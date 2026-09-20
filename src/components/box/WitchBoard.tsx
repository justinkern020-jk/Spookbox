import { useEffect, useRef } from "react";
import { bindPlanchetteToField, planchette, type Glyph } from "@/lib/box/planchette";
import type { ThemeId } from "@/lib/box/theme";

function paint() {
  const s = getComputedStyle(document.documentElement);
  const hex = (name: string, fb: string) => s.getPropertyValue(name).trim() || fb;
  return {
    bg: hex("--color-bg", "#070807"),
    surface: hex("--color-surface", "#101410"),
    raised: hex("--color-raised", "#171c17"),
    fg: hex("--color-fg", "#c8d4c4"),
    muted: hex("--color-muted", "#7a8a7a"),
    accent: hex("--color-accent", "#8fbf7a"),
    line: hex("--color-line", "#2a322a"),
    danger: hex("--color-danger", "#b85a4a"),
  };
}

function drawGlyph(ctx: CanvasRenderingContext2D, g: Glyph, c: ReturnType<typeof paint>, lit: boolean) {
  ctx.save();
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  const token = g.id.length > 1;
  ctx.font = token
    ? `700 13px "IBM Plex Sans", system-ui, sans-serif`
    : `600 16px "IBM Plex Mono", ui-monospace, monospace`;
  ctx.fillStyle = lit ? c.accent : c.fg;
  ctx.globalAlpha = lit ? 1 : 0.82;
  if (lit) {
    ctx.shadowColor = c.accent;
    ctx.shadowBlur = 14;
  }
  ctx.fillText(g.label, g.x, g.y);
  ctx.restore();
}

function drawPlanchette(ctx: CanvasRenderingContext2D, x: number, y: number, c: ReturnType<typeof paint>, steam: boolean) {
  ctx.save();
  ctx.translate(x, y);
  ctx.shadowColor = "rgba(0,0,0,0.55)";
  ctx.shadowBlur = 10;
  ctx.shadowOffsetY = 3;
  ctx.beginPath();
  ctx.ellipse(0, 2, 32, 26, 0, 0, Math.PI * 2);
  ctx.fillStyle = steam ? c.raised : c.surface;
  ctx.fill();
  ctx.shadowBlur = 0;
  ctx.lineWidth = 2.5;
  ctx.strokeStyle = c.accent;
  ctx.stroke();
  ctx.beginPath();
  ctx.arc(0, -1, 11, 0, Math.PI * 2);
  ctx.fillStyle = c.bg;
  ctx.fill();
  ctx.strokeStyle = c.fg;
  ctx.lineWidth = 1.75;
  ctx.stroke();
  ctx.beginPath();
  ctx.arc(0, -1, 4, 0, Math.PI * 2);
  ctx.fillStyle = c.accent;
  ctx.fill();
  ctx.restore();
}

export function WitchBoard({
  theme,
  onSpelled,
}: {
  theme: ThemeId;
  onSpelled: (word: string, built: string) => void;
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const wrapRef = useRef<HTMLDivElement>(null);
  const doneRef = useRef(onSpelled);
  doneRef.current = onSpelled;
  const lastWord = useRef("");

  useEffect(() => bindPlanchetteToField(), []);

  useEffect(() => {
    const canvas = canvasRef.current;
    const wrap = wrapRef.current;
    if (!canvas || !wrap) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    let raf = 0;
    let last = performance.now();
    let lastActive = false;

    const fit = () => {
      const dpr = Math.min(2, window.devicePixelRatio || 1);
      const w = wrap.clientWidth;
      const h = Math.max(300, Math.round(w * 1.15));
      canvas.style.width = `${w}px`;
      canvas.style.height = `${h}px`;
      canvas.width = Math.floor(w * dpr);
      canvas.height = Math.floor(h * dpr);
      planchette.resize(w, h);
    };

    const ro = new ResizeObserver(fit);
    ro.observe(wrap);
    fit();

    const loop = (now: number) => {
      raf = requestAnimationFrame(loop);
      const dt = Math.min(0.05, (now - last) / 1000);
      last = now;
      planchette.tick(reduce ? dt * 3 : dt);

      const c = paint();
      const dpr = Math.min(2, window.devicePixelRatio || 1);
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      const w = planchette.w;
      const h = planchette.h;
      ctx.fillStyle = c.bg;
      ctx.fillRect(0, 0, w, h);
      ctx.fillStyle = c.surface;
      ctx.beginPath();
      ctx.roundRect(6, 6, w - 12, h - 12, 16);
      ctx.fill();
      ctx.strokeStyle = c.line;
      ctx.lineWidth = 2;
      ctx.stroke();

      const litId = planchette.target?.id ?? "";
      for (const g of planchette.glyphs) {
        drawGlyph(ctx, g, c, planchette.spell.active && g.id === litId);
      }

      drawPlanchette(ctx, planchette.x, planchette.y, c, theme === "steam");

      const active = planchette.spell.active;
      if (lastActive && !active && planchette.spell.word && planchette.spell.word !== lastWord.current) {
        lastWord.current = planchette.spell.word;
        doneRef.current(planchette.spell.word, planchette.spell.built);
      }
      lastActive = active;
    };
    raf = requestAnimationFrame(loop);
    return () => {
      cancelAnimationFrame(raf);
      ro.disconnect();
    };
  }, [theme]);

  return (
    <div ref={wrapRef} className="witch-board">
      <canvas ref={canvasRef} className="witch-board__canvas" aria-label="Witch Board" />
    </div>
  );
}
