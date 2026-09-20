/**
 * Cold-spot / ambient environmental meter.
 * Prefers Ambient Temperature (rare) then Ambient Light. Never invents readings.
 */

export type ColdSource = "temperature" | "light" | "none";

export type ColdReading = {
  live: boolean;
  source: ColdSource;
  /** Absolute sensor value when live (°C or lux). */
  value: number | null;
  unit: "°C" | "lux" | null;
  /** Signed delta from calibrated baseline (negative = colder / darker). */
  delta: number;
  bars: number;
  /** Drop below baseline past threshold. */
  drop: boolean;
  /** Rise above baseline past threshold. */
  spike: boolean;
  lit: boolean;
  error: string | null;
  /** True when device has no usable ambient temp or light sensor. */
  unavailable: boolean;
  status: string;
};

type Listener = (reading: ColdReading) => void;

type GenericSensor = {
  start: () => void;
  stop: () => void;
  addEventListener: (type: string, fn: (ev?: Event) => void) => void;
};

type TempSensor = GenericSensor & { temperature: number | null };
type LightSensor = GenericSensor & { illuminance: number | null };

function inEmbeddedPreview() {
  try {
    if (/\.grok\.me$/i.test(window.location.hostname)) return false;
    return window.self !== window.top;
  } catch {
    return true;
  }
}

function tempCtor(): (new (opts?: { frequency?: number }) => TempSensor) | null {
  const w = window as unknown as {
    AmbientTemperatureSensor?: new (opts?: { frequency?: number }) => TempSensor;
  };
  return w.AmbientTemperatureSensor ?? null;
}

function lightCtor(): (new (opts?: { frequency?: number }) => LightSensor) | null {
  const w = window as unknown as {
    AmbientLightSensor?: new (opts?: { frequency?: number }) => LightSensor;
  };
  return w.AmbientLightSensor ?? null;
}

function toBars(absDelta: number, source: ColdSource) {
  if (source === "temperature") {
    if (absDelta < 0.3) return 0;
    if (absDelta < 0.7) return 1;
    if (absDelta < 1.2) return 2;
    if (absDelta < 2.0) return 3;
    if (absDelta < 3.5) return 4;
    return 5;
  }
  // lux
  if (absDelta < 8) return 0;
  if (absDelta < 25) return 1;
  if (absDelta < 60) return 2;
  if (absDelta < 120) return 3;
  if (absDelta < 250) return 4;
  return 5;
}

export class ColdSensor {
  private listeners = new Set<Listener>();
  private sensor: GenericSensor | null = null;
  private baseline: number | null = null;
  private holdBaseline = false;
  private lastAlert = 0;
  private litUntil = 0;
  live = false;
  source: ColdSource = "none";
  value: number | null = null;
  unit: "°C" | "lux" | null = null;
  delta = 0;
  bars = 0;
  drop = false;
  spike = false;
  lit = false;
  error: string | null = null;
  unavailable = false;
  status = "Idle";

  onReading(fn: Listener) {
    this.listeners.add(fn);
    fn(this.snapshot());
    return () => {
      this.listeners.delete(fn);
    };
  }

  snapshot(): ColdReading {
    return {
      live: this.live,
      source: this.source,
      value: this.value,
      unit: this.unit,
      delta: this.delta,
      bars: this.bars,
      drop: this.drop,
      spike: this.spike,
      lit: this.lit,
      error: this.error,
      unavailable: this.unavailable,
      status: this.status,
    };
  }

  private emit() {
    const reading = this.snapshot();
    for (const fn of this.listeners) fn(reading);
  }

  /** Capture current value as fixed baseline for relative anomaly. */
  calibrate() {
    if (this.value == null) return false;
    this.baseline = this.value;
    this.holdBaseline = true;
    this.status = "Calibrated";
    this.emit();
    return true;
  }

  private ingest(value: number, kind: ColdSource) {
    this.source = kind;
    this.value = value;
    this.unit = kind === "temperature" ? "°C" : "lux";
    this.unavailable = false;
    this.error = null;

    if (this.baseline == null) {
      this.baseline = value;
    } else if (!this.holdBaseline) {
      // Soft track until user calibrates
      this.baseline = this.baseline * 0.97 + value * 0.03;
    }

    this.delta = value - (this.baseline ?? value);
    const abs = Math.abs(this.delta);
    this.bars = toBars(abs, kind);

    const dropThresh = kind === "temperature" ? -0.8 : -40;
    const spikeThresh = kind === "temperature" ? 1.2 : 80;
    const now = performance.now();
    const wasLit = this.lit;

    if (this.delta <= dropThresh || this.delta >= spikeThresh) {
      this.litUntil = now + 1100;
    }
    this.lit = now < this.litUntil;

    const alertReady = this.lit && !wasLit && now - this.lastAlert > 1200;
    this.drop = alertReady && this.delta <= dropThresh;
    this.spike = alertReady && this.delta >= spikeThresh;
    if (this.drop || this.spike) this.lastAlert = now;

    if (this.drop) this.status = kind === "temperature" ? "Cold drop" : "Lux drop";
    else if (this.spike) this.status = kind === "temperature" ? "Warm rise" : "Lux rise";
    else if (this.lit) this.status = "Anomaly";
    else if (this.holdBaseline) this.status = "Watching";
    else this.status = "Ambient";

    this.emit();
  }

  async start(): Promise<boolean> {
    this.error = null;
    this.unavailable = false;
    this.baseline = null;
    this.holdBaseline = false;
    this.stopSensorOnly();

    if (inEmbeddedPreview()) {
      this.error =
        "Open the published page in Chrome or Safari to read ambient sensors. This chat blocks sensors.";
      this.status = "Blocked";
      this.emit();
      return false;
    }

    const Temp = tempCtor();
    if (Temp) {
      try {
        const sensor = new Temp({ frequency: 2 });
        sensor.addEventListener("reading", () => {
          const t = sensor.temperature;
          if (typeof t === "number" && Number.isFinite(t)) this.ingest(t, "temperature");
        });
        sensor.addEventListener("error", () => {
          this.stopSensorOnly();
          void this.startLight();
        });
        sensor.start();
        this.sensor = sensor;
        this.live = true;
        this.source = "temperature";
        this.unit = "°C";
        this.status = "Temperature live";
        this.emit();
        return true;
      } catch {
        /* fall through */
      }
    }

    return this.startLight();
  }

  private async startLight(): Promise<boolean> {
    const Light = lightCtor();
    if (!Light) {
      this.live = false;
      this.source = "none";
      this.unavailable = true;
      this.error = null;
      this.status = "No sensor";
      this.emit();
      return false;
    }

    try {
      // Permissions API may gate Ambient Light on some Chromium builds
      const perms = navigator.permissions as
        | { query?: (desc: { name: string }) => Promise<{ state: string }> }
        | undefined;
      if (perms?.query) {
        try {
          const result = await perms.query({ name: "ambient-light-sensor" });
          if (result.state === "denied") {
            this.error =
              "Ambient light permission denied. Phone Settings → this browser → Sensors / additional permissions.";
            this.status = "Denied";
            this.emit();
            return false;
          }
        } catch {
          /* name may be unrecognized — continue and try start() */
        }
      }

      const sensor = new Light({ frequency: 4 });
      sensor.addEventListener("reading", () => {
        const lux = sensor.illuminance;
        if (typeof lux === "number" && Number.isFinite(lux)) this.ingest(lux, "light");
      });
      sensor.addEventListener("error", () => {
        this.stopSensorOnly();
        this.live = false;
        this.unavailable = true;
        this.source = "none";
        this.error = null;
        this.status = "No sensor";
        this.emit();
      });
      sensor.start();
      this.sensor = sensor;
      this.live = true;
      this.source = "light";
      this.unit = "lux";
      this.status = "Light live";
      this.emit();
      return true;
    } catch {
      this.live = false;
      this.source = "none";
      this.unavailable = true;
      this.error = null;
      this.status = "No sensor";
      this.emit();
      return false;
    }
  }

  private stopSensorOnly() {
    try {
      this.sensor?.stop();
    } catch {
      /* already stopped */
    }
    this.sensor = null;
  }

  stop() {
    this.stopSensorOnly();
    this.live = false;
    this.drop = false;
    this.spike = false;
    this.lit = false;
    this.bars = 0;
    this.delta = 0;
    this.status = "Idle";
    this.emit();
  }
}

export const cold = new ColdSensor();
