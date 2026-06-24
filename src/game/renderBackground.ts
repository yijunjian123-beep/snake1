import { clamp, seededUnit } from "./renderCanvasUtils";
import type { RenderQualityState } from "./renderQuality";
import type { CanvasSize } from "./types";

interface Star {
  x: number;
  y: number;
  radius: number;
  alpha: number;
  speed: number;
  hue: number;
  layer: number;
  twinkle: number;
}

interface NebulaPatch {
  x: number;
  y: number;
  radius: number;
  stretchX: number;
  stretchY: number;
  rotation: number;
  hue: number;
  alpha: number;
}

interface BackgroundDust {
  x: number;
  y: number;
  size: number;
  alpha: number;
  hue: number;
  streak: number;
  driftX: number;
  driftY: number;
}

export interface RenderBackgroundOptions {
  quality: RenderQualityState;
  reducedMotionPreferred: boolean;
}

const TAU = Math.PI * 2;
const STAR_COUNT = 132;

export function createStars(): Star[] {
  return Array.from({ length: STAR_COUNT }, (_, index) => {
    const layer = seededUnit(index, 7);

    return {
      x: seededUnit(index, 1),
      y: seededUnit(index, 2),
      radius: 0.45 + seededUnit(index, 3) * (layer > 0.74 ? 2.2 : 1.25),
      alpha: 0.22 + seededUnit(index, 4) * 0.74,
      speed: 0.012 + layer * 0.23,
      hue: 174 + seededUnit(index, 6) * 150,
      layer,
      twinkle: seededUnit(index, 8) * TAU,
    };
  });
}

export function createNebulaPatches(): NebulaPatch[] {
  return [
    { x: 0.18, y: 0.22, radius: 0.24, stretchX: 1.72, stretchY: 0.92, rotation: -0.58, hue: 188, alpha: 0.18 },
    { x: 0.77, y: 0.18, radius: 0.19, stretchX: 1.86, stretchY: 0.8, rotation: 0.72, hue: 316, alpha: 0.15 },
    { x: 0.53, y: 0.72, radius: 0.28, stretchX: 1.56, stretchY: 0.84, rotation: -0.24, hue: 248, alpha: 0.13 },
  ];
}

export function createBackgroundDust(): BackgroundDust[] {
  return Array.from({ length: 42 }, (_, index) => {
    const layer = seededUnit(index, 31);

    return {
      x: seededUnit(index, 11),
      y: seededUnit(index, 12),
      size: 0.32 + seededUnit(index, 13) * (layer > 0.7 ? 1.1 : 0.7),
      alpha: 0.018 + seededUnit(index, 14) * 0.05,
      hue: 176 + seededUnit(index, 15) * 150,
      streak: seededUnit(index, 16),
      driftX: seededUnit(index, 17) - 0.5,
      driftY: seededUnit(index, 18) - 0.5,
    };
  });
}

export function drawBackground(
  context: CanvasRenderingContext2D,
  size: CanvasSize,
  time: number,
  nebulaPatches: readonly NebulaPatch[],
  backgroundDust: readonly BackgroundDust[],
  options: RenderBackgroundOptions,
): void {
  const pulse = 0.5 + Math.sin(time * 1.35) * 0.5;
  const centerX = size.width * (0.48 + Math.sin(time * 0.12) * 0.04);
  const centerY = size.height * (0.42 + Math.cos(time * 0.1) * 0.04);
  const radius = Math.max(size.width, size.height) * 0.92;
  const space = context.createRadialGradient(centerX, centerY, 0, size.width * 0.5, size.height * 0.54, radius);

  space.addColorStop(0, "#17265f");
  space.addColorStop(0.34, "#090d2b");
  space.addColorStop(0.72, "#030613");
  space.addColorStop(1, "#010208");

  context.fillStyle = space;
  context.fillRect(0, 0, size.width, size.height);

  context.save();
  context.globalCompositeOperation = "lighter";
  context.globalAlpha = 1;

  for (const patch of nebulaPatches) {
    drawNebulaPatch(context, size, patch, options.quality);
  }

  context.globalAlpha = 0.2 + pulse * 0.08;
  const cyanWash = context.createLinearGradient(0, 0, size.width, size.height);
  cyanWash.addColorStop(0, "rgba(0, 245, 255, 0.18)");
  cyanWash.addColorStop(0.42, "rgba(0, 245, 255, 0.025)");
  cyanWash.addColorStop(1, "rgba(255, 43, 214, 0.12)");
  context.fillStyle = cyanWash;
  context.fillRect(0, 0, size.width, size.height);

  context.globalAlpha = 1;
  drawBackgroundDust(context, size, backgroundDust, options);

  context.globalAlpha = 0.08;
  context.fillStyle = "#ffffff";
  const scanlineGap = 5;
  const scanOffset = (time * 18) % scanlineGap;

  for (let y = -scanlineGap + scanOffset; y < size.height; y += scanlineGap) {
    context.fillRect(0, y, size.width, 1);
  }

  context.restore();

  const vignette = context.createRadialGradient(
    size.width * 0.5,
    size.height * 0.5,
    Math.min(size.width, size.height) * 0.18,
    size.width * 0.5,
    size.height * 0.5,
    Math.max(size.width, size.height) * 0.78,
  );
  vignette.addColorStop(0, "rgba(0, 0, 0, 0)");
  vignette.addColorStop(1, "rgba(0, 0, 0, 0.72)");
  context.fillStyle = vignette;
  context.fillRect(0, 0, size.width, size.height);
}

export function drawStars(
  context: CanvasRenderingContext2D,
  size: CanvasSize,
  stars: readonly Star[],
  time: number,
  options: RenderBackgroundOptions,
): void {
  context.save();
  context.globalCompositeOperation = "lighter";

  const starStride = Math.max(1, options.quality.starStride);

  for (let index = 0; index < stars.length; index += 1) {
    if (index % starStride !== 0) {
      continue;
    }

    const star = stars[index];

    if (!star) {
      continue;
    }

    const drift = (time * star.speed) % 1;
    const parallax = 0.35 + star.layer * 0.9;
    const x = (star.x * size.width + Math.sin(time * 0.08 + star.twinkle) * 18 * parallax) % size.width;
    const y = ((star.y + drift) % 1) * size.height;
    const shimmer = 0.58 + Math.sin(time * (2.8 + star.layer * 5.4) + star.twinkle) * 0.42;
    const alpha = clamp(star.alpha * shimmer, 0.05, 0.95);

    context.globalAlpha = alpha;
    context.fillStyle = `hsl(${star.hue} 100% ${70 + star.layer * 16}%)`;
    context.shadowColor = `hsl(${star.hue} 100% 68%)`;
    context.shadowBlur = (star.layer > 0.72 ? 6 : 2) * options.quality.glowScale;
    context.beginPath();
    context.arc(x < 0 ? x + size.width : x, y, star.radius, 0, TAU);
    context.fill();
  }

  context.lineCap = "round";

  const streakCount = Math.max(4, Math.round(8 * options.quality.ambientAlpha));

  for (let index = 0; index < streakCount; index += 1) {
    const seedX = seededUnit(index, 18);
    const seedY = seededUnit(index, 19);
    const drift = (time * (0.07 + seededUnit(index, 20) * 0.1)) % 1;
    const x = (seedX + drift) % 1 * size.width;
    const y = (seedY + drift * 0.28) % 1 * size.height;
    const length = 24 + seededUnit(index, 21) * 58;

    context.globalAlpha = 0.08 + seededUnit(index, 22) * 0.12;
    context.strokeStyle = "rgba(143, 251, 255, 0.85)";
    context.shadowColor = "#00f5ff";
    context.shadowBlur = 8 * options.quality.glowScale;
    context.lineWidth = 1.2;
    context.beginPath();
    context.moveTo(x, y);
    context.lineTo(x - length, y - length * 0.28);
    context.stroke();
  }

  const dustCount = Math.max(10, Math.round(12 + options.quality.ambientAlpha * 8));
  const motionScale = options.reducedMotionPreferred ? 0.18 : 1;

  for (let index = 0; index < dustCount; index += 1) {
    const seed = index + 64;
    const baseX = seededUnit(seed, 1);
    const baseY = seededUnit(seed, 2);
    const driftX = Math.sin(time * (0.018 + seededUnit(seed, 3) * 0.02) + seed * 0.41) * 0.012 * motionScale;
    const driftY = Math.cos(time * (0.022 + seededUnit(seed, 4) * 0.018) + seed * 0.29) * 0.01 * motionScale;
    const x = ((baseX + driftX) % 1 + 1) % 1 * size.width;
    const y = ((baseY + driftY) % 1 + 1) % 1 * size.height;
    const radius = 0.3 + seededUnit(seed, 5) * 0.9;
    const alpha = (0.015 + seededUnit(seed, 6) * 0.04) * options.quality.ambientAlpha;
    const hue = 182 + seededUnit(seed, 7) * 120;

    context.globalAlpha = alpha;
    context.shadowColor = `hsl(${hue} 100% 74%)`;
    context.shadowBlur = 5 * options.quality.glowScale;
    context.fillStyle = `hsl(${hue} 100% 76%)`;
    context.beginPath();
    context.arc(x, y, radius, 0, TAU);
    context.fill();
  }

  context.restore();
}

function drawNebulaPatch(
  context: CanvasRenderingContext2D,
  size: CanvasSize,
  patch: NebulaPatch,
  quality: RenderQualityState,
): void {
  const centerX = size.width * patch.x;
  const centerY = size.height * patch.y;
  const radius = Math.max(size.width, size.height) * patch.radius;

  context.save();
  context.translate(centerX, centerY);
  context.rotate(patch.rotation);
  context.scale(patch.stretchX, patch.stretchY);
  context.shadowColor = `hsl(${patch.hue} 100% 68%)`;
  context.shadowBlur = 18 * quality.glowScale;

  const glow = context.createRadialGradient(0, 0, 0, 0, 0, radius);
  glow.addColorStop(0, `hsl(${patch.hue} 100% 74% / ${patch.alpha})`);
  glow.addColorStop(0.18, `hsl(${patch.hue + 16} 100% 66% / ${patch.alpha * 0.72})`);
  glow.addColorStop(0.46, `hsl(${patch.hue + 42} 100% 56% / ${patch.alpha * 0.3})`);
  glow.addColorStop(1, "rgba(0, 0, 0, 0)");
  context.fillStyle = glow;
  context.beginPath();
  context.arc(0, 0, radius, 0, TAU);
  context.fill();

  const core = context.createRadialGradient(0, 0, 0, 0, 0, radius * 0.42);
  core.addColorStop(0, `hsl(${patch.hue + 10} 100% 84% / ${patch.alpha * 0.72})`);
  core.addColorStop(0.34, `hsl(${patch.hue + 26} 100% 70% / ${patch.alpha * 0.34})`);
  core.addColorStop(1, "rgba(0, 0, 0, 0)");
  context.fillStyle = core;
  context.beginPath();
  context.arc(0, 0, radius * 0.42, 0, TAU);
  context.fill();

  context.restore();
}

function drawBackgroundDust(
  context: CanvasRenderingContext2D,
  size: CanvasSize,
  dustField: readonly BackgroundDust[],
  options: RenderBackgroundOptions,
): void {
  const motionScale = options.reducedMotionPreferred ? 0.25 : 1;

  context.save();
  context.globalCompositeOperation = "lighter";
  context.lineCap = "round";

  for (const dust of dustField) {
    const x = dust.x * size.width;
    const y = dust.y * size.height;
    const drift = (dust.driftX + dust.driftY) * 0.5;
    const trailLength = size.width * (0.006 + dust.streak * 0.01);
    const angle = drift * Math.PI * 0.8;

    context.globalAlpha = dust.alpha;
    context.shadowColor = `hsl(${dust.hue} 100% 70%)`;
    context.shadowBlur = 4 * options.quality.glowScale;
    context.fillStyle = `hsl(${dust.hue} 100% 76%)`;
    context.beginPath();
    context.arc(x, y, dust.size, 0, TAU);
    context.fill();

    if (dust.streak > 0.7) {
      context.globalAlpha = dust.alpha * 0.46 * motionScale;
      context.strokeStyle = `hsl(${dust.hue} 100% 74%)`;
      context.lineWidth = Math.max(0.8, dust.size * 0.5);
      context.beginPath();
      context.moveTo(x, y);
      context.lineTo(x - Math.cos(angle) * trailLength, y - Math.sin(angle) * trailLength * 0.74);
      context.stroke();
    }
  }

  context.restore();
}
