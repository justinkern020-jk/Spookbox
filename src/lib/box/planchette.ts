import { field, type FieldReading } from "./field";
import { hashString, pickAnswer, pickWord } from "./lexicon";

/** A glyph on the witch board — letters, digits, and the corner tokens. */
export type Glyph = {
  id: string;
  label: string;
  x: number;
  y: number;
};

export type SpellState = {
  word: string;
  built: string;
  index: number;
  active: boolean;
};

type Listener = (s: { x: number; y: number; spell: SpellState; uT: number; delta: number }) => void;

const LETTERS = "ABCDEFGHIJKLMNOPQRSTUVWXYZ".split("");
const DIGITS = "1234567890".split("");

function clamp(n: number, a: number, b: number) {
  return Math.max(a, Math.min(b, n));
}

function hypot(x: number, y: number) {
  return Math.sqrt(x * x + y * y);
}

/**
 * Map a spoken/dictionary word onto board tokens.
 * YES / NO / GOODBYE are whole glyphs; everything else is spelled A–Z / 0–9.
 */
export function tokenize(word: string): string[] {
  const raw = word.trim().toUpperCase();
  if (raw === "YES" || raw === "YEP" || raw === "YEAH") return ["YES"];
  if (raw === "NO" || raw === "NOPE") return ["NO"];
  if (raw === "GOODBYE" || raw === "GOOD BYE" || raw === "BYE") return ["GOODBYE"];
  const out: string[] = [];
  for (const ch of raw) {
    if (ch === " " || ch === "'" || ch === "-") {
      out.push("PAUSE");
      continue;
    }
    if (/[A-Z0-9]/.test(ch)) out.push(ch);
  }
  return out.length ? out : ["YES"];
}

/** Lay out glyphs in board space (origin top-left, units = canvas CSS pixels). */
export function layoutGlyphs(w: number, h: number): Glyph[] {
  const padX = w * 0.08;
  const padY = h * 0.1;
  const glyphs: Glyph[] = [];
  glyphs.push({ id: "YES", label: "YES", x: padX + 28, y: padY });
  glyphs.push({ id: "NO", label: "NO", x: w - padX - 28, y: padY });

  const rows = [LETTERS.slice(0, 13), LETTERS.slice(13)];
  rows.forEach((row, ri) => {
    const y = padY + h * 0.22 + ri * (h * 0.16);
    const inner = w - padX * 2;
    row.forEach((ch, i) => {
      const x = padX + (inner * (i + 0.5)) / row.length;
      glyphs.push({ id: ch, label: ch, x, y });
    });
  });

  const yD = padY + h * 0.22 + 2 * (h * 0.16);
  const inner = w - padX * 2;
  DIGITS.forEach((d, i) => {
    const x = padX + (inner * (i + 0.5)) / DIGITS.length;
    glyphs.push({ id: d, label: d, x, y: yD });
  });

  glyphs.push({ id: "GOODBYE", label: "GOODBYE", x: w * 0.5, y: h - padY * 0.85 });
  return glyphs;
}

/**
 * Planchette physics: critically-damped seek + live EMF force.
 * µT / milligauss from the phone magnetometer (or compass delta) shove the
 * pointer; a spike queues a dictionary word and we steer letter-by-letter.
 */
export class PlanchetteEngine {
  x = 0.5;
  y = 0.5;
  vx = 0;
  vy = 0;
  w = 320;
  h = 380;
  glyphs: Glyph[] = [];
  uT = 0;
  delta = 0;
  heading = 0;
  live = false;
  spell: SpellState = { word: "", built: "", index: 0, active: false };
  target: Glyph | null = null;

  private listeners = new Set<Listener>();
  private queue: string[] = [];
  private dwellUntil = 0;
  private lastSpike = 0;
  private question: string | null = null;
  asked = false;
  /** When false, EMF still shoves the pointer but spikes don't start a spell. */
  spellOnSpike = true;
  private controlX = 0;
  private controlY = 0;
  private along = 1;
  private fromX = 0;
  private fromY = 0;

  onFrame(fn: Listener) {
    this.listeners.add(fn);
    return () => {
      this.listeners.delete(fn);
    };
  }

  private emit() {
    const snap = { x: this.x, y: this.y, spell: { ...this.spell }, uT: this.uT, delta: this.delta };
    for (const fn of this.listeners) fn(snap);
  }

  resize(w: number, h: number) {
    this.w = Math.max(1, w);
    this.h = Math.max(1, h);
    this.glyphs = layoutGlyphs(this.w, this.h);
    if (!this.spell.active) {
      this.x = this.w * 0.5;
      this.y = this.h * 0.55;
    }
  }

  /** Hold a question so the next spike (or a forced seek) answers that, not a random lock. */
  setQuestion(q: string | null) {
    this.question = q && q.trim() ? q.trim() : null;
    this.asked = false;
  }

  /**
   * Feed a live magnetometer sample. `microtesla` is used as-is; compass-only
   * devices pass heading + delta and we treat delta as a relative field shove.
   */
  ingest(reading: FieldReading) {
    this.live = reading.live;
    this.uT = reading.microtesla ?? reading.milligauss / 10;
    this.delta = reading.delta;
    this.heading = reading.heading ?? this.heading;
    if (reading.spike) this.onSpike(reading);
  }

  /** Begin spelling `word` along a curved path through each glyph. */
  spellWord(word: string) {
    const tokens = tokenize(word);
    this.queue = tokens;
    this.spell = { word, built: "", index: 0, active: true };
    this.dwellUntil = 0;
    this.advanceTarget();
    this.emit();
  }

  private onSpike(reading: FieldReading) {
    if (!this.spellOnSpike) return;
    const now = performance.now();
    if (now - this.lastSpike < 1600) return;
    this.lastSpike = now;
    if (this.spell.active) return;
    const salt = ((this.uT * 10) | 0) ^ ((reading.delta * 100) | 0) ^ (now | 0);
    const word = this.question && !this.asked
      ? pickAnswer(this.question, salt)
      : pickWord((hashString(String(salt)) >>> 0) / 4294967296);
    if (this.question) this.asked = true;
    this.spellWord(word);
  }

  /** Force a dictionary (or question) hit — used by Ask. */
  triggerFromAsk(question: string, salt: number) {
    this.setQuestion(question);
    const word = pickAnswer(question, salt);
    this.asked = true;
    this.spellWord(word);
    return word;
  }

  private glyphById(id: string) {
    return this.glyphs.find((g) => g.id === id) ?? null;
  }

  /**
   * Quadratic control point between current pose and the next glyph.
   * Bulge amount is EMF-weighted so a hot field takes a wider arc.
   */
  private setCurve(to: Glyph) {
    this.fromX = this.x;
    this.fromY = this.y;
    this.along = 0;
    const mx = (this.x + to.x) * 0.5;
    const my = (this.y + to.y) * 0.5;
    let nx = -(to.y - this.y);
    let ny = to.x - this.x;
    const len = hypot(nx, ny) || 1;
    nx /= len;
    ny /= len;
    const bulge = (18 + clamp(this.delta, 0, 40) * 1.4) * (this.uT % 2 >= 1 ? 1 : -1);
    this.controlX = mx + nx * bulge;
    this.controlY = my + ny * bulge;
  }

  private advanceTarget() {
    while (this.queue.length && this.queue[0] === "PAUSE") {
      this.queue.shift();
      this.spell.built += " ";
    }
    const next = this.queue.shift();
    if (!next) {
      this.spell.active = false;
      this.target = null;
      this.emit();
      return;
    }
    const g = this.glyphById(next);
    this.target = g;
    if (g) this.setCurve(g);
    this.dwellUntil = 0;
  }

  /**
   * Step the integrator. `dt` in seconds. Call from rAF.
   * Seek uses a critically-damped spring; EMF adds a world-space shove.
   */
  tick(dt: number) {
    const dtClamped = clamp(dt, 0, 0.05);
    const now = performance.now();

    // Live field shove — idle wander + spelling jitter.
    const ang = (this.heading + this.uT * 3.2) * (Math.PI / 180);
    const shove = clamp(this.delta, 0, 28) * (this.spell.active ? 8 : 14);
    const fx = Math.cos(ang) * shove + Math.sin(now * 0.0017 + this.uT) * (6 + this.delta);
    const fy = Math.sin(ang) * shove + Math.cos(now * 0.0013 + this.heading) * (6 + this.delta * 0.5);

    if (this.spell.active && this.target && this.dwellUntil === 0) {
      this.along = clamp(this.along + dtClamped * (1.15 + clamp(this.delta, 0, 20) * 0.03), 0, 1);
      const t = this.along;
      const omt = 1 - t;
      // Quadratic Bezier: P = (1-t)² P0 + 2(1-t)t C + t² P1
      const px = omt * omt * this.fromX + 2 * omt * t * this.controlX + t * t * this.target.x;
      const py = omt * omt * this.fromY + 2 * omt * t * this.controlY + t * t * this.target.y;
      // Spring toward the curve sample so EMF can still nudge off-path.
      const kx = (px - this.x) * 18;
      const ky = (py - this.y) * 18;
      this.vx += (kx + fx * 0.35) * dtClamped;
      this.vy += (ky + fy * 0.35) * dtClamped;
      this.vx *= 0.86;
      this.vy *= 0.86;
      this.x += this.vx * dtClamped * 60;
      this.y += this.vy * dtClamped * 60;

      const d = hypot(this.target.x - this.x, this.target.y - this.y);
      if (t >= 0.97 || d < 14) {
        this.x = this.target.x;
        this.y = this.target.y;
        this.vx = 0;
        this.vy = 0;
        this.reveal(this.target.id);
        this.dwellUntil = now + (this.target.id.length > 1 ? 520 : 280);
        this.emit();
      }
    } else if (this.spell.active && this.dwellUntil && now >= this.dwellUntil) {
      this.dwellUntil = 0;
      this.advanceTarget();
    } else {
      // Idle: rest near center, shoved by the live field.
      const hx = this.w * 0.5 - this.x;
      const hy = this.h * 0.55 - this.y;
      this.vx += (hx * 4 + fx) * dtClamped;
      this.vy += (hy * 4 + fy) * dtClamped;
      this.vx *= 0.9;
      this.vy *= 0.9;
      this.x += this.vx * dtClamped * 60;
      this.y += this.vy * dtClamped * 60;
    }

    this.x = clamp(this.x, 18, this.w - 18);
    this.y = clamp(this.y, 18, this.h - 18);
    this.emit();
  }

  /** Reveal the prefix of `spell.word` once a glyph is reached. */
  private reveal(hit: string) {
    if (hit.length > 1) {
      this.spell.built = this.spell.word;
      return;
    }
    const want = this.spell.built.replace(/[^a-z0-9]/gi, "").length + 1;
    let n = 0;
    let out = "";
    for (const ch of this.spell.word) {
      if (/[a-z0-9]/i.test(ch)) {
        n += 1;
        out += ch;
        if (n >= want) break;
      } else if (n > 0) {
        out += ch;
      }
    }
    this.spell.built = out;
  }
}

export const planchette = new PlanchetteEngine();

/** Keep the engine wired to the shared magnetometer singleton. */
export function bindPlanchetteToField() {
  return field.onReading((r) => planchette.ingest(r));
}
