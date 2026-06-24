export interface RenderQualityState {
  level: number;
  dprCap: number;
  glowScale: number;
  starStride: number;
  particleCap: number;
  attractionParticleCap: number;
  rewardBurstCap: number;
  trailCap: number;
  ambientAlpha: number;
}

export const QUALITY_LEVELS: readonly RenderQualityState[] = [
  { level: 0, dprCap: 2.5, glowScale: 0.95, starStride: 1, particleCap: 180, attractionParticleCap: 56, rewardBurstCap: 4, trailCap: 5, ambientAlpha: 0.92 },
  { level: 1, dprCap: 2, glowScale: 0.85, starStride: 1, particleCap: 150, attractionParticleCap: 40, rewardBurstCap: 4, trailCap: 4, ambientAlpha: 0.88 },
  { level: 2, dprCap: 1.65, glowScale: 0.72, starStride: 2, particleCap: 120, attractionParticleCap: 28, rewardBurstCap: 3, trailCap: 3, ambientAlpha: 0.82 },
  { level: 3, dprCap: 1.25, glowScale: 0.6, starStride: 3, particleCap: 88, attractionParticleCap: 20, rewardBurstCap: 2, trailCap: 2, ambientAlpha: 0.76 },
] as const;

export const DEFAULT_QUALITY_LEVEL = 2;

export interface RenderQualityControllerState {
  qualityLevel: number;
  qualityElapsedMs: number;
  smoothedFrameMs: number;
  slowFrameScore: number;
  fastFrameScore: number;
  lastQualityChangeAt: number;
}

export function createRenderQualityState(): RenderQualityControllerState {
  return {
    qualityLevel: DEFAULT_QUALITY_LEVEL,
    qualityElapsedMs: 0,
    smoothedFrameMs: 16.67,
    slowFrameScore: 0,
    fastFrameScore: 0,
    lastQualityChangeAt: Number.NEGATIVE_INFINITY,
  };
}

export interface RenderQualityContext {
  currentLevel(): number;
  applyLevel(nextLevel: number): void;
}

export function getActiveRenderQuality(level: number): RenderQualityState {
  return QUALITY_LEVELS[level] ?? QUALITY_LEVELS[0]!;
}

export function updateRenderQuality(
  state: RenderQualityControllerState,
  context: RenderQualityContext,
  delta: number,
): void {
  if (!Number.isFinite(delta) || delta <= 0) {
    return;
  }

  const sample = Math.min(80, delta);
  state.qualityElapsedMs += delta;
  state.smoothedFrameMs = state.smoothedFrameMs * 0.92 + sample * 0.08;

  const isSlowFrame = state.smoothedFrameMs > 20.5 || sample > 34;
  const isFastFrame = state.smoothedFrameMs < 15.25 && sample < 18;

  state.slowFrameScore = Math.max(0, state.slowFrameScore + (isSlowFrame ? 1.4 : -0.3));
  state.fastFrameScore = Math.max(0, state.fastFrameScore + (isFastFrame ? 1 : -0.18));

  if (state.qualityElapsedMs - state.lastQualityChangeAt < 1500) {
    return;
  }

  if (state.slowFrameScore >= 18 && context.currentLevel() < QUALITY_LEVELS.length - 1) {
    context.applyLevel(context.currentLevel() + 1);
    state.lastQualityChangeAt = state.qualityElapsedMs;
    state.slowFrameScore = 0;
    state.fastFrameScore = 0;
    return;
  }

  if (state.fastFrameScore >= 150 && context.currentLevel() > 0) {
    context.applyLevel(context.currentLevel() - 1);
    state.lastQualityChangeAt = state.qualityElapsedMs;
    state.slowFrameScore = 0;
    state.fastFrameScore = 0;
  }
}
