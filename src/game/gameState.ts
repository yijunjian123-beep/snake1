import type {
  BlackHole,
  BlackHoleCue,
  Direction,
  GamePhase,
  GameSnapshot,
  ShellView,
  GridCell,
  InputAction,
  InputEventKind,
  MatchMode,
  PlayerId,
  PlayerInputOrigin,
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
  shellView: ShellView | "";
  boardTop: string;
  startPanelHidden: boolean;
  startButtonHidden: boolean;
  startButtonText: string;
  startButtonAriaLabel: string;
  startButtonDisabled: boolean;
  entryActionsHidden: boolean;
  pvpRoomPanelHidden: boolean;
  roomStatusLabel: string;
  createRoomButtonDisabled: boolean;
  joinRoomButtonDisabled: boolean;
  readyRoomButtonDisabled: boolean;
  settlementActionsHidden: boolean;
  continueButtonText: string;
  continueButtonAriaLabel: string;
  continueButtonDisabled: boolean;
  mainMenuButtonText: string;
  mainMenuButtonAriaLabel: string;
  mainMenuButtonDisabled: boolean;
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
  perfLabel: string;
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

export interface MatchRuntimeState {
  mode: MatchMode;
  phase: GamePhase;
  tick: number;
  winnerId: PlayerId | null;
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
  lastSimulationMs: number;
  lastRenderMs: number;
}

export interface SpeedRuntimeState {
  speedCue: SpeedCueState | null;
  lastMovementSpeedMode: SpeedMode;
  currentMovementSpeed: MovementSpeedState;
}

export interface WorldRuntimeState {
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

export interface PlayerRuntimeState {
  id: PlayerId;
  label: string;
  inputOrigin: PlayerInputOrigin;
  snake: GridCell[];
  lifecycle: RunLifecycleState;
  movement: MovementRuntimeState;
  speed: SpeedRuntimeState;
  progress: ProgressRuntimeState;
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
  lastAppliedSequenceByPlayer: Record<PlayerId, number>;
  queue: PlayerInputCommand[];
}

export interface PlayerInputCommand {
  playerId: PlayerId;
  tick: number;
  action: InputAction;
  kind: InputEventKind;
  origin: PlayerInputOrigin;
  sequence: number;
}
