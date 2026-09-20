import { useEffect, useRef, useState } from "react";
import {
  Activity,
  Mic,
  MicOff,
  Pause,
  Play,
  Radio,
  Trash2,
  Volume2,
  VolumeX,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { BANDS, box, type BandId, type BoxFrame, type ScanDir } from "@/lib/box/audio";
import { FieldGauge } from "@/components/box/FieldGauge";
import { WitchBoard } from "@/components/box/WitchBoard";
import { RitePanel } from "@/components/box/RitePanel";
import { EvpPanel } from "@/components/box/EvpPanel";
import { SlsPanel } from "@/components/box/SlsPanel";
import { ColdSpotPanel } from "@/components/box/ColdSpotPanel";
import { planchette } from "@/lib/box/planchette";
import { applyTheme, readTheme, type ThemeId } from "@/lib/box/theme";
import { bumpSessionCount, getSessionCount } from "@/lib/box/sessions";
import { field } from "@/lib/box/field";
import { hashString } from "@/lib/box/lexicon";
import { inEmbeddedPreview, micErrorMessage, requestMic } from "@/lib/box/mic";

type SpeechRec = {
  lang: string;
  interimResults: boolean;
  onresult: ((ev: { results: ArrayLike<ArrayLike<{ transcript: string }>> }) => void) | null;
  onerror: (() => void) | null;
  onend: (() => void) | null;
  start: () => void;
};

const SPEEDS = [
  { label: "Slow", ms: 280 },
  { label: "Hunt", ms: 140 },
  { label: "SB", ms: 90 },
  { label: "Burst", ms: 55 },
] as const;

function formatFreq(band: BandId, freq: number) {
  const b = BANDS[band];
  if (b.step < 1) return freq.toFixed(b.step < 0.1 ? 3 : 1);
  return String(Math.round(freq));
}

function hexRgb(hex: string) {
  const h = hex.replace("#", "").trim();
  if (h.length < 6) return { r: 7, g: 8, b: 7 };
  return {
    r: Number.parseInt(h.slice(0, 2), 16),
    g: Number.parseInt(h.slice(2, 4), 16),
    b: Number.parseInt(h.slice(4, 6), 16),
  };
}

function themePaint() {
  const styles = getComputedStyle(document.documentElement);
  const bg = styles.getPropertyValue("--color-bg").trim() || "#070807";
  const accent = styles.getPropertyValue("--color-accent").trim() || "#8fbf7a";
  return { bg, accent: hexRgb(accent) };
}

function ThemeSwitch({ theme, onChange }: { theme: ThemeId; onChange: (id: ThemeId) => void }) {
  return (
    <div className="flex gap-1">
      <Button variant={theme === "field" ? "accent" : "ghost"} size="sm" onClick={() => onChange("field")}>
        Field
      </Button>
      <Button variant={theme === "steam" ? "accent" : "ghost"} size="sm" onClick={() => onChange("steam")}>
        Brass
      </Button>
    </div>
  );
}

function Spectrum({ theme }: { theme: ThemeId }) {
  const ref = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = ref.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    let raf = 0;
    const draw = () => {
      raf = requestAnimationFrame(draw);
      const { bins, rms } = box.pullBins();
      const dpr = Math.min(2, window.devicePixelRatio || 1);
      const w = canvas.clientWidth;
      const h = canvas.clientHeight;
      if (w < 2 || h < 2) return;
      if (canvas.width !== Math.floor(w * dpr) || canvas.height !== Math.floor(h * dpr)) {
        canvas.width = Math.floor(w * dpr);
        canvas.height = Math.floor(h * dpr);
      }
      const paint = themePaint();
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.fillStyle = paint.bg;
      ctx.fillRect(0, 0, w, h);
      const n = bins.length;
      const gap = 1;
      const barW = Math.max(1, (w - n * gap) / n);
      const { r, g, b } = paint.accent;
      for (let i = 0; i < n; i++) {
        const v = bins[i]! / 255;
        const bh = Math.max(1, v * h);
        ctx.fillStyle = `rgba(${r}, ${g}, ${b}, ${0.25 + v * 0.75})`;
        ctx.fillRect(i * (barW + gap), h - bh, barW, bh);
      }
      ctx.fillStyle = `rgba(${r}, ${g}, ${b}, 0.35)`;
      ctx.fillRect(0, h - rms * h, w, 1);
    };
    draw();
    return () => cancelAnimationFrame(raf);
  }, [theme]);

  return <canvas ref={ref} className="h-24 w-full rounded-sm" />;
}

export function SpiritBoxApp() {
  const [armed, setArmed] = useState(false);
  const [armError, setArmError] = useState<string | null>(null);
  const [frame, setFrame] = useState<BoxFrame>(() => ({
    freq: box.freq,
    band: box.band,
    scanning: false,
    holding: false,
    askMode: false,
    asking: false,
    rms: 0,
    word: null,
    log: [],
  }));
  const [muted, setMuted] = useState(false);
  const [volume, setVolume] = useState(0.72);
  const [speed, setSpeed] = useState<(typeof SPEEDS)[number]["ms"]>(140);
  const [dir, setDir] = useState<ScanDir>("fwd");
  const [mic, setMic] = useState(false);
  const [note, setNote] = useState<string | null>(null);
  const [micError, setMicError] = useState<string | null>(null);
  const [micPending, setMicPending] = useState(false);
  const [question, setQuestion] = useState("");
  const [hearingAsk, setHearingAsk] = useState(false);
  const [spell, setSpell] = useState<string | null>(null);
  const [seeking, setSeeking] = useState(false);
  const [theme, setTheme] = useState<ThemeId>("field");
  const [sessions, setSessions] = useState<number | null>(null);
  const askGen = useRef(0);

  useEffect(() => {
    const next = readTheme();
    setTheme(next);
    applyTheme(next);
  }, []);

  useEffect(() => {
    void getSessionCount()
      .then((r) => setSessions(r.count))
      .catch(() => setSessions(null));
  }, []);

  const chooseTheme = (id: ThemeId) => {
    setTheme(id);
    applyTheme(id);
  };

  useEffect(() => {
    return box.onFrame(setFrame);
  }, []);

  useEffect(() => {
    let prev = "";
    return planchette.onFrame((s) => {
      if (s.spell.built && s.spell.built !== prev) {
        prev = s.spell.built;
        setSpell(s.spell.built);
      }
    });
  }, []);

  const arm = async (withMic: boolean) => {
    setArmError(null);
    setMicError(null);
    try {
      let stream: MediaStream | null = null;
      if (withMic) stream = await requestMic();
      await field.start();
      await box.unlock();
      if (stream) {
        box.attachMic(stream);
        setMic(true);
        setNote("Mic live — speak. You should hear yourself in the chop.");
      }
      setArmed(true);
      box.startScan();
      try {
        if (sessionStorage.getItem("spookbox-session") !== "1") {
          const r = await bumpSessionCount();
          sessionStorage.setItem("spookbox-session", "1");
          setSessions(r.count);
        }
      } catch {
        /* counter is optional */
      }
    } catch (err) {
      if (withMic) setMicError(micErrorMessage(err));
      else setArmError("Couldn't start the receiver. Tap again with sound allowed.");
    }
  };

  const toggleScan = () => {
    if (frame.scanning) box.stopScan();
    else box.startScan();
  };

  const cycleBand = (id: BandId) => box.setBand(id);
  const cycleDir = (next: ScanDir) => {
    setDir(next);
    box.setDir(next);
  };
  const cycleSpeed = (ms: (typeof SPEEDS)[number]["ms"]) => {
    setSpeed(ms);
    box.setSpeed(ms);
  };

  const toggleMic = async () => {
    setMicError(null);
    if (mic) {
      box.dropMic();
      setMic(false);
      setNote(null);
      return;
    }
    setMicPending(true);
    try {
      const stream = await requestMic();
      if (!box.attachMic(stream)) {
        stream.getTracks().forEach((t) => t.stop());
        setMicError("Arm the receiver first, then open the mic.");
        return;
      }
      setMic(true);
      setNote("Mic live — speak. You should hear yourself in the chop.");
    } catch (err) {
      setMicError(micErrorMessage(err));
    } finally {
      setMicPending(false);
    }
  };

  const setMode = (ask: boolean) => {
    box.setAskMode(ask);
    planchette.spellOnSpike = ask;
    if (!ask) {
      askGen.current += 1;
      setSpell(null);
      setSeeking(false);
    } else if (!frame.scanning) box.startScan();
  };

  const submitAsk = (q = question) => {
    const text = q.trim();
    if (!text) return;
    setQuestion(text);
    box.setAskMode(true);
    planchette.spellOnSpike = true;
    if (!box.scanning) box.startScan();
    const gen = ++askGen.current;
    setSeeking(true);
    setSpell("…");
    const salt = hashString(text) ^ ((frame.freq * 10) | 0);
    window.setTimeout(() => {
      if (gen !== askGen.current) return;
      setSeeking(false);
      planchette.triggerFromAsk(text, salt);
    }, 500);
  };

  const listenAsk = () => {
    const Speech =
      (window as unknown as { SpeechRecognition?: new () => SpeechRec }).SpeechRecognition ??
      (window as unknown as { webkitSpeechRecognition?: new () => SpeechRec }).webkitSpeechRecognition;
    if (!Speech) {
      setNote("Type the question — this browser can't take dictation.");
      return;
    }
    const rec = new Speech();
    rec.lang = "en-US";
    rec.interimResults = false;
    setHearingAsk(true);
    rec.onresult = (ev) => {
      const text = ev.results[0]?.[0]?.transcript ?? "";
      setHearingAsk(false);
      if (text) submitAsk(text);
    };
    rec.onerror = () => setHearingAsk(false);
    rec.onend = () => setHearingAsk(false);
    rec.start();
  };

  const openStandalone = () => {
    window.open(window.location.href, "_blank", "noopener,noreferrer");
  };

  if (!armed) {
    return (
      <div className="flex min-h-dvh flex-col items-center justify-center px-5 py-10">
        <p className="font-display text-xs tracking-[0.28em] text-accent uppercase">
          {theme === "steam" ? "Aether engine" : "Field receiver"}
        </p>
        <h1 className="mt-3 text-center font-display text-4xl leading-tight text-fg">Kern's Spookbox</h1>
        <p className="mt-3 max-w-sm text-center font-display text-sm text-accent">
          “they hate it when you do this”
        </p>
        <div className="mt-5">
          <ThemeSwitch theme={theme} onChange={chooseTheme} />
        </div>
        <p className="mt-4 max-w-sm text-center text-sm text-muted">
          A working spirit box. Sweep for hits, or ask on the Witch Board.
        </p>
        <Button size="xl" className="mt-8" onClick={() => void arm(false)}>
          Arm the receiver
        </Button>
        <Button variant="ghost" size="lg" className="mt-3" onClick={() => void arm(true)}>
          <Mic className="size-4" />
          Arm with open mic
        </Button>
        {armError && <p className="mt-3 text-center text-sm text-danger">{armError}</p>}
        {micError && (
          <div className="mt-3 max-w-sm text-center">
            <p className="text-sm text-danger">{micError}</p>
            {inEmbeddedPreview() && (
              <Button variant="ghost" size="sm" className="mt-2" onClick={openStandalone}>
                Open box in its own page
              </Button>
            )}
          </div>
        )}
        <p className="mt-3 text-center text-xs text-muted">Turn sound on. You should hear the scan chop.</p>
        {sessions != null && (
          <p className="mt-5 text-center font-display text-xs tracking-[0.18em] text-muted uppercase">
            {sessions.toLocaleString()} {sessions === 1 ? "session" : "sessions"} in the field
          </p>
        )}
      </div>
    );
  }

  const band = BANDS[frame.band];
  const shown = seeking ? "…" : spell && spell !== "…" ? spell : frame.word;

  return (
    <div className="mx-auto flex min-h-dvh w-full max-w-lg flex-col px-3 pt-[max(0.75rem,env(safe-area-inset-top))] pb-[max(0.75rem,env(safe-area-inset-bottom))]">
      <header className="flex items-center justify-between gap-2">
        <div>
          <p className="font-display text-[10px] tracking-[0.28em] text-muted uppercase">Kern's Spookbox</p>
          <p className="font-display text-xs text-accent">“they hate it when you do this”</p>
          {sessions != null && (
            <p className="mt-1 font-display text-[10px] tracking-wide text-muted">
              {sessions.toLocaleString()} {sessions === 1 ? "session" : "sessions"}
            </p>
          )}
        </div>
        <div className="flex items-center gap-1">
          <Button
            variant="ghost"
            size="icon"
            aria-label={mic ? "Disable ambient mic" : "Enable ambient mic"}
            onClick={() => void toggleMic()}
          >
            {mic ? <Mic className="size-5" /> : <MicOff className="size-5" />}
          </Button>
          <Button
            variant="ghost"
            size="icon"
            aria-label={muted ? "Unmute" : "Mute"}
            onClick={() => {
              const next = !muted;
              setMuted(next);
              box.setMuted(next);
            }}
          >
            {muted ? <VolumeX className="size-5" /> : <Volume2 className="size-5" />}
          </Button>
        </div>
      </header>
      <div className="mt-3">
        <ThemeSwitch theme={theme} onChange={chooseTheme} />
      </div>

      <section className="chassis relative mt-3 overflow-hidden rounded-xl p-4">
        <div className="scanlines absolute inset-0" />
        <div className="relative">
          <div className="flex items-end justify-between">
            <p className="font-display text-[10px] tracking-[0.2em] text-muted uppercase">{band.label} band</p>
            <p className="font-display text-[10px] tracking-[0.2em] text-muted uppercase">
              {seeking ? "Seeking" : frame.askMode ? "Ask" : frame.scanning ? "Sweeping" : frame.holding ? "Hold" : "Idle"}
            </p>
          </div>
          <p className="phosphor mt-1 font-display text-5xl leading-none tabular-nums">
            {formatFreq(frame.band, frame.freq)}
            <span className="ml-2 text-lg text-muted">{band.unit}</span>
          </p>
          <div className="mt-4">
            <Spectrum theme={theme} />
          </div>
          <div className="mt-4 min-h-16 text-center">
            {shown ? (
              <p className="word-lock font-display text-2xl leading-tight tracking-wide text-accent uppercase sm:text-3xl">
                {shown}
              </p>
            ) : (
              <p className="font-display text-sm tracking-[0.2em] text-muted uppercase">
                {frame.askMode ? "Ask, then wait" : "Listening"}
              </p>
            )}
            {mic && (
              <p className="mt-2 font-display text-xs tracking-[0.18em] text-accent uppercase">Mic live · speak into the room</p>
            )}
          </div>
        </div>
      </section>

      <FieldGauge />

      <section className="chassis mt-3 rounded-xl p-3">
        <div className="flex gap-1">
          <Button variant={!frame.askMode ? "accent" : "ghost"} size="sm" className="flex-1" onClick={() => setMode(false)}>
            Sweep
          </Button>
          <Button variant={frame.askMode ? "accent" : "ghost"} size="sm" className="flex-1" onClick={() => setMode(true)}>
            Ask
          </Button>
        </div>
        <p className="mt-2 font-display text-[10px] tracking-[0.2em] text-muted uppercase">Witch Board</p>
        <WitchBoard
          theme={theme}
          onSpelled={(word, built) => {
            setSpell(built || word);
            box.logHit(word, question || undefined);
          }}
        />
        <div className="mt-2 flex gap-2">
          <input
            value={question}
            onChange={(e) => setQuestion(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") submitAsk();
            }}
            placeholder="Ask a question…"
            maxLength={120}
            className="h-11 min-w-0 flex-1 rounded-lg border border-line bg-raised px-3 text-sm text-fg outline-none placeholder:text-muted"
          />
          <Button variant="accent" size="lg" disabled={seeking || !question.trim()} onClick={() => submitAsk()}>
            Ask
          </Button>
        </div>
        <div className="mt-2 flex flex-wrap gap-1">
          {["Are you there?", "Who are you?", "What do you want?", "Can we help?"].map((q) => (
            <Button key={q} variant="ghost" size="sm" onClick={() => submitAsk(q)}>
              {q}
            </Button>
          ))}
          <Button variant="ghost" size="sm" disabled={hearingAsk} onClick={listenAsk}>
            {hearingAsk ? "Hearing…" : "Speak"}
          </Button>
        </div>
        <div className="mt-2 grid grid-cols-3 gap-1">
          {(
            [
              ["yes", "Are you with us?"],
              ["no", "Should we leave?"],
              ["goodbye", "Goodbye"],
            ] as const
          ).map(([label, q]) => (
            <Button key={label} variant="ghost" size="sm" className="uppercase" onClick={() => submitAsk(q)}>
              {label}
            </Button>
          ))}
        </div>
        <p className="mt-2 text-xs text-muted">
          The planchette rides live µT. A field spike spells a dictionary hit letter by letter. Ask a question to aim the next glide.
        </p>
      </section>

      <RitePanel />

      <EvpPanel />

      <SlsPanel />

      <ColdSpotPanel />

      <div className="mt-4 grid grid-cols-3 gap-2">
        {(Object.keys(BANDS) as BandId[]).map((id) => (
          <Button
            key={id}
            variant={frame.band === id ? "accent" : "ghost"}
            size="sm"
            onClick={() => cycleBand(id)}
          >
            {BANDS[id].label}
          </Button>
        ))}
      </div>

      <div className="mt-2 grid grid-cols-3 gap-2">
        {([
          ["fwd", "Fwd"],
          ["rev", "Rev"],
          ["bounce", "Bounce"],
        ] as const).map(([id, label]) => (
          <Button key={id} variant={dir === id ? "accent" : "ghost"} size="sm" onClick={() => cycleDir(id)}>
            {label}
          </Button>
        ))}
      </div>

      <div className="mt-2 grid grid-cols-4 gap-2">
        {SPEEDS.map((s) => (
          <Button
            key={s.ms}
            variant={speed === s.ms ? "accent" : "ghost"}
            size="sm"
            onClick={() => cycleSpeed(s.ms)}
          >
            {s.label}
          </Button>
        ))}
      </div>

      <div className="mt-4 flex items-center gap-2">
        <Button
          variant={frame.scanning ? "danger" : "accent"}
          size="lg"
          className="flex-1"
          onClick={toggleScan}
        >
          {frame.scanning ? <Pause className="size-4" /> : <Play className="size-4" />}
          {frame.scanning ? "Stop" : "Scan"}
        </Button>
        <Button variant={frame.holding ? "accent" : "ghost"} size="lg" onClick={() => box.toggleHold()}>
          Hold
        </Button>
        <Button
          variant={mic ? "accent" : "ghost"}
          size="lg"
          disabled={micPending}
          onClick={() => void toggleMic()}
          aria-pressed={mic}
        >
          {mic ? <Mic className="size-4" /> : <MicOff className="size-4" />}
          {micPending ? "Asking" : mic ? "Live" : "Mic"}
        </Button>
      </div>

      <label className="mt-4 flex items-center gap-3 text-sm text-muted">
        <span className="w-14 font-display text-xs tracking-wide uppercase">Gain</span>
        <input
          type="range"
          min={0.05}
          max={1}
          step={0.01}
          value={volume}
          onChange={(e) => {
            const v = Number(e.target.value);
            setVolume(v);
            box.setVolume(v);
          }}
          className="h-11 flex-1 accent-accent"
        />
      </label>

      {note && !micError && <p className="mt-2 text-sm text-accent">{note}</p>}
      {micError && (
        <div className="chassis mt-3 rounded-lg p-3">
          <p className="text-sm text-danger">{micError}</p>
          {inEmbeddedPreview() && (
            <Button variant="ghost" size="sm" className="mt-2" onClick={openStandalone}>
              Open box in its own page
            </Button>
          )}
        </div>
      )}

      <section className="mt-5 min-h-0 flex-1">
        <div className="mb-2 flex items-center justify-between">
          <p className="flex items-center gap-2 font-display text-xs tracking-[0.2em] text-muted uppercase">
            <Activity className="size-3.5" /> Session log
          </p>
          <Button variant="ghost" size="sm" onClick={() => box.clearLog()} disabled={frame.log.length === 0}>
            <Trash2 className="size-3.5" />
            Clear
          </Button>
        </div>
        <ul className="chassis max-h-56 space-y-1 overflow-y-auto rounded-lg p-2">
          {frame.log.length === 0 && (
            <li className="px-2 py-6 text-center text-sm text-muted">
              No locks yet. Sweep, Ask, arm a rite, record EVP, scan SLS, or start cold spot.
            </li>
          )}
          {frame.log.map((hit) => (
            <li key={hit.id} className="rounded-md px-2 py-2">
              <div className="flex items-baseline justify-between gap-3 font-display text-sm">
                <span className="text-accent uppercase">{hit.word}</span>
                <span className="tabular-nums text-muted">
                  {hit.rite || hit.evp || hit.sls || hit.cold
                    ? new Date(hit.at).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" })
                    : `${formatFreq(hit.band, hit.freq)} ${BANDS[hit.band].unit}`}
                </span>
              </div>
              {hit.rite ? (
                <p className="mt-0.5 text-[11px] text-muted">
                  {hit.rite.tradition} · {hit.rite.prayer}
                </p>
              ) : hit.evp ? (
                <p className="mt-0.5 text-[11px] text-muted">
                  {hit.evp.clip ? `${hit.evp.clip} · ` : ""}
                  {hit.evp.action}
                  {hit.evp.offsetMs != null && ` @ ${(hit.evp.offsetMs / 1000).toFixed(1)}s`}
                  {hit.evp.durationMs != null && ` · ${(hit.evp.durationMs / 1000).toFixed(1)}s`}
                </p>
              ) : hit.sls ? (
                <p className="mt-0.5 text-[11px] text-muted">
                  {hit.sls.action}
                  {hit.sls.mode ? ` · ${hit.sls.mode}` : ""}
                  {hit.sls.facing ? ` · ${hit.sls.facing}` : ""}
                  {hit.sls.figures != null && hit.sls.figures > 0
                    ? ` · ${hit.sls.figures} fig${hit.sls.figures === 1 ? "" : "s"}`
                    : ""}
                </p>
              ) : hit.cold ? (
                <p className="mt-0.5 text-[11px] text-muted">
                  {hit.cold.action}
                  {hit.cold.source ? ` · ${hit.cold.source}` : ""}
                  {hit.cold.delta != null && hit.cold.unit
                    ? ` · Δ${hit.cold.delta >= 0 ? "+" : ""}${hit.cold.delta.toFixed(
                        hit.cold.source === "temperature" ? 2 : 0,
                      )}${hit.cold.unit}`
                    : hit.cold.value != null && hit.cold.unit
                      ? ` · ${hit.cold.value.toFixed(
                          hit.cold.source === "temperature" ? 1 : 0,
                        )}${hit.cold.unit}`
                      : ""}
                </p>
              ) : (
                hit.asked && <p className="mt-0.5 text-[11px] text-muted">Q: {hit.asked}</p>
              )}
            </li>
          ))}
        </ul>
      </section>

      <p className="mt-4 flex items-start gap-2 text-xs text-muted">
        <Radio className="mt-0.5 size-3.5 shrink-0" />
        Sweep locks speech-shaped bursts. Ask spells. Rite, EVP, SLS, and cold-spot tools log to this strip. You interpret the session.
      </p>
    </div>
  );
}
