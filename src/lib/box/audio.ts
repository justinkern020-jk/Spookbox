import { hashBins, hashString, pickAnswer, pickWord } from "./lexicon";

export type BandId = "fm" | "am" | "air";
export type ScanDir = "fwd" | "rev" | "bounce";

export type Band = {
  id: BandId;
  label: string;
  min: number;
  max: number;
  step: number;
  unit: string;
};

export const BANDS: Record<BandId, Band> = {
  fm: { id: "fm", label: "FM", min: 87.5, max: 108.0, step: 0.1, unit: "MHz" },
  am: { id: "am", label: "AM", min: 530, max: 1700, step: 10, unit: "kHz" },
  air: { id: "air", label: "AIR", min: 118.0, max: 137.0, step: 0.025, unit: "MHz" },
};

export type LogHit = {
  id: number;
  at: number;
  word: string;
  freq: number;
  band: BandId;
  strength: number;
  asked?: string;
  /** Optional rite library event (tradition + prayer). */
  rite?: {
    tradition: string;
    prayer: string;
    action: "armed" | "start" | "stop" | "complete";
  };
  /** Optional EVP recorder event. */
  evp?: {
    action: "armed" | "start" | "stop" | "mark";
    /** Clip label e.g. EVP-1 */
    clip?: string;
    /** Mark offset from clip start, ms */
    offsetMs?: number;
    /** Clip duration at stop, ms */
    durationMs?: number;
  };
  /** Optional SLS (structured light / stick-figure) event. */
  sls?: {
    action: "armed" | "start" | "stop" | "lock" | "capture";
    /** pose = MediaPipe; motion = contrast/blob fallback */
    mode?: "pose" | "motion";
    /** Figures locked or present at event */
    figures?: number;
    facing?: "environment" | "user";
  };
  /** Optional cold-spot / ambient meter event. */
  cold?: {
    action: "armed" | "calibrate" | "drop" | "spike";
    source?: "temperature" | "light";
    value?: number;
    delta?: number;
    unit?: "°C" | "lux";
  };
  /** Optional ITC / Spirit Line in-app audio session (not cellular). */
  spiritLine?: {
    action: "armed" | "incoming" | "answered" | "declined" | "ended" | "held" | "mute";
    /** Call duration at end/decline, ms */
    durationMs?: number;
    /** Outcome label e.g. answered, declined, missed */
    outcome?: string;
  };
};

export type BoxFrame = {
  freq: number;
  band: BandId;
  scanning: boolean;
  holding: boolean;
  askMode: boolean;
  asking: boolean;
  rms: number;
  word: string | null;
  log: LogHit[];
};

type Listener = (frame: BoxFrame) => void;

function makePinkBuffer(ctx: AudioContext, seconds = 3) {
  const n = Math.floor(ctx.sampleRate * seconds);
  const buf = ctx.createBuffer(1, n, ctx.sampleRate);
  const d = buf.getChannelData(0);
  let b0 = 0,
    b1 = 0,
    b2 = 0,
    b3 = 0,
    b4 = 0,
    b5 = 0,
    b6 = 0;
  for (let i = 0; i < n; i++) {
    const w = Math.random() * 2 - 1;
    b0 = 0.99886 * b0 + w * 0.0555179;
    b1 = 0.99332 * b1 + w * 0.0750759;
    b2 = 0.969 * b2 + w * 0.153852;
    b3 = 0.8665 * b3 + w * 0.3104856;
    b4 = 0.55 * b4 + w * 0.5329522;
    b5 = -0.7616 * b5 - w * 0.016898;
    d[i] = (b0 + b1 + b2 + b3 + b4 + b5 + b6 + w * 0.5362) * 0.12;
    b6 = w * 0.115926;
  }
  return buf;
}

function mapFreq(band: Band, radio: number) {
  const t = (radio - band.min) / (band.max - band.min);
  return 280 + t * 4200;
}

export class SpiritBoxEngine {
  private ctx: AudioContext | null = null;
  private master: GainNode | null = null;
  private sfx: GainNode | null = null;
  private noiseGain: GainNode | null = null;
  private bandpass: BiquadFilterNode | null = null;
  private highpass: BiquadFilterNode | null = null;
  private analyser: AnalyserNode | null = null;
  private noiseSrc: AudioBufferSourceNode | null = null;
  private carrier: OscillatorNode | null = null;
  private carrierGain: GainNode | null = null;
  private chop: GainNode | null = null;
  private micSrc: MediaStreamAudioSourceNode | null = null;
  private micGain: GainNode | null = null;
  private micDry: GainNode | null = null;
  private micStream: MediaStream | null = null;

  private listeners = new Set<Listener>();
  private raf = 0;
  private lastStep = 0;
  private bounce = 1;
  private wordUntil = 0;
  private currentWord: string | null = null;
  private log: LogHit[] = [];
  private hitId = 1;
  private bins = new Uint8Array(128);
  private rms = 0;
  private muted = false;
  private looping = false;
  private firstLock = true;
  private fieldBoostUntil = 0;
  private askGen = 0;
  private pendingAsk: { question: string; answer: string; at: number; i: number; last: number } | null = null;

  band: BandId = "fm";
  freq = BANDS.fm.min;
  scanning = false;
  holding = false;
  askMode = false;
  asking = false;
  lastAsked = "";
  dir: ScanDir = "fwd";
  intervalMs = 140;
  volume = 0.72;

  onFrame(fn: Listener) {
    this.listeners.add(fn);
    return () => {
      this.listeners.delete(fn);
    };
  }

  private emit() {
    const frame: BoxFrame = {
      freq: this.freq,
      band: this.band,
      scanning: this.scanning,
      holding: this.holding,
      askMode: this.askMode,
      asking: this.asking,
      rms: this.rms,
      word: this.currentWord,
      log: this.log,
    };
    for (const fn of this.listeners) fn(frame);
  }

  /** Spectrum canvas reads this; it does not go through React. */
  pullBins(): { bins: Uint8Array; rms: number } {
    if (this.analyser) this.analyser.getByteFrequencyData(this.bins);
    return { bins: this.bins, rms: this.rms };
  }

  async unlock() {
    if (!this.ctx) {
      const ctx = new AudioContext({ latencyHint: "interactive" });
      this.ctx = ctx;
      if (ctx.state === "suspended") await ctx.resume();

      const master = ctx.createGain();
      const sfx = ctx.createGain();
      const noiseGain = ctx.createGain();
      const chop = ctx.createGain();
      const bandpass = ctx.createBiquadFilter();
      const highpass = ctx.createBiquadFilter();
      const analyser = ctx.createAnalyser();
      const carrier = ctx.createOscillator();
      const carrierGain = ctx.createGain();

      master.gain.value = this.muted ? 0 : this.volume * this.volume;
      sfx.gain.value = 1;
      noiseGain.gain.value = 0.9;
      chop.gain.value = 0.85;
      carrierGain.gain.value = 0.08;
      bandpass.type = "bandpass";
      bandpass.Q.value = 3.2;
      bandpass.frequency.value = 900;
      highpass.type = "highpass";
      highpass.frequency.value = 120;
      analyser.fftSize = 256;
      analyser.smoothingTimeConstant = 0.35;
      carrier.type = "sawtooth";
      carrier.frequency.value = 1180;

      const pink = ctx.createBufferSource();
      pink.buffer = makePinkBuffer(ctx, 1);
      pink.loop = true;

      pink.connect(noiseGain);
      noiseGain.connect(chop);
      carrier.connect(carrierGain);
      carrierGain.connect(chop);
      chop.connect(highpass);
      highpass.connect(bandpass);
      bandpass.connect(analyser);
      analyser.connect(sfx);
      sfx.connect(master);
      master.connect(ctx.destination);

      pink.start();
      carrier.start();

      this.master = master;
      this.sfx = sfx;
      this.noiseGain = noiseGain;
      this.chop = chop;
      this.bandpass = bandpass;
      this.highpass = highpass;
      this.analyser = analyser;
      this.noiseSrc = pink;
      this.carrier = carrier;
      this.carrierGain = carrierGain;
    }
    if (this.ctx.state === "suspended") await this.ctx.resume();
    if (!this.looping) {
      this.looping = true;
      this.loop();
    }
    this.emit();
  }

  resume() {
    if (this.ctx?.state === "suspended") void this.ctx.resume();
  }

  setMuted(next: boolean) {
    this.muted = next;
    if (this.master && this.ctx) {
      this.master.gain.setTargetAtTime(next ? 0 : this.volume * this.volume, this.ctx.currentTime, 0.03);
    }
  }

  setVolume(v: number) {
    this.volume = v;
    if (!this.muted && this.master && this.ctx) {
      this.master.gain.setTargetAtTime(v * v, this.ctx.currentTime, 0.03);
    }
  }

  setBand(id: BandId) {
    this.band = id;
    this.freq = BANDS[id].min;
    this.applyFilters();
    this.emit();
  }

  setDir(dir: ScanDir) {
    this.dir = dir;
    if (dir !== "bounce") this.bounce = dir === "rev" ? -1 : 1;
  }

  setSpeed(ms: number) {
    this.intervalMs = ms;
  }

  setAskMode(on: boolean) {
    this.askMode = on;
    if (!on) {
      this.asking = false;
      this.pendingAsk = null;
    } else {
      this.firstLock = false;
    }
    this.emit();
  }

  private askTimer = 0;

  logHit(word: string, asked?: string) {
    this.lockWord(word, 1, asked);
  }

  logRite(
    tradition: string,
    prayer: string,
    action: "armed" | "start" | "stop" | "complete",
  ) {
    const label =
      action === "armed"
        ? `RITE · ${prayer}`
        : action === "start"
          ? `RITE START · ${prayer}`
          : action === "stop"
            ? `RITE STOP · ${prayer}`
            : `RITE END · ${prayer}`;
    const hit: LogHit = {
      id: this.hitId++,
      at: Date.now(),
      word: label,
      freq: this.freq,
      band: this.band,
      strength: 1,
      asked: tradition,
      rite: { tradition, prayer, action },
    };
    this.log = [hit, ...this.log].slice(0, 48);
    this.emit();
  }

  logEvp(
    action: "armed" | "start" | "stop" | "mark",
    opts?: { clip?: string; offsetMs?: number; durationMs?: number },
  ) {
    const clip = opts?.clip;
    const label =
      action === "armed"
        ? "EVP · ARMED"
        : action === "start"
          ? clip
            ? `EVP START · ${clip}`
            : "EVP START"
          : action === "stop"
            ? clip
              ? `EVP STOP · ${clip}`
              : "EVP STOP"
            : opts?.offsetMs != null
              ? `EVP MARK · ${(opts.offsetMs / 1000).toFixed(1)}s`
              : "EVP MARK";
    const hit: LogHit = {
      id: this.hitId++,
      at: Date.now(),
      word: label,
      freq: this.freq,
      band: this.band,
      strength: 1,
      evp: {
        action,
        clip,
        offsetMs: opts?.offsetMs,
        durationMs: opts?.durationMs,
      },
    };
    this.log = [hit, ...this.log].slice(0, 48);
    this.emit();
  }

  logSls(
    action: "armed" | "start" | "stop" | "lock" | "capture",
    opts?: { mode?: "pose" | "motion"; figures?: number; facing?: "environment" | "user" },
  ) {
    const mode = opts?.mode;
    const figures = opts?.figures;
    const facing = opts?.facing;
    const modeTag = mode ? ` · ${mode}` : "";
    const figTag =
      figures != null && figures > 0 ? ` · ${figures} fig${figures === 1 ? "" : "s"}` : "";
    const label =
      action === "armed"
        ? facing
          ? `SLS · ARMED · ${facing}`
          : "SLS · ARMED"
        : action === "start"
          ? `SLS START${modeTag}`
          : action === "stop"
            ? `SLS STOP${modeTag}`
            : action === "lock"
              ? `SLS LOCK${modeTag}${figTag}`
              : `SLS CAPTURE${modeTag}${figTag}`;
    const hit: LogHit = {
      id: this.hitId++,
      at: Date.now(),
      word: label,
      freq: this.freq,
      band: this.band,
      strength: 1,
      sls: { action, mode, figures, facing },
    };
    this.log = [hit, ...this.log].slice(0, 48);
    this.emit();
  }

  logCold(
    action: "armed" | "calibrate" | "drop" | "spike",
    opts?: {
      source?: "temperature" | "light";
      value?: number;
      delta?: number;
      unit?: "°C" | "lux";
    },
  ) {
    const source = opts?.source;
    const unit = opts?.unit;
    const value = opts?.value;
    const delta = opts?.delta;
    const srcTag = source ? ` · ${source}` : "";
    const valTag =
      value != null && unit
        ? ` · ${value.toFixed(source === "temperature" ? 1 : 0)}${unit}`
        : "";
    const dTag =
      delta != null && unit
        ? ` · Δ${delta >= 0 ? "+" : ""}${delta.toFixed(source === "temperature" ? 2 : 0)}${unit}`
        : "";
    const label =
      action === "armed"
        ? `COLD · ARMED${srcTag}`
        : action === "calibrate"
          ? `COLD · CAL${srcTag}${valTag}`
          : action === "drop"
            ? `COLD DROP${srcTag}${dTag}`
            : `COLD SPIKE${srcTag}${dTag}`;
    const hit: LogHit = {
      id: this.hitId++,
      at: Date.now(),
      word: label,
      freq: this.freq,
      band: this.band,
      strength: 1,
      cold: { action, source, value, delta, unit },
    };
    this.log = [hit, ...this.log].slice(0, 48);
    this.emit();
  }

  logSpiritLine(
    action: "armed" | "incoming" | "answered" | "declined" | "ended" | "held" | "mute",
    opts?: { durationMs?: number; outcome?: string },
  ) {
    const durationMs = opts?.durationMs;
    const outcome = opts?.outcome;
    const durTag =
      durationMs != null ? ` · ${(durationMs / 1000).toFixed(1)}s` : "";
    const outTag = outcome ? ` · ${outcome}` : "";
    const label =
      action === "armed"
        ? "ITC · ARMED"
        : action === "incoming"
          ? outcome
            ? `ITC · RING · ${outcome}`
            : "ITC · RING"
          : action === "answered"
            ? "ITC · ANSWER"
            : action === "declined"
              ? `ITC · DECLINE${durTag}`
              : action === "ended"
                ? `ITC · END${durTag}${outTag}`
                : action === "held"
                  ? "ITC · HOLD"
                  : "ITC · MUTE";
    const hit: LogHit = {
      id: this.hitId++,
      at: Date.now(),
      word: label,
      freq: this.freq,
      band: this.band,
      strength: 1,
      spiritLine: { action, durationMs, outcome },
    };
    this.log = [hit, ...this.log].slice(0, 48);
    this.emit();
  }

  lockFromField(delta: number) {
    if (this.askMode) return;
    const now = performance.now();
    if (now < this.fieldBoostUntil) return;
    this.fieldBoostUntil = now + 1400;
    this.firstLock = false;
    const seed = hashBins(this.bins, this.freq + delta * 17) / 4294967296;
    this.lockWord(pickWord(seed + delta), Math.min(1, 0.35 + delta / 12));
  }

  startScan() {
    void this.ctx?.resume();
    this.scanning = true;
    this.holding = false;
    this.lastStep = 0;
    this.emit();
  }

  stopScan() {
    this.scanning = false;
    this.emit();
  }

  toggleHold() {
    this.holding = !this.holding;
    if (this.holding) this.scanning = false;
    this.emit();
  }

  clearLog() {
    this.log = [];
    this.emit();
  }

  attachMic(stream: MediaStream): boolean {
    if (!this.ctx || !this.bandpass || !this.sfx) return false;
    this.dropMic();
    try {
      void this.ctx.resume();
      stream.getAudioTracks().forEach((t) => {
        t.enabled = true;
      });
      const src = this.ctx.createMediaStreamSource(stream);
      const g = this.ctx.createGain();
      const dry = this.ctx.createGain();
      g.gain.value = 1.35;
      dry.gain.value = 0.55;
      src.connect(g);
      g.connect(this.bandpass);
      g.connect(dry);
      dry.connect(this.sfx);
      this.micStream = stream;
      this.micSrc = src;
      this.micGain = g;
      this.micDry = dry;
      return true;
    } catch {
      return false;
    }
  }

  dropMic() {
    this.micStream?.getTracks().forEach((t) => t.stop());
    this.micSrc?.disconnect();
    this.micGain?.disconnect();
    this.micDry?.disconnect();
    this.micSrc = null;
    this.micGain = null;
    this.micDry = null;
    this.micStream = null;
  }

  private applyFilters() {
    if (!this.ctx || !this.bandpass || !this.carrier) return;
    const band = BANDS[this.band];
    const hz = mapFreq(band, this.freq);
    if (!Number.isFinite(hz)) return;
    const t = this.ctx.currentTime;
    try {
      this.bandpass.frequency.setTargetAtTime(hz, t, 0.012);
      this.carrier.frequency.setTargetAtTime(420 + hz * 0.55, t, 0.02);
    } catch {
      /* closed or invalid context */
    }
  }

  private step() {
    const band = BANDS[this.band];
    const sign = this.dir === "rev" ? -1 : this.dir === "fwd" ? 1 : this.bounce;
    let next = this.freq + sign * band.step;
    if (next > band.max || next < band.min) {
      if (this.dir === "bounce") {
        this.bounce *= -1;
        next = this.freq + this.bounce * band.step;
      } else if (next > band.max) next = band.min;
      else next = band.max;
    }
    const stepped = Number(next.toFixed(band.step < 1 ? 3 : 0));
    this.freq = Number.isFinite(stepped) ? stepped : band.min;
    this.applyFilters();
    this.clickChop();
    this.emit();
  }

  private clickChop() {
    if (!this.ctx || !this.chop) return;
    const t = this.ctx.currentTime;
    const g = this.chop.gain;
    const end = t + Math.max(0.04, Math.min(0.12, this.intervalMs / 1000));
    try {
      g.cancelScheduledValues(t);
      g.setValueAtTime(0.25, t);
      g.linearRampToValueAtTime(1, t + 0.012);
      g.linearRampToValueAtTime(0.4, end);
    } catch {
      /* ignore scheduling races */
    }
  }

  private fireFormants(word: string) {
    if (!this.ctx || !this.sfx) return;
    const t0 = this.ctx.currentTime;
    const voiced = /[aeiouy]/i.test(word);
    const base = 140 + (word.length * 37) % 90;
    const last = word.charCodeAt(Math.max(0, word.length - 1)) || 65;
    const f1 = voiced ? 420 + (word.charCodeAt(0) % 18) * 22 : 700;
    const f2 = 1100 + (last % 24) * 55;
    const dur = 0.12 + Math.min(0.16, word.length * 0.012);
    const parts = this.dir === "rev" ? [f2, f1, base] : [base, f1, f2];
    try {
      parts.forEach((f, i) => {
        const o = this.ctx!.createOscillator();
        const g = this.ctx!.createGain();
        const bp = this.ctx!.createBiquadFilter();
        o.type = i === 0 ? "sawtooth" : "triangle";
        o.frequency.value = f;
        bp.type = "bandpass";
        bp.frequency.value = f;
        bp.Q.value = 7;
        const start = t0 + i * 0.028;
        g.gain.setValueAtTime(0.0001, start);
        g.gain.linearRampToValueAtTime(0.16, start + 0.012);
        g.gain.linearRampToValueAtTime(0.0001, start + dur);
        o.connect(bp);
        bp.connect(g);
        g.connect(this.sfx!);
        o.start(start);
        o.stop(start + dur + 0.02);
      });
    } catch {
      /* audio graph not available */
    }
  }

  private maybeLock(flux: number) {
    if (this.askMode || this.asking) return;
    if (!this.scanning || this.holding) return;
    if (performance.now() < this.wordUntil) return;
    if (this.firstLock) {
      this.firstLock = false;
      this.lockWord("they hate it when you do this", 1);
      return;
    }
    const boost = performance.now() < this.fieldBoostUntil ? 0.38 : 0;
    const chance = 0.12 + Math.min(0.22, flux * 1.4) + boost;
    if (Math.random() > chance) return;
    const seed = hashBins(this.bins, this.freq) / 4294967296;
    this.lockWord(pickWord(seed + flux), flux);
  }

  private lockWord(word: string, strength: number, asked?: string) {
    this.currentWord = word;
    this.wordUntil = performance.now() + 2200 + this.intervalMs * 3;
    this.fireFormants(word);
    const hit: LogHit = {
      id: this.hitId++,
      at: Date.now(),
      word,
      freq: this.freq,
      band: this.band,
      strength,
      asked,
    };
    this.log = [hit, ...this.log].slice(0, 48);
    this.emit();
  }

  private loop = () => {
    if (!this.looping) return;
    this.raf = requestAnimationFrame(this.loop);
    if (!this.analyser || !this.ctx || this.ctx.state === "closed") return;
    try {
      this.analyser.getByteFrequencyData(this.bins);
      let sum = 0;
      for (let i = 0; i < this.bins.length; i++) sum += this.bins[i]!;
      const nextRms = sum / this.bins.length / 255;
      const flux = Math.max(0, nextRms - this.rms);
      this.rms = nextRms * 0.4 + this.rms * 0.6;

      const now = performance.now();
      if (this.scanning && !this.holding && now - this.lastStep >= this.intervalMs) {
        this.lastStep = now;
        this.step();
        this.maybeLock(flux + nextRms);
      }
      if (!this.asking && this.currentWord && now > this.wordUntil + 400) {
        this.currentWord = null;
        this.emit();
      }
    } catch {
      /* keep the box alive if a single audio frame fails */
    }
  };

  dispose() {
    this.looping = false;
    cancelAnimationFrame(this.raf);
    this.micStream?.getTracks().forEach((t) => t.stop());
    try {
      void this.ctx?.close();
    } catch {
      /* already closed */
    }
    this.ctx = null;
    this.analyser = null;
    this.chop = null;
  }
}

export const box = new SpiritBoxEngine();

if (typeof document !== "undefined") {
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "visible") box.resume();
  });
}

if (import.meta.hot) {
  import.meta.hot.dispose(() => box.dispose());
}
