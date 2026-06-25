import { FOOD_SPAWN_CONFIG } from "./foodSpawn";
import { STAR_ATTRACTOR_CONFIG } from "./starAttractor";
import type {
  InputRuntimeState,
  MatchRuntimeState,
  MovementRuntimeState,
  PlayerRuntimeState,
  ProgressRuntimeState,
  RunLifecycleState,
  SpawnRuntimeState,
  SpeedRuntimeState,
  TimingRuntimeState,
  WorldRuntimeState,
} from "./gameState";
import type { PlayerId, PlayerInputOrigin } from "./types";

const DEFAULT_LIVES = 3;
const BASE_STEP_MS = 180 / 0.7 / 0.7;

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

export function createMatchState(
  mode: MatchRuntimeState["mode"] = "solo",
  phase: RunLifecycleState["phase"] = "ready",
): MatchRuntimeState {
  return {
    mode,
    phase,
    tick: 0,
    winnerId: null,
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
    lastSimulationMs: 0,
    lastRenderMs: 0,
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

export function createWorldState(): WorldRuntimeState {
  return {
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

export function createPlayerState(
  id: PlayerId,
  label: string,
  inputOrigin: PlayerInputOrigin,
  phase: RunLifecycleState["phase"] = "ready",
  highScore = 0,
): PlayerRuntimeState {
  return {
    id,
    label,
    inputOrigin,
    snake: [],
    lifecycle: createLifecycleState(phase),
    movement: createMovementState(),
    speed: createSpeedState(),
    progress: createProgressState(highScore),
  };
}

export function createSoloPlayers(phase: RunLifecycleState["phase"] = "ready", highScore = 0): PlayerRuntimeState[] {
  return [
    createPlayerState("p1", "P1", "local", phase, highScore),
  ];
}

export function createLocalPvpPlayers(phase: RunLifecycleState["phase"] = "ready"): PlayerRuntimeState[] {
  return [
    createPlayerState("p1", "P1", "local", phase, 0),
    createPlayerState("p2", "P2", "scripted", phase, 0),
  ];
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
    foodWaveNextSpawnAt: FOOD_SPAWN_CONFIG.waveIntervalMs,
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
    lastAppliedSequenceByPlayer: {
      p1: 0,
      p2: 0,
    },
    queue: [],
  };
}
