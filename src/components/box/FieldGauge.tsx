import { useEffect, useState } from "react";
import { Compass } from "lucide-react";
import { Button } from "@/components/ui/button";
import { box } from "@/lib/box/audio";
import { field, type FieldReading } from "@/lib/box/field";
import { cn } from "@/lib/utils";

const IDLE: FieldReading = {
  live: false,
  source: "none",
  microtesla: null,
  heading: null,
  milligauss: 0,
  delta: 0,
  bars: 0,
  spike: false,
  lit: false,
  error: null,
};

export function FieldGauge() {
  const [reading, setReading] = useState<FieldReading>(IDLE);

  useEffect(() => {
    return field.onReading((next) => {
      setReading(next);
      if (next.spike && !box.askMode) box.lockFromField(next.delta);
    });
  }, []);

  const toggle = async () => {
    if (field.live) field.stop();
    else await field.start();
  };

  const level = reading.lit ? Math.max(reading.bars, 1) : reading.bars;

  return (
    <section className={cn("chassis mt-3 rounded-xl p-3", reading.lit && "ring-2 ring-danger")}>
      <div className="flex items-center justify-between gap-2">
        <p className="font-display text-[10px] tracking-[0.2em] text-muted uppercase">EMF meter</p>
        <Button variant={reading.live ? "accent" : "ghost"} size="sm" onClick={() => void toggle()}>
          <Compass className="size-3.5" />
          {reading.live ? "Meter live" : "Start meter"}
        </Button>
      </div>

      <div className="mt-3 flex h-10 items-end gap-1.5" aria-label={`EMF ${level} of 5`}>
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
              i < level ? (i >= 3 ? "bg-danger" : "bg-accent") : "bg-raised",
            )}
          />
        ))}
      </div>

      <div className="mt-3 flex items-baseline justify-between gap-2">
        <p className="phosphor font-display text-2xl leading-none tabular-nums">
          {reading.live ? reading.milligauss.toFixed(1) : "—"}
          <span className="ml-1 text-sm text-muted">mG</span>
        </p>
        <p className="font-display text-[10px] tracking-wide text-muted uppercase">
          {reading.spike ? "Hit" : reading.lit ? "Rising" : reading.live ? "Ambient" : "Idle"}
        </p>
      </div>
      {reading.error && <p className="mt-2 text-sm text-danger">{reading.error}</p>}
      {!reading.error && (
        <p className="mt-2 text-xs text-muted">
          {reading.live
            ? "Wave the phone past metal, a speaker, or wiring. A jump lights the meter and locks a word."
            : "Tap Start meter, then move the phone. Uses the compass magnetometer."}
        </p>
      )}
    </section>
  );
}
