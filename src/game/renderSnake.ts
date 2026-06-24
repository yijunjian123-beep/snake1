import { drawBlackHoleCue } from "./renderBlackHole";
import {
  cellCenter,
  clamp,
  easeOutCubic,
  fillRoundedRect,
  scaleAlpha,
  scaleLightness,
} from "./renderCanvasUtils";
import type { RenderQualityState } from "./renderQuality";
import type { TrailSample } from "./renderState";
import type { Direction, GameSnapshot, GridCell, GridMetrics, SpeedMode } from "./types";

interface RenderSnakeOptions {
  quality: RenderQualityState;
  reducedMotionPreferred: boolean;
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

export function drawSnakeTrail(
  context: CanvasRenderingContext2D,
  snapshot: GameSnapshot,
  trails: readonly TrailSample[],
  time: number,
  options: RenderSnakeOptions,
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
      context.shadowBlur = (18 + tintStrength * 8 + cueVisualStrength * 10) * alpha * snakeBrightness * options.quality.glowScale;
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

export function drawSnake(
  context: CanvasRenderingContext2D,
  snapshot: GameSnapshot,
  time: number,
  options: RenderSnakeOptions,
): void {
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

  drawSnakePathGlow(context, grid, snake, snapshot, time, speedMode, options);

  context.save();
  context.globalCompositeOperation = "lighter";
  drawSpeedPulse(context, snapshot, time, options);
  const glowScale = options.quality.glowScale;

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

function drawSnakePathGlow(
  context: CanvasRenderingContext2D,
  grid: GridMetrics,
  snake: readonly GridCell[],
  snapshot: GameSnapshot,
  time: number,
  speedMode: SpeedMode,
  options: RenderSnakeOptions,
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
  const glowScale = options.quality.glowScale;
  const passCount = options.quality.level === 0 ? 2 : 1;

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

function drawSpeedPulse(
  context: CanvasRenderingContext2D,
  snapshot: GameSnapshot,
  time: number,
  options: RenderSnakeOptions,
): void {
  const cue = snapshot.speedCue;

  if (snapshot.phase !== "playing" || !cue) {
    return;
  }

  const tone = getSpeedTone(cue.mode);
  const center = cellCenter(snapshot.grid, cue.anchor);
  const cueStrength = getSpeedCueStrength(snapshot);
  const cueIntroStrength = getSpeedCueIntroStrength(snapshot, time);
  const cueVisualStrength = cueStrength * cueIntroStrength;
  const pulse = options.reducedMotionPreferred ? 1 : 0.92 + Math.sin(time * 10.2 + cue.startedAt * 0.004) * 0.08;
  const radius = snapshot.grid.cellSize * (0.24 + cueVisualStrength * 1.06);

  context.save();
  context.globalCompositeOperation = "lighter";
  context.translate(center.x, center.y);
  context.globalAlpha = cueVisualStrength * pulse;
  context.shadowColor = tone.glow;
  context.shadowBlur = snapshot.grid.cellSize * (0.18 + cueVisualStrength * 1.24) * options.quality.glowScale;

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
