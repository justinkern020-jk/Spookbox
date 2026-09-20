import { useEffect, useRef, useState } from "react";
import { ThermometerSnowflake } from "lucide-react";
import { Button } from "@/components/ui/button";
import { box } from "@/lib/box/audio";
import { cold, type ColdReading } from "@/lib/box/cold";
import { cn } from "@/lib/utils";

const IDLE: ColdReading = {
  live: false,
  source: "none",
  value: null,
  unit: null,
  delta: 0,
  bars: 0,
  drop: false,
  spike: false,
  lit: false,
  error: null,
  unavailable: false,
  status: "Idle",
};

export function ColdSpotPanel() {
  const [reading, setReading] = useState<ColdReading>(IDLE);
  const [calNote, setCalNote] = useState<string | null>(null);
  const armedLogged = useRef(false);

  useEffect(() => {
    return cold.onReading((next) => {
      setReading(next);
      if (next.drop) {
        box.logCold("drop", {
          source: next.source === "none" ? undefined : next.source,
          value: next.value ?? undefined,
          delta: next.delta,
          unit: next.unit ?? undefined,
        });
      } else if (next.spike) {
        box.logCold("spike", {
          source: next.source === "none" ? undefined : next.source,
          value: next.value ?? undefined,
          delta: next.delta,
          unit: next.unit ?? undefined,
        });
      }
    });
  }, []);

  useEffect(() => {
    return () => {
      cold.stop();
    };
  }, []);

  const toggle = async () => {
    setCalNote(null);
    if (cold.live) {
      cold.stop();
      armedLogged.current = false;
      return;
    }
    const ok = await cold.start();
    if (ok && !armedLogged.current) {
      armedLogged.current = true;
      box.logCold("armed", {
        source: cold.source === "none" ? undefined : cold.source,
        unit: cold.unit ?? undefined,
      });
    }
  };

  const calibrate = () => {
    if (!cold.calibrate()) {
      setCalNote("No live sample yet — wait for the first reading.");
      return;
    }
    setCalNote("Baseline held. Drops from this mark log as anomalies.");
    box.logCold("calibrate", {
      source: cold.source === "none" ? undefined : cold.source,
      value: cold.value ?? undefined,
      unit: cold.unit ?? undefined,
      delta: 0,
    });
  };

  const level = reading.lit ? Math.max(reading.bars, 1) : reading.bars;
  const deltaStr =
    reading.live && reading.value != null
      ? `${reading.delta >= 0 ? "+" : ""}${reading.delta.toFixed(reading.source === "temperature" ? 2 : 0)}${reading.unit ?? ""}`
      : "—";

  return (
    <section className={cn("chassis mt-3 rounded-xl p-3", reading.lit && "ring-2 ring-accent")}>
      <div className="flex items-center justify-between gap-2">
        <p className="flex items-center gap-2 font-display text-[10px] tracking-[0.2em] text-muted uppercase">
          <ThermometerSnowflake className="size-3.5" />
          Cold spot
        </p>
        <Button variant={reading.live ? "accent" : "ghost"} size="sm" onClick={() => void toggle()}>
          {reading.live ? "Meter live" : "Start meter"}
        </Button>
      </div>

      <div className="mt-3 flex h-10 items-end gap-1.5" aria-label={`Cold anomaly ${level} of 5`}>
        {[0, 1, 2, 3, 4].map((i) => (
          <div
            key={i}
            className={cn(
              "flex-1 rounded-sm transition-colors",
              i === 0 && "h-4",
              i === 1 && "h-5",
              i === 2 && "h-6",
              i === 3 && "h-8",
              i === 4 && "h-10",
              i < level
                ? reading.drop || reading.delta < 0
                  ? "bg-accent"
                  : "bg-danger"
                : "bg-raised",
            )}
          />
        ))}
      </div>

      <div className="mt-3 flex items-baseline justify-between gap-2">
        <p className="phosphor font-display text-2xl leading-none tabular-nums">
          {reading.live && reading.value != null
            ? reading.value.toFixed(reading.source === "temperature" ? 1 : 0)
            : "—"}
          <span className="ml-1 text-sm text-muted">{reading.unit ?? ""}</span>
        </p>
        <p className="font-display text-[10px] tracking-wide text-muted uppercase">
          {reading.status}
        </p>
      </div>

      <div className="mt-1 flex items-center justify-between gap-2">
        <p className="font-display text-xs tabular-nums text-muted">
          Δ {deltaStr}
        </p>
        <Button
          variant="ghost"
          size="sm"
          disabled={!reading.live || reading.value == null}
          onClick={calibrate}
        >
          Calibrate
        </Button>
      </div>

      {reading.error && <p className="mt-2 text-sm text-danger">{reading.error}</p>}

      {reading.unavailable && !reading.error && (
        <p className="mt-2 text-sm text-muted">
          This device is not reporting an ambient temperature or ambient light sensor. Cold-spot
          metering needs one of those Generic Sensor APIs — no simulated cold spots.
        </p>
      )}

      {!reading.error && !reading.unavailable && (
        <p className="mt-2 text-xs text-muted">
          {reading.live
            ? reading.source === "temperature"
              ? "Live ambient temperature. Calibrate a baseline, then watch for relative drops."
              : "No ambient temperature API on this phone — using ambient light (lux) as the environmental channel. Calibrate, then watch relative drops."
            : "Tap Start meter. Prefers Ambient Temperature Sensor; falls back to Ambient Light. Does not invent readings."}
        </p>
      )}

      {calNote && <p className="mt-1 text-xs text-accent">{calNote}</p>}
    </section>
  );
}
