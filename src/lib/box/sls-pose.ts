/**
 * SLS pose path: MediaPipe Pose when WASM/model load, else honest motion/contrast
 * blob candidates. Never invents constant fake figures.
 */

export type Joint = { x: number; y: number; v: number };
export type StickFigure = { joints: Joint[]; score: number };

export type PoseMode = "pose" | "motion" | "loading" | "idle";

export type PoseFrame = {
  mode: PoseMode;
  figures: StickFigure[];
  /** True when at least one figure cleared lock threshold this frame. */
  locked: boolean;
  note?: string;
};

type PoseLandmarkerLike = {
  detectForVideo: (
    video: HTMLVideoElement,
    timestamp: number,
  ) => { landmarks: Array<Array<{ x: number; y: number; visibility?: number }>> };
  close: () => void;
};

const POSE_CONNECTIONS: Array<[number, number]> = [
  [11, 12],
  [11, 13],
  [13, 15],
  [12, 14],
  [14, 16],
  [11, 23],
  [12, 24],
  [23, 24],
  [23, 25],
  [25, 27],
  [24, 26],
  [26, 28],
  [0, 11],
  [0, 12],
];

/** Stick-figure edges for drawing (MediaPipe 33-landmark indices or motion 8). */
export const POSE_EDGES = POSE_CONNECTIONS;

export const MOTION_EDGES: Array<[number, number]> = [
  [0, 1], // head-neck
  [1, 2], // neck-L shoulder
  [1, 3], // neck-R shoulder
  [2, 4], // L arm
  [3, 5], // R arm
  [1, 6], // torso to hips mid via L hip proxy
  [1, 7],
  [6, 7],
];

const WASM_CDN =
  "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@1.0.1/wasm";
const MODEL_URL =
  "https://storage.googleapis.com/mediapipe-models/pose_landmarker/pose_landmarker_lite/float16/1/pose_landmarker_lite.tflite";

export class SlsPoseEngine {
  private landmarker: PoseLandmarkerLike | null = null;
  private mode: PoseMode = "idle";
  private note: string | undefined;
  private prevGray: Float32Array | null = null;
  private prevW = 0;
  private prevH = 0;
  private workCanvas: HTMLCanvasElement | null = null;
  private lastLockAt = 0;
  private initPromise: Promise<void> | null = null;

  getMode(): PoseMode {
    return this.mode;
  }

  getNote(): string | undefined {
    return this.note;
  }

  async init(): Promise<PoseMode> {
    if (this.landmarker) {
      this.mode = "pose";
      return this.mode;
    }
    if (this.initPromise) {
      await this.initPromise;
      return this.mode;
    }
    this.mode = "loading";
    this.initPromise = this.loadPose();
    await this.initPromise;
    return this.mode;
  }

  private async loadPose() {
    try {
      const vision = await import("@mediapipe/tasks-vision");
      const fileset = await vision.FilesetResolver.forVisionTasks(WASM_CDN);
      const landmarker = await vision.PoseLandmarker.createFromOptions(fileset, {
        baseOptions: {
          modelAssetPath: MODEL_URL,
          delegate: "GPU",
        },
        runningMode: "VIDEO",
        numPoses: 2,
        minPoseDetectionConfidence: 0.45,
        minPosePresenceConfidence: 0.45,
        minTrackingConfidence: 0.45,
      });
      this.landmarker = landmarker as unknown as PoseLandmarkerLike;
      this.mode = "pose";
      this.note = "MediaPipe Pose · lite";
    } catch {
      try {
        // CPU fallback if GPU delegate fails
        const vision = await import("@mediapipe/tasks-vision");
        const fileset = await vision.FilesetResolver.forVisionTasks(WASM_CDN);
        const landmarker = await vision.PoseLandmarker.createFromOptions(fileset, {
          baseOptions: {
            modelAssetPath: MODEL_URL,
            delegate: "CPU",
          },
          runningMode: "VIDEO",
          numPoses: 2,
          minPoseDetectionConfidence: 0.45,
          minPosePresenceConfidence: 0.45,
          minTrackingConfidence: 0.45,
        });
        this.landmarker = landmarker as unknown as PoseLandmarkerLike;
        this.mode = "pose";
        this.note = "MediaPipe Pose · CPU";
      } catch {
        this.landmarker = null;
        this.mode = "motion";
        this.note =
          "Pose model unavailable — motion/contrast scan only. Figures appear when blobs justify them.";
      }
    }
  }

  dispose() {
    try {
      this.landmarker?.close();
    } catch {
      /* already closed */
    }
    this.landmarker = null;
    this.prevGray = null;
    this.mode = "idle";
    this.initPromise = null;
  }

  process(video: HTMLVideoElement, timestampMs: number): PoseFrame {
    if (this.mode === "loading" || this.mode === "idle") {
      return { mode: this.mode, figures: [], locked: false, note: this.note };
    }
    if (this.mode === "pose" && this.landmarker) {
      return this.processPose(video, timestampMs);
    }
    return this.processMotion(video, timestampMs);
  }

  private processPose(video: HTMLVideoElement, timestampMs: number): PoseFrame {
    try {
      const result = this.landmarker!.detectForVideo(video, timestampMs);
      const figures: StickFigure[] = [];
      for (const lm of result.landmarks ?? []) {
        const joints: Joint[] = lm.map((p) => ({
          x: p.x,
          y: p.y,
          v: p.visibility ?? 0.5,
        }));
        const visible = joints.filter((j) => j.v >= 0.35).length;
        if (visible < 6) continue;
        const score = visible / joints.length;
        figures.push({ joints, score });
      }
      const locked = this.considerLock(figures.length > 0, timestampMs);
      return { mode: "pose", figures, locked, note: this.note };
    } catch {
      // Drop to motion if runtime detect fails mid-session
      this.mode = "motion";
      this.note =
        "Pose runtime failed — switched to motion/contrast scan. No invented figures.";
      return this.processMotion(video, timestampMs);
    }
  }

  private ensureWork(w: number, h: number) {
    if (!this.workCanvas) this.workCanvas = document.createElement("canvas");
    if (this.workCanvas.width !== w || this.workCanvas.height !== h) {
      this.workCanvas.width = w;
      this.workCanvas.height = h;
      this.prevGray = null;
    }
    return this.workCanvas;
  }

  private processMotion(video: HTMLVideoElement, timestampMs: number): PoseFrame {
    const vw = video.videoWidth || 0;
    const vh = video.videoHeight || 0;
    if (vw < 16 || vh < 16) {
      return { mode: "motion", figures: [], locked: false, note: this.note };
    }
    // Downsample for cheap diff
    const w = 80;
    const h = Math.max(40, Math.round((vh / vw) * w));
    const canvas = this.ensureWork(w, h);
    const ctx = canvas.getContext("2d", { willReadFrequently: true });
    if (!ctx) {
      return { mode: "motion", figures: [], locked: false, note: this.note };
    }
    ctx.drawImage(video, 0, 0, w, h);
    const img = ctx.getImageData(0, 0, w, h);
    const gray = new Float32Array(w * h);
    for (let i = 0, p = 0; i < gray.length; i++, p += 4) {
      gray[i] = 0.299 * img.data[p]! + 0.587 * img.data[p + 1]! + 0.114 * img.data[p + 2]!;
    }

    const figures: StickFigure[] = [];
    if (this.prevGray && this.prevW === w && this.prevH === h) {
      const motion = new Float32Array(w * h);
      let motionSum = 0;
      for (let i = 0; i < gray.length; i++) {
        const d = Math.abs(gray[i]! - this.prevGray[i]!);
        motion[i] = d;
        motionSum += d;
      }
      const mean = motionSum / motion.length;
      // Only propose candidates when scene has real motion — never a constant ghost.
      if (mean >= 4.5) {
        const threshold = Math.max(18, mean * 2.2);
        const blobs = findBlobs(motion, w, h, threshold, 28);
        for (const b of blobs.slice(0, 2)) {
          const fig = blobToFigure(b, w, h);
          if (fig) figures.push(fig);
        }
      }
    }

    this.prevGray = gray;
    this.prevW = w;
    this.prevH = h;
    const locked = this.considerLock(figures.length > 0, timestampMs);
    return { mode: "motion", figures, locked, note: this.note };
  }

  private considerLock(hasFigure: boolean, now: number): boolean {
    if (!hasFigure) return false;
    if (now - this.lastLockAt < 1800) return false;
    this.lastLockAt = now;
    return true;
  }
}

type BlobBox = {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
  area: number;
  cx: number;
  cy: number;
};

function findBlobs(
  motion: Float32Array,
  w: number,
  h: number,
  threshold: number,
  minArea: number,
): BlobBox[] {
  const visited = new Uint8Array(w * h);
  const blobs: BlobBox[] = [];
  const stack: number[] = [];

  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = y * w + x;
      if (visited[i] || motion[i]! < threshold) continue;
      stack.length = 0;
      stack.push(i);
      visited[i] = 1;
      let minX = x,
        maxX = x,
        minY = y,
        maxY = y,
        area = 0,
        sx = 0,
        sy = 0;
      while (stack.length) {
        const cur = stack.pop()!;
        const cx = cur % w;
        const cy = (cur / w) | 0;
        area++;
        sx += cx;
        sy += cy;
        if (cx < minX) minX = cx;
        if (cx > maxX) maxX = cx;
        if (cy < minY) minY = cy;
        if (cy > maxY) maxY = cy;
        const neighbors = [cur - 1, cur + 1, cur - w, cur + w];
        for (const n of neighbors) {
          if (n < 0 || n >= motion.length || visited[n]) continue;
          const nx = n % w;
          const ny = (n / w) | 0;
          if (Math.abs(nx - cx) + Math.abs(ny - cy) !== 1) continue;
          if (motion[n]! < threshold) continue;
          visited[n] = 1;
          stack.push(n);
        }
      }
      if (area < minArea) continue;
      const bw = maxX - minX + 1;
      const bh = maxY - minY + 1;
      const aspect = bh / Math.max(1, bw);
      // Human-ish upright blobs only
      if (aspect < 1.15 || aspect > 4.5) continue;
      if (bh < h * 0.22) continue;
      blobs.push({
        minX,
        minY,
        maxX,
        maxY,
        area,
        cx: sx / area,
        cy: sy / area,
      });
    }
  }
  blobs.sort((a, b) => b.area - a.area);
  return blobs;
}

/** Map a motion blob to 8 candidate joints in normalized 0–1 video space. */
function blobToFigure(b: BlobBox, w: number, h: number): StickFigure | null {
  const nx = (v: number) => v / w;
  const ny = (v: number) => v / h;
  const midX = (b.minX + b.maxX) / 2;
  const top = b.minY;
  const bottom = b.maxY;
  const height = bottom - top;
  if (height < 8) return null;
  const shoulderY = top + height * 0.22;
  const hipY = top + height * 0.55;
  const kneeY = top + height * 0.78;
  const shoulderSpan = (b.maxX - b.minX) * 0.38;
  const joints: Joint[] = [
    { x: nx(midX), y: ny(top + height * 0.08), v: 0.7 }, // head
    { x: nx(midX), y: ny(shoulderY), v: 0.65 }, // neck
    { x: nx(midX - shoulderSpan), y: ny(shoulderY), v: 0.6 },
    { x: nx(midX + shoulderSpan), y: ny(shoulderY), v: 0.6 },
    { x: nx(midX - shoulderSpan * 1.15), y: ny(hipY * 0.85 + shoulderY * 0.15), v: 0.45 },
    { x: nx(midX + shoulderSpan * 1.15), y: ny(hipY * 0.85 + shoulderY * 0.15), v: 0.45 },
    { x: nx(midX - shoulderSpan * 0.55), y: ny(kneeY), v: 0.55 },
    { x: nx(midX + shoulderSpan * 0.55), y: ny(kneeY), v: 0.55 },
  ];
  return { joints, score: Math.min(1, b.area / (w * h * 0.15)) };
}

export function drawScanGrid(
  ctx: CanvasRenderingContext2D,
  w: number,
  h: number,
  accent: { r: number; g: number; b: number },
  t: number,
) {
  ctx.save();
  ctx.strokeStyle = `rgba(${accent.r}, ${accent.g}, ${accent.b}, 0.18)`;
  ctx.lineWidth = 1;
  const step = Math.max(24, Math.floor(w / 12));
  for (let x = step; x < w; x += step) {
    ctx.beginPath();
    ctx.moveTo(x, 0);
    ctx.lineTo(x, h);
    ctx.stroke();
  }
  for (let y = step; y < h; y += step) {
    ctx.beginPath();
    ctx.moveTo(0, y);
    ctx.lineTo(w, y);
    ctx.stroke();
  }
  // Sweep bar
  const sweepY = ((t / 18) % (h + 40)) - 20;
  const grad = ctx.createLinearGradient(0, sweepY - 12, 0, sweepY + 12);
  grad.addColorStop(0, `rgba(${accent.r}, ${accent.g}, ${accent.b}, 0)`);
  grad.addColorStop(0.5, `rgba(${accent.r}, ${accent.g}, ${accent.b}, 0.35)`);
  grad.addColorStop(1, `rgba(${accent.r}, ${accent.g}, ${accent.b}, 0)`);
  ctx.fillStyle = grad;
  ctx.fillRect(0, sweepY - 12, w, 24);
  ctx.restore();
}

export function drawFigures(
  ctx: CanvasRenderingContext2D,
  w: number,
  h: number,
  figures: StickFigure[],
  mode: PoseMode,
  accent: { r: number; g: number; b: number },
) {
  const edges = mode === "pose" ? POSE_EDGES : MOTION_EDGES;
  for (const fig of figures) {
    ctx.save();
    ctx.strokeStyle = `rgba(${accent.r}, ${accent.g}, ${accent.b}, ${0.55 + fig.score * 0.4})`;
    ctx.fillStyle = `rgba(${accent.r}, ${accent.g}, ${accent.b}, ${0.7 + fig.score * 0.25})`;
    ctx.lineWidth = 2;
    ctx.lineCap = "round";
    for (const [a, b] of edges) {
      const ja = fig.joints[a];
      const jb = fig.joints[b];
      if (!ja || !jb) continue;
      if (ja.v < 0.3 || jb.v < 0.3) continue;
      ctx.beginPath();
      ctx.moveTo(ja.x * w, ja.y * h);
      ctx.lineTo(jb.x * w, jb.y * h);
      ctx.stroke();
    }
    for (const j of fig.joints) {
      if (j.v < 0.3) continue;
      ctx.beginPath();
      ctx.arc(j.x * w, j.y * h, mode === "pose" ? 3.5 : 4, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.restore();
  }
}
