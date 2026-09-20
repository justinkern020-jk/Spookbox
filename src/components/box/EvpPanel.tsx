import { useEffect, useRef, useState } from "react";
import { AudioLines, Circle, Play, Square, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { box } from "@/lib/box/audio";
import {
  inEmbeddedPreview,
  micErrorMessage,
  pickRecorderMime,
  requestMic,
} from "@/lib/box/mic";

type Phase = "idle" | "armed" | "recording";

type EvpMark = {
  offsetMs: number;
  at: number;
};

type EvpClip = {
  id: string;
  label: string;
  url: string;
  blob: Blob;
  startedAt: number;
  durationMs: number;
  marks: EvpMark[];
  mimeType: string;
};

function formatOffset(ms: number) {
  const s = Math.max(0, ms) / 1000;
  if (s < 60) return `${s.toFixed(1)}s`;
  const m = Math.floor(s / 60);
  const rem = s - m * 60;
  return `${m}:${rem.toFixed(1).padStart(4, "0")}`;
}

function formatClock(ms: number) {
  const total = Math.floor(ms / 1000);
  const m = Math.floor(total / 60);
  const s = total % 60;
  return `${m}:${String(s).padStart(2, "0")}`;
}

export function EvpPanel() {
  const [phase, setPhase] = useState<Phase>("idle");
  const [clips, setClips] = useState<EvpClip[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const [elapsedMs, setElapsedMs] = useState(0);
  const [playingId, setPlayingId] = useState<string | null>(null);

  const streamRef = useRef<MediaStream | null>(null);
  const recorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<BlobPart[]>([]);
  const startedAtRef = useRef(0);
  const marksRef = useRef<EvpMark[]>([]);
  const clipSeq = useRef(0);
  const tickRef = useRef(0);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const discardRecRef = useRef(false);
  const activeLabelRef = useRef("EVP-1");

  const releaseStream = () => {
    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
  };

  const revokeClips = (list: EvpClip[]) => {
    for (const c of list) {
      try {
        URL.revokeObjectURL(c.url);
      } catch {
        /* already revoked */
      }
    }
  };

  useEffect(() => {
    return () => {
      if (tickRef.current) window.clearInterval(tickRef.current);
      try {
        recorderRef.current?.stop();
      } catch {
        /* ignore */
      }
      releaseStream();
      if (audioRef.current) {
        audioRef.current.pause();
        audioRef.current = null;
      }
      setClips((prev) => {
        revokeClips(prev);
        return [];
      });
    };
  }, []);

  const armEvp = async () => {
    setError(null);
    setPending(true);
    try {
      if (typeof MediaRecorder === "undefined") {
        setError("This browser can't record audio (MediaRecorder missing).");
        return;
      }
      releaseStream();
      const stream = await requestMic();
      streamRef.current = stream;
      setPhase("armed");
      box.logEvp("armed");
    } catch (err) {
      setError(micErrorMessage(err));
      releaseStream();
      setPhase("idle");
    } finally {
      setPending(false);
    }
  };

  const startRecording = () => {
    setError(null);
    const stream = streamRef.current;
    if (!stream) {
      setError("Arm EVP first so the mic is ready.");
      setPhase("idle");
      return;
    }
    const mime = pickRecorderMime();
    let recorder: MediaRecorder;
    try {
      recorder = mime
        ? new MediaRecorder(stream, { mimeType: mime })
        : new MediaRecorder(stream);
    } catch {
      setError("Couldn't start the recorder on this device.");
      return;
    }

    chunksRef.current = [];
    marksRef.current = [];
    startedAtRef.current = performance.now();
    setElapsedMs(0);
    discardRecRef.current = false;
    clipSeq.current += 1;
    const label = `EVP-${clipSeq.current}`;
    activeLabelRef.current = label;

    recorder.ondataavailable = (ev) => {
      if (ev.data && ev.data.size > 0) chunksRef.current.push(ev.data);
    };
    recorder.onerror = () => {
      setError("Recording failed. Stop and try again.");
    };
    recorder.onstop = () => {
      if (tickRef.current) {
        window.clearInterval(tickRef.current);
        tickRef.current = 0;
      }
      const durationMs = Math.max(0, performance.now() - startedAtRef.current);
      const type = recorder.mimeType || mime || "audio/webm";
      const blob = new Blob(chunksRef.current, { type });
      chunksRef.current = [];
      if (discardRecRef.current) {
        discardRecRef.current = false;
        setElapsedMs(0);
        return;
      }
      const url = URL.createObjectURL(blob);
      const clip: EvpClip = {
        id: `${Date.now()}-${clipSeq.current}`,
        label,
        url,
        blob,
        startedAt: Date.now() - durationMs,
        durationMs,
        marks: [...marksRef.current],
        mimeType: type,
      };
      setClips((prev) => [clip, ...prev].slice(0, 8));
      box.logEvp("stop", { clip: label, durationMs });
      setPhase(streamRef.current ? "armed" : "idle");
      setElapsedMs(0);
    };

    recorderRef.current = recorder;
    try {
      recorder.start(250);
    } catch {
      setError("Couldn't start the recorder on this device.");
      return;
    }
    setPhase("recording");
    box.logEvp("start", { clip: label });
    tickRef.current = window.setInterval(() => {
      setElapsedMs(performance.now() - startedAtRef.current);
    }, 200);
  };

  const stopRecording = () => {
    const rec = recorderRef.current;
    if (!rec || rec.state === "inactive") {
      setPhase(streamRef.current ? "armed" : "idle");
      return;
    }
    try {
      rec.stop();
    } catch {
      setPhase("armed");
    }
    recorderRef.current = null;
  };

  const markHit = () => {
    if (phase !== "recording") return;
    const offsetMs = Math.max(0, performance.now() - startedAtRef.current);
    const mark: EvpMark = { offsetMs, at: Date.now() };
    marksRef.current = [...marksRef.current, mark];
    box.logEvp("mark", { clip: activeLabelRef.current, offsetMs });
  };

  const clearArm = () => {
    if (phase === "recording") {
      discardRecRef.current = true;
      const rec = recorderRef.current;
      if (rec && rec.state !== "inactive") {
        try {
          rec.stop();
        } catch {
          /* ignore */
        }
      }
      recorderRef.current = null;
      if (tickRef.current) {
        window.clearInterval(tickRef.current);
        tickRef.current = 0;
      }
    }
    releaseStream();
    setPhase("idle");
    setElapsedMs(0);
    setError(null);
  };

  const clearClips = () => {
    if (audioRef.current) {
      audioRef.current.pause();
      audioRef.current = null;
    }
    setPlayingId(null);
    setClips((prev) => {
      revokeClips(prev);
      return [];
    });
  };

  const playClip = (clip: EvpClip) => {
    if (audioRef.current) {
      audioRef.current.pause();
      audioRef.current = null;
    }
    if (playingId === clip.id) {
      setPlayingId(null);
      return;
    }
    const audio = new Audio(clip.url);
    audioRef.current = audio;
    setPlayingId(clip.id);
    audio.onended = () => {
      setPlayingId(null);
      if (audioRef.current === audio) audioRef.current = null;
    };
    audio.onerror = () => {
      setPlayingId(null);
      setError("Playback failed for that clip.");
    };
    void audio.play().catch(() => {
      setPlayingId(null);
      setError("Playback blocked — tap play again.");
    });
  };

  const openStandalone = () => {
    window.open(window.location.href, "_blank", "noopener,noreferrer");
  };

  return (
    <section className="chassis mt-3 rounded-xl p-3">
      <div className="flex items-center justify-between gap-2">
        <p className="flex items-center gap-2 font-display text-[10px] tracking-[0.2em] text-muted uppercase">
          <AudioLines className="size-3.5" />
          EVP recorder
        </p>
        <p className="font-display text-[10px] tracking-[0.18em] text-muted uppercase">
          {phase === "recording"
            ? `Rec ${formatClock(elapsedMs)}`
            : phase === "armed"
              ? "Armed"
              : "Standby"}
        </p>
      </div>

      <p className="mt-2 text-xs text-muted">
        Dedicated mic capture for electronic voice phenomena. Runs as its own armed
        recorder — sweep can continue, but EVP does not mix into the chop path.
      </p>

      <div className="mt-3 flex gap-2">
        {phase === "idle" && (
          <Button
            variant="accent"
            size="lg"
            className="flex-1"
            disabled={pending}
            onClick={() => void armEvp()}
          >
            {pending ? "Asking mic…" : "Arm EVP"}
          </Button>
        )}
        {phase === "armed" && (
          <>
            <Button variant="accent" size="lg" className="flex-1" onClick={startRecording}>
              <Circle className="size-4 fill-current" />
              Record
            </Button>
            <Button variant="ghost" size="lg" onClick={clearArm}>
              <Square className="size-4" />
              Clear
            </Button>
          </>
        )}
        {phase === "recording" && (
          <>
            <Button variant="danger" size="lg" className="flex-1" onClick={stopRecording}>
              <Square className="size-4" />
              Stop
            </Button>
            <Button variant="accent" size="lg" onClick={markHit}>
              Mark
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

      <div className="mt-3 flex items-center justify-between gap-2">
        <p className="font-display text-[10px] tracking-[0.2em] text-muted uppercase">
          Session clips
        </p>
        <Button
          variant="ghost"
          size="sm"
          disabled={clips.length === 0}
          onClick={clearClips}
        >
          <Trash2 className="size-3.5" />
          Clear clips
        </Button>
      </div>

      <ul className="mt-1 max-h-40 space-y-1 overflow-y-auto rounded-lg border border-line bg-raised p-2">
        {clips.length === 0 && (
          <li className="px-2 py-4 text-center text-xs text-muted">
            No clips yet. Arm, record, then stop to keep a take in this session.
          </li>
        )}
        {clips.map((clip) => (
          <li
            key={clip.id}
            className="flex items-center gap-2 rounded-md px-2 py-2"
          >
            <Button
              variant={playingId === clip.id ? "accent" : "ghost"}
              size="sm"
              className="shrink-0"
              onClick={() => playClip(clip)}
              aria-label={playingId === clip.id ? "Stop playback" : "Play clip"}
            >
              <Play className="size-3.5" />
            </Button>
            <div className="min-w-0 flex-1">
              <p className="font-display text-xs tracking-[0.14em] text-accent uppercase">
                {clip.label}
              </p>
              <p className="text-[11px] text-muted">
                {formatOffset(clip.durationMs)}
                {clip.marks.length > 0 &&
                  ` · ${clip.marks.length} mark${clip.marks.length === 1 ? "" : "s"} (${clip.marks
                    .map((m) => formatOffset(m.offsetMs))
                    .join(", ")})`}
              </p>
            </div>
          </li>
        ))}
      </ul>

      <p className="mt-2 text-xs text-muted">
        Clips stay in memory for this session. Mark logs a time offset into the active
        take on the session strip.
      </p>
    </section>
  );
}
