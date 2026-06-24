import { STAR_ATTRACTOR_CONFIG } from "./starAttractor";
import type {
  EntityRuntimeState,
  InputRuntimeState,
  MovementRuntimeState,
  ProgressRuntimeState,
  RunLifecycleState,
  SpawnRuntimeState,
  SpeedRuntimeState,
  TimingRuntimeState,
} from "./gameState";

const DEFAULT_LIVES = 3;
const BASE_STEP_MS = 180 / 0.7 / 0.7;
const FOOD_WAVE_INTERVAL_MS = 5000;

export function createLifecycleState(phase: RunLifecycleState["phase"] = "ready"): RunLifecycleState {
  return {
    phase,
    deathReason: null,
    livesRemaining: DEFAULT_LIVES,
    reviving: false,
    reviveEndsAt: 0,
    wallGrace: null,
    birthCell: { column: 0, row: 0 },
  };
}

export function createMovementState(): MovementRuntimeState {
  return {
    direction: "right",
    directionQueue: [],
    snakeOccupancy: new Uint8Array(0),
    movementTick: 0,
    stepAccumulator: 0,
    isBoosting: false,
    pendingGrowthSegments: 0,
  };
}

export function createTimingState(): TimingRuntimeState {
  return {
    elapsed: 0,
    playElapsed: 0,
    lastFrameTime: 0,
    lastUiUpdate: 0,
    lastTickerUpdate: Number.NEGATIVE_INFINITY,
    lastFps: 0,
  };
}

export function resetTimingState(previous: TimingRuntimeState): TimingRuntimeState {
  return {
    ...previous,
    playElapsed: 0,
  };
}

export function createSpeedState(): SpeedRuntimeState {
  return {
    speedCue: null,
    lastMovementSpeedMode: "base",
    currentMovementSpeed: { mode: "base", multiplier: 1, stepMs: BASE_STEP_MS },
  };
}

export function createEntityState(): EntityRuntimeState {
  return {
    snake: [],
    foods: [],
    starAttractors: [],
    starAttractorEffects: [],
    starBeasts: [],
    starCores: [],
    starBeastEffects: [],
    blackHoles: [],
    blackHoleAlert: null,
    blackHoleGravityState: { key: null, charge: 0 },
    blackHoleCue: null,
    blackHoleRecoveryDirection: null,
    rewardBurstOrigin: null,
  };
}

export function createProgressState(highScore = 0): ProgressRuntimeState {
  return {
    score: 0,
    coresEaten: 0,
    highScore,
  };
}

export function createSpawnState(): SpawnRuntimeState {
  return {
    starAttractorEatCount: 0,
    starAttractorNeedIndex: 0,
    starAttractorNeed: STAR_ATTRACTOR_CONFIG.thresholdRanges[0]?.[0] ?? 6,
    starAttractorSpawnPending: false,
    starBeastNextSpawnCheckAt: 0,
    starBeastRespawnLockUntil: 0,
    foodWaveBag: [],
    foodWaveNextSpawnAt: FOOD_WAVE_INTERVAL_MS,
    nextStarAttractorId: 1,
    nextStarAttractorEffectId: 1,
    nextStarBeastId: 1,
    nextStarCoreId: 1,
    nextStarBeastEffectId: 1,
  };
}

export function createInputState(): InputRuntimeState {
  return {
    activeInputSequence: 0,
  };
}
