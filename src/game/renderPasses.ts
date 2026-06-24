import type { OverlayPassOptions } from "./renderOverlay";
import type { RenderQualityState } from "./renderQuality";
import type { Particle, RewardBurst, TrailSample } from "./renderState";
import type { CanvasSize, GameSnapshot } from "./types";

export interface ShakeOffset {
  x: number;
  y: number;
}

export interface RenderPassDrawers {
  drawAmbientPulse(context: CanvasRenderingContext2D, size: CanvasSize, time: number): void;
  drawStars(context: CanvasRenderingContext2D, size: CanvasSize, time: number): void;
  drawCoreGlow(context: CanvasRenderingContext2D, size: CanvasSize, time: number): void;
  drawWallGraceWarning(context: CanvasRenderingContext2D, snapshot: GameSnapshot, time: number): void;
  drawBlackHoles(context: CanvasRenderingContext2D, snapshot: GameSnapshot, time: number): void;
  drawSnakeTrail(
    context: CanvasRenderingContext2D,
    snapshot: GameSnapshot,
    trails: readonly TrailSample[],
    time: number,
  ): void;
  drawRewardBursts(context: CanvasRenderingContext2D, rewardBursts: readonly RewardBurst[]): void;
  drawFood(context: CanvasRenderingContext2D, snapshot: GameSnapshot, time: number): void;
  drawStarCores(context: CanvasRenderingContext2D, snapshot: GameSnapshot, time: number): void;
  drawStarAttractors(context: CanvasRenderingContext2D, snapshot: GameSnapshot, time: number): void;
  drawStarBeasts(context: CanvasRenderingContext2D, snapshot: GameSnapshot, time: number): void;
  drawSnake(context: CanvasRenderingContext2D, snapshot: GameSnapshot, time: number): void;
  drawStarBeastEffects(context: CanvasRenderingContext2D, snapshot: GameSnapshot, time: number): void;
  drawStarAttractorEffects(context: CanvasRenderingContext2D, snapshot: GameSnapshot, time: number): void;
  drawOverlayPass(
    context: CanvasRenderingContext2D,
    snapshot: GameSnapshot,
    size: CanvasSize,
    time: number,
    options: OverlayPassOptions,
  ): void;
  drawParticles(context: CanvasRenderingContext2D, particles: readonly Particle[]): void;
}

export interface RenderFramePassInput {
  context: CanvasRenderingContext2D;
  size: CanvasSize;
  snapshot: GameSnapshot;
  time: number;
  backgroundLayer: HTMLCanvasElement;
  boardLayer: HTMLCanvasElement;
  shakeOffset: ShakeOffset;
  trails: readonly TrailSample[];
  rewardBursts: readonly RewardBurst[];
  particles: readonly Particle[];
  quality: RenderQualityState;
  reducedMotionPreferred: boolean;
  blackHoleAlert: GameSnapshot["blackHoleAlert"];
  blackHoleAlertAlpha: number;
  drawers: RenderPassDrawers;
}

export function drawFramePasses(input: RenderFramePassInput): void {
  const {
    context,
    size,
    snapshot,
    time,
    backgroundLayer,
    boardLayer,
    shakeOffset,
    trails,
    rewardBursts,
    particles,
    quality,
    reducedMotionPreferred,
    blackHoleAlert,
    blackHoleAlertAlpha,
    drawers,
  } = input;

  drawBackgroundPass(context, size, time, backgroundLayer, boardLayer, drawers);
  drawShakenPass(context, shakeOffset, () => {
    drawers.drawWallGraceWarning(context, snapshot, time);
    drawers.drawBlackHoles(context, snapshot, time);
    drawers.drawSnakeTrail(context, snapshot, trails, time);
  });

  drawers.drawRewardBursts(context, rewardBursts);

  drawShakenPass(context, shakeOffset, () => {
    drawers.drawFood(context, snapshot, time);
    drawers.drawStarCores(context, snapshot, time);
    drawers.drawStarAttractors(context, snapshot, time);
    drawers.drawStarBeasts(context, snapshot, time);
    drawers.drawSnake(context, snapshot, time);
  });

  drawShakenPass(context, shakeOffset, () => {
    drawers.drawStarBeastEffects(context, snapshot, time);
    drawers.drawStarAttractorEffects(context, snapshot, time);
  });

  drawers.drawOverlayPass(context, snapshot, size, time, {
    glowScale: quality.glowScale,
    reducedMotionPreferred,
    shakeOffset,
    blackHoleAlert,
    blackHoleAlertAlpha,
  });

  drawers.drawParticles(context, particles);
}

function drawBackgroundPass(
  context: CanvasRenderingContext2D,
  size: CanvasSize,
  time: number,
  backgroundLayer: HTMLCanvasElement,
  boardLayer: HTMLCanvasElement,
  drawers: Pick<RenderPassDrawers, "drawAmbientPulse" | "drawStars" | "drawCoreGlow">,
): void {
  context.drawImage(backgroundLayer, 0, 0, size.width, size.height);
  drawers.drawAmbientPulse(context, size, time);
  drawers.drawStars(context, size, time);
  drawers.drawCoreGlow(context, size, time);
  context.drawImage(boardLayer, 0, 0, size.width, size.height);
}

function drawShakenPass(context: CanvasRenderingContext2D, shakeOffset: ShakeOffset, draw: () => void): void {
  context.save();
  context.translate(shakeOffset.x, shakeOffset.y);
  draw();
  context.restore();
}
