export type FieldSource = "magnetometer" | "compass" | "none";

export type FieldReading = {
  live: boolean;
  source: FieldSource;
  microtesla: number | null;
  heading: number | null;
  milligauss: number;
  delta: number;
  bars: number;
  spike: boolean;
  lit: boolean;
  error: string | null;
};

type Listener = (reading: FieldReading) => void;

type MagSensor = {
  x: number | null;
  y: number | null;
  z: number | null;
  start: () => void;
  stop: () => void;
  addEventListener: (type: string, fn: (ev?: Event) => void) => void;
};

function inEmbeddedPreview() {
  try {
    if (/\.grok\.me$/i.test(window.location.hostname)) return false;
    return window.self !== window.top;
  } catch {
    return true;
  }
}

function magnetometerCtor(): (new (opts?: { frequency?: number }) => MagSensor) | null {
  const ctor = (window as unknown as { Magnetometer?: new (opts?: { frequency?: number }) => MagSensor })
    .Magnetometer;
  return ctor ?? null;
}

function toBars(deltaMg: number) {
  if (deltaMg < 3) return 0;
  if (deltaMg < 12) return 1;
  if (deltaMg < 35) return 2;
  if (deltaMg < 80) return 3;
  if (deltaMg < 200) return 4;
  return 5;
}

export class FieldSensor {
  private listeners = new Set<Listener>();
  private mag: MagSensor | null = null;
  private baseline = 0;
  private primed = false;
  private lastSpike = 0;
  private litUntil = 0;
  private heading = 0;
  live = false;
  source: FieldSource = "none";
  error: string | null = null;
  microtesla: number | null = null;
  milligauss = 0;
  delta = 0;
  bars = 0;
  spike = false;
  lit = false;

  onReading(fn: Listener) {
    this.listeners.add(fn);
    fn(this.snapshot());
    return () => {
      this.listeners.delete(fn);
    };
  }

  snapshot(): FieldReading {
    return {
      live: this.live,
      source: this.source,
      microtesla: this.microtesla,
      heading: this.source === "compass" ? this.heading : null,
      milligauss: this.milligauss,
      delta: this.delta,
      bars: this.bars,
      spike: this.spike,
      lit: this.lit,
      error: this.error,
    };
  }

  private emit() {
    const reading: FieldReading = {
      live: this.live,
      source: this.source,
      microtesla: this.microtesla,
      heading: this.source === "compass" ? this.heading : null,
      milligauss: this.milligauss,
      delta: this.delta,
      bars: this.bars,
      spike: this.spike,
      lit: this.lit,
      error: this.error,
    };
    for (const fn of this.listeners) fn(reading);
  }

  private ingest(value: number, kind: FieldSource) {
    this.source = kind;
    if (kind === "magnetometer") {
      this.microtesla = value;
      this.milligauss = value * 10;
    } else {
      this.heading = value;
    }
    if (!this.primed) {
      this.baseline = value;
      this.primed = true;
    }
    this.baseline = this.baseline * 0.985 + value * 0.015;
    this.delta = Math.abs(value - this.baseline);
    const deltaMg = kind === "magnetometer" ? this.delta * 10 : this.delta * 3;
    if (kind === "compass") this.milligauss = Math.min(2000, 2 + deltaMg);
    this.bars = toBars(deltaMg);
    const threshold = kind === "magnetometer" ? 1.6 : 4;
    const now = performance.now();
    if (this.delta >= threshold) this.litUntil = now + 900;
    const wasLit = this.lit;
    this.lit = now < this.litUntil;
    this.spike = this.lit && !wasLit && now - this.lastSpike > 650;
    if (this.spike) this.lastSpike = now;
    this.emit();
  }

  async start(): Promise<boolean> {
    this.error = null;
    this.primed = false;
    if (inEmbeddedPreview()) {
      this.error = "Open the published page in Chrome or Safari to read the field. This chat blocks sensors.";
      this.emit();
      return false;
    }

    const Mag = magnetometerCtor();
    if (Mag) {
      try {
        const mag = new Mag({ frequency: 20 });
        mag.addEventListener("reading", () => {
          const x = mag.x ?? 0;
          const y = mag.y ?? 0;
          const z = mag.z ?? 0;
          this.ingest(Math.hypot(x, y, z), "magnetometer");
        });
        mag.addEventListener("error", () => {
          this.stopMag();
          void this.startCompass();
        });
        mag.start();
        this.mag = mag;
        this.live = true;
        this.source = "magnetometer";
        this.emit();
        return true;
      } catch {
        /* fall through to compass */
      }
    }

    return this.startCompass();
  }

  private async startCompass(): Promise<boolean> {
    const DOE = DeviceOrientationEvent as unknown as {
      requestPermission?: () => Promise<string>;
    };
    try {
      if (typeof DOE.requestPermission === "function") {
        const perm = await DOE.requestPermission();
        if (perm !== "granted") {
          this.error = "Allow motion access to read the compass field.";
          this.emit();
          return false;
        }
      }
    } catch {
      this.error = "Motion permission was blocked. Phone Settings → this browser → Motion.";
      this.emit();
      return false;
    }

    window.addEventListener("deviceorientationabsolute", this.onOrient);
    window.addEventListener("deviceorientation", this.onOrient);
    this.live = true;
    this.source = "compass";
    this.emit();
    return true;
  }

  private onOrient = (event: DeviceOrientationEvent) => {
    const webkit = event as DeviceOrientationEvent & { webkitCompassHeading?: number };
    const heading =
      typeof webkit.webkitCompassHeading === "number"
        ? webkit.webkitCompassHeading
        : typeof event.alpha === "number"
          ? event.alpha
          : null;
    if (heading == null) {
      this.error = "This device isn't reporting a magnetic heading.";
      this.emit();
      return;
    }
    this.error = null;
    this.ingest(heading, "compass");
  };

  private stopMag() {
    try {
      this.mag?.stop();
    } catch {
      /* already stopped */
    }
    this.mag = null;
  }

  stop() {
    this.stopMag();
    window.removeEventListener("deviceorientation", this.onOrient);
    window.removeEventListener("deviceorientationabsolute", this.onOrient);
    this.live = false;
    this.spike = false;
    this.bars = 0;
    this.emit();
  }
}

export const field = new FieldSensor();
