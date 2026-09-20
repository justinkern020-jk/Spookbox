import { useEffect, useRef, useState } from "react";
import { Phone, PhoneIncoming, PhoneOff, Mic, MicOff, Pause, Play } from "lucide-react";
import { Button } from "@/components/ui/button";
import { box } from "@/lib/box/audio";
import { field } from "@/lib/box/field";
import { cold } from "@/lib/box/cold";
import { micErrorMessage, requestMic } from "@/lib/box/mic";
import { cn } from "@/lib/utils";

type LinePhase = "idle" | "armed" | "incoming" | "active" | "ended";

type RingReason =
  | "EMF spike"
  | "Cold drop"
  | "Knock"
  | "Manual"
  | "Standby ping";

function formatClock(ms: number) {
  const total = Math.max(0, Math.floor(ms / 1000));
  const m = Math.floor(total / 60);
  const s = total % 60;
  return `${m}:${String(s).padStart(2, "0")}`;
}

function randStandbyMs() {
  return 8000 + Math.floor(Math.random() * 12000); // 8–20s — explicit standby only
}

/** In-app ring tone — never opens the cellular dialer. */
function startRingTone(): () => void {
  let stopped = false;
  let ctx: AudioContext | null = null;
  let oscA: OscillatorNode | null = null;
  let oscB: OscillatorNode | null = null;
  let gain: GainNode | null = null;
  let pulseTimer = 0;
  let vibTimer = 0;

  const stop = () => {
    if (stopped) return;
    stopped = true;
    if (pulseTimer) window.clearInterval(pulseTimer);
    if (vibTimer) window.clearInterval(vibTimer);
    try {
      navigator.vibrate?.(0);
    } catch {
      /* ignore */
    }
    try {
      oscA?.stop();
      oscB?.stop();
    } catch {
      /* ignore */
    }
    oscA = null;
    oscB = null;
    try {
      void ctx?.close();
    } catch {
      /* ignore */
    }
    ctx = null;
  };

  try {
    ctx = new AudioContext({ latencyHint: "interactive" });
    gain = ctx.createGain();
    gain.gain.value = 0;
    gain.connect(ctx.destination);
    oscA = ctx.createOscillator();
    oscB = ctx.createOscillator();
    oscA.type = "sine";
    oscB.type = "sine";
    oscA.frequency.value = 440;
    oscB.frequency.value = 480;
    oscA.connect(gain);
    oscB.connect(gain);
    oscA.start();
    oscB.start();
    void ctx.resume();

    let on = false;
    const pulse = () => {
      if (!gain || !ctx || stopped) return;
      on = !on;
      const t = ctx.currentTime;
      gain.gain.cancelScheduledValues(t);
      gain.gain.setTargetAtTime(on ? 0.18 : 0, t, 0.02);
    };
    pulse();
    pulseTimer = window.setInterval(pulse, 420);

    const buzz = () => {
      try {
        navigator.vibrate?.([220, 120, 220, 120, 220, 700]);
      } catch {
        /* ignore */
      }
    };
    buzz();
    vibTimer = window.setInterval(buzz, 1600);
  } catch {
    /* audio unavailable — UI still rings visually */
  }

  return stop;
}

export function SpiritLinePanel() {
  const [phase, setPhase] = useState<LinePhase>("idle");
  /** Off by default — random theater demoted; sensors are primary. */
  const [standbyPing, setStandbyPing] = useState(false);
  const [listenKnock, setListenKnock] = useState(true);
  const [elapsedMs, setElapsedMs] = useState(0);
  const [callMuted, setCallMuted] = useState(false);
  const [callHeld, setCallHeld] = useState(false);
  const [micOn, setMicOn] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [sensorNote, setSensorNote] = useState<string | null>(null);
  const [lastOutcome, setLastOutcome] = useState<string | null>(null);
  const [ringReason, setRingReason] = useState<RingReason | null>(null);
  const [pendingStandbyIn, setPendingStandbyIn] = useState<number | null>(null);
  const [fieldLive, setFieldLive] = useState(field.live);
  const [coldLive, setColdLive] = useState(cold.live);

  const phaseRef = useRef<LinePhase>("idle");
  const stopRingRef = useRef<(() => void) | null>(null);
  const standbyTimerRef = useRef(0);
  const standbyDeadlineRef = useRef(0);
  const standbyTickRef = useRef(0);
  const activeStartedRef = useRef(0);
  const tickRef = useRef(0);
  const ownedMicRef = useRef(false);
  const muteBeforeRef = useRef(false);
  const wasScanningRef = useRef(false);
  const startedFieldRef = useRef(false);
  const lastRingAtRef = useRef(0);
  const listenKnockRef = useRef(true);
  const knockBaselineRef = useRef(0);
  const knockPrimedRef = useRef(false);

  const setPhaseSafe = (next: LinePhase) => {
    phaseRef.current = next;
    setPhase(next);
  };

  const clearStandbyTimer = () => {
    if (standbyTimerRef.current) {
      window.clearTimeout(standbyTimerRef.current);
      standbyTimerRef.current = 0;
    }
    if (standbyTickRef.current) {
      window.clearInterval(standbyTickRef.current);
      standbyTickRef.current = 0;
    }
    setPendingStandbyIn(null);
  };

  const stopRing = () => {
    stopRingRef.current?.();
    stopRingRef.current = null;
  };

  const releaseOwnedMic = () => {
    if (ownedMicRef.current) {
      box.dropMic();
      ownedMicRef.current = false;
      setMicOn(false);
    }
  };

  const scheduleStandbyPing = () => {
    clearStandbyTimer();
    if (!standbyPing) return;
    const delay = randStandbyMs();
    standbyDeadlineRef.current = Date.now() + delay;
    setPendingStandbyIn(Math.ceil(delay / 1000));
    standbyTickRef.current = window.setInterval(() => {
      const left = Math.max(0, Math.ceil((standbyDeadlineRef.current - Date.now()) / 1000));
      setPendingStandbyIn(left || null);
    }, 250);
    standbyTimerRef.current = window.setTimeout(() => {
      clearStandbyTimer();
      if (phaseRef.current === "armed") triggerIncoming("Standby ping");
    }, delay);
  };

  const triggerIncoming = (reason: RingReason) => {
    if (phaseRef.current !== "armed") return;
    const now = Date.now();
    // Cooldown so sensor chatter doesn't spam rings
    if (reason !== "Manual" && now - lastRingAtRef.current < 4500) return;
    lastRingAtRef.current = now;
    clearStandbyTimer();
    stopRing();
    stopRingRef.current = startRingTone();
    setRingReason(reason);
    setLastOutcome(null);
    setPhaseSafe("incoming");
    box.logSpiritLine("incoming", { outcome: reason });
  };

  useEffect(() => {
    phaseRef.current = phase;
  }, [phase]);

  useEffect(() => {
    listenKnockRef.current = listenKnock;
  }, [listenKnock]);

  useEffect(() => {
    return () => {
      clearStandbyTimer();
      stopRing();
      if (tickRef.current) window.clearInterval(tickRef.current);
      releaseOwnedMic();
      if (startedFieldRef.current) {
        // Leave field running if the Field gauge may still want it — only stop if we started and panel unmounts idle
        startedFieldRef.current = false;
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // PRIMARY: EMF / field spike while armed
  useEffect(() => {
    return field.onReading((reading) => {
      setFieldLive(reading.live);
      if (reading.spike && phaseRef.current === "armed") {
        triggerIncoming("EMF spike");
      }
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // SECONDARY: cold-spot DROP while cold meter is live + line armed
  useEffect(() => {
    return cold.onReading((reading) => {
      setColdLive(reading.live);
      if (reading.live && reading.drop && phaseRef.current === "armed") {
        triggerIncoming("Cold drop");
      }
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // OPTIONAL: knock / jolt via DeviceMotion acceleration
  useEffect(() => {
    const onMotion = (ev: DeviceMotionEvent) => {
      if (!listenKnockRef.current || phaseRef.current !== "armed") return;
      const a = ev.accelerationIncludingGravity;
      if (!a || a.x == null || a.y == null || a.z == null) return;
      const mag = Math.hypot(a.x, a.y, a.z);
      if (!knockPrimedRef.current) {
        knockBaselineRef.current = mag;
        knockPrimedRef.current = true;
        return;
      }
      knockBaselineRef.current = knockBaselineRef.current * 0.92 + mag * 0.08;
      const delta = Math.abs(mag - knockBaselineRef.current);
      // ~ gravity + sudden knock; tuned for phone taps / thumps
      if (delta > 6.5) triggerIncoming("Knock");
    };

    const DOE = DeviceMotionEvent as unknown as {
      requestPermission?: () => Promise<string>;
    };

    let attached = false;
    const attach = () => {
      if (attached) return;
      window.addEventListener("devicemotion", onMotion);
      attached = true;
    };

    if (typeof DOE.requestPermission === "function") {
      // Permission usually already granted via field/compass arm; try quietly
      void DOE.requestPermission()
        .then((perm) => {
          if (perm === "granted") attach();
        })
        .catch(() => {
          /* knock optional */
        });
    } else {
      attach();
    }

    return () => {
      if (attached) window.removeEventListener("devicemotion", onMotion);
      knockPrimedRef.current = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (phase !== "active") {
      if (tickRef.current) {
        window.clearInterval(tickRef.current);
        tickRef.current = 0;
      }
      return;
    }
    tickRef.current = window.setInterval(() => {
      setElapsedMs(Date.now() - activeStartedRef.current);
    }, 250);
    return () => {
      if (tickRef.current) {
        window.clearInterval(tickRef.current);
        tickRef.current = 0;
      }
    };
  }, [phase]);

  const armLine = async () => {
    setError(null);
    setLastOutcome(null);
    setRingReason(null);
    setElapsedMs(0);
    setCallMuted(false);
    setCallHeld(false);
    setSensorNote(null);
    try {
      await box.unlock();
      box.resume();
    } catch {
      setError("Couldn't unlock audio. Tap Arm again with sound allowed.");
      return;
    }

    // Ensure field meter is live so EMF spikes can ring
    if (!field.live) {
      const ok = await field.start();
      if (ok) {
        startedFieldRef.current = true;
        setFieldLive(true);
        setSensorNote("Field meter armed for EMF spikes.");
      } else {
        setSensorNote(
          field.error ??
            "Field meter didn't start — use Request incoming to test, or start Field gauge manually.",
        );
      }
    } else {
      setFieldLive(true);
      setSensorNote(
        cold.live
          ? "Listening for EMF spikes and cold drops."
          : "Listening for EMF spikes. Start Cold spot meter for drop rings.",
      );
    }

    box.logSpiritLine("armed");
    setPhaseSafe("armed");
    if (standbyPing) scheduleStandbyPing();
    else clearStandbyTimer();
  };

  const disarm = () => {
    clearStandbyTimer();
    stopRing();
    releaseOwnedMic();
    setRingReason(null);
    setPhaseSafe("idle");
    setPendingStandbyIn(null);
  };

  const answer = async () => {
    stopRing();
    clearStandbyTimer();
    setError(null);
    try {
      await box.unlock();
      box.resume();
    } catch {
      setError("Audio path blocked — allow sound, then Answer again.");
      return;
    }
    wasScanningRef.current = box.scanning;
    if (!box.scanning) box.startScan();
    activeStartedRef.current = Date.now();
    setElapsedMs(0);
    setCallMuted(false);
    setCallHeld(false);
    setPhaseSafe("active");
    box.logSpiritLine("answered", { outcome: ringReason ?? undefined });
  };

  const decline = () => {
    stopRing();
    clearStandbyTimer();
    box.logSpiritLine("declined", {
      durationMs: 0,
      outcome: ringReason ? `declined · ${ringReason}` : "declined",
    });
    setLastOutcome(ringReason ? `Declined · ${ringReason}` : "Declined");
    setPhaseSafe("ended");
  };

  const hangup = (outcome = "ended") => {
    stopRing();
    clearStandbyTimer();
    const durationMs = phaseRef.current === "active" ? Date.now() - activeStartedRef.current : 0;
    if (callMuted) {
      box.setMuted(muteBeforeRef.current);
      setCallMuted(false);
    }
    if (callHeld) {
      setCallHeld(false);
      box.startScan();
    }
    releaseOwnedMic();
    const out = ringReason ? `${outcome} · ${ringReason}` : outcome;
    box.logSpiritLine("ended", { durationMs, outcome: out });
    setElapsedMs(durationMs);
    setLastOutcome(`Ended · ${formatClock(durationMs)}${ringReason ? ` · ${ringReason}` : ""}`);
    setPhaseSafe("ended");
  };

  const toggleMute = () => {
    if (!callMuted) {
      muteBeforeRef.current = false;
      box.setMuted(true);
      setCallMuted(true);
      box.logSpiritLine("mute");
    } else {
      box.setMuted(muteBeforeRef.current);
      setCallMuted(false);
    }
  };

  const toggleHold = () => {
    if (!callHeld) {
      wasScanningRef.current = box.scanning;
      if (!box.holding) box.toggleHold();
      else box.stopScan();
      setCallHeld(true);
      box.logSpiritLine("held");
    } else {
      box.startScan();
      setCallHeld(false);
    }
  };

  const toggleMicFeed = async () => {
    setError(null);
    if (micOn && ownedMicRef.current) {
      releaseOwnedMic();
      return;
    }
    if (micOn && !ownedMicRef.current) {
      setMicOn(false);
      return;
    }
    try {
      const stream = await requestMic();
      if (!box.attachMic(stream)) {
        stream.getTracks().forEach((t) => t.stop());
        setError("Arm the receiver first, then open the mic feed.");
        return;
      }
      ownedMicRef.current = true;
      setMicOn(true);
    } catch (err) {
      setError(micErrorMessage(err));
    }
  };

  const requestIncoming = () => {
    if (phase !== "armed") return;
    triggerIncoming("Manual");
  };

  const statusLabel =
    phase === "idle"
      ? "Standby"
      : phase === "armed"
        ? standbyPing && pendingStandbyIn != null
          ? `Armed · standby ~${pendingStandbyIn}s`
          : "Armed · sensors"
        : phase === "incoming"
          ? "Incoming"
          : phase === "active"
            ? callHeld
              ? "On hold"
              : "Live path"
            : "Ended";

  return (
    <section
      className={cn(
        "chassis mt-3 rounded-xl p-3",
        phase === "incoming" && "ring-2 ring-accent animate-pulse",
        phase === "active" && "ring-2 ring-accent",
      )}
    >
      <div className="flex items-center justify-between gap-2">
        <p className="flex items-center gap-2 font-display text-[10px] tracking-[0.2em] text-muted uppercase">
          <Phone className="size-3.5" />
          Spirit Line
        </p>
        <p className="font-display text-[10px] tracking-[0.18em] text-muted uppercase">{statusLabel}</p>
      </div>

      <div className="mt-2 flex flex-wrap items-center gap-2">
        <span className="rounded-sm border border-line bg-raised px-2 py-0.5 font-display text-[10px] tracking-[0.22em] text-accent uppercase">
          ITC LINE
        </span>
        <span className="font-display text-[10px] tracking-[0.14em] text-muted uppercase">
          not cellular · unknown field
        </span>
      </div>

      <p className="mt-2 text-xs text-muted">
        ITC line — not cellular. Answer to open a live audio path. Rings on real field / cold events — never dials the Phone app.
      </p>

      {phase === "idle" && (
        <div className="mt-3 flex flex-col gap-2">
          <Button variant="accent" size="lg" className="w-full" onClick={() => void armLine()}>
            <PhoneIncoming className="size-4" />
            Arm line
          </Button>
          <p className="text-xs text-muted">
            Primary: <span className="text-accent">EMF / field spike</span>. Secondary:{" "}
            <span className="text-accent">cold drop</span> (if Cold spot meter is live). Optional knock via motion.
          </p>
          <label className="flex items-center gap-2 text-xs text-muted">
            <input
              type="checkbox"
              className="size-4 accent-accent"
              checked={listenKnock}
              onChange={(e) => setListenKnock(e.target.checked)}
            />
            Listen for knock / thump (accelerometer)
          </label>
          <label className="flex items-center gap-2 text-xs text-muted">
            <input
              type="checkbox"
              className="size-4 accent-accent"
              checked={standbyPing}
              onChange={(e) => setStandbyPing(e.target.checked)}
            />
            Standby ping (timed — off by default, not sensor)
          </label>
        </div>
      )}

      {phase === "armed" && (
        <div className="mt-3 flex flex-col gap-2">
          <div className="rounded-lg border border-line bg-raised px-3 py-2 text-xs text-muted">
            <p className="font-display text-[10px] tracking-[0.2em] text-muted uppercase">Sensor watch</p>
            <p className="mt-1">
              EMF: {fieldLive ? <span className="text-accent">live</span> : <span className="text-danger">off</span>}
              {" · "}
              Cold: {coldLive ? <span className="text-accent">live</span> : "off (start Cold spot)"}
              {" · "}
              Knock: {listenKnock ? <span className="text-accent">on</span> : "off"}
            </p>
            {sensorNote && <p className="mt-1 text-accent">{sensorNote}</p>}
          </div>
          <div className="grid grid-cols-2 gap-2">
            <Button variant="accent" size="lg" onClick={requestIncoming}>
              <PhoneIncoming className="size-4" />
              Request incoming
            </Button>
            <Button variant="ghost" size="lg" onClick={disarm}>
              Disarm
            </Button>
          </div>
          <p className="text-xs text-muted">
            <span className="text-accent">Request incoming</span> = manual test ring. Real rings come from EMF spikes
            {coldLive ? ", cold drops" : ""}
            {listenKnock ? ", or knocks" : ""}.
          </p>
          <label className="flex items-center gap-2 text-xs text-muted">
            <input
              type="checkbox"
              className="size-4 accent-accent"
              checked={listenKnock}
              onChange={(e) => setListenKnock(e.target.checked)}
            />
            Listen for knock / thump
          </label>
          <label className="flex items-center gap-2 text-xs text-muted">
            <input
              type="checkbox"
              className="size-4 accent-accent"
              checked={standbyPing}
              onChange={(e) => {
                const on = e.target.checked;
                setStandbyPing(on);
                if (on) scheduleStandbyPing();
                else clearStandbyTimer();
              }}
            />
            Standby ping (timed — not sensor)
          </label>
        </div>
      )}

      {phase === "incoming" && (
        <div className="mt-3 space-y-3">
          <div className="rounded-lg border border-line bg-raised px-3 py-4 text-center">
            <p className="font-display text-[10px] tracking-[0.28em] text-muted uppercase">Incoming · ITC</p>
            <p className="phosphor mt-1 font-display text-2xl tracking-wide text-accent uppercase">
              {ringReason ?? "Unknown field"}
            </p>
            <p className="mt-1 text-xs text-muted">
              {ringReason === "Manual"
                ? "Manual test — in-app audio session, not a carrier call"
                : ringReason === "Standby ping"
                  ? "Timed standby ping — not a sensor event"
                  : "Sensor trigger — in-app audio session, not a carrier call"}
            </p>
          </div>
          <div className="grid grid-cols-2 gap-2">
            <Button variant="accent" size="xl" className="w-full" onClick={() => void answer()}>
              Answer
            </Button>
            <Button variant="danger" size="xl" className="w-full" onClick={decline}>
              Decline
            </Button>
          </div>
        </div>
      )}

      {phase === "active" && (
        <div className="mt-3 space-y-3">
          <div className="flex items-baseline justify-between gap-2">
            <p className="phosphor font-display text-3xl leading-none tabular-nums">{formatClock(elapsedMs)}</p>
            <p className="font-display text-[10px] tracking-[0.2em] text-muted uppercase">
              {callHeld ? "Hold" : callMuted ? "Muted" : "Earpiece path"}
            </p>
          </div>
          {ringReason && (
            <p className="font-display text-[10px] tracking-[0.18em] text-accent uppercase">
              Opened by · {ringReason}
            </p>
          )}
          <p className="text-xs text-muted">
            Live sweep / ITC chop into the session
            {micOn ? " · mic feed open" : ""}. Hang up to close the path.
          </p>
          <div className="grid grid-cols-2 gap-2">
            <Button variant={callMuted ? "accent" : "ghost"} size="lg" onClick={toggleMute}>
              {callMuted ? <MicOff className="size-4" /> : <Mic className="size-4" />}
              {callMuted ? "Unmute" : "Mute"}
            </Button>
            <Button variant={callHeld ? "accent" : "ghost"} size="lg" onClick={toggleHold}>
              {callHeld ? <Play className="size-4" /> : <Pause className="size-4" />}
              {callHeld ? "Resume" : "Hold"}
            </Button>
            <Button variant={micOn ? "accent" : "ghost"} size="lg" onClick={() => void toggleMicFeed()}>
              {micOn ? <Mic className="size-4" /> : <MicOff className="size-4" />}
              {micOn ? "Mic live" : "Feed mic"}
            </Button>
            <Button variant="danger" size="lg" onClick={() => hangup("ended")}>
              <PhoneOff className="size-4" />
              Hang up
            </Button>
          </div>
        </div>
      )}

      {phase === "ended" && (
        <div className="mt-3 flex flex-col gap-2">
          {lastOutcome && <p className="text-sm text-accent">{lastOutcome}</p>}
          <div className="grid grid-cols-2 gap-2">
            <Button variant="accent" size="lg" onClick={() => void armLine()}>
              Re-arm line
            </Button>
            <Button variant="ghost" size="lg" onClick={disarm}>
              Standby
            </Button>
          </div>
          <label className="flex items-center gap-2 text-xs text-muted">
            <input
              type="checkbox"
              className="size-4 accent-accent"
              checked={standbyPing}
              onChange={(e) => setStandbyPing(e.target.checked)}
            />
            Standby ping (timed — off by default)
          </label>
        </div>
      )}

      {error && <p className="mt-2 text-sm text-danger">{error}</p>}
    </section>
  );
}
