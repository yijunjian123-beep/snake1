import type {
  BlackHole,
  BlackHoleCue,
  Direction,
  GamePhase,
  GameSnapshot,
  GridCell,
  StarAttractor,
  StarAttractorEffect,
  StarBeast,
  StarBeastEffect,
  StarCore,
  SpeedCueMode,
  SpeedMode,
} from "./types";

export interface ActiveDirectionalInput {
  action: Direction;
  source: "keyboard" | "pointer";
  order: number;
}

export interface ActiveSpeedInput {
  mode: SpeedCueMode;
  source: "keyboard" | "pointer";
  order: number;
}

export interface SpeedCueState {
  mode: SpeedCueMode;
  anchor: GridCell;
  startedAt: number;
}

export interface BlackHoleGravityState {
  key: string | null;
  charge: number;
}

export interface WallGraceState {
  direction: Direction;
  startedAt: number;
  expiresAt: number;
}

export interface MovementSpeedState {
  mode: SpeedMode;
  multiplier: number;
  stepMs: number;
}

export interface UiSyncState {
  rootPhase: string;
  boardTop: string;
  startPanelHidden: boolean;
  startButtonText: string;
  startButtonAriaLabel: string;
  startButtonDisabled: boolean;
  pauseButtonDisabled: boolean;
  pauseButtonText: string;
  pauseButtonAriaLabel: string;
  panelPrimaryLabel: string;
  panelPrimaryValue: string;
  panelSecondaryLabel: string;
  panelMetaHidden: boolean;
  panelMetaLabel: string;
  lifeHeartActiveStates: string[];
  lengthLabel: string;
  unlockTitleLabel: string;
  unlockValueLabel: string;
  stateLabel: string;
  fpsLabel: string;
  sizeLabel: string;
  tickerCurrentText: string;
  tickerNextText: string;
  tickerCurrentOpacity: string;
  tickerNextOpacity: string;
}

export interface SnakeAdvanceEvaluation {
  nextHead: GridCell;
  ateFoodIndex: number;
  ateStarCoreIndex: number;
  ateStarAttractorIndex: number;
  growthBeforeMove: number;
  shouldKeepTail: boolean;
  isOutOfBounds: boolean;
  collidesWithSelf: boolean;
  canAdvance: boolean;
}

export interface RunLifecycleState {
  phase: GamePhase;
  deathReason: GameSnapshot["deathReason"];
  livesRemaining: number;
  reviving: boolean;
  reviveEndsAt: number;
  wallGrace: WallGraceState | null;
  birthCell: GridCell;
}

export interface MovementRuntimeState {
  direction: Direction;
  directionQueue: Direction[];
  snakeOccupancy: Uint8Array;
  movementTick: number;
  stepAccumulator: number;
  isBoosting: boolean;
  pendingGrowthSegments: number;
}

export interface TimingRuntimeState {
  elapsed: number;
  playElapsed: number;
  lastFrameTime: number;
  lastUiUpdate: number;
  lastTickerUpdate: number;
  lastFps: number;
}

export interface SpeedRuntimeState {
  speedCue: SpeedCueState | null;
  lastMovementSpeedMode: SpeedMode;
  currentMovementSpeed: MovementSpeedState;
}

export interface EntityRuntimeState {
  snake: GridCell[];
  foods: GridCell[];
  starAttractors: StarAttractor[];
  starAttractorEffects: StarAttractorEffect[];
  starBeasts: StarBeast[];
  starCores: StarCore[];
  starBeastEffects: StarBeastEffect[];
  blackHoles: BlackHole[];
  blackHoleAlert: GameSnapshot["blackHoleAlert"];
  blackHoleGravityState: BlackHoleGravityState;
  blackHoleCue: BlackHoleCue | null;
  blackHoleRecoveryDirection: Direction | null;
  rewardBurstOrigin: GridCell | null;
}

export interface ProgressRuntimeState {
  score: number;
  coresEaten: number;
  highScore: number;
}

export type FoodWaveKind = "single" | "cluster";

export interface SpawnRuntimeState {
  starAttractorEatCount: number;
  starAttractorNeedIndex: number;
  starAttractorNeed: number;
  starAttractorSpawnPending: boolean;
  starBeastNextSpawnCheckAt: number;
  starBeastRespawnLockUntil: number;
  foodWaveBag: FoodWaveKind[];
  foodWaveNextSpawnAt: number;
  nextStarAttractorId: number;
  nextStarAttractorEffectId: number;
  nextStarBeastId: number;
  nextStarCoreId: number;
  nextStarBeastEffectId: number;
}

export interface InputRuntimeState {
  activeInputSequence: number;
}
