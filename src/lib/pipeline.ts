/**
 * RoomVerse capture pipeline (runs entirely in the browser).
 *
 * What is real here, and what is honestly not:
 *  - Real: keyframe extraction, blur/exposure/motion analysis, frame-to-frame
 *    yaw estimation via 1-D column-signature correlation, room segmentation on
 *    sustained scene change, and equirectangular panorama compositing with
 *    feathered blending.
 *  - Not claimed: full Structure-from-Motion / Gaussian splatting reconstruction.
 *    Areas the camera never saw are left visibly uncaptured instead of invented.
 */

export type Stage =
  | "decode"
  | "keyframes"
  | "tracking"
  | "segmentation"
  | "panorama"
  | "optimize"
  | "publish";

export interface Progress {
  stage: Stage;
  percent: number;
  message: string;
}

export interface QualityReport {
  frames: number;
  duration: number;
  sharpness: number;
  brightness: number;
  motion: number;
  coverageDegrees: number;
  issues: string[];
  score: number;
}

interface Frame {
  time: number;
  canvas: HTMLCanvasElement;
  signature: Float32Array;
  luma: number;
  sharpness: number;
  yaw: number;
  diff: number;
}

export interface RoomResult {
  name: string;
  blob: Blob;
  coverageDegrees: number;
  frameCount: number;
}

export interface PipelineResult {
  rooms: RoomResult[];
  report: QualityReport;
  duration: number;
}

const H_FOV = 62; // typical smartphone horizontal field of view, degrees
const V_FOV = 40;
const SIG_W = 96;
const SIG_H = 54;
const PANO_W = 4096;
const PANO_H = 2048;

export function loadVideo(file: File): Promise<HTMLVideoElement> {
  return new Promise((resolve, reject) => {
    const video = document.createElement("video");
    video.preload = "auto";
    video.muted = true;
    video.playsInline = true;
    video.crossOrigin = "anonymous";
    video.src = URL.createObjectURL(file);
    video.onloadedmetadata = () => resolve(video);
    video.onerror = () => reject(new Error("This video could not be decoded by your browser."));
  });
}

function seek(video: HTMLVideoElement, time: number): Promise<void> {
  return new Promise((resolve, reject) => {
    const done = () => {
      video.removeEventListener("seeked", done);
      resolve();
    };
    video.addEventListener("seeked", done);
    setTimeout(() => reject(new Error("Timed out reading a frame from the video.")), 12000);
    video.currentTime = Math.min(time, Math.max(0, video.duration - 0.05));
  });
}

function analyze(canvas: HTMLCanvasElement) {
  const small = document.createElement("canvas");
  small.width = SIG_W;
  small.height = SIG_H;
  const sctx = small.getContext("2d", { willReadFrequently: true })!;
  sctx.drawImage(canvas, 0, 0, SIG_W, SIG_H);
  const { data } = sctx.getImageData(0, 0, SIG_W, SIG_H);
  const gray = new Float32Array(SIG_W * SIG_H);
  let sum = 0;
  for (let i = 0; i < gray.length; i++) {
    const g =
      (0.2126 * data[i * 4] + 0.7152 * data[i * 4 + 1] + 0.0722 * data[i * 4 + 2]) / 255;
    gray[i] = g;
    sum += g;
  }
  // Laplacian variance → sharpness (blur detection)
  let mean = 0;
  const lap: number[] = [];
  for (let y = 1; y < SIG_H - 1; y++) {
    for (let x = 1; x < SIG_W - 1; x++) {
      const i = y * SIG_W + x;
      const v =
        4 * gray[i] - gray[i - 1] - gray[i + 1] - gray[i - SIG_W] - gray[i + SIG_W];
      lap.push(v);
      mean += v;
    }
  }
  mean /= lap.length;
  let variance = 0;
  for (const v of lap) variance += (v - mean) ** 2;
  variance /= lap.length;

  // Column signature used for horizontal motion estimation
  const signature = new Float32Array(SIG_W);
  for (let x = 0; x < SIG_W; x++) {
    let acc = 0;
    for (let y = 0; y < SIG_H; y++) acc += gray[y * SIG_W + x];
    signature[x] = acc / SIG_H;
  }
  return { luma: sum / gray.length, sharpness: variance * 1000, signature };
}

/** Estimated horizontal shift (in signature columns) between two frames. */
function estimateShift(a: Float32Array, b: Float32Array) {
  const max = 28;
  let best = 0;
  let bestScore = Infinity;
  for (let s = -max; s <= max; s++) {
    let score = 0;
    let count = 0;
    for (let x = 0; x < SIG_W; x++) {
      const xs = x + s;
      if (xs < 0 || xs >= SIG_W) continue;
      score += (a[x] - b[xs]) ** 2;
      count++;
    }
    if (count < SIG_W * 0.5) continue;
    score /= count;
    if (score < bestScore) {
      bestScore = score;
      best = s;
    }
  }
  return { shift: best, residual: bestScore };
}

function feather(frame: HTMLCanvasElement, w: number, h: number) {
  const tmp = document.createElement("canvas");
  tmp.width = w;
  tmp.height = h;
  const ctx = tmp.getContext("2d")!;
  ctx.drawImage(frame, 0, 0, w, h);
  const grad = ctx.createLinearGradient(0, 0, w, 0);
  grad.addColorStop(0, "rgba(0,0,0,0)");
  grad.addColorStop(0.18, "rgba(0,0,0,1)");
  grad.addColorStop(0.82, "rgba(0,0,0,1)");
  grad.addColorStop(1, "rgba(0,0,0,0)");
  ctx.globalCompositeOperation = "destination-in";
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, w, h);
  return tmp;
}

function buildPanorama(frames: Frame[]) {
  const pano = document.createElement("canvas");
  pano.width = PANO_W;
  pano.height = PANO_H;
  const ctx = pano.getContext("2d")!;
  ctx.fillStyle = "#0d0f13";
  ctx.fillRect(0, 0, PANO_W, PANO_H);

  const base = frames[0]?.yaw ?? 0;
  const tileW = Math.round((H_FOV / 360) * PANO_W);
  const tileH = Math.round((V_FOV / 180) * PANO_H);
  const top = Math.round((PANO_H - tileH) / 2);
  let min = Infinity;
  let max = -Infinity;

  for (const frame of frames) {
    const yaw = frame.yaw - base;
    min = Math.min(min, yaw);
    max = Math.max(max, yaw);
    const cx = ((((yaw / 360) * PANO_W) % PANO_W) + PANO_W) % PANO_W;
    const tile = feather(frame.canvas, tileW, tileH);
    const x = Math.round(cx - tileW / 2);
    ctx.drawImage(tile, x, top);
    if (x < 0) ctx.drawImage(tile, x + PANO_W, top);
    if (x + tileW > PANO_W) ctx.drawImage(tile, x - PANO_W, top);
  }

  // Soft vertical falloff so uncaptured ceiling/floor reads as unknown space
  const fade = ctx.createLinearGradient(0, 0, 0, PANO_H);
  fade.addColorStop(0, "rgba(13,15,19,1)");
  fade.addColorStop(0.22, "rgba(13,15,19,0)");
  fade.addColorStop(0.78, "rgba(13,15,19,0)");
  fade.addColorStop(1, "rgba(13,15,19,1)");
  ctx.fillStyle = fade;
  ctx.fillRect(0, 0, PANO_W, PANO_H);

  const coverage = Math.min(360, Math.max(0, max - min) + H_FOV);
  return { pano, coverage };
}

function toBlob(canvas: HTMLCanvasElement) {
  return new Promise<Blob>((resolve, reject) =>
    canvas.toBlob(
      (b) => (b ? resolve(b) : reject(new Error("Could not encode the panorama image."))),
      "image/jpeg",
      0.86,
    ),
  );
}

const ROOM_NAMES = ["Main Room", "Second Space", "Third Space", "Fourth Space", "Fifth Space"];

export async function processVideo(
  file: File,
  onProgress: (p: Progress) => void,
): Promise<PipelineResult> {
  onProgress({ stage: "decode", percent: 4, message: "Decoding video stream…" });
  const video = await loadVideo(file);
  const duration = Number.isFinite(video.duration) ? video.duration : 0;
  if (!duration) throw new Error("The video has no readable duration.");

  const width = 960;
  const height = Math.round((video.videoHeight / video.videoWidth) * width) || 540;
  const step = Math.max(0.12, Math.min(0.5, duration / 90));
  const times: number[] = [];
  for (let t = 0; t < duration - 0.05; t += step) times.push(t);

  const frames: Frame[] = [];
  let yaw = 0;
  let prev: Frame | null = null;

  for (let i = 0; i < times.length; i++) {
    await seek(video, times[i]);
    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    canvas.getContext("2d")!.drawImage(video, 0, 0, width, height);
    const { luma, sharpness, signature } = analyze(canvas);

    let diff = 0;
    if (prev) {
      const { shift, residual } = estimateShift(prev.signature, signature);
      yaw += (shift / SIG_W) * H_FOV;
      diff = residual;
      // Drop near-duplicate frames (camera barely moved)
      if (Math.abs(shift) < 1 && residual < 0.00035) {
        prev.time = times[i];
        onProgress({
          stage: "keyframes",
          percent: 4 + (i / times.length) * 34,
          message: `Selecting keyframes — ${frames.length} kept`,
        });
        continue;
      }
    }
    const frame: Frame = { time: times[i], canvas, signature, luma, sharpness, yaw, diff };
    frames.push(frame);
    prev = frame;
    onProgress({
      stage: i < times.length * 0.6 ? "keyframes" : "tracking",
      percent: 4 + (i / times.length) * 34,
      message:
        i < times.length * 0.6
          ? `Extracting keyframes — ${frames.length} kept`
          : `Estimating camera rotation — ${Math.round(Math.abs(yaw))}° swept`,
    });
  }

  URL.revokeObjectURL(video.src);
  if (frames.length < 4) throw new Error("Too few usable frames. Record a longer, steadier pan.");

  onProgress({ stage: "segmentation", percent: 44, message: "Detecting room transitions…" });
  const diffs = frames.map((f) => f.diff).filter((d) => d > 0);
  const meanDiff = diffs.reduce((a, b) => a + b, 0) / Math.max(1, diffs.length);
  const cut = meanDiff * 6;
  const segments: Frame[][] = [[]];
  frames.forEach((f, idx) => {
    if (idx > 0 && f.diff > cut && segments[segments.length - 1].length >= 8) segments.push([]);
    segments[segments.length - 1].push(f);
  });
  const usable = segments.filter((s) => s.length >= 4).slice(0, 5);
  const groups = usable.length ? usable : [frames];

  const rooms: RoomResult[] = [];
  for (let i = 0; i < groups.length; i++) {
    onProgress({
      stage: "panorama",
      percent: 50 + (i / groups.length) * 34,
      message: `Compositing 360° panorama ${i + 1} of ${groups.length}…`,
    });
    const { pano, coverage } = buildPanorama(groups[i]);
    const blob = await toBlob(pano);
    rooms.push({
      name: ROOM_NAMES[i] ?? `Space ${i + 1}`,
      blob,
      coverageDegrees: Math.round(coverage),
      frameCount: groups[i].length,
    });
  }

  onProgress({ stage: "optimize", percent: 90, message: "Optimising scene for VR playback…" });
  const sharpness = frames.reduce((a, f) => a + f.sharpness, 0) / frames.length;
  const brightness = frames.reduce((a, f) => a + f.luma, 0) / frames.length;
  const motion = meanDiff * 1000;
  const coverageDegrees = Math.max(...rooms.map((r) => r.coverageDegrees));

  const issues: string[] = [];
  if (sharpness < 1.2) issues.push("Frames look soft — motion blur or focus loss detected.");
  if (brightness < 0.22) issues.push("The room is quite dark; add light for cleaner panoramas.");
  if (brightness > 0.85) issues.push("Highlights are blown out — avoid pointing at bright windows.");
  if (motion > 9) issues.push("Camera moved fast between frames; walk and pan more slowly.");
  if (coverageDegrees < 180) issues.push("Less than half the room was covered — pan a full circle.");
  if (frames.length < 14) issues.push("Few distinct frames captured — record for longer.");

  const score = Math.max(
    12,
    Math.round(
      100 -
        issues.length * 11 -
        Math.max(0, 180 - coverageDegrees) / 6 -
        Math.max(0, 1.2 - sharpness) * 18,
    ),
  );

  onProgress({ stage: "publish", percent: 97, message: "Creating your virtual tour…" });
  return {
    rooms,
    duration,
    report: {
      frames: frames.length,
      duration: Math.round(duration * 10) / 10,
      sharpness: Math.round(sharpness * 100) / 100,
      brightness: Math.round(brightness * 100) / 100,
      motion: Math.round(motion * 100) / 100,
      coverageDegrees,
      issues,
      score: Math.min(100, score),
    },
  };
}

/** Fast pre-flight check on a handful of frames, before the full run. */
export async function prescreen(file: File) {
  const video = await loadVideo(file);
  const duration = Number.isFinite(video.duration) ? video.duration : 0;
  const width = 480;
  const height = Math.round((video.videoHeight / video.videoWidth) * width) || 270;
  const samples = [0.1, 0.3, 0.5, 0.7, 0.9].map((p) => p * duration);
  let luma = 0;
  let sharp = 0;
  for (const t of samples) {
    await seek(video, t);
    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    canvas.getContext("2d")!.drawImage(video, 0, 0, width, height);
    const a = analyze(canvas);
    luma += a.luma;
    sharp += a.sharpness;
  }
  URL.revokeObjectURL(video.src);
  const warnings: string[] = [];
  const brightness = luma / samples.length;
  const sharpness = sharp / samples.length;
  if (duration < 6) warnings.push("Clip is shorter than 6s — pan slowly for at least 15 seconds.");
  if (duration > 180) warnings.push("Very long clip; only the first frames may be needed.");
  if (brightness < 0.22) warnings.push("Scene looks dark — turn on the lights before capturing.");
  if (sharpness < 1.2) warnings.push("Frames look blurry — hold the phone steadier.");
  return { duration, brightness, sharpness, warnings };
}
