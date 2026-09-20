import { useEffect, useRef, useState } from "react";
import { Aperture, Camera, Square, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { box } from "@/lib/box/audio";
import { cameraErrorMessage, requestCamera } from "@/lib/box/camera";
import { inEmbeddedPreview } from "@/lib/box/mic";
import {
  drawFigures,
  drawScanGrid,
  SlsPoseEngine,
  type PoseFrame,
  type PoseMode,
} from "@/lib/box/sls-pose";

type Phase = "idle" | "armed" | "scanning";

function hexRgb(hex: string) {
  const h = hex.replace("#", "").trim();
  if (h.length < 6) return { r: 143, g: 191, b: 122 };
  return {
    r: Number.parseInt(h.slice(0, 2), 16),
    g: Number.parseInt(h.slice(2, 4), 16),
    b: Number.parseInt(h.slice(4, 6), 16),
  };
}

function accentColor() {
  const styles = getComputedStyle(document.documentElement);
  const accent = styles.getPropertyValue("--color-accent").trim() || "#8fbf7a";
  return hexRgb(accent);
}

export function SlsPanel() {
  const [phase, setPhase] = useState<Phase>("idle");
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const [facing, setFacing] = useState<"environment" | "user" | null>(null);
  const [mode, setMode] = useState<PoseMode>("idle");
  const [modeNote, setModeNote] = useState<string | null>(null);
  const [figureCount, setFigureCount] = useState(0);
  const [stillUrl, setStillUrl] = useState<string | null>(null);

  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const engineRef = useRef<SlsPoseEngine | null>(null);
  const rafRef = useRef(0);
  const scanningRef = useRef(false);
  const lastFrameRef = useRef<PoseFrame | null>(null);

  const releaseStream = () => {
    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
    const video = videoRef.current;
    if (video) {
      video.srcObject = null;
    }
  };

  const stopLoop = () => {
    scanningRef.current = false;
    if (rafRef.current) {
      cancelAnimationFrame(rafRef.current);
      rafRef.current = 0;
    }
  };

  useEffect(() => {
    return () => {
      stopLoop();
      engineRef.current?.dispose();
      engineRef.current = null;
      releaseStream();
      if (stillUrl) {
        try {
          URL.revokeObjectURL(stillUrl);
        } catch {
          /* ignore */
        }
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const paintOverlay = (frame: PoseFrame | null, scanning: boolean) => {
    const video = videoRef.current;
    const canvas = canvasRef.current;
    if (!video || !canvas) return;
    const w = video.clientWidth;
    const h = video.clientHeight;
    if (w < 2 || h < 2) return;
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    if (canvas.width !== Math.floor(w * dpr) || canvas.height !== Math.floor(h * dpr)) {
      canvas.width = Math.floor(w * dpr);
      canvas.height = Math.floor(h * dpr);
    }
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, w, h);
    const accent = accentColor();
    if (scanning) {
      drawScanGrid(ctx, w, h, accent, performance.now());
    }
    if (frame && frame.figures.length > 0) {
      drawFigures(ctx, w, h, frame.figures, frame.mode, accent);
    }
  };

  const loop = () => {
    if (!scanningRef.current) return;
    rafRef.current = requestAnimationFrame(loop);
    const video = videoRef.current;
    const engine = engineRef.current;
    if (!video || !engine || video.readyState < 2) {
      paintOverlay(null, true);
      return;
    }
    const frame = engine.process(video, performance.now());
    lastFrameRef.current = frame;
    setMode(frame.mode);
    if (frame.note) setModeNote(frame.note);
    setFigureCount(frame.figures.length);
    if (frame.locked && frame.figures.length > 0) {
      box.logSls("lock", {
        mode: frame.mode === "pose" || frame.mode === "motion" ? frame.mode : undefined,
        figures: frame.figures.length,
      });
    }
    paintOverlay(frame, true);
  };

  const armCamera = async () => {
    setError(null);
    setPending(true);
    try {
      releaseStream();
      const { stream, facing: opened } = await requestCamera();
      streamRef.current = stream;
      setFacing(opened);
      const video = videoRef.current;
      if (video) {
        video.srcObject = stream;
        video.playsInline = true;
        video.muted = true;
        await video.play().catch(() => undefined);
      }
      if (!engineRef.current) engineRef.current = new SlsPoseEngine();
      const loaded = await engineRef.current.init();
      setMode(loaded);
      setModeNote(engineRef.current.getNote() ?? null);
      setPhase("armed");
      box.logSls("armed", { facing: opened, mode: loaded === "pose" || loaded === "motion" ? loaded : undefined });
    } catch (err) {
      setError(cameraErrorMessage(err));
      releaseStream();
      setPhase("idle");
      setFacing(null);
    } finally {
      setPending(false);
    }
  };

  const startScan = async () => {
    setError(null);
    if (!streamRef.current) {
      setError("Arm the camera first.");
      setPhase("idle");
      return;
    }
    if (!engineRef.current) engineRef.current = new SlsPoseEngine();
    const loaded = await engineRef.current.init();
    setMode(loaded);
    setModeNote(engineRef.current.getNote() ?? null);
    scanningRef.current = true;
    setPhase("scanning");
    box.logSls("start", {
      mode: loaded === "pose" || loaded === "motion" ? loaded : undefined,
      facing: facing ?? undefined,
    });
    loop();
  };

  const stopScan = () => {
    stopLoop();
    const frame = lastFrameRef.current;
    const m = frame?.mode === "pose" || frame?.mode === "motion" ? frame.mode : mode === "pose" || mode === "motion" ? mode : undefined;
    box.logSls("stop", { mode: m, figures: figureCount || undefined });
    setPhase(streamRef.current ? "armed" : "idle");
    paintOverlay(null, false);
  };

  const captureStill = () => {
    const video = videoRef.current;
    const overlay = canvasRef.current;
    if (!video || video.readyState < 2) {
      setError("No live frame to capture yet.");
      return;
    }
    const w = video.videoWidth || video.clientWidth;
    const h = video.videoHeight || video.clientHeight;
    if (w < 2 || h < 2) {
      setError("No live frame to capture yet.");
      return;
    }
    const out = document.createElement("canvas");
    out.width = w;
    out.height = h;
    const ctx = out.getContext("2d");
    if (!ctx) return;
    ctx.drawImage(video, 0, 0, w, h);
    if (overlay && overlay.width > 0) {
      ctx.drawImage(overlay, 0, 0, w, h);
    }
    out.toBlob(
      (blob) => {
        if (!blob) {
          setError("Capture failed on this device.");
          return;
        }
        if (stillUrl) {
          try {
            URL.revokeObjectURL(stillUrl);
          } catch {
            /* ignore */
          }
        }
        const url = URL.createObjectURL(blob);
        setStillUrl(url);
        const frame = lastFrameRef.current;
        box.logSls("capture", {
          mode:
            frame?.mode === "pose" || frame?.mode === "motion"
              ? frame.mode
              : mode === "pose" || mode === "motion"
                ? mode
                : undefined,
          figures: frame?.figures.length ?? figureCount,
          facing: facing ?? undefined,
        });
      },
      "image/jpeg",
      0.92,
    );
  };

  const clearAll = () => {
    stopLoop();
    releaseStream();
    engineRef.current?.dispose();
    engineRef.current = null;
    setPhase("idle");
    setFacing(null);
    setMode("idle");
    setModeNote(null);
    setFigureCount(0);
    setError(null);
    if (stillUrl) {
      try {
        URL.revokeObjectURL(stillUrl);
      } catch {
        /* ignore */
      }
      setStillUrl(null);
    }
    const canvas = canvasRef.current;
    if (canvas) {
      const ctx = canvas.getContext("2d");
      ctx?.clearRect(0, 0, canvas.width, canvas.height);
    }
  };

  const openStandalone = () => {
    window.open(window.location.href, "_blank", "noopener,noreferrer");
  };

  const statusLabel =
    phase === "scanning"
      ? mode === "pose"
        ? figureCount > 0
          ? `Lock ${figureCount}`
          : "Pose scan"
        : mode === "motion"
          ? figureCount > 0
            ? `Motion ${figureCount}`
            : "Motion scan"
          : "Scanning"
      : phase === "armed"
        ? "Armed"
        : "Standby";

  return (
    <section className="chassis mt-3 rounded-xl p-3">
      <div className="flex items-center justify-between gap-2">
        <p className="flex items-center gap-2 font-display text-[10px] tracking-[0.2em] text-muted uppercase">
          <Aperture className="size-3.5" />
          SLS stick-figure
        </p>
        <p className="font-display text-[10px] tracking-[0.18em] text-muted uppercase">{statusLabel}</p>
      </div>

      <p className="mt-2 text-xs text-muted">
        Environment camera with skeleton overlay. Prefers MediaPipe Pose; falls back to motion/contrast
        candidates only when blobs justify a figure — no constant fake ghosts.
      </p>

      <div className="relative mt-3 overflow-hidden rounded-lg border border-line bg-raised aspect-[4/3]">
        <video
          ref={videoRef}
          className="absolute inset-0 h-full w-full object-cover"
          playsInline
          muted
          autoPlay
        />
        <canvas ref={canvasRef} className="pointer-events-none absolute inset-0 h-full w-full" />
        {phase === "idle" && (
          <div className="absolute inset-0 flex items-center justify-center bg-bg/70 px-4 text-center">
            <p className="font-display text-xs tracking-[0.18em] text-muted uppercase">
              Camera standby
            </p>
          </div>
        )}
      </div>

      <div className="mt-2 flex flex-wrap items-center justify-between gap-2">
        <p className="font-display text-[10px] tracking-[0.16em] text-muted uppercase">
          {facing ? `Lens · ${facing}` : "Lens · —"}
          {mode !== "idle" && mode !== "loading" ? ` · ${mode}` : mode === "loading" ? " · loading pose" : ""}
        </p>
        {figureCount > 0 && phase === "scanning" && (
          <p className="font-display text-[10px] tracking-[0.16em] text-accent uppercase">
            {figureCount} figure{figureCount === 1 ? "" : "s"}
          </p>
        )}
      </div>
      {modeNote && <p className="mt-1 text-[11px] text-muted">{modeNote}</p>}

      <div className="mt-3 flex flex-wrap gap-2">
        {phase === "idle" && (
          <Button
            variant="accent"
            size="lg"
            className="flex-1"
            disabled={pending}
            onClick={() => void armCamera()}
          >
            <Camera className="size-4" />
            {pending ? "Asking camera…" : "Arm camera"}
          </Button>
        )}
        {phase === "armed" && (
          <>
            <Button variant="accent" size="lg" className="flex-1" onClick={() => void startScan()}>
              Start scan
            </Button>
            <Button variant="ghost" size="lg" onClick={captureStill}>
              Capture
            </Button>
            <Button variant="ghost" size="lg" onClick={clearAll}>
              <Square className="size-4" />
              Clear
            </Button>
          </>
        )}
        {phase === "scanning" && (
          <>
            <Button variant="danger" size="lg" className="flex-1" onClick={stopScan}>
              Stop scan
            </Button>
            <Button variant="accent" size="lg" onClick={captureStill}>
              Capture
            </Button>
          </>
        )}
      </div>

      {error && (
        <div className="mt-3 rounded-lg border border-line bg-raised px-3 py-2">
          <p className="text-sm text-danger">{error}</p>
          {inEmbeddedPreview() && (
            <Button variant="ghost" size="sm" className="mt-2" onClick={openStandalone}>
              Open box in its own page
            </Button>
          )}
        </div>
      )}

      {stillUrl && (
        <div className="mt-3">
          <div className="mb-1 flex items-center justify-between gap-2">
            <p className="font-display text-[10px] tracking-[0.2em] text-muted uppercase">
              Last capture
            </p>
            <Button
              variant="ghost"
              size="sm"
              onClick={() => {
                try {
                  URL.revokeObjectURL(stillUrl);
                } catch {
                  /* ignore */
                }
                setStillUrl(null);
              }}
            >
              <Trash2 className="size-3.5" />
              Drop still
            </Button>
          </div>
          <img
            src={stillUrl}
            alt="SLS still with overlay"
            className="w-full rounded-lg border border-line object-cover"
          />
        </div>
      )}

      <p className="mt-2 text-xs text-muted">
        Arm → Start scan for overlay. Capture freezes video + stick figure. Locks log when a figure holds.
      </p>
    </section>
  );
}
