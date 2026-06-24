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
  clamp,
  getCanvasSize,
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
import { drawBlackHoles as drawBlackHolesPass } from "./renderBlackHole";
import { drawSnake as drawSnakePass, drawSnakeTrail as drawSnakeTrailPass } from "./renderSnake";
import { drawParticles as drawParticlesPass, drawRewardBursts as drawRewardBurstsPass } from "./renderFx";
import { drawFramePasses, type RenderPassDrawers } from "./renderPasses";
import {
  createRenderState,
  getShakeOffset,
  updateRenderState,
} from "./renderState";
import { drawOverlayPass } from "./renderOverlay";
import { createStaticLayerController } from "./renderStaticLayers";
import type {
  CanvasSize,
  FrameInfo,
  GameSnapshot,
  Renderer,
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
    drawSnakeTrail(context, snapshot, trails, time): void {
      drawSnakeTrailPass(context, snapshot, trails, time, {
        quality: activeRenderQuality,
        reducedMotionPreferred: isReducedMotionPreferred,
      });
    },
    drawRewardBursts(context, rewardBursts): void {
      drawRewardBurstsPass(context, rewardBursts, {
        quality: activeRenderQuality,
      });
    },
    drawFood,
    drawStarCores,
    drawStarAttractors,
    drawStarBeasts,
    drawSnake(context, snapshot, time): void {
      drawSnakePass(context, snapshot, time, {
        quality: activeRenderQuality,
        reducedMotionPreferred: isReducedMotionPreferred,
      });
    },
    drawStarBeastEffects,
    drawStarAttractorEffects,
    drawOverlayPass,
    drawParticles(context, particles): void {
      drawParticlesPass(context, particles, {
        quality: activeRenderQuality,
      });
    },
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
