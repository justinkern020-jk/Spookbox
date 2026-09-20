import { useEffect, useMemo, useRef, useState } from "react";
import { BookOpen, Pause, Play, Square } from "lucide-react";
import { Button } from "@/components/ui/button";
import { box } from "@/lib/box/audio";
import {
  TRADITIONS,
  type TraditionId,
  prayerByIds,
} from "@/lib/box/rites";

type Phase = "idle" | "armed" | "running";

/** Kept alive so Chrome doesn't GC the utterance mid-speak. */
let activeUtter: SpeechSynthesisUtterance | null = null;
let resumeTimer: number | null = null;

function stopSpeech() {
  try {
    if (resumeTimer != null) {
      window.clearInterval(resumeTimer);
      resumeTimer = null;
    }
    window.speechSynthesis?.cancel();
  } catch {
    /* unsupported */
  }
  activeUtter = null;
}

function pickVoice(lang: string): SpeechSynthesisVoice | null {
  const voices = window.speechSynthesis?.getVoices?.() ?? [];
  if (!voices.length) return null;
  const base = lang.toLowerCase().split("-")[0] ?? lang.toLowerCase();
  return (
    voices.find((v) => v.lang.toLowerCase() === lang.toLowerCase()) ||
    voices.find((v) => v.lang.toLowerCase().startsWith(base)) ||
    voices.find((v) => v.default) ||
    voices[0] ||
    null
  );
}

function waitForVoices(): Promise<SpeechSynthesisVoice[]> {
  return new Promise((resolve) => {
    const syn = window.speechSynthesis;
    if (!syn) {
      resolve([]);
      return;
    }
    const now = syn.getVoices();
    if (now.length) {
      resolve(now);
      return;
    }
    const done = () => {
      syn.removeEventListener("voiceschanged", done);
      resolve(syn.getVoices());
    };
    syn.addEventListener("voiceschanged", done);
    // Android sometimes never fires voiceschanged — don't hang Start.
    window.setTimeout(() => {
      syn.removeEventListener("voiceschanged", done);
      resolve(syn.getVoices());
    }, 400);
  });
}

/** Pixel/Chrome often drops the first speak and pauses the synth mid-utterance. */
async function speakText(text: string, lang: string, onEnd: () => void) {
  stopSpeech();
  if (typeof window === "undefined" || !window.speechSynthesis || !window.SpeechSynthesisUtterance) {
    onEnd();
    return;
  }
  const syn = window.speechSynthesis;
  await waitForVoices();
  // Kick a silent/short warm-up — Chrome Android ignores the first real speak otherwise.
  try {
    syn.cancel();
    const warm = new SpeechSynthesisUtterance(" ");
    warm.volume = 0;
    syn.speak(warm);
    syn.cancel();
  } catch {
    /* ignore */
  }

  const body = text.replace(/\n+/g, " ").trim();
  const utter = new SpeechSynthesisUtterance(body);
  activeUtter = utter;
  utter.lang = lang;
  utter.rate = 0.92;
  utter.pitch = 1;
  utter.volume = 1;
  const voice = pickVoice(lang);
  if (voice) {
    utter.voice = voice;
    utter.lang = voice.lang || lang;
  }
  let finished = false;
  const finish = () => {
    if (finished) return;
    finished = true;
    if (resumeTimer != null) {
      window.clearInterval(resumeTimer);
      resumeTimer = null;
    }
    activeUtter = null;
    onEnd();
  };
  utter.onend = () => finish();
  utter.onerror = () => finish();
  // Chrome bug: synth goes to paused and never resumes without a nudge.
  resumeTimer = window.setInterval(() => {
    try {
      if (syn.paused) syn.resume();
    } catch {
      /* ignore */
    }
  }, 250);
  syn.resume();
  syn.speak(utter);
}

export function RitePanel() {
  const [traditionId, setTraditionId] = useState<TraditionId>("christian");
  const [prayerId, setPrayerId] = useState<string>("lords-prayer");
  const [phase, setPhase] = useState<Phase>("idle");
  const [ttsNote, setTtsNote] = useState<string | null>(null);
  const runGen = useRef(0);

  const tradition = useMemo(
    () => TRADITIONS.find((t) => t.id === traditionId)!,
    [traditionId],
  );
  const prayer = useMemo(
    () => prayerByIds(traditionId, prayerId) ?? tradition.prayers[0]!,
    [traditionId, prayerId, tradition],
  );

  useEffect(() => {
    const first = TRADITIONS.find((t) => t.id === traditionId)?.prayers[0];
    if (first && !tradition.prayers.some((p) => p.id === prayerId)) {
      setPrayerId(first.id);
    }
  }, [traditionId, prayerId, tradition.prayers]);

  useEffect(() => {
    try {
      window.speechSynthesis?.getVoices();
    } catch {
      /* unsupported */
    }
    return () => {
      runGen.current += 1;
      stopSpeech();
    };
  }, []);

  const selectTradition = (id: TraditionId) => {
    if (phase === "running") return;
    setTraditionId(id);
    const first = TRADITIONS.find((t) => t.id === id)?.prayers[0];
    if (first) setPrayerId(first.id);
    setPhase("idle");
    setTtsNote(null);
  };

  const selectPrayer = (id: string) => {
    if (phase === "running") return;
    setPrayerId(id);
    setPhase("idle");
    setTtsNote(null);
  };

  const armRite = () => {
    stopSpeech();
    runGen.current += 1;
    setPhase("armed");
    setTtsNote(null);
    box.logRite(tradition.label, prayer.shortName, "armed");
  };

  const startRite = () => {
    const gen = ++runGen.current;
    setPhase("running");
    box.logRite(tradition.label, prayer.shortName, "start");
    const supported = typeof window !== "undefined" && !!window.speechSynthesis;
    if (!supported) {
      setTtsNote("Speech unavailable on this browser — read the text on screen.");
      return;
    }
    setTtsNote("Speaking… turn media volume up.");
    void speakText(prayer.text, prayer.lang, () => {
      if (gen !== runGen.current) return;
      setPhase("armed");
      setTtsNote(null);
      box.logRite(tradition.label, prayer.shortName, "complete");
    });
  };

  const stopRite = () => {
    runGen.current += 1;
    stopSpeech();
    setPhase(phase === "running" ? "armed" : "idle");
    if (phase === "running") {
      box.logRite(tradition.label, prayer.shortName, "stop");
    }
  };

  return (
    <section className="chassis mt-3 rounded-xl p-3">
      <div className="flex items-center justify-between gap-2">
        <p className="flex items-center gap-2 font-display text-[10px] tracking-[0.2em] text-muted uppercase">
          <BookOpen className="size-3.5" />
          Spiritual Warfare
        </p>
        <p className="font-display text-[10px] tracking-[0.18em] text-muted uppercase">
          {phase === "running" ? "Reciting" : phase === "armed" ? "Armed" : "Standby"}
        </p>
      </div>

      <p className="mt-2 font-display text-[10px] tracking-[0.2em] text-muted uppercase">Tradition</p>
      <div className="mt-1 grid grid-cols-3 gap-1">
        {TRADITIONS.map((t) => (
          <Button
            key={t.id}
            variant={traditionId === t.id ? "accent" : "ghost"}
            size="sm"
            disabled={phase === "running"}
            onClick={() => selectTradition(t.id)}
          >
            {t.label}
          </Button>
        ))}
      </div>

      <p className="mt-3 font-display text-[10px] tracking-[0.2em] text-muted uppercase">Prayer</p>
      <div className="mt-1 flex flex-wrap gap-1">
        {tradition.prayers.map((p) => (
          <Button
            key={p.id}
            variant={prayerId === p.id ? "accent" : "ghost"}
            size="sm"
            disabled={phase === "running"}
            onClick={() => selectPrayer(p.id)}
          >
            {p.shortName}
          </Button>
        ))}
      </div>

      <div className="mt-3 min-h-28 max-h-44 overflow-y-auto rounded-lg border border-line bg-raised px-3 py-3">
        <p className="font-display text-xs tracking-[0.18em] text-accent uppercase">{prayer.name}</p>
        <p className="mt-2 whitespace-pre-wrap font-display text-sm leading-relaxed text-fg">{prayer.text}</p>
      </div>

      <div className="mt-3 flex gap-2">
        {phase === "idle" && (
          <Button variant="accent" size="lg" className="flex-1" onClick={armRite}>
            Arm rite
          </Button>
        )}
        {phase === "armed" && (
          <>
            <Button variant="accent" size="lg" className="flex-1" onClick={startRite}>
              <Play className="size-4" />
              Start
            </Button>
            <Button variant="ghost" size="lg" onClick={stopRite}>
              <Square className="size-4" />
              Clear
            </Button>
          </>
        )}
        {phase === "running" && (
          <Button variant="danger" size="lg" className="flex-1" onClick={stopRite}>
            <Pause className="size-4" />
            Stop rite
          </Button>
        )}
      </div>

      {ttsNote && <p className="mt-2 text-xs text-muted">{ttsNote}</p>}
      <p className="mt-2 text-xs text-muted">
        Select tradition and prayer, arm, then start. Uses your phone's text-to-speech — turn media volume up. Logged to the session strip.
      </p>
    </section>
  );
}
