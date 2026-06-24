import {
  createRenderQualityState,
  DEFAULT_QUALITY_LEVEL,
  getActiveRenderQuality,
  QUALITY_LEVELS,
  type RenderQualityContext,
  type RenderQualityState,
  updateRenderQuality as updateRenderQualityController,
} from "./renderQuality";
import {
  burstUnit,
  cellCenter,
  clamp,
  easeOutCubic,
  fillRoundedRect,
  getCanvasSize,
  scaleAlpha,
  scaleLightness,
} from "./renderCanvasUtils";
import {
  createBackgroundDust,
  createNebulaPatches,
  createStars,
  drawBackground,
  drawStars,
} from "./renderBackground";
import {
  createStaticSceneSnapshot,
  drawBoard,
  drawCoreGlow,
  drawGrid,
} from "./renderBoard";
import { drawFood, drawStarCores } from "./renderCores";
export { getCoreGlyphMetrics, getStarCoreBurstState } from "./renderCores";
import { drawStarAttractorEffects, drawStarAttractors } from "./renderStarAttractor";
import { drawStarBeastEffects, drawStarBeasts } from "./renderStarBeast";
import { drawBlackHoleCue, drawBlackHoles as drawBlackHolesPass } from "./renderBlackHole";
import { drawFramePasses, type RenderPassDrawers } from "./renderPasses";
import {
  createRenderState,
  getShakeOffset,
  type Particle,
  type RewardBurst,
  type TrailSample,
  updateRenderState,
} from "./renderState";
import { drawOverlayPass } from "./renderOverlay";
import { createStaticLayerController } from "./renderStaticLayers";
import type {
  CanvasSize,
  Direction,
  FrameInfo,
  GameSnapshot,
  GridCell,
  GridMetrics,
  Renderer,
  SpeedMode,
} from "./types";

let activeRenderQuality: RenderQualityState = QUALITY_LEVELS[DEFAULT_QUALITY_LEVEL] ?? QUALITY_LEVELS[0]!;

let reducedMotionQuery: MediaQueryList | null = null;
let isReducedMotionPreferred = false;

const handleReducedMotionPreferenceChange = (event: MediaQueryListEvent): void => {
  isReducedMotionPreferred = event.matches;
};

function ensureReducedMotionPreference(): void {
  if (typeof window === "undefined" || typeof window.matchMedia !== "function" || reducedMotionQuery) {
    return;
  }

  reducedMotionQuery = window.matchMedia("(prefers-reduced-motion: reduce)");
  isReducedMotionPreferred = reducedMotionQuery.matches;
  reducedMotionQuery.addEventListener("change", handleReducedMotionPreferenceChange);
}

function releaseReducedMotionPreference(): void {
  if (!reducedMotionQuery) {
    return;
  }

  reducedMotionQuery.removeEventListener("change", handleReducedMotionPreferenceChange);
  reducedMotionQuery = null;
  isReducedMotionPreferred = false;
}

function prefersReducedMotion(): boolean {
  return isReducedMotionPreferred;
}

interface SpeedTone {
  label: string;
  panel: string;
  border: string;
  text: string;
  glow: string;
  trail: string;
  head: string;
  body: string;
}

const SPEED_TONES: Record<SpeedMode, SpeedTone> = {
  base: {
    label: "基础",
    panel: "rgba(7, 10, 18, 0.66)",
    border: "rgba(143, 251, 255, 0.34)",
    text: "#f7fbff",
    glow: "#00f5ff",
    trail: "#00f5ff",
    head: "#dbff52",
    body: "#00f5ff",
  },
  accelerate: {
    label: "加速",
    panel: "rgba(6, 16, 22, 0.74)",
    border: "rgba(0, 245, 255, 0.58)",
    text: "#eefeff",
    glow: "#00f5ff",
    trail: "#90fbff",
    head: "#ffffff",
    body: "#34f0ff",
  },
  brake: {
    label: "减速",
    panel: "rgba(18, 6, 8, 0.76)",
    border: "rgba(255, 82, 82, 0.58)",
    text: "#ffecec",
    glow: "#ff4a4a",
    trail: "#ff8b8b",
    head: "#fff5f5",
    body: "#ff4f4f",
  },
  boost: {
    label: "冲刺",
    panel: "rgba(6, 12, 16, 0.78)",
    border: "rgba(255, 255, 255, 0.56)",
    text: "#f7fbff",
    glow: "#ffffff",
    trail: "#dbff52",
    head: "#ffffff",
    body: "#7efcff",
  },
};

function getSpeedTone(mode: SpeedMode): SpeedTone {
  return SPEED_TONES[mode];
}

function getSpeedCueStrength(snapshot: GameSnapshot): number {
  if (!snapshot.speedCue || snapshot.speedCue.mode !== snapshot.speedMode) {
    return 0;
  }

  const fade = Math.max(0, Math.min(1, 1 - snapshot.speedCue.fadeProgress));

  return fade * fade;
}

function getSpeedCueIntroStrength(snapshot: GameSnapshot, time: number): number {
  if (!snapshot.speedCue || snapshot.speedCue.mode !== snapshot.speedMode) {
    return 0;
  }

  const introDurationSeconds = 0.15;
  const progress = clamp((time - snapshot.speedCue.startedAt) / introDurationSeconds, 0, 1);

  return easeOutCubic(progress);
}

function getSnakeBrightnessScale(speedMode: SpeedMode): number {
  return speedMode === "base" ? 0.85 : 1;
}

export function drawWallGraceWarning(context: CanvasRenderingContext2D, snapshot: GameSnapshot, time: number): void {
  const grace = snapshot.wallGrace;

  if (snapshot.phase !== "playing" || !grace) {
    return;
  }

  const { grid } = snapshot;
  const width = grid.columns * grid.cellSize;
  const height = grid.rows * grid.cellSize;
  const duration = Math.max(1, grace.expiresAt - grace.startedAt);
  const progress = clamp((time * 1000 - grace.startedAt) / duration, 0, 1);
  const pulse = prefersReducedMotion() ? 1 : 0.68 + Math.sin(time * 24.5) * 0.32;
  const alpha = (1 - progress) * pulse;
  const borderAlpha = Math.min(1, 0.2 + alpha * 0.5);
  const bandSize = Math.max(10, grid.cellSize * 0.82);
  const edgeLine = Math.max(1.5, grid.cellSize * 0.09);
  const left = grid.offsetX;
  const top = grid.offsetY;

  context.save();
  context.globalCompositeOperation = "lighter";
  context.shadowColor = "rgba(255, 82, 82, 0.96)";
  context.shadowBlur = Math.max(12, grid.cellSize * 0.9) * alpha;
  context.strokeStyle = `rgba(255, 82, 82, ${borderAlpha})`;
  context.lineWidth = Math.max(1.6, grid.cellSize * 0.08);
  context.strokeRect(left - 0.5, top - 0.5, width + 1, height + 1);

  context.fillStyle = `rgba(255, 43, 214, ${0.06 + alpha * 0.08})`;
  context.fillRect(left - 8, top - 8, width + 16, height + 16);

  switch (grace.direction) {
    case "up": {
      const gradient = context.createLinearGradient(0, top - bandSize, 0, top + bandSize * 0.3);
      gradient.addColorStop(0, `rgba(255, 43, 214, ${alpha * 0.74})`);
      gradient.addColorStop(0.45, `rgba(255, 82, 82, ${alpha * 0.5})`);
      gradient.addColorStop(1, "rgba(255, 82, 82, 0)");
      context.fillStyle = gradient;
      context.fillRect(left - 2, top - bandSize, width + 4, bandSize);
      context.fillStyle = `rgba(255, 255, 255, ${alpha * 0.22})`;
      context.fillRect(left, top - edgeLine * 0.5, width, edgeLine);
      break;
    }
    case "down": {
      const gradient = context.createLinearGradient(0, top + height + bandSize, 0, top + height - bandSize * 0.3);
      gradient.addColorStop(0, `rgba(255, 43, 214, ${alpha * 0.74})`);
      gradient.addColorStop(0.45, `rgba(255, 82, 82, ${alpha * 0.5})`);
      gradient.addColorStop(1, "rgba(255, 82, 82, 0)");
      context.fillStyle = gradient;
      context.fillRect(left - 2, top + height, width + 4, bandSize);
      context.fillStyle = `rgba(255, 255, 255, ${alpha * 0.22})`;
      context.fillRect(left, top + height - edgeLine * 0.5, width, edgeLine);
      break;
    }
    case "left": {
      const gradient = context.createLinearGradient(left - bandSize, 0, left + bandSize * 0.3, 0);
      gradient.addColorStop(0, `rgba(255, 43, 214, ${alpha * 0.74})`);
      gradient.addColorStop(0.45, `rgba(255, 82, 82, ${alpha * 0.5})`);
      gradient.addColorStop(1, "rgba(255, 82, 82, 0)");
      context.fillStyle = gradient;
      context.fillRect(left - bandSize, top - 2, bandSize, height + 4);
      context.fillStyle = `rgba(255, 255, 255, ${alpha * 0.22})`;
      context.fillRect(left - edgeLine * 0.5, top, edgeLine, height);
      break;
    }
    case "right": {
      const gradient = context.createLinearGradient(left + width + bandSize, 0, left + width - bandSize * 0.3, 0);
      gradient.addColorStop(0, `rgba(255, 43, 214, ${alpha * 0.74})`);
      gradient.addColorStop(0.45, `rgba(255, 82, 82, ${alpha * 0.5})`);
      gradient.addColorStop(1, "rgba(255, 82, 82, 0)");
      context.fillStyle = gradient;
      context.fillRect(left + width, top - 2, bandSize, height + 4);
      context.fillStyle = `rgba(255, 255, 255, ${alpha * 0.22})`;
      context.fillRect(left + width - edgeLine * 0.5, top, edgeLine, height);
      break;
    }
  }

  context.restore();
}

function drawSnakePathGlow(
  context: CanvasRenderingContext2D,
  grid: GridMetrics,
  snake: readonly GridCell[],
  snapshot: GameSnapshot,
  time: number,
  speedMode: SpeedMode,
): void {
  if (snake.length < 2) {
    return;
  }

  const speedTone = getSpeedTone(speedMode);
  const modeIntensity = speedMode === "boost" ? 1.18 : speedMode === "accelerate" ? 1.08 : speedMode === "brake" ? 1.12 : 1;
  const snakeBrightness = getSnakeBrightnessScale(speedMode);
  const cueIntroStrength = getSpeedCueIntroStrength(snapshot, time);
  const cueVisualStrength = getSpeedCueStrength(snapshot) * cueIntroStrength;

  context.save();
  context.globalCompositeOperation = "lighter";
  context.lineCap = "round";
  context.lineJoin = "round";
  const glowScale = activeRenderQuality.glowScale;
  const passCount = activeRenderQuality.level === 0 ? 2 : 1;

  for (let pass = 0; pass < passCount; pass += 1) {
    context.beginPath();

    for (let index = snake.length - 1; index >= 0; index -= 1) {
      const center = cellCenter(grid, snake[index] as GridCell);

      if (index === snake.length - 1) {
        context.moveTo(center.x, center.y);
      } else {
        context.lineTo(center.x, center.y);
      }
    }

    const pulse = 0.65 + Math.sin(time * 4.6) * 0.35;
    const cueBoost = 1 + cueVisualStrength * 0.3;
    context.globalAlpha = (pass === 0 ? 0.32 : 0.82) * cueBoost * snakeBrightness;
    context.shadowColor = pass === 0 ? speedTone.glow : speedTone.trail;
    context.shadowBlur = (pass === 0 ? 18 : 10) * cueBoost * modeIntensity * snakeBrightness * glowScale;
    context.strokeStyle =
      pass === 0
        ? speedMode === "base"
          ? `rgba(0, 245, 255, ${0.34 * snakeBrightness})`
          : speedMode === "brake"
            ? "rgba(255, 74, 74, 0.42)"
            : speedMode === "boost"
              ? "rgba(255, 255, 255, 0.42)"
              : "rgba(0, 245, 255, 0.42)"
        : speedMode === "base"
          ? `rgba(219, 255, 82, ${scaleAlpha(0.22 + pulse * 0.16, snakeBrightness)})`
          : speedMode === "brake"
            ? `rgba(255, 138, 138, ${0.2 + pulse * 0.16})`
            : speedMode === "boost"
              ? `rgba(219, 255, 82, ${0.18 + pulse * 0.18})`
          : `rgba(144, 251, 255, ${0.2 + pulse * 0.16})`;
    context.lineWidth = grid.cellSize * (pass === 0 ? 0.82 : 0.34) * cueBoost * modeIntensity * snakeBrightness;
    context.stroke();
  }

  context.restore();
}

function drawSpeedPulse(context: CanvasRenderingContext2D, snapshot: GameSnapshot, time: number): void {
  const cue = snapshot.speedCue;

  if (snapshot.phase !== "playing" || !cue) {
    return;
  }

  const tone = getSpeedTone(cue.mode);
  const center = cellCenter(snapshot.grid, cue.anchor);
  const cueStrength = getSpeedCueStrength(snapshot);
  const cueIntroStrength = getSpeedCueIntroStrength(snapshot, time);
  const cueVisualStrength = cueStrength * cueIntroStrength;
  const pulse = prefersReducedMotion() ? 1 : 0.92 + Math.sin(time * 10.2 + cue.startedAt * 0.004) * 0.08;
  const radius = snapshot.grid.cellSize * (0.24 + cueVisualStrength * 1.06);

  context.save();
  context.globalCompositeOperation = "lighter";
  context.translate(center.x, center.y);
  context.globalAlpha = cueVisualStrength * pulse;
  context.shadowColor = tone.glow;
  context.shadowBlur = snapshot.grid.cellSize * (0.18 + cueVisualStrength * 1.24) * activeRenderQuality.glowScale;

  const fill = context.createRadialGradient(0, 0, 0, 0, 0, radius * 1.25);
  fill.addColorStop(0, tone.head);
  fill.addColorStop(0.32, tone.glow);
  fill.addColorStop(0.68, tone.body);
  fill.addColorStop(1, "rgba(0, 0, 0, 0)");

  context.fillStyle = fill;
  context.beginPath();
  context.arc(0, 0, radius * 1.12, 0, Math.PI * 2);
  context.fill();

  context.globalAlpha = cueVisualStrength * 0.76;
  context.strokeStyle = tone.border;
  context.lineWidth = Math.max(1, snapshot.grid.cellSize * 0.05);
  context.beginPath();
  context.arc(0, 0, radius * 0.84, 0, Math.PI * 2);
  context.stroke();

  context.restore();
}

function drawHeadCue(
  context: CanvasRenderingContext2D,
  grid: GridMetrics,
  head: GridCell,
  direction: Direction,
): void {
  const center = cellCenter(grid, head);
  const vectors: Record<Direction, { x: number; y: number }> = {
    up: { x: 0, y: -1 },
    right: { x: 1, y: 0 },
    down: { x: 0, y: 1 },
    left: { x: -1, y: 0 },
  };
  const forward = vectors[direction];
  const side = { x: -forward.y, y: forward.x };
  const eyeForward = grid.cellSize * 0.17;
  const eyeSide = grid.cellSize * 0.16;
  const eyeRadius = Math.max(1.7, grid.cellSize * 0.07);
  const highlightX = center.x + forward.x * grid.cellSize * 0.22;
  const highlightY = center.y + forward.y * grid.cellSize * 0.22;

  context.save();
  context.globalCompositeOperation = "lighter";
  context.fillStyle = "rgba(255, 255, 255, 0.72)";
  context.shadowColor = "#ffffff";
  context.shadowBlur = 8;
  context.beginPath();
  context.arc(highlightX, highlightY, grid.cellSize * 0.1, 0, Math.PI * 2);
  context.fill();

  context.globalCompositeOperation = "source-over";
  context.shadowBlur = 0;
  context.fillStyle = "#031015";

  for (const sign of [-1, 1]) {
    context.beginPath();
    context.arc(
      center.x + forward.x * eyeForward + side.x * eyeSide * sign,
      center.y + forward.y * eyeForward + side.y * eyeSide * sign,
      eyeRadius,
      0,
      Math.PI * 2,
    );
    context.fill();
  }

  context.restore();
}

function drawSnakeTrail(
  context: CanvasRenderingContext2D,
  snapshot: GameSnapshot,
  trails: readonly TrailSample[],
  time: number,
): void {
  const { grid, speedMode } = snapshot;
  const cellGap = Math.max(2, grid.cellSize * 0.12);
  const segmentSize = grid.cellSize - cellGap * 2;
  const speedTone = getSpeedTone(speedMode);
  const tintStrength = speedMode === "base" ? 0 : Math.min(1, Math.abs(snapshot.speedMultiplier - 1) / 0.67);
  const cueStrength = getSpeedCueStrength(snapshot);
  const cueIntroStrength = getSpeedCueIntroStrength(snapshot, time);
  const cueVisualStrength = cueStrength * cueIntroStrength;
  const snakeBrightness = getSnakeBrightnessScale(speedMode);

  context.save();
  context.globalCompositeOperation = "lighter";

  for (const sample of trails) {
    const alpha = clamp(sample.life / sample.maxLife, 0, 1);

    for (let index = sample.cells.length - 1; index >= 0; index -= 1) {
      const segment = sample.cells[index];

      if (!segment) {
        continue;
      }

      const age = sample.cells.length <= 1 ? 1 : 1 - index / (sample.cells.length - 1);
      const x = grid.offsetX + segment.column * grid.cellSize + cellGap;
      const y = grid.offsetY + segment.row * grid.cellSize + cellGap;
      const bodyLightness = speedMode === "base" ? scaleLightness(50 + age * 24, snakeBrightness) : 50 + age * 24;

      context.globalAlpha = alpha * (0.06 + age * 0.18) * (1 + tintStrength * 0.08 + cueVisualStrength * 0.14);
      context.shadowColor = index === 0 ? speedTone.head : speedMode === "base" ? "#00f5ff" : speedTone.trail;
      context.shadowBlur = (18 + tintStrength * 8 + cueVisualStrength * 10) * alpha * snakeBrightness * activeRenderQuality.glowScale;
      context.fillStyle = index === 0
        ? speedTone.head
        : speedMode === "base"
          ? `hsl(${184 + age * 76} 100% ${bodyLightness}%)`
          : speedTone.body;
      fillRoundedRect(context, x, y, segmentSize, segmentSize, index === 0 ? 9 : 7);
    }
  }

  context.restore();
}

function drawSnake(context: CanvasRenderingContext2D, snapshot: GameSnapshot, time: number): void {
  const { direction, grid, phase, snake, speedMode } = snapshot;
  const cellGap = Math.max(2, grid.cellSize * 0.12);
  const segmentSize = grid.cellSize - cellGap * 2;
  const isGameOver = phase === "gameOver";
  const speedTone = getSpeedTone(speedMode);
  const tintStrength = speedMode === "base" ? 0 : Math.min(1, Math.abs(snapshot.speedMultiplier - 1) / 0.67);
  const cueStrength = getSpeedCueStrength(snapshot);
  const cueIntroStrength = getSpeedCueIntroStrength(snapshot, time);
  const cueVisualStrength = cueStrength * cueIntroStrength;
  const snakeBrightness = getSnakeBrightnessScale(speedMode);

  drawSnakePathGlow(context, grid, snake, snapshot, time, speedMode);

  context.save();
  context.globalCompositeOperation = "lighter";
  drawSpeedPulse(context, snapshot, time);
  const glowScale = activeRenderQuality.glowScale;

  for (let index = snake.length - 1; index >= 0; index -= 1) {
    const segment = snake[index];

    if (!segment) {
      continue;
    }

    const isHead = index === 0;
    const age = snake.length <= 1 ? 1 : 1 - index / (snake.length - 1);
    const x = grid.offsetX + segment.column * grid.cellSize + cellGap;
    const y = grid.offsetY + segment.row * grid.cellSize + cellGap;
    const pulse = 0.72 + Math.sin(time * 5.2 + index * 0.55) * 0.28;
    context.globalAlpha = isGameOver ? 0.56 : 0.78 + age * 0.22 + tintStrength * 0.06 + cueVisualStrength * 0.08;
    context.shadowColor = isHead ? speedTone.head : speedMode === "base" ? "#00f5ff" : speedTone.trail;
    context.shadowBlur = isHead
      ? (30 + tintStrength * 8 + cueVisualStrength * 10) * snakeBrightness * glowScale
      : (17 + pulse * 8 + tintStrength * 5 + cueVisualStrength * 4) * snakeBrightness * glowScale;

    if (isHead) {
      const headGradient = context.createRadialGradient(
        x + segmentSize * 0.35,
        y + segmentSize * 0.28,
        0,
        x + segmentSize * 0.5,
        y + segmentSize * 0.5,
        segmentSize * 0.72,
      );
      headGradient.addColorStop(0, "#ffffff");
      headGradient.addColorStop(0.32, speedTone.head);
      headGradient.addColorStop(1, speedMode === "base" ? "#00f5ff" : speedTone.body);
      context.fillStyle = headGradient;
      fillRoundedRect(context, x - 1, y - 1, segmentSize + 2, segmentSize + 2, 9);

      if (speedMode !== "base") {
        context.globalAlpha = isGameOver ? 0.22 : 0.42 + tintStrength * 0.18 + cueVisualStrength * 0.1;
        context.strokeStyle = speedTone.glow;
        context.lineWidth = Math.max(1, grid.cellSize * 0.05);
        context.beginPath();
        context.roundRect(x + 0.5, y + 0.5, segmentSize - 1, segmentSize - 1, 9);
        context.stroke();
      }
    } else {
      const baseColor = speedMode === "base"
        ? `hsl(${178 + age * 76} 100% ${scaleLightness(50 + age * 24, snakeBrightness)}%)`
        : speedTone.body;
      const edgeColor = speedMode === "base"
        ? `hsl(${194 + age * 58} 100% ${scaleLightness(64 + age * 12, snakeBrightness)}%)`
        : speedTone.text;
      const bodyFill = context.createLinearGradient(x, y, x + segmentSize, y + segmentSize);

      bodyFill.addColorStop(0, "rgba(255, 255, 255, 0.08)");
      bodyFill.addColorStop(0.4, baseColor);
      bodyFill.addColorStop(1, edgeColor);
      context.fillStyle = bodyFill;
      fillRoundedRect(context, x, y, segmentSize, segmentSize, 7);

      context.globalAlpha = isGameOver ? 0.24 : 0.34 + age * 0.22 + cueVisualStrength * 0.05;
      context.fillStyle = speedMode === "base" ? `rgba(255, 255, 255, ${scaleAlpha(0.72, snakeBrightness)})` : speedTone.text;
      fillRoundedRect(
        context,
        x + segmentSize * 0.22,
        y + segmentSize * 0.18,
        Math.max(2, segmentSize * 0.28),
        Math.max(2, segmentSize * 0.16),
        5,
      );
    }
  }

  const head = snake[0];

  if (head && !isGameOver) {
    drawHeadCue(context, grid, head, direction);
  }

  if (!isGameOver) {
    drawBlackHoleCue(context, snapshot, time);
  }

  context.restore();
}

function drawRewardBursts(context: CanvasRenderingContext2D, rewardBursts: readonly RewardBurst[]): void {
  if (rewardBursts.length === 0) {
    return;
  }

  context.save();
  context.globalCompositeOperation = "lighter";
  context.lineCap = "round";
  context.lineJoin = "round";
  const glowScale = activeRenderQuality.glowScale;

  for (const rewardBurst of rewardBursts) {
    const progress = clamp(1 - rewardBurst.life / rewardBurst.maxLife, 0, 1);
    const flashProgress = clamp(progress / 0.25, 0, 1);
    const ringProgress = clamp((progress - 0.11) / 0.61, 0, 1);
    const bladeProgress = clamp((progress - 0.17) / 0.83, 0, 1);
    const flashAlpha = Math.pow(1 - flashProgress, 2.1);
    const ringAlpha = Math.sin(ringProgress * Math.PI) * (1 - ringProgress * 0.12);
    const bladeAlpha = Math.pow(1 - bladeProgress, 1.24);

    if (flashAlpha > 0) {
      const flashRadius = rewardBurst.cellSize * (1.18 - flashProgress * 0.34);
      const flash = context.createRadialGradient(
        rewardBurst.x,
        rewardBurst.y,
        0,
        rewardBurst.x,
        rewardBurst.y,
        flashRadius,
      );

      flash.addColorStop(0, `rgba(255, 255, 255, ${0.94 * flashAlpha})`);
      flash.addColorStop(0.2, `rgba(219, 255, 82, ${0.72 * flashAlpha})`);
      flash.addColorStop(0.48, `rgba(0, 245, 255, ${0.28 * flashAlpha})`);
      flash.addColorStop(0.72, `rgba(255, 43, 214, ${0.08 * flashAlpha})`);
      flash.addColorStop(1, "rgba(0, 245, 255, 0)");

      context.globalAlpha = 1;
      context.fillStyle = flash;
      context.shadowColor = "#dbff52";
      context.shadowBlur = 34 * flashAlpha * glowScale;
      context.beginPath();
      context.arc(rewardBurst.x, rewardBurst.y, flashRadius * 1.22, 0, Math.PI * 2);
      context.fill();

      const starOuter = rewardBurst.cellSize * (0.96 - flashProgress * 0.18);
      const starInner = starOuter * 0.38;
      const starRotation = rewardBurst.angle + progress * 1.25;

      context.globalAlpha = 0.92 * flashAlpha;
      context.fillStyle = "#ffffff";
      context.shadowColor = "#ffffff";
      context.shadowBlur = 20 * flashAlpha * glowScale;
      context.beginPath();

      for (let point = 0; point < 16; point += 1) {
        const radius = point % 2 === 0 ? starOuter : starInner;
        const angle = starRotation + (point / 16) * Math.PI * 2;
        const x = rewardBurst.x + Math.cos(angle) * radius;
        const y = rewardBurst.y + Math.sin(angle) * radius;

        if (point === 0) {
          context.moveTo(x, y);
        } else {
          context.lineTo(x, y);
        }
      }

      context.closePath();
      context.fill();
    }

    if (ringAlpha > 0) {
      const easedRing = easeOutCubic(ringProgress);
      const mainRadius = rewardBurst.cellSize * (0.85 + easedRing * 4.35);
      const cyanRadius = mainRadius * (0.93 + ringProgress * 0.04);
      const magentaRadius = mainRadius * (1.06 + ringProgress * 0.03);

      context.setLineDash([]);
      context.globalAlpha = 0.68 * ringAlpha;
      context.strokeStyle = "rgba(219, 255, 82, 0.92)";
      context.shadowColor = "#dbff52";
      context.shadowBlur = 24 * ringAlpha * glowScale;
      context.lineWidth = Math.max(1.25, rewardBurst.cellSize * (0.085 - ringProgress * 0.036));
      context.beginPath();
      context.arc(rewardBurst.x, rewardBurst.y, mainRadius, 0, Math.PI * 2);
      context.stroke();

      context.globalAlpha = 0.38 * ringAlpha;
      context.strokeStyle = "rgba(0, 245, 255, 0.88)";
      context.shadowColor = "#00f5ff";
      context.shadowBlur = 20 * ringAlpha * glowScale;
      context.lineWidth = Math.max(1, rewardBurst.cellSize * 0.042);
      context.beginPath();
      context.arc(
        rewardBurst.x,
        rewardBurst.y,
        cyanRadius,
        rewardBurst.secondaryAngle + ringProgress * 0.9,
        rewardBurst.secondaryAngle + Math.PI * 1.62 + ringProgress * 0.9,
      );
      context.stroke();

      context.globalAlpha = 0.3 * ringAlpha;
      context.strokeStyle = "rgba(255, 43, 214, 0.8)";
      context.shadowColor = "#ff2bd6";
      context.shadowBlur = 18 * ringAlpha * glowScale;
      context.beginPath();
      context.arc(
        rewardBurst.x,
        rewardBurst.y,
        magentaRadius,
        rewardBurst.secondaryAngle + Math.PI * 0.78 - ringProgress * 0.55,
        rewardBurst.secondaryAngle + Math.PI * 1.98 - ringProgress * 0.55,
      );
      context.stroke();
    }

    if (progress >= 0.17) {
      for (let index = 0; index < rewardBurst.rayCount; index += 1) {
        const lengthUnit = burstUnit(rewardBurst.seed, index + 1);
        const alphaUnit = burstUnit(rewardBurst.seed, index + 31);
        const angleJitter = (burstUnit(rewardBurst.seed, index + 61) - 0.5) * 0.28;
        const angle =
          rewardBurst.angle +
          (index / rewardBurst.rayCount) * Math.PI * 2 +
          angleJitter +
          bladeProgress * 0.08;
        const inner = rewardBurst.cellSize * (0.78 + bladeProgress * 0.58);
        const outer = rewardBurst.cellSize * (2.05 + bladeProgress * (2.25 + lengthUnit * 1.45));
        const startX = rewardBurst.x + Math.cos(angle) * inner;
        const startY = rewardBurst.y + Math.sin(angle) * inner;
        const endX = rewardBurst.x + Math.cos(angle) * outer;
        const endY = rewardBurst.y + Math.sin(angle) * outer;
        const rayAlpha = bladeAlpha * (0.24 + alphaUnit * 0.48);
        const rayHue = index % 5 === 0 ? "#ff2bd6" : index % 2 === 0 ? "#dbff52" : "#00f5ff";
        const rayGradient = context.createLinearGradient(startX, startY, endX, endY);

        rayGradient.addColorStop(0, "rgba(255, 255, 255, 0)");
        rayGradient.addColorStop(0.28, rayHue);
        rayGradient.addColorStop(1, "rgba(255, 255, 255, 0)");

        context.globalAlpha = rayAlpha;
        context.strokeStyle = rayGradient;
        context.shadowColor = rayHue;
        context.shadowBlur = 18 * rayAlpha * glowScale;
        context.lineWidth = Math.max(1, rewardBurst.cellSize * (0.036 + lengthUnit * 0.036) * (1 - bladeProgress * 0.34));
        context.beginPath();
        context.moveTo(startX, startY);
        context.lineTo(endX, endY);
        context.stroke();
      }
    }

    context.setLineDash([]);
  }

  context.restore();
}

function drawParticles(context: CanvasRenderingContext2D, particles: readonly Particle[]): void {
  context.save();
  context.globalCompositeOperation = "lighter";

  for (const particle of particles) {
    const progress = clamp(particle.life / particle.maxLife, 0, 1);
    const radius = particle.radius * (0.62 + progress * 0.86);

    context.globalAlpha = progress;
    context.fillStyle = `hsl(${particle.hue} 100% ${58 + progress * 24}%)`;
    context.shadowColor = `hsl(${particle.hue} 100% 66%)`;
    context.shadowBlur = 18 * progress * activeRenderQuality.glowScale;
    context.beginPath();
    context.arc(particle.x, particle.y, radius, 0, Math.PI * 2);
    context.fill();

    context.globalAlpha = progress * 0.22;
    context.strokeStyle = `hsl(${particle.hue} 100% 72%)`;
    context.lineWidth = 1;
    context.beginPath();
    context.moveTo(particle.x, particle.y);
    context.lineTo(particle.x - particle.vx * 0.028, particle.y - particle.vy * 0.028);
    context.stroke();
  }

  context.restore();
}

export function createRenderer(canvas: HTMLCanvasElement): Renderer {
  const context = canvas.getContext("2d", { alpha: false });

  if (!context) {
    throw new Error("Canvas 2D context is not available.");
  }

  const stars = createStars();
  const backgroundNebulae = createNebulaPatches();
  const backgroundDust = createBackgroundDust();
  const state = createRenderState();
  const staticLayers = createStaticLayerController({
    drawBackground(layerContext, currentSize): void {
      drawBackground(layerContext, currentSize, 0, backgroundNebulae, backgroundDust, {
        quality: activeRenderQuality,
        reducedMotionPreferred: isReducedMotionPreferred,
      });
    },
    drawBoard(layerContext, currentSize, grid): void {
      drawGrid(layerContext, currentSize, 0);
      drawBoard(layerContext, createStaticSceneSnapshot(grid), 0, activeRenderQuality);
    },
  });

  const passDrawers: RenderPassDrawers = {
    drawAmbientPulse,
    drawStars(context, currentSize, time): void {
      drawStars(context, currentSize, stars, time, {
        quality: activeRenderQuality,
        reducedMotionPreferred: isReducedMotionPreferred,
      });
    },
    drawCoreGlow(context, currentSize, time): void {
      drawCoreGlow(context, currentSize, time, activeRenderQuality);
    },
    drawWallGraceWarning,
    drawBlackHoles(context, snapshot, time): void {
      drawBlackHolesPass(context, snapshot, time, {
        glowScale: activeRenderQuality.glowScale,
        reducedMotionPreferred: isReducedMotionPreferred,
      });
    },
    drawSnakeTrail,
    drawRewardBursts,
    drawFood,
    drawStarCores,
    drawStarAttractors,
    drawStarBeasts,
    drawSnake,
    drawStarBeastEffects,
    drawStarAttractorEffects,
    drawOverlayPass,
    drawParticles,
  };

  activeRenderQuality = QUALITY_LEVELS[DEFAULT_QUALITY_LEVEL] ?? QUALITY_LEVELS[0]!;
  ensureReducedMotionPreference();
  const qualityState = createRenderQualityState();
  let size = getCanvasSize(canvas, activeRenderQuality.dprCap);
  let layoutDirty = true;

  const syncBackingStores = (): void => {
    size = getCanvasSize(canvas, activeRenderQuality.dprCap);

    if (canvas.width !== size.pixelWidth) {
      canvas.width = size.pixelWidth;
    }

    if (canvas.height !== size.pixelHeight) {
      canvas.height = size.pixelHeight;
    }

    context.setTransform(size.dpr, 0, 0, size.dpr, 0, 0);
    staticLayers.syncBackingStores(size);
  };

  const resize = (): CanvasSize => {
    syncBackingStores();
    staticLayers.markDirty();
    layoutDirty = false;
    return size;
  };

  const renderQualityContext: RenderQualityContext = {
    currentLevel(): number {
      return qualityState.qualityLevel;
    },
    applyLevel(nextLevel: number): void {
      const boundedLevel = Math.max(0, Math.min(QUALITY_LEVELS.length - 1, Math.floor(nextLevel)));

      if (boundedLevel === qualityState.qualityLevel) {
        return;
      }

      qualityState.qualityLevel = boundedLevel;
      activeRenderQuality = getActiveRenderQuality(qualityState.qualityLevel);
      layoutDirty = true;
      staticLayers.markDirty();
    },
  };

  resize();

  return {
    resize,

    recordFrameTime(delta: number): void {
      updateRenderQualityController(qualityState, renderQualityContext, delta);
    },

    render(frame: FrameInfo): void {
      if (layoutDirty) {
        resize();
      }

      const time = frame.elapsed / 1000;
      const grid = frame.snapshot.grid;

      staticLayers.ensure(grid, size);
      updateRenderState(state, frame.snapshot, frame.delta, activeRenderQuality, isReducedMotionPreferred);

      context.setTransform(size.dpr, 0, 0, size.dpr, 0, 0);
      context.clearRect(0, 0, size.width, size.height);

      const shakeOffset = getShakeOffset(state.shake, time);

      drawFramePasses({
        context,
        size,
        snapshot: frame.snapshot,
        time,
        backgroundLayer: staticLayers.backgroundLayer,
        boardLayer: staticLayers.boardLayer,
        shakeOffset,
        trails: state.trails,
        rewardBursts: state.rewardBursts,
        particles: state.particles,
        quality: activeRenderQuality,
        reducedMotionPreferred: isReducedMotionPreferred,
        blackHoleAlert: state.blackHoleAlert,
        blackHoleAlertAlpha: state.blackHoleAlertAlpha,
        drawers: passDrawers,
      });
    },

    getSize(): CanvasSize {
      return size;
    },

    destroy(): void {
      context.setTransform(1, 0, 0, 1, 0, 0);
      context.clearRect(0, 0, canvas.width, canvas.height);
      state.particles.length = 0;
      state.rewardBursts.length = 0;
      state.trails.length = 0;
      state.previousFoods.length = 0;
      staticLayers.destroy();
      releaseReducedMotionPreference();
    },
  };
}

function drawAmbientPulse(context: CanvasRenderingContext2D, size: CanvasSize, time: number): void {
  const pulse = 0.5 + Math.sin(time * 1.32) * 0.5;
  const centerX = size.width * (0.5 + Math.sin(time * 0.09) * 0.03);
  const centerY = size.height * (0.42 + Math.cos(time * 0.08) * 0.025);
  const radius = Math.max(size.width, size.height) * (0.82 + pulse * 0.08);

  context.save();
  context.globalCompositeOperation = "lighter";
  context.globalAlpha = (0.06 + pulse * 0.035) * activeRenderQuality.ambientAlpha;

  const wash = context.createRadialGradient(centerX, centerY, 0, size.width * 0.5, size.height * 0.48, radius);
  wash.addColorStop(0, "rgba(0, 245, 255, 0.16)");
  wash.addColorStop(0.4, "rgba(0, 245, 255, 0.03)");
  wash.addColorStop(1, "rgba(255, 43, 214, 0)");
  context.fillStyle = wash;
  context.fillRect(0, 0, size.width, size.height);

  const secondary = context.createRadialGradient(centerX, centerY, radius * 0.08, centerX, centerY, radius * 0.78);
  secondary.addColorStop(0, "rgba(255, 255, 255, 0.05)");
  secondary.addColorStop(0.35, "rgba(0, 245, 255, 0.03)");
  secondary.addColorStop(0.72, "rgba(255, 43, 214, 0.015)");
  secondary.addColorStop(1, "rgba(0, 0, 0, 0)");
  context.globalAlpha = (0.045 + pulse * 0.018) * activeRenderQuality.ambientAlpha;
  context.fillStyle = secondary;
  context.fillRect(0, 0, size.width, size.height);

  context.restore();
}
