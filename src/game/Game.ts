import { createAudioController, type AudioController } from "./audio";
import {
  getBlackHoleFoodAvoidRadiusCells,
  getDesiredBlackHoleCount,
  isBlackHoleCollision,
  resolveBlackHoleAlert,
  resolveBlackHoleMovement,
  chooseBlackHoleSpawnKind,
  spawnBlackHole,
  type BlackHoleGravityState,
} from "./blackHole";
import { createInputController } from "./input";
import {
  DEFAULT_SAFE_SPAWN_CONFIG,
  DEFAULT_UNLOCK_CONFIG,
  getNextLengthUnlockCopy,
  getUnlockedFeatures as computeUnlockedFeatures,
  type GameProgress,
  type UnlockedFeatures,
} from "./progression";
import { findReviveSpawnPlacement, findSafeSpawnPosition } from "./spawn";
import type { ReviveSpawnPlacement } from "./spawn";
import {
  STAR_BEAST_CONFIG,
  buildStarBeastDropCores,
  chooseStarBeastDirection,
  getDesiredStarBeastCount,
  spawnStarBeast,
  type StarBeastMoveContext,
} from "./starBeast";
import {
  STAR_ATTRACTOR_CONFIG,
  rollStarAttractorNeed,
  spawnStarAttractor,
} from "./starAttractor";
import { createRenderer } from "./render";
import { readHighScore, writeHighScore } from "./storage";
import type {
  BlackHole,
  BlackHoleCue,
  CanvasSize,
  Direction,
  GamePhase,
  GameSnapshot,
  GameUiElements,
  GridCell,
  GridMetrics,
  InputAction,
  InputCommand,
  InputController,
  InputSource,
  Renderer,
  SpeedCueMode,
  SpeedMode,
  StarAttractor,
  StarAttractorEffect,
  StarBeast,
  StarBeastEffect,
  StarBeastDeathCause,
  StarCore,
  DeathReason,
  Unsubscribe,
} from "./types";

const STAR_ATTRACTOR_ENABLED = DEFAULT_UNLOCK_CONFIG.featureFlags.starAttractor;

interface GameOptions {
  canvas: HTMLCanvasElement;
  ui: GameUiElements;
}

const PHASE_LABELS: Record<GamePhase, string> = {
  ready: "待机",
  playing: "运行中",
  revivePrompt: "待复活",
  reviving: "复活中",
  paused: "已暂停",
  gameOver: "结束",
};

const DIRECTION_DELTAS: Record<Direction, GridCell> = {
  up: { column: 0, row: -1 },
  right: { column: 1, row: 0 },
  down: { column: 0, row: 1 },
  left: { column: -1, row: 0 },
};

const OPPOSITE_DIRECTIONS: Record<Direction, Direction> = {
  up: "down",
  right: "left",
  down: "up",
  left: "right",
};

const BASE_STEP_MS = 180 / 0.7 / 0.7;
const BEAST_BASE_STEP_MS = BASE_STEP_MS;
const BOOST_STEP_RATIO = 0.6;
const ACCELERATE_SPEED_MULTIPLIER = 2.6 / 0.7 / 0.7;
const BRAKE_SPEED_MULTIPLIER = 0.35;
const SPEED_CUE_DURATION_MS = 1500;
const HUD_TICKER_LINES = [
  "长按Shift减速，长按方向键加速",
  "注意，黑洞会把你吸入深渊",
  "杀死星兽，可以吃它的能量！",
] as const;
const HUD_TICKER_INTERVAL_MS = 10000;
const HUD_TICKER_FADE_MS = 720;
const MAX_DIRECTION_QUEUE_LENGTH = 2;
const STARTING_LENGTH = 4;
const SCORE_PER_CORE = 10;
const WALL_GRACE_MS = 110;
const FOOD_NORMAL_CAP = 10;
const FOOD_WAVE_INTERVAL_MS = 5000;
const FOOD_WAVE_BAG_SINGLE_COUNT = 17;
const FOOD_WAVE_BAG_CLUSTER_COUNT = 3;
const FOOD_CLUSTER_MIN_COUNT = 3;
const FOOD_CLUSTER_MAX_COUNT = 5;
const FOOD_CLUSTER_RADIUS = 2;
const DEFAULT_LIVES = 3;
const REVIVE_COUNTDOWN_MS = 3000;
const MIN_COLUMNS = 12;
const MAX_COLUMNS = 34;
const MIN_ROWS = 10;
const MAX_ROWS = 24;
const DEFAULT_TOP_MARGIN = 214;
const COMPACT_LANDSCAPE_TOP_MARGIN = 170;
const SHORT_SCREEN_TOP_MARGIN = 112;
const DEFAULT_HUD_GAP = 12;
const COMPACT_LANDSCAPE_HUD_GAP = 10;

const DEATH_REASON_LABELS: Record<DeathReason, string> = {
  wall: "撞到墙壁了",
  snake_body: "撞到蛇身体了",
  black_hole: "被黑洞吸入了",
  star_beast: "被星兽撞到了",
  unknown: "意外死亡",
};

type FoodWaveKind = "single" | "cluster";

interface WeightedGridCell {
  cell: GridCell;
  weight: number;
}

function clampInteger(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, Math.floor(value)));
}

function isCompactLandscapeSize(size: CanvasSize): boolean {
  return size.width > size.height && size.width <= 980 && size.height <= 520;
}

function getFallbackTopMargin(size: CanvasSize): number {
  if (isCompactLandscapeSize(size)) {
    return COMPACT_LANDSCAPE_TOP_MARGIN;
  }

  if (size.height < 430) {
    return SHORT_SCREEN_TOP_MARGIN;
  }

  return DEFAULT_TOP_MARGIN;
}

function createGrid(size: CanvasSize, topMargin: number): GridMetrics {
  const isCompactLandscape = isCompactLandscapeSize(size);
  const sideMargin = Math.max(14, Math.min(40, Math.floor(size.width * 0.05)));
  const bottomMargin = isCompactLandscape ? 104 : size.height < 430 ? 30 : 58;
  const availableWidth = Math.max(220, size.width - sideMargin * 2);
  const availableHeight = Math.max(size.height < 430 ? 150 : 180, size.height - topMargin - bottomMargin);
  const idealCellSize = size.width < 620 || size.height < 440 ? 18 : 24;
  const columns = clampInteger(availableWidth / idealCellSize, MIN_COLUMNS, MAX_COLUMNS);
  const rows = clampInteger(availableHeight / idealCellSize, MIN_ROWS, MAX_ROWS);
  const cellSize = Math.max(12, Math.floor(Math.min(availableWidth / columns, availableHeight / rows)));
  const boardWidth = columns * cellSize;
  const boardHeight = rows * cellSize;

  return {
    columns,
    rows,
    cellSize,
    offsetX: Math.floor((size.width - boardWidth) / 2),
    offsetY: Math.max(8, Math.floor(topMargin + (availableHeight - boardHeight) / 2)),
  };
}

function directionFromAction(action: InputAction): Direction | null {
  switch (action) {
    case "move-up":
      return "up";
    case "move-right":
      return "right";
    case "move-down":
      return "down";
    case "move-left":
      return "left";
    default:
      return null;
  }
}

function cellsMatch(left: GridCell, right: GridCell): boolean {
  return left.column === right.column && left.row === right.row;
}

function cellKey(cell: GridCell): string {
  return `${cell.column}:${cell.row}`;
}

function chebyshevDistance(left: GridCell, right: GridCell): number {
  return Math.max(Math.abs(left.column - right.column), Math.abs(left.row - right.row));
}

function shuffleArray<T>(items: T[], random: () => number = Math.random): T[] {
  for (let index = items.length - 1; index > 0; index -= 1) {
    const swapIndex = Math.floor(random() * (index + 1));
    const current = items[index];
    const swap = items[swapIndex];

    if (current !== undefined && swap !== undefined) {
      items[index] = swap;
      items[swapIndex] = current;
    }
  }

  return items;
}

function pickWeightedGridCell(cells: readonly WeightedGridCell[], random: () => number = Math.random): GridCell | null {
  let totalWeight = 0;

  for (const candidate of cells) {
    totalWeight += Math.max(0, candidate.weight);
  }

  if (totalWeight <= 0) {
    return null;
  }

  let remaining = random() * totalWeight;

  for (const candidate of cells) {
    remaining -= Math.max(0, candidate.weight);

    if (remaining <= 0) {
      return candidate.cell;
    }
  }

  return cells[cells.length - 1]?.cell ?? null;
}

function rollDuration(min: number, max: number): number {
  return min + Math.random() * (max - min);
}

interface ActiveDirectionalInput {
  action: Direction;
  source: InputSource;
  order: number;
}

interface ActiveSpeedInput {
  mode: SpeedCueMode;
  source: InputSource;
  order: number;
}

interface SpeedCueState {
  mode: SpeedCueMode;
  anchor: GridCell;
  startedAt: number;
}

interface WallGraceState {
  direction: Direction;
  startedAt: number;
  expiresAt: number;
}

interface MovementSpeedState {
  mode: SpeedMode;
  multiplier: number;
  stepMs: number;
}

interface UiSyncState {
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

interface SnakeAdvanceEvaluation {
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

export class Game {
  private readonly canvas: HTMLCanvasElement;
  private readonly ui: GameUiElements;
  private readonly renderer: Renderer;
  private readonly input: InputController;
  private readonly audio: AudioController;
  private readonly unsubscribers: Unsubscribe[] = [];
  private readonly activeDirectionalInputs = new Map<string, ActiveDirectionalInput>();
  private readonly activeSpeedInputs = new Map<string, ActiveSpeedInput>();

  private phase: GamePhase = "ready";
  private grid: GridMetrics;
  private snake: GridCell[] = [];
  private foods: GridCell[] = [];
  private starAttractors: StarAttractor[] = [];
  private starAttractorEffects: StarAttractorEffect[] = [];
  private starBeasts: StarBeast[] = [];
  private starCores: StarCore[] = [];
  private starBeastEffects: StarBeastEffect[] = [];
  private blackHoles: BlackHole[] = [];
  private blackHoleAlert: GameSnapshot["blackHoleAlert"] = null;
  private blackHoleGravityState: BlackHoleGravityState = { key: null, charge: 0 };
  private blackHoleCue: GameSnapshot["blackHoleCue"] = null;
  private blackHoleRecoveryDirection: Direction | null = null;
  private livesRemaining = DEFAULT_LIVES;
  private deathReason: DeathReason | null = null;
  private reviving = false;
  private reviveEndsAt = 0;
  private wallGrace: WallGraceState | null = null;
  private birthCell: GridCell = { column: 0, row: 0 };
  private direction: Direction = "right";
  private directionQueue: Direction[] = [];
  private snakeOccupancy = new Uint8Array(0);
  private score = 0;
  private coresEaten = 0;
  private rewardBurstOrigin: GridCell | null = null;
  private highScore: number;
  private frameId: number | null = null;
  private elapsed = 0;
  private playElapsed = 0;
  private movementTick = 0;
  private stepAccumulator = 0;
  private lastFrameTime = 0;
  private lastUiUpdate = 0;
  private lastTickerUpdate = Number.NEGATIVE_INFINITY;
  private lastFps = 0;
  private isBoosting = false;
  private speedCue: SpeedCueState | null = null;
  private lastMovementSpeedMode: SpeedMode = "base";
  private currentMovementSpeed: MovementSpeedState = { mode: "base", multiplier: 1, stepMs: BASE_STEP_MS };
  private uiSyncState: UiSyncState | null = null;
  private activeInputSequence = 0;
  private pendingGrowthSegments = 0;
  private starAttractorEatCount = 0;
  private starAttractorNeedIndex = 0;
  private starAttractorNeed: number = STAR_ATTRACTOR_CONFIG.thresholdRanges[0]?.[0] ?? 6;
  private starAttractorSpawnPending = false;
  private starBeastNextSpawnCheckAt = 0;
  private starBeastRespawnLockUntil = 0;
  private foodWaveBag: FoodWaveKind[] = [];
  private foodWaveNextSpawnAt = FOOD_WAVE_INTERVAL_MS;
  private nextStarAttractorId = 1;
  private nextStarAttractorEffectId = 1;
  private nextStarBeastId = 1;
  private nextStarCoreId = 1;
  private nextStarBeastEffectId = 1;

  public constructor(options: GameOptions) {
    this.canvas = options.canvas;
    this.ui = options.ui;
    this.renderer = createRenderer(this.canvas);
    this.input = createInputController({ target: window, touchControls: this.ui.touchControls });
    this.audio = createAudioController();
    this.highScore = readHighScore();
    this.grid = this.buildGrid(this.renderer.getSize());
    this.resetRun("ready");
  }

  public start(): void {
    if (this.frameId !== null) {
      return;
    }

    const size = this.renderer.resize();
    this.grid = this.buildGrid(size);
    this.resetRun("ready");
    this.bindUi();
    this.unsubscribers.push(this.input.subscribe(this.handleInput));

    window.addEventListener("resize", this.handleResize);
    window.addEventListener("orientationchange", this.handleResize);

    this.lastFrameTime = performance.now();
    this.updateTickerUi();
    this.syncUi(true);
    this.frameId = window.requestAnimationFrame(this.loop);
  }

  public destroy(): void {
    if (this.frameId !== null) {
      window.cancelAnimationFrame(this.frameId);
      this.frameId = null;
    }

    for (const unsubscribe of this.unsubscribers) {
      unsubscribe();
    }

    this.unsubscribers.length = 0;
    this.unbindUi();
    window.removeEventListener("resize", this.handleResize);
    window.removeEventListener("orientationchange", this.handleResize);
    this.input.destroy();
    this.audio.destroy();
    this.renderer.destroy();
  }

  private readonly loop = (now: number): void => {
    const frameDelta = now - this.lastFrameTime;
    const delta = Math.min(50, frameDelta);
    this.lastFrameTime = now;
    this.elapsed += delta;

    if (this.phase === "playing") {
      this.playElapsed += delta;
      this.stepAccumulator += delta;
      this.updateWallGraceState();

      if (this.phase === "playing") {
        let movementSpeed = this.getMovementSpeedState();
        this.currentMovementSpeed = movementSpeed;
        this.updateSpeedCueState(movementSpeed);

        if (!this.wallGrace) {
          while (this.phase === "playing") {
            const stepMs = movementSpeed.stepMs;

            if (this.stepAccumulator < stepMs) {
              break;
            }

            this.advanceSnake();
            this.stepAccumulator -= stepMs;

            if (this.phase !== "playing" || this.wallGrace) {
              break;
            }

            movementSpeed = this.getMovementSpeedState();
            this.currentMovementSpeed = movementSpeed;
            this.updateSpeedCueState(movementSpeed);
          }
        }

        if (this.phase === "playing") {
          this.updateTransientEntities(delta);
        }
      }
    } else if (this.phase === "reviving") {
      this.currentMovementSpeed = { mode: "base", multiplier: 1, stepMs: BASE_STEP_MS };
      this.updateReviveState();
    } else {
      this.currentMovementSpeed = { mode: "base", multiplier: 1, stepMs: BASE_STEP_MS };
    }

    this.renderer.recordFrameTime(frameDelta);
    this.expireSpeedCue();
    this.updateTickerUi();
    this.renderer.render({
      now,
      delta,
      frameDelta,
      elapsed: this.elapsed,
      phase: this.phase,
      snapshot: this.createSnapshot(),
    });

    this.lastFps = frameDelta > 0 ? Math.round(1000 / frameDelta) : this.lastFps;
    this.syncUi(false);
    this.frameId = window.requestAnimationFrame(this.loop);
  };

  private readonly handleResize = (): void => {
    const size = this.renderer.resize();
    this.grid = this.buildGrid(size);

    if ((this.phase === "playing" || this.phase === "paused" || this.phase === "ready") && !this.isCurrentPlacementValid()) {
      this.resetRun(this.phase === "paused" ? "paused" : this.phase);
    } else {
      this.rebuildSnakeOccupancy();
    }

    this.syncUi(true, size);
  };

  private readonly handleInput = (command: InputCommand): void => {
    if (command.action === "boost") {
      this.setBoosting(command.kind === "pressed");
      return;
    }

    if (command.action === "speed-accelerate") {
      this.updateSpeedInputState(command, "accelerate");
      return;
    }

    if (command.action === "speed-brake") {
      this.updateSpeedInputState(command, "brake");
      return;
    }

    const direction = directionFromAction(command.action);

    if (direction) {
      this.updateDirectionalInputState(command, direction);

      if (command.kind === "pressed") {
        this.queueDirection(direction);
      }

      return;
    }

    if (command.kind !== "pressed") {
      return;
    }

    if (command.action === "start") {
      if (this.phase === "revivePrompt") {
        this.confirmRevive();
      } else {
        this.beginRun();
      }
      return;
    }

    if (command.action === "pause") {
      this.togglePause();
      return;
    }

    if (command.action === "restart") {
      this.restartRun();
    }
  };

  private readonly handleStartPointer = (event: PointerEvent): void => {
    event.preventDefault();

    if (this.phase === "revivePrompt") {
      this.confirmRevive();
      return;
    }

    this.beginRun();
  };

  private readonly handlePausePointer = (event: PointerEvent): void => {
    event.preventDefault();
    this.togglePause();
  };

  private bindUi(): void {
    this.ui.startButton.addEventListener("pointerup", this.handleStartPointer);
    this.ui.pauseButton.addEventListener("pointerup", this.handlePausePointer);
  }

  private unbindUi(): void {
    this.ui.startButton.removeEventListener("pointerup", this.handleStartPointer);
    this.ui.pauseButton.removeEventListener("pointerup", this.handlePausePointer);
  }

  private beginRun(): void {
    if (this.phase !== "ready" && this.phase !== "gameOver") {
      return;
    }

    this.audio.unlock();
    this.audio.playUiPulse();
    this.resetRun("playing");
  }

  private restartRun(): void {
    this.audio.unlock();
    this.audio.playUiPulse();
    this.resetRun("playing");
  }

  private togglePause(): void {
    if (this.phase !== "playing" && this.phase !== "paused") {
      return;
    }

    this.audio.unlock();
    this.phase = this.phase === "paused" ? "playing" : "paused";
    this.isBoosting = false;
    this.stepAccumulator = 0;
    this.syncUi(true);
  }

  private setBoosting(active: boolean): void {
    this.isBoosting = active && this.phase === "playing";
  }

  private updateSpeedInputState(command: InputCommand, mode: SpeedCueMode): void {
    const key = `${command.source}:${command.action}`;

    if (command.kind === "pressed") {
      this.activeInputSequence += 1;
      this.activeSpeedInputs.set(key, {
        mode,
        source: command.source,
        order: this.activeInputSequence,
      });
      return;
    }

    this.activeSpeedInputs.delete(key);
  }

  private updateDirectionalInputState(command: InputCommand, direction: Direction): void {
    const key = `${command.source}:${command.action}`;

    if (command.kind === "pressed") {
      this.activeInputSequence += 1;
      this.activeDirectionalInputs.set(key, {
        action: direction,
        source: command.source,
        order: this.activeInputSequence,
      });
      return;
    }

    this.activeDirectionalInputs.delete(key);
  }

  private getActiveDirectionalInput(): ActiveDirectionalInput | null {
    let activeInput: ActiveDirectionalInput | null = null;

    for (const input of this.activeDirectionalInputs.values()) {
      if (!activeInput || input.order > activeInput.order) {
        activeInput = input;
      }
    }
    return activeInput;
  }

  private getActiveSpeedInput(): ActiveSpeedInput | null {
    let activeInput: ActiveSpeedInput | null = null;

    for (const input of this.activeSpeedInputs.values()) {
      if (!activeInput || input.order > activeInput.order) {
        activeInput = input;
      }
    }

    return activeInput;
  }

  private getMovementSpeedStateFromMode(mode: SpeedMode): MovementSpeedState {
    switch (mode) {
      case "boost":
        return {
          mode,
          multiplier: 1 / BOOST_STEP_RATIO,
          stepMs: BASE_STEP_MS * BOOST_STEP_RATIO,
        };
      case "accelerate":
        return {
          mode,
          multiplier: ACCELERATE_SPEED_MULTIPLIER,
          stepMs: BASE_STEP_MS / ACCELERATE_SPEED_MULTIPLIER,
        };
      case "brake":
        return {
          mode,
          multiplier: BRAKE_SPEED_MULTIPLIER,
          stepMs: BASE_STEP_MS / BRAKE_SPEED_MULTIPLIER,
        };
      default:
        return { mode: "base", multiplier: 1, stepMs: BASE_STEP_MS };
    }
  }

  private getMovementSpeedState(): MovementSpeedState {
    if (this.phase !== "playing") {
      return { mode: "base", multiplier: 1, stepMs: BASE_STEP_MS };
    }

    if (this.isBoosting) {
      return this.getMovementSpeedStateFromMode("boost");
    }

    const activeSpeedInput = this.getActiveSpeedInput();

    if (activeSpeedInput) {
      return this.getMovementSpeedStateFromMode(activeSpeedInput.mode);
    }

    const activeDirectionalInput = this.getActiveDirectionalInput();

    if (activeDirectionalInput) {
      if (activeDirectionalInput.action === this.direction) {
        return this.getMovementSpeedStateFromMode("accelerate");
      }

      if (activeDirectionalInput.action === OPPOSITE_DIRECTIONS[this.direction]) {
        return this.getMovementSpeedStateFromMode("brake");
      }
    }

    return { mode: "base", multiplier: 1, stepMs: BASE_STEP_MS };
  }

  private updateSpeedCueState(movementSpeed: MovementSpeedState): void {
    if (movementSpeed.mode !== this.lastMovementSpeedMode) {
      this.lastMovementSpeedMode = movementSpeed.mode;

      if (movementSpeed.mode !== "base") {
        const head = this.snake[0];

        if (head) {
          this.speedCue = {
            mode: movementSpeed.mode,
            anchor: { ...head },
            startedAt: this.elapsed,
          };
        }
      }
    }
  }

  private expireSpeedCue(): void {
    if (!this.speedCue) {
      return;
    }

    if (this.elapsed - this.speedCue.startedAt >= SPEED_CUE_DURATION_MS) {
      this.speedCue = null;
    }
  }

  private queueDirection(direction: Direction): void {
    if (this.phase !== "playing") {
      return;
    }

    if (this.wallGrace) {
      if (direction === OPPOSITE_DIRECTIONS[this.direction]) {
        return;
      }

      if (!this.canAdvanceDirection(direction)) {
        return;
      }

      this.directionQueue = [direction];
      return;
    }

    const lastQueuedDirection = this.directionQueue[this.directionQueue.length - 1] ?? this.direction;

    if (
      direction === lastQueuedDirection ||
      direction === OPPOSITE_DIRECTIONS[lastQueuedDirection] ||
      this.directionQueue.length >= MAX_DIRECTION_QUEUE_LENGTH
    ) {
      return;
    }

    if (!this.canAdvanceDirection(direction)) {
      return;
    }

    this.directionQueue.push(direction);
  }

  private resetRun(phase: GamePhase): void {
    this.phase = phase;
    this.score = 0;
    this.coresEaten = 0;
    this.direction = "right";
    this.directionQueue = [];
    this.isBoosting = false;
    this.activeDirectionalInputs.clear();
    this.activeSpeedInputs.clear();
    this.activeInputSequence = 0;
    this.speedCue = null;
    this.currentMovementSpeed = { mode: "base", multiplier: 1, stepMs: BASE_STEP_MS };
    this.lastMovementSpeedMode = "base";
    this.stepAccumulator = 0;
    this.playElapsed = 0;
    this.movementTick = 0;
    this.pendingGrowthSegments = 0;
    this.starAttractorEatCount = 0;
    this.starAttractorNeedIndex = 0;
    this.starAttractorNeed = STAR_ATTRACTOR_ENABLED ? rollStarAttractorNeed(this.starAttractorNeedIndex) : 0;
    this.starAttractorSpawnPending = false;
    this.starBeastNextSpawnCheckAt = 0;
    this.starBeastRespawnLockUntil = 0;
    this.foodWaveBag = [];
    this.foodWaveNextSpawnAt = FOOD_WAVE_INTERVAL_MS;
    this.nextStarAttractorId = 1;
    this.nextStarAttractorEffectId = 1;
    this.nextStarBeastId = 1;
    this.nextStarCoreId = 1;
    this.nextStarBeastEffectId = 1;
    this.blackHoleGravityState = { key: null, charge: 0 };
    this.blackHoleAlert = null;
    this.blackHoleCue = null;
    this.blackHoleRecoveryDirection = null;
    this.livesRemaining = DEFAULT_LIVES;
    this.deathReason = null;
    this.reviving = false;
    this.reviveEndsAt = 0;
    this.wallGrace = null;
    this.rewardBurstOrigin = null;
    this.snake = this.createStartingSnake();
    this.birthCell = this.snake[0] ? { ...this.snake[0] } : { column: 0, row: 0 };
    this.starAttractors = [];
    this.starAttractorEffects = [];
    this.starBeasts = [];
    this.starCores = [];
    this.starBeastEffects = [];
    this.blackHoles = [];
    this.foods = this.createFoods();
    this.rebuildSnakeOccupancy();
    this.syncUi(true);
  }

  private handlePlayerDeath(reason: DeathReason): void {
    if (this.phase === "gameOver") {
      return;
    }

    this.deathReason = reason;

    if (this.livesRemaining > 1) {
      this.livesRemaining -= 1;
      this.enterRevivePrompt();
      return;
    }

    this.livesRemaining = 0;
    this.finishGameOver(reason);
  }

  private enterRevivePrompt(): void {
    this.phase = "revivePrompt";
    this.reviving = false;
    this.reviveEndsAt = 0;
    this.resetTransientRunState();
    this.syncUi(true);
  }

  private confirmRevive(): void {
    if (this.phase !== "revivePrompt" || this.livesRemaining <= 0) {
      return;
    }

    this.audio.unlock();
    this.audio.playUiPulse();

    const placement = findReviveSpawnPlacement(this.grid, {
      length: this.snake.length,
      occupiedCells: this.getReviveBlockedCells(),
      dangerZones: this.blackHoles.map((blackHole) => ({
        center: blackHole.cell,
        radius: getBlackHoleFoodAvoidRadiusCells(blackHole),
      })),
      wallPadding: 1,
      random: Math.random,
    });

    if (!placement) {
      this.livesRemaining = 0;
      this.finishGameOver(this.deathReason ?? "unknown");
      return;
    }

    this.applyRevivePlacement(placement);
    this.phase = "reviving";
    this.reviving = true;
    this.reviveEndsAt = this.elapsed + REVIVE_COUNTDOWN_MS;
    this.syncUi(true);
  }

  private applyRevivePlacement(placement: ReviveSpawnPlacement): void {
    this.snake = placement.cells;
    this.birthCell = this.snake[0] ? { ...this.snake[0] } : this.birthCell;
    this.direction = placement.direction;
    this.rebuildSnakeOccupancy();
    this.resetTransientRunState();
  }

  private resetTransientRunState(): void {
    this.isBoosting = false;
    this.stepAccumulator = 0;
    this.blackHoleRecoveryDirection = null;
    this.blackHoleGravityState = { key: null, charge: 0 };
    this.blackHoleAlert = null;
    this.blackHoleCue = null;
    this.wallGrace = null;
    this.speedCue = null;
    this.lastMovementSpeedMode = "base";
    this.directionQueue = [];
    this.activeDirectionalInputs.clear();
    this.activeSpeedInputs.clear();
  }

  private updateReviveState(): void {
    if (!this.reviving || this.phase !== "reviving") {
      return;
    }

    if (this.elapsed < this.reviveEndsAt) {
      return;
    }

    this.completeRevive();
  }

  private completeRevive(): void {
    if (!this.reviving || this.phase !== "reviving") {
      return;
    }

    this.reviving = false;
    this.reviveEndsAt = 0;
    this.phase = "playing";
    this.syncUi(true);
  }

  private finishGameOver(reason: DeathReason | null = null): void {
    this.phase = "gameOver";
    this.reviving = false;
    this.reviveEndsAt = 0;
    this.resetTransientRunState();
    this.deathReason = reason;
    this.saveHighScoreIfNeeded();
    this.syncUi(true);
  }

  private getReviveBlockedCells(): GridCell[] {
    return [
      ...this.snake,
      ...this.foods,
      ...(STAR_ATTRACTOR_ENABLED ? this.starAttractors.map((attractor) => attractor.cell) : []),
      ...this.starBeasts.flatMap((beast) => beast.body),
      ...this.starCores.map((core) => ({ column: Math.floor(core.x), row: Math.floor(core.y) })),
      ...this.blackHoles.map((blackHole) => blackHole.cell),
    ];
  }

  private getDeathReasonText(reason: DeathReason | null = this.deathReason): string {
    if (reason) {
      return DEATH_REASON_LABELS[reason];
    }

    return "本局已结束";
  }

  private getReviveCountdownSeconds(): number {
    if (!this.reviving) {
      return 0;
    }

    return Math.max(1, Math.ceil((this.reviveEndsAt - this.elapsed) / 1000));
  }

  private createStartingSnake(): GridCell[] {
    const headColumn = Math.floor(this.grid.columns / 2);
    const headRow = Math.floor(this.grid.rows / 2);

    return Array.from({ length: STARTING_LENGTH }, (_, index) => ({
      column: headColumn - index,
      row: headRow,
    }));
  }

  private createFoods(): GridCell[] {
    const foods: GridCell[] = [];

    while (foods.length < 3) {
      const candidate = this.spawnFood(foods);

      if (!candidate) {
        break;
      }

      foods.push(candidate);
    }

    return foods;
  }

  private spawnFood(extraBlocked: readonly GridCell[] = []): GridCell | null {
    return findSafeSpawnPosition(this.grid, {
      ...DEFAULT_SAFE_SPAWN_CONFIG,
      wallPadding: 0,
      snakeHeadRadius: 0,
      occupiedCells: [
        ...this.snake,
        ...this.foods,
        ...(STAR_ATTRACTOR_ENABLED ? this.starAttractors.map((attractor) => attractor.cell) : []),
        ...this.starBeasts.flatMap((beast) => beast.body),
        ...this.starCores.map((core) => ({ column: Math.floor(core.x), row: Math.floor(core.y) })),
        ...this.blackHoles.map((blackHole) => blackHole.cell),
        ...extraBlocked,
      ],
      dangerZones: this.blackHoles.map((blackHole) => ({
        center: blackHole.cell,
        radius: getBlackHoleFoodAvoidRadiusCells(blackHole),
      })),
    });
  }

  private refillFoods(): void {
    while (this.foods.length < 3) {
      const candidate = this.spawnFood();

      if (!candidate) {
        break;
      }

      this.foods.push(candidate);
    }
  }

  // Keep the immediate 3-food safety floor, then let the timed wave top the board up toward 10.
  private updateFoodWaves(currentTimeMs: number): void {
    while (currentTimeMs >= this.foodWaveNextSpawnAt) {
      if (this.foods.length < FOOD_NORMAL_CAP) {
        const spawnedFoods = this.spawnFoodWave();

        if (spawnedFoods.length > 0) {
          this.foods.push(...spawnedFoods);
        }
      }

      this.foodWaveNextSpawnAt += FOOD_WAVE_INTERVAL_MS;
    }
  }

  private spawnFoodWave(): GridCell[] {
    if (this.foods.length >= FOOD_NORMAL_CAP) {
      return [];
    }

    const waveKind = this.peekFoodWaveKind();

    if (waveKind === "single") {
      const singleFood = this.spawnFood();

      if (!singleFood) {
        return [];
      }

      this.consumeFoodWaveKind();
      return [singleFood];
    }

    const availableSlots = FOOD_NORMAL_CAP - this.foods.length;
    const targetCount = Math.min(
      availableSlots,
      FOOD_CLUSTER_MIN_COUNT + Math.floor(Math.random() * (FOOD_CLUSTER_MAX_COUNT - FOOD_CLUSTER_MIN_COUNT + 1)),
    );
    const clusterFoods = this.spawnClusterFoods(targetCount);

    if (clusterFoods.length > 0) {
      this.consumeFoodWaveKind();
      return clusterFoods;
    }

    const fallbackFood = this.spawnFood();
    if (!fallbackFood) {
      return [];
    }

    this.consumeFoodWaveKind();
    return [fallbackFood];
  }

  private peekFoodWaveKind(): FoodWaveKind {
    if (this.foodWaveBag.length === 0) {
      this.refillFoodWaveBag();
    }

    return this.foodWaveBag[this.foodWaveBag.length - 1] ?? "single";
  }

  private consumeFoodWaveKind(): void {
    if (this.foodWaveBag.length === 0) {
      this.refillFoodWaveBag();
    }

    this.foodWaveBag.pop();
  }

  private refillFoodWaveBag(): void {
    // 17 single spawns, 3 cluster spawns, then reshuffle.
    const bag: FoodWaveKind[] = [
      ...Array.from({ length: FOOD_WAVE_BAG_SINGLE_COUNT }, () => "single" as const),
      ...Array.from({ length: FOOD_WAVE_BAG_CLUSTER_COUNT }, () => "cluster" as const),
    ];

    this.foodWaveBag = shuffleArray(bag);
  }

  private spawnClusterFoods(maxCount: number): GridCell[] {
    if (maxCount <= 0) {
      return [];
    }

    const candidates = this.getFoodSpawnCandidates();

    if (candidates.length === 0) {
      return [];
    }

    const candidateKeys = new Set(candidates.map((cell) => cellKey(cell)));
    const weightedAnchors = candidates
      .map((cell) => ({
        cell,
        weight: this.getFoodClusterAnchorWeight(cell, candidateKeys),
      }))
      .filter((candidate) => candidate.weight > 0);
    const anchor = pickWeightedGridCell(weightedAnchors);

    if (!anchor) {
      return [];
    }

    const clusterCandidates = this.getClusterFoodsAroundAnchor(anchor, candidateKeys);
    return clusterCandidates.slice(0, maxCount);
  }

  private getFoodSpawnCandidates(extraBlocked: readonly GridCell[] = []): GridCell[] {
    const occupied = new Set<string>();

    for (const cell of this.snake) {
      occupied.add(cellKey(cell));
    }

    for (const cell of this.foods) {
      occupied.add(cellKey(cell));
    }

    if (STAR_ATTRACTOR_ENABLED) {
      for (const attractor of this.starAttractors) {
        occupied.add(cellKey(attractor.cell));
      }
    }

    for (const beast of this.starBeasts) {
      for (const segment of beast.body) {
        occupied.add(cellKey(segment));
      }
    }

    for (const core of this.starCores) {
      occupied.add(cellKey({ column: Math.floor(core.x), row: Math.floor(core.y) }));
    }

    for (const blackHole of this.blackHoles) {
      occupied.add(cellKey(blackHole.cell));
    }

    for (const cell of extraBlocked) {
      occupied.add(cellKey(cell));
    }

    const candidates: GridCell[] = [];

    for (let row = 0; row < this.grid.rows; row += 1) {
      for (let column = 0; column < this.grid.columns; column += 1) {
        const cell = { column, row };

        if (occupied.has(cellKey(cell))) {
          continue;
        }

        if (this.isBlockedByBlackHoleFoodZone(cell)) {
          continue;
        }

        candidates.push(cell);
      }
    }

    return candidates;
  }

  private isBlockedByBlackHoleFoodZone(cell: GridCell): boolean {
    return this.blackHoles.some((blackHole) => chebyshevDistance(cell, blackHole.cell) <= getBlackHoleFoodAvoidRadiusCells(blackHole));
  }

  private getFoodClusterAnchorWeight(cell: GridCell, candidateKeys: Set<string>): number {
    const capacity = this.getFoodClusterCapacity(cell, candidateKeys);
    let proximityBonus = 1;

    for (const blackHole of this.blackHoles) {
      const forbiddenRadius = getBlackHoleFoodAvoidRadiusCells(blackHole);
      const distance = chebyshevDistance(cell, blackHole.cell);

      if (distance <= forbiddenRadius) {
        continue;
      }

      const gap = distance - forbiddenRadius;

      if (gap <= 1) {
        proximityBonus = Math.max(proximityBonus, 9);
      } else if (gap === 2) {
        proximityBonus = Math.max(proximityBonus, 6);
      } else if (gap === 3) {
        proximityBonus = Math.max(proximityBonus, 4);
      } else if (gap === 4) {
        proximityBonus = Math.max(proximityBonus, 2);
      }
    }

    return Math.max(1, capacity) * proximityBonus;
  }

  private getFoodClusterCapacity(center: GridCell, candidateKeys: Set<string>): number {
    let capacity = 0;

    for (let row = center.row - FOOD_CLUSTER_RADIUS; row <= center.row + FOOD_CLUSTER_RADIUS; row += 1) {
      for (let column = center.column - FOOD_CLUSTER_RADIUS; column <= center.column + FOOD_CLUSTER_RADIUS; column += 1) {
        if (column < 0 || row < 0 || column >= this.grid.columns || row >= this.grid.rows) {
          continue;
        }

        const cell = { column, row };

        if (!candidateKeys.has(cellKey(cell))) {
          continue;
        }

        capacity += 1;
      }
    }

    return capacity;
  }

  private getClusterFoodsAroundAnchor(anchor: GridCell, candidateKeys: Set<string>): GridCell[] {
    const scored: Array<{ cell: GridCell; distance: number; manhattan: number }> = [];

    for (let row = anchor.row - FOOD_CLUSTER_RADIUS; row <= anchor.row + FOOD_CLUSTER_RADIUS; row += 1) {
      for (let column = anchor.column - FOOD_CLUSTER_RADIUS; column <= anchor.column + FOOD_CLUSTER_RADIUS; column += 1) {
        if (column < 0 || row < 0 || column >= this.grid.columns || row >= this.grid.rows) {
          continue;
        }

        const cell = { column, row };

        if (!candidateKeys.has(cellKey(cell))) {
          continue;
        }

        const dx = Math.abs(column - anchor.column);
        const dy = Math.abs(row - anchor.row);

        scored.push({
          cell,
          distance: Math.max(dx, dy),
          manhattan: dx + dy,
        });
      }
    }

    scored.sort((left, right) => (
      left.distance - right.distance ||
      left.manhattan - right.manhattan ||
      left.cell.row - right.cell.row ||
      left.cell.column - right.cell.column
    ));

    return scored.map((entry) => entry.cell);
  }

  private advanceSnake(): void {
    if (!this.snake[0]) {
      this.finishGameOver("unknown");
      return;
    }

    const recoveryDirection = this.blackHoleRecoveryDirection;

    if (recoveryDirection !== null) {
      this.movementTick += 1;
      const selection = this.pickAdvanceDirection(recoveryDirection, [this.direction]);
      this.blackHoleRecoveryDirection = null;
      this.blackHoleGravityState = { key: null, charge: 0 };
      this.blackHoleCue = selection.primaryBlocked ? this.createBlockedBlackHoleCue(this.blackHoleCue) : null;
      this.direction = selection.direction;
      this.commitSnakeStep();
      return;
    }

    const intendedDirection = this.directionQueue[0] ?? this.direction;

    if (this.directionQueue.length > 0) {
      this.directionQueue.shift();
    }

    this.advanceSnakeFromDirection(intendedDirection);
  }

  private advanceSnakeFromDirection(intendedDirection: Direction): void {
    const head = this.snake[0];

    if (!head) {
      this.finishGameOver("unknown");
      return;
    }

    this.movementTick += 1;
    const movementDirection = this.pickAdvanceDirection(intendedDirection, [this.direction]).direction;
    const currentTime = this.elapsed / 1000;
    const resolution = resolveBlackHoleMovement(
      head,
      movementDirection,
      this.direction,
      this.blackHoles,
      currentTime,
      this.blackHoleGravityState,
    );

    const pullBlocked = resolution.shouldPlayPull && !this.canAdvanceDirection(resolution.finalDirection);

    if (resolution.shouldDie) {
      this.direction = resolution.finalDirection;
      this.handlePlayerDeath("black_hole");
      return;
    }

    this.blackHoleGravityState = pullBlocked ? { key: null, charge: 0 } : resolution.nextGravityState;
    this.blackHoleCue = pullBlocked ? this.createBlockedBlackHoleCue(resolution.cue) : resolution.cue;
    this.direction = pullBlocked ? movementDirection : resolution.finalDirection;

    if (resolution.shouldPlayPull && !pullBlocked) {
      this.blackHoleRecoveryDirection = movementDirection;
    } else {
      this.blackHoleRecoveryDirection = null;
    }

    this.commitSnakeStep();
  }

  private commitSnakeStep(): void {
    if (!this.snake[0]) {
      this.finishGameOver("unknown");
      return;
    }

    const currentTime = this.elapsed / 1000;
    const evaluation = this.evaluateSnakeAdvance(this.direction);

    if (!evaluation) {
      this.finishGameOver("unknown");
      return;
    }

    const {
      nextHead,
      ateFoodIndex,
      ateStarCoreIndex,
      ateStarAttractorIndex,
      growthBeforeMove,
      shouldKeepTail,
    } = evaluation;

    if (evaluation.isOutOfBounds) {
      this.startWallGrace(this.direction);
      return;
    }

    if (evaluation.collidesWithSelf) {
      this.handlePlayerDeath("snake_body");
      return;
    }

    if (this.collidesWithBlackHole(nextHead)) {
      this.handlePlayerDeath("black_hole");
      return;
    }

    if (this.collidesWithStarBeast(nextHead)) {
      this.handlePlayerDeath("star_beast");
      return;
    }

    const previousTail = this.snake[this.snake.length - 1] ?? null;
    this.snake = [nextHead, ...this.snake];
    this.adjustSnakeOccupancy(nextHead, 1);

    if (!shouldKeepTail && previousTail) {
      this.snake.pop();
      this.adjustSnakeOccupancy(previousTail, -1);
    }

    if (ateFoodIndex !== -1) {
      this.foods.splice(ateFoodIndex, 1);
      this.handleCoreCollection(currentTime, 1, true, nextHead);
    } else if (ateStarCoreIndex !== -1) {
      this.starCores.splice(ateStarCoreIndex, 1);
      this.handleCoreCollection(currentTime, 1, false, nextHead);
    } else if (ateStarAttractorIndex !== -1) {
      this.starAttractors.splice(ateStarAttractorIndex, 1);
      this.absorbStarAttractor(nextHead, currentTime);
    }

    if (growthBeforeMove > 0) {
      this.pendingGrowthSegments = Math.max(0, this.pendingGrowthSegments - 1);
    }

    if (STAR_ATTRACTOR_ENABLED) {
      this.retryPendingStarAttractorSpawn(currentTime);
    }
    this.updateBlackHoleAlert(currentTime);
  }

  private handleCoreCollection(
    currentTime: number,
    amount: number,
    advancesStarAttractorProgress: boolean,
    rewardBurstOrigin: GridCell | null,
  ): void {
    if (amount <= 0) {
      return;
    }

    this.rewardBurstOrigin = rewardBurstOrigin ? { ...rewardBurstOrigin } : null;
    this.coresEaten += amount;
    this.score += SCORE_PER_CORE * amount;
    this.saveHighScoreIfNeeded();
    this.refreshBlackHoles();
    if (advancesStarAttractorProgress && STAR_ATTRACTOR_ENABLED) {
      this.advanceStarAttractorProgress(amount, currentTime);
    }
    this.refillFoods();
    this.updateBlackHoleAlert(currentTime);
    this.syncUi(true);
  }

  private advanceStarAttractorProgress(amount: number, currentTime: number): void {
    if (!STAR_ATTRACTOR_ENABLED) {
      return;
    }

    if (amount <= 0) {
      return;
    }

    if (this.getProgress().snakeLength < STAR_ATTRACTOR_CONFIG.unlockLength) {
      return;
    }

    if (this.starAttractors.length > 0 || this.starAttractorSpawnPending) {
      return;
    }

    this.starAttractorEatCount = Math.min(this.starAttractorNeed, this.starAttractorEatCount + amount);

    if (this.starAttractorEatCount < this.starAttractorNeed) {
      return;
    }

    if (this.trySpawnStarAttractor(currentTime)) {
      this.starAttractorEatCount = 0;
      this.starAttractorSpawnPending = false;
      this.starAttractorNeedIndex = (this.starAttractorNeedIndex + 1) % STAR_ATTRACTOR_CONFIG.thresholdRanges.length;
      this.starAttractorNeed = rollStarAttractorNeed(this.starAttractorNeedIndex);
      return;
    }

    this.starAttractorSpawnPending = true;
  }

  private retryPendingStarAttractorSpawn(currentTime: number): void {
    if (!STAR_ATTRACTOR_ENABLED) {
      return;
    }

    if (!this.starAttractorSpawnPending) {
      return;
    }

    if (this.starAttractors.length > 0 || this.getProgress().snakeLength < STAR_ATTRACTOR_CONFIG.unlockLength) {
      return;
    }

    if (this.trySpawnStarAttractor(currentTime)) {
      this.starAttractorEatCount = 0;
      this.starAttractorSpawnPending = false;
      this.starAttractorNeedIndex = (this.starAttractorNeedIndex + 1) % STAR_ATTRACTOR_CONFIG.thresholdRanges.length;
      this.starAttractorNeed = rollStarAttractorNeed(this.starAttractorNeedIndex);
    }
  }

  private trySpawnStarAttractor(currentTime: number): boolean {
    if (!STAR_ATTRACTOR_ENABLED) {
      return false;
    }

    if (this.starAttractors.length >= STAR_ATTRACTOR_CONFIG.maxOnBoard) {
      return false;
    }

    const progress = this.getProgress();
    const nextStarAttractor = spawnStarAttractor({
      grid: this.grid,
      progress,
      snake: this.snake,
      direction: this.direction,
      foods: this.foods,
      starCoreCells: this.getStarCoreCells(),
      existingBlackHoles: this.blackHoles,
      existingStarAttractors: this.starAttractors,
      existingStarBeasts: this.starBeasts,
      currentTime,
    });

    if (!nextStarAttractor) {
      return false;
    }

    nextStarAttractor.id = this.nextStarAttractorId++;
    this.starAttractors.push(nextStarAttractor);
    return true;
  }

  private absorbStarAttractor(attractorCell: GridCell, currentTime: number): void {
    if (!STAR_ATTRACTOR_ENABLED) {
      return;
    }

    const absorbedCells = this.foods.map((food) => ({ ...food }));
    const absorbCount = absorbedCells.length;

    this.foods = [];

    if (absorbCount > 0) {
      this.pendingGrowthSegments += absorbCount;
      this.handleCoreCollection(currentTime, absorbCount, false, attractorCell);
    } else {
      this.saveHighScoreIfNeeded();
      this.refreshBlackHoles();
      this.refillFoods();
      this.updateBlackHoleAlert(currentTime);
      this.syncUi(true);
    }

    this.audio.playRewardPulse(absorbCount);
    this.starAttractorEffects.push({
      id: this.nextStarAttractorEffectId++,
      origin: { ...attractorCell },
      target: this.snake[0] ? { ...this.snake[0] } : { ...this.birthCell },
      absorbedCells,
      absorbCount,
      createdAt: currentTime,
      lifetimeMs: absorbCount >= 12 ? 860 : absorbCount >= 8 ? 740 : 620,
      seed: this.nextStarAttractorEffectId * 113 + absorbCount * 17,
    });
  }

  private refreshBlackHoles(): void {
    const desiredCount = getDesiredBlackHoleCount(this.getProgress());
    const starBeastBodies = this.starBeasts.flatMap((beast) => beast.body);
    const starAttractorCells = STAR_ATTRACTOR_ENABLED ? this.starAttractors.map((attractor) => attractor.cell) : [];
    const starCoreCells = this.starCores.map((core) => ({ column: Math.floor(core.x), row: Math.floor(core.y) }));
    const random = Math.random;

    while (this.blackHoles.length < desiredCount) {
      const nextKind = chooseBlackHoleSpawnKind(
        this.blackHoles.map((blackHole) => blackHole.kind),
        desiredCount,
        random,
      );
      const nextBlackHole = spawnBlackHole({
        grid: this.grid,
        progress: this.getProgress(),
        snake: this.snake,
        foods: this.foods,
        existingBlackHoles: this.blackHoles,
        birthCell: this.birthCell,
        currentTime: this.elapsed / 1000,
        futureBlockedCells: [...starBeastBodies, ...starAttractorCells, ...starCoreCells],
        futureDangerZones: this.starBeasts.map((beast) => ({
          center: beast.body[0] ?? this.birthCell,
          radius: Math.max(3, Math.ceil(beast.length * 0.45)),
        })),
        kind: nextKind,
        random,
      });

      if (!nextBlackHole) {
        break;
      }

      this.blackHoles.push(nextBlackHole);
    }
  }

  private refreshStarBeasts(): void {
    if (this.phase !== "playing") {
      return;
    }

    if (this.starCores.length >= STAR_BEAST_CONFIG.maxDroppedCoresOnMap) {
      return;
    }

    const currentTime = this.playElapsed / 1000;

    if (currentTime < this.starBeastRespawnLockUntil || currentTime < this.starBeastNextSpawnCheckAt) {
      return;
    }

    const progress = this.getProgress();
    const desiredCount = getDesiredStarBeastCount(progress);

    if (desiredCount <= 0) {
      return;
    }

    const aliveCount = this.starBeasts.filter((beast) => beast.alive).length;

    if (aliveCount >= desiredCount) {
      this.starBeastNextSpawnCheckAt = currentTime + STAR_BEAST_CONFIG.spawnCheckIntervalMs / 1000;
      return;
    }

    const nextStarBeast = spawnStarBeast({
      grid: this.grid,
      progress,
      snake: this.snake,
      foods: this.foods,
      starCoreCells: this.getStarCoreCells(),
      existingBlackHoles: this.blackHoles,
      existingStarBeasts: this.starBeasts,
      currentTime,
    });

    if (nextStarBeast) {
      nextStarBeast.id = this.nextStarBeastId++;
      this.starBeasts.push(nextStarBeast);
    }

    this.starBeastNextSpawnCheckAt = currentTime + STAR_BEAST_CONFIG.spawnCheckIntervalMs / 1000;
  }

  private updateTransientEntities(delta: number): void {
    if (this.phase !== "playing") {
      return;
    }

    const currentTime = this.playElapsed / 1000;
    this.updateStarCores(delta, currentTime);
    if (this.phase !== "playing") {
      return;
    }

    this.updateFoodWaves(this.playElapsed);
    if (this.phase !== "playing") {
      return;
    }

    this.updateStarBeastEffects(currentTime);
    this.updateStarBeasts(delta);
    this.refreshStarBeasts();
  }

  private updateStarCores(delta: number, currentTime: number): void {
    if (this.starCores.length === 0) {
      return;
    }

    const dt = Math.min(delta / 1000, 0.05);
    const dragExponent = delta / 16.67;
    const head = this.snake[0];
    const playerCenter = head
      ? {
          x: head.column + 0.5,
          y: head.row + 0.5,
        }
      : null;

    for (let index = this.starCores.length - 1; index >= 0; index -= 1) {
      const core = this.starCores[index];

      if (!core) {
        continue;
      }

      const ageMs = currentTime * 1000 - core.spawnTime * 1000;
      const rewardBurstOrigin = core.burstOrigin
        ? (head ? { ...head } : null)
        : { column: Math.floor(core.x), row: Math.floor(core.y) };

      if (ageMs >= core.lifetimeMs) {
        this.starCores.splice(index, 1);
        continue;
      }

      if (playerCenter) {
        const dx = playerCenter.x - core.x;
        const dy = playerCenter.y - core.y;
        const distance = Math.hypot(dx, dy);
        const magnetReady = ageMs >= core.magnetDelayMs;

        if (distance <= 0.36) {
          this.starCores.splice(index, 1);
          this.extendSnakeByOne();
          this.handleCoreCollection(currentTime, 1, false, rewardBurstOrigin);

          if (this.foods.length === 0 && this.starCores.length === 0) {
            this.endRun();
            return;
          }

          continue;
        }

        if (magnetReady && distance <= core.magnetRadius) {
          const pull = Math.min(1, 1 - distance / Math.max(0.001, core.magnetRadius));
          const pullStrength = 4.5 + pull * 8;
          core.vx += dx * pullStrength * dt;
          core.vy += dy * pullStrength * dt;
        } else {
          const swirl = 0.18 + Math.sin(currentTime * 6.3 + core.id * 0.11) * 0.06;
          core.vx += Math.sin(currentTime * 2.4 + core.id * 0.17) * swirl * dt;
          core.vy += Math.cos(currentTime * 2.1 + core.id * 0.13) * swirl * dt;
        }
      }

      const drag = ageMs < core.magnetDelayMs ? 0.98 : 0.94;
      const dragFactor = Math.pow(drag, dragExponent);
      core.vx *= dragFactor;
      core.vy *= dragFactor;

      const maxSpeed = ageMs < core.magnetDelayMs ? 0.9 : 2.4;
      const speed = Math.hypot(core.vx, core.vy);

      if (speed > maxSpeed) {
        const scale = maxSpeed / Math.max(0.001, speed);
        core.vx *= scale;
        core.vy *= scale;
      }

      core.x += core.vx * dt;
      core.y += core.vy * dt;
      core.x = Math.max(0.35, Math.min(this.grid.columns - 0.35, core.x));
      core.y = Math.max(0.35, Math.min(this.grid.rows - 0.35, core.y));

      if (playerCenter) {
        const distance = Math.hypot(playerCenter.x - core.x, playerCenter.y - core.y);

        if (distance <= 0.36) {
          this.starCores.splice(index, 1);
          this.handleCoreCollection(currentTime, 1, false, rewardBurstOrigin);

          if (this.foods.length === 0 && this.starCores.length === 0) {
            this.endRun();
            return;
          }
        }
      }
    }
  }

  private extendSnakeByOne(): void {
    const tail = this.snake[this.snake.length - 1];

    if (!tail) {
      return;
    }

    this.snake.push({ ...tail });
    this.adjustSnakeOccupancy(tail, 1);
  }

  private updateStarBeastEffects(currentTime: number): void {
    if (this.starBeastEffects.length === 0) {
      return;
    }

    this.starBeastEffects = this.starBeastEffects.filter(
      (effect) => currentTime - effect.createdAt < effect.lifetimeMs / 1000,
    );
  }

  private primeStarBeastBehavior(beast: StarBeast, currentTime: number): void {
    if (currentTime >= beast.nextCoreHuntAt && currentTime >= beast.coreHuntUntil) {
      beast.coreHuntUntil = currentTime + rollDuration(
        STAR_BEAST_CONFIG.coreHuntWindowRangeMs[0],
        STAR_BEAST_CONFIG.coreHuntWindowRangeMs[1],
      ) / 1000;
      beast.nextCoreHuntAt = currentTime + rollDuration(
        STAR_BEAST_CONFIG.coreHuntCooldownRangeMs[0],
        STAR_BEAST_CONFIG.coreHuntCooldownRangeMs[1],
      ) / 1000;
    }

    if (currentTime >= beast.nextAttackAt && currentTime >= beast.attackUntil) {
      beast.attackUntil = currentTime + rollDuration(
        STAR_BEAST_CONFIG.attackWindowRangeMs[0],
        STAR_BEAST_CONFIG.attackWindowRangeMs[1],
      ) / 1000;
      beast.nextAttackAt = currentTime + rollDuration(
        STAR_BEAST_CONFIG.attackCooldownRangeMs[0],
        STAR_BEAST_CONFIG.attackCooldownRangeMs[1],
      ) / 1000;
    }
  }

  private getStarCoreCells(): GridCell[] {
    return this.starCores.map((core) => ({
      column: Math.floor(core.x),
      row: Math.floor(core.y),
    }));
  }

  private rebuildSnakeOccupancy(): void {
    const cellCount = this.grid.columns * this.grid.rows;

    if (this.snakeOccupancy.length !== cellCount) {
      this.snakeOccupancy = new Uint8Array(cellCount);
    } else {
      this.snakeOccupancy.fill(0);
    }

    for (const segment of this.snake) {
      this.adjustSnakeOccupancy(segment, 1);
    }
  }

  private adjustSnakeOccupancy(cell: GridCell, delta: number): void {
    const index = this.getSnakeCellIndex(cell);

    if (index === null) {
      return;
    }

    const currentValue = this.snakeOccupancy[index] ?? 0;
    const nextValue = currentValue + delta;
    this.snakeOccupancy[index] = Math.max(0, Math.min(255, nextValue));
  }

  private getSnakeCellIndex(cell: GridCell): number | null {
    if (this.isOutOfBounds(cell)) {
      return null;
    }

    return cell.row * this.grid.columns + cell.column;
  }

  private evaluateSnakeAdvance(direction: Direction): SnakeAdvanceEvaluation | null {
    const head = this.snake[0];

    if (!head) {
      return null;
    }

    const delta = DIRECTION_DELTAS[direction];
    const nextHead: GridCell = {
      column: head.column + delta.column,
      row: head.row + delta.row,
    };
    const ateFoodIndex = this.foods.findIndex((food) => cellsMatch(food, nextHead));
    const ateStarCoreIndex = this.findStarCoreIndex(nextHead);
    const ateStarAttractorIndex = STAR_ATTRACTOR_ENABLED ? this.findStarAttractorIndex(nextHead) : -1;
    const growthBeforeMove = this.pendingGrowthSegments;
    const shouldKeepTail = ateFoodIndex !== -1 || ateStarCoreIndex !== -1 || growthBeforeMove > 0;
    const isOutOfBounds = this.isOutOfBounds(nextHead);
    const collidesWithSelf = !isOutOfBounds && this.collidesWithSelf(nextHead, shouldKeepTail);

    return {
      nextHead,
      ateFoodIndex,
      ateStarCoreIndex,
      ateStarAttractorIndex,
      growthBeforeMove,
      shouldKeepTail,
      isOutOfBounds,
      collidesWithSelf,
      canAdvance: !isOutOfBounds && !collidesWithSelf,
    };
  }

  private canAdvanceDirection(direction: Direction): boolean {
    return this.evaluateSnakeAdvance(direction)?.canAdvance ?? false;
  }

  private pickAdvanceDirection(primary: Direction, fallbacks: readonly Direction[] = []): { direction: Direction; primaryBlocked: boolean } {
    const primaryBlocked = !this.canAdvanceDirection(primary);
    const candidates = [primary, ...fallbacks.filter((direction) => direction !== primary)];

    for (const direction of candidates) {
      if (this.canAdvanceDirection(direction)) {
        return {
          direction,
          primaryBlocked,
        };
      }
    }

    return {
      direction: primary,
      primaryBlocked,
    };
  }

  private createBlockedBlackHoleCue(cue: BlackHoleCue | null): BlackHoleCue | null {
    if (!cue) {
      return null;
    }

    return {
      ...cue,
      charge: 0,
      isPulling: false,
    };
  }

  private findStarAttractorIndex(cell: GridCell): number {
    if (!STAR_ATTRACTOR_ENABLED) {
      return -1;
    }

    return this.starAttractors.findIndex((attractor) => cellsMatch(attractor.cell, cell));
  }

  private collidesWithPlayerBody(cell: GridCell): boolean {
    const head = this.snake[0];

    if (!head) {
      return false;
    }

    const index = this.getSnakeCellIndex(cell);

    if (index === null) {
      return false;
    }

    const occupancy = this.snakeOccupancy[index] ?? 0;

    return occupancy > 0 && !cellsMatch(head, cell);
  }

  private consumeStarCore(beast: StarBeast, starCoreIndex: number, currentTime: number): void {
    this.starCores.splice(starCoreIndex, 1);
    beast.coreHuntUntil = currentTime;
    beast.nextCoreHuntAt = currentTime + rollDuration(
      STAR_BEAST_CONFIG.coreHuntCooldownRangeMs[0],
      STAR_BEAST_CONFIG.coreHuntCooldownRangeMs[1],
    ) / 1000;
    beast.aiDecisionCooldown = 0;
  }

  private findStarCoreIndex(cell: GridCell, radius = 0): number {
    return this.starCores.findIndex((core) => {
      const coreCell = { column: Math.floor(core.x), row: Math.floor(core.y) };

      if (radius > 0) {
        return Math.abs(coreCell.column - cell.column) <= radius && Math.abs(coreCell.row - cell.row) <= radius;
      }

      const distance = Math.hypot(core.x - (cell.column + 0.5), core.y - (cell.row + 0.5));

      return cellsMatch(coreCell, cell) || distance <= 0.42;
    });
  }

  private collidesWithStarBeast(cell: GridCell): boolean {
    return this.starBeasts.some((beast) => beast.alive && beast.body.some((segment) => cellsMatch(segment, cell)));
  }

  private killStarBeast(beast: StarBeast, cause: StarBeastDeathCause, currentTime: number): void {
    if (!beast.alive) {
      return;
    }

    beast.alive = false;
    beast.state = "dead";
    this.starBeasts = this.starBeasts.filter((candidate) => candidate.id !== beast.id);

    const availableSlots = STAR_BEAST_CONFIG.maxDroppedCoresOnMap - this.starCores.length;

    if (availableSlots > 0) {
      const drops = buildStarBeastDropCores(beast, cause, {
        grid: this.grid,
        currentTime,
        blackHoles: this.blackHoles,
      });

      for (const drop of drops.slice(0, availableSlots)) {
        drop.id = this.nextStarCoreId++;
        this.starCores.push(drop);
      }
    }

    const flashCell = beast.body[0] ? { ...beast.body[0] } : { ...this.birthCell };
    this.starBeastEffects.push({
      id: this.nextStarBeastEffectId++,
      cell: flashCell,
      createdAt: currentTime,
      lifetimeMs: STAR_BEAST_CONFIG.deathFlashMs,
      seed: beast.id * 97 + this.nextStarBeastEffectId,
      length: beast.length,
      cause,
    });

    const nextSpawnAllowedAt = currentTime + STAR_BEAST_CONFIG.respawnCooldownMs / 1000;
    this.starBeastRespawnLockUntil = Math.max(this.starBeastRespawnLockUntil, nextSpawnAllowedAt);
    this.starBeastNextSpawnCheckAt = Math.max(this.starBeastNextSpawnCheckAt, this.starBeastRespawnLockUntil);
  }

  private updateStarBeasts(stepMs: number): void {
    if (this.phase !== "playing" || this.starBeasts.length === 0) {
      return;
    }

    const currentTime = this.playElapsed / 1000;
    const playerHead = this.snake[0];

    if (!playerHead) {
      return;
    }

    const playerBody = this.snake.slice(1);
    const blockedCells = [...this.foods];
    const playerDirection = this.direction;
    const beastsToUpdate = [...this.starBeasts];

    for (const beast of beastsToUpdate) {
      if (this.phase !== "playing") {
        return;
      }

      if (!beast.alive || !this.starBeasts.some((candidate) => candidate.id === beast.id)) {
        continue;
      }

      this.advanceStarBeast(
        beast,
        stepMs,
        currentTime,
        playerHead,
        playerBody,
        blockedCells,
        this.getStarCoreCells(),
        playerDirection,
      );
    }
  }

  private advanceStarBeast(
    beast: StarBeast,
    deltaMs: number,
    currentTime: number,
    playerHead: GridCell,
    playerBody: readonly GridCell[],
    blockedCells: readonly GridCell[],
    starCoreCells: readonly GridCell[],
    playerDirection: Direction,
  ): void {
    if (!beast.alive || beast.body.length === 0) {
      return;
    }

    let visibleStarCoreCells = starCoreCells;

    if (beast.state === "spawning") {
      beast.spawnGraceTime = Math.max(0, beast.spawnGraceTime - deltaMs);

      if (beast.spawnGraceTime > 0) {
        return;
      }

      beast.state = "patrol";
      beast.aiDecisionCooldown = 0;
    }

    this.primeStarBeastBehavior(beast, currentTime);

    beast.moveTimer += deltaMs;
    const moveInterval = Math.max(90, BEAST_BASE_STEP_MS / Math.max(0.55, beast.speedFactor));

    while (beast.moveTimer >= moveInterval && beast.alive && this.phase === "playing") {
      const otherBeasts = this.starBeasts.filter((candidate) => candidate.id !== beast.id && candidate.alive);
      beast.state = this.getStarBeastState(playerHead, beast);
      const moveContext: StarBeastMoveContext = {
        grid: this.grid,
        playerHead,
        playerDirection,
        playerBody,
        blockedCells,
        starCoreCells: visibleStarCoreCells,
        otherStarBeasts: otherBeasts,
        blackHoles: this.blackHoles,
        currentTime,
      };

      if (beast.aiDecisionCooldown > 0) {
        beast.aiDecisionCooldown -= 1;
      } else {
        beast.dir = chooseStarBeastDirection(beast, moveContext);
        beast.aiDecisionCooldown = beast.turnCommitTicks;
      }

      const head = beast.body[0];

      if (!head) {
        this.killStarBeast(beast, "black_hole", currentTime);
        return;
      }

      const delta = DIRECTION_DELTAS[beast.dir];
      const nextHead: GridCell = {
        column: head.column + delta.column,
        row: head.row + delta.row,
      };

      if (this.isOutOfBounds(nextHead)) {
        beast.aiDecisionCooldown = 0;
        beast.moveTimer = Math.max(0, beast.moveTimer - moveInterval);
        continue;
      }

      if (this.collidesWithPlayerBody(nextHead)) {
        this.killStarBeast(beast, "player_body", currentTime);
        return;
      }

      if (this.collidesWithBlackHole(nextHead)) {
        this.killStarBeast(beast, "black_hole", currentTime);
        return;
      }

      if (cellsMatch(nextHead, playerHead)) {
        this.handlePlayerDeath("star_beast");
        return;
      }

      if (blockedCells.some((cell) => cellsMatch(cell, nextHead))) {
        beast.aiDecisionCooldown = 0;
        break;
      }

      if (otherBeasts.some((other) => other.body.some((segment) => cellsMatch(segment, nextHead)))) {
        beast.aiDecisionCooldown = 0;
        break;
      }

      let growth = 0;
      const ateStarCoreIndex = this.findStarCoreIndex(nextHead);

      if (ateStarCoreIndex !== -1) {
        this.consumeStarCore(beast, ateStarCoreIndex, currentTime);
        growth += 1;
        visibleStarCoreCells = this.getStarCoreCells();
      }

      beast.coreScanStepCount += 1;

      if (beast.coreScanStepCount >= 2) {
        beast.coreScanStepCount = 0;

        const nearbyStarCoreIndex = this.findStarCoreIndex(head, 1);

        if (nearbyStarCoreIndex !== -1) {
          this.consumeStarCore(beast, nearbyStarCoreIndex, currentTime);
          growth += 1;
          visibleStarCoreCells = this.getStarCoreCells();
        }
      }

      const nextLength = Math.min(STAR_BEAST_CONFIG.maxLength, beast.length + growth);

      beast.body = [nextHead, ...beast.body];

      while (beast.body.length > nextLength) {
        beast.body.pop();
      }

      beast.length = nextLength;

      beast.moveTimer = Math.max(0, beast.moveTimer - moveInterval);
      beast.aiDecisionCooldown = Math.max(0, beast.aiDecisionCooldown - 1);
      beast.state = this.getStarBeastState(playerHead, beast);
    }
  }

  private getStarBeastState(playerHead: GridCell, beast: StarBeast): StarBeast["state"] {
    const head = beast.body[0];

    if (!head) {
      return "patrol";
    }

    const distance = Math.abs(head.column - playerHead.column) + Math.abs(head.row - playerHead.row);

    if (distance <= beast.aggroRadius) {
      return "chase";
    }

    if (distance >= beast.loseAggroRadius) {
      return "patrol";
    }

    return beast.state === "chase" ? "chase" : "patrol";
  }

  private collidesWithSelf(cell: GridCell, willGrow: boolean): boolean {
    const index = this.getSnakeCellIndex(cell);

    if (index === null) {
      return false;
    }

    const occupancy = this.snakeOccupancy[index] ?? 0;

    if (occupancy <= 0) {
      return false;
    }

    if (!willGrow) {
      const tail = this.snake[this.snake.length - 1];

      if (tail && cellsMatch(tail, cell) && occupancy === 1) {
        return false;
      }
    }

    return true;
  }

  private collidesWithBlackHole(cell: GridCell): boolean {
    return this.blackHoles.some((blackHole) => isBlackHoleCollision(cell, blackHole, this.elapsed / 1000));
  }

  private startWallGrace(direction: Direction): void {
    if (this.wallGrace) {
      return;
    }

    const now = this.elapsed;
    this.wallGrace = {
      direction,
      startedAt: now,
      expiresAt: now + WALL_GRACE_MS,
    };
  }

  private updateWallGraceState(): void {
    if (!this.wallGrace) {
      return;
    }

    const recoveryDirection = this.getWallGraceRecoveryDirection();

    if (!recoveryDirection) {
      if (this.elapsed >= this.wallGrace.expiresAt) {
        this.handlePlayerDeath("wall");
      }

      return;
    }

    this.wallGrace = null;
    this.stepAccumulator = 0;
    this.advanceSnakeFromDirection(recoveryDirection);
  }

  private getWallGraceRecoveryDirection(): Direction | null {
    if (!this.snake[0]) {
      return null;
    }

    for (let index = 0; index < this.directionQueue.length; index += 1) {
      const direction = this.directionQueue[index];

      if (!direction) {
        continue;
      }

      if (direction === OPPOSITE_DIRECTIONS[this.direction]) {
        continue;
      }

      if (!this.canAdvanceDirection(direction)) {
        continue;
      }

      this.directionQueue.splice(0, index + 1);
      return direction;
    }

    return null;
  }

  private updateBlackHoleAlert(currentTime: number): void {
    const head = this.snake[0];
    this.blackHoleAlert = head ? resolveBlackHoleAlert(head, this.blackHoles, currentTime) : null;
  }

  private isOutOfBounds(cell: GridCell): boolean {
    return cell.column < 0 || cell.row < 0 || cell.column >= this.grid.columns || cell.row >= this.grid.rows;
  }

  private isCurrentPlacementValid(): boolean {
    const snakeIsValid = this.snake.every((segment) => !this.isOutOfBounds(segment));
    const occupiedBlackHoleCells = new Set<string>();
    const occupiedStarBeastCells = new Set<string>();
    const occupiedStarCoreCells = new Set<string>();
    const foodsAreValid = this.foods.every((food) => {
      if (this.isOutOfBounds(food) || this.snake.some((segment) => cellsMatch(segment, food))) {
        return false;
      }

      if (STAR_ATTRACTOR_ENABLED && this.starAttractors.some((attractor) => cellsMatch(attractor.cell, food))) {
        return false;
      }

      if (this.starBeasts.some((beast) => beast.body.some((segment) => cellsMatch(segment, food)))) {
        return false;
      }

      if (this.starCores.some((core) => cellsMatch({ column: Math.floor(core.x), row: Math.floor(core.y) }, food))) {
        return false;
      }

      return !this.blackHoles.some((blackHole) => cellsMatch(blackHole.cell, food));
    });
    const blackHolesAreValid = this.blackHoles.every((blackHole) => {
      if (this.isOutOfBounds(blackHole.cell)) {
        return false;
      }

      const key = `${blackHole.cell.column}:${blackHole.cell.row}`;

      if (occupiedBlackHoleCells.has(key)) {
        return false;
      }

      occupiedBlackHoleCells.add(key);

      if (this.snake.some((segment) => cellsMatch(segment, blackHole.cell))) {
        return false;
      }

      if (this.foods.some((food) => cellsMatch(food, blackHole.cell))) {
        return false;
      }

      if (STAR_ATTRACTOR_ENABLED && this.starAttractors.some((attractor) => cellsMatch(attractor.cell, blackHole.cell))) {
        return false;
      }

      return true;
    });
    const starBeastsAreValid = this.starBeasts.every((beast) => {
      if (!beast.alive || beast.body.length === 0) {
        return false;
      }

      return beast.body.every((segment) => {
        if (this.isOutOfBounds(segment)) {
          return false;
        }

        const key = `${segment.column}:${segment.row}`;

        if (occupiedStarBeastCells.has(key)) {
          return false;
        }

        occupiedStarBeastCells.add(key);

        if (this.snake.some((snakeCell) => cellsMatch(snakeCell, segment))) {
          return false;
        }

        if (this.foods.some((food) => cellsMatch(food, segment))) {
          return false;
        }

        if (STAR_ATTRACTOR_ENABLED && this.starAttractors.some((attractor) => cellsMatch(attractor.cell, segment))) {
          return false;
        }

        if (this.starCores.some((core) => cellsMatch({ column: Math.floor(core.x), row: Math.floor(core.y) }, segment))) {
          return false;
        }

        if (this.blackHoles.some((blackHole) => cellsMatch(blackHole.cell, segment))) {
          return false;
        }

        return true;
      });
    });
    const starCoresAreValid = this.starCores.every((core) => {
      if (!Number.isFinite(core.x) || !Number.isFinite(core.y)) {
        return false;
      }

      if (core.x < 0.35 || core.y < 0.35 || core.x > this.grid.columns - 0.35 || core.y > this.grid.rows - 0.35) {
        return false;
      }

      const key = `${Math.floor(core.x)}:${Math.floor(core.y)}`;

      if (occupiedStarCoreCells.has(key)) {
        return false;
      }

      occupiedStarCoreCells.add(key);

      const coreCell = { column: Math.floor(core.x), row: Math.floor(core.y) };

      if (this.snake.some((segment) => cellsMatch(segment, coreCell))) {
        return false;
      }

      if (STAR_ATTRACTOR_ENABLED && this.starAttractors.some((attractor) => cellsMatch(attractor.cell, coreCell))) {
        return false;
      }

      return true;
    });

    return snakeIsValid && foodsAreValid && blackHolesAreValid && starBeastsAreValid && starCoresAreValid;
  }

  private endRun(): void {
    this.finishGameOver();
  }

  private saveHighScoreIfNeeded(): void {
    if (this.score <= this.highScore) {
      return;
    }

    this.highScore = this.score;
    writeHighScore(this.highScore);
  }

  private buildGrid(size: CanvasSize): GridMetrics {
    return createGrid(size, this.measureTopMargin(size));
  }

  private measureTopMargin(size: CanvasSize): number {
    const hudBottom = this.ui.hudStrip.getBoundingClientRect().bottom;

    if (Number.isFinite(hudBottom) && hudBottom > 0) {
      const gap = isCompactLandscapeSize(size) ? COMPACT_LANDSCAPE_HUD_GAP : DEFAULT_HUD_GAP;
      return Math.ceil(hudBottom + gap);
    }

    return getFallbackTopMargin(size);
  }

  private getSpeedCueSnapshot(): GameSnapshot["speedCue"] {
    if (!this.speedCue) {
      return null;
    }

    const age = this.elapsed - this.speedCue.startedAt;

    if (age >= SPEED_CUE_DURATION_MS) {
      return null;
    }

    return {
      mode: this.speedCue.mode,
      anchor: { ...this.speedCue.anchor },
      startedAt: this.speedCue.startedAt,
      fadeProgress: Math.max(0, Math.min(1, age / SPEED_CUE_DURATION_MS)),
    };
  }

  private updateTickerUi(): void {
    if (this.elapsed - this.lastTickerUpdate < 75) {
      return;
    }

    this.lastTickerUpdate = this.elapsed;
    const cycleIndex = Math.floor(this.elapsed / HUD_TICKER_INTERVAL_MS);
    const cycleProgress = this.elapsed - cycleIndex * HUD_TICKER_INTERVAL_MS;
    const currentIndex = cycleIndex % HUD_TICKER_LINES.length;
    const nextIndex = (currentIndex + 1) % HUD_TICKER_LINES.length;
    const crossfadeStart = HUD_TICKER_INTERVAL_MS - HUD_TICKER_FADE_MS;
    const isCrossfading = cycleProgress >= crossfadeStart;
    const fadeProgress = isCrossfading
      ? Math.max(0, Math.min(1, (cycleProgress - crossfadeStart) / HUD_TICKER_FADE_MS))
      : 0;
    const nextState = this.getOrCreateUiSyncState();
    const currentText = HUD_TICKER_LINES[currentIndex] ?? "";
    const nextText = HUD_TICKER_LINES[nextIndex] ?? "";
    const currentOpacity = (1 - fadeProgress).toFixed(3);
    const nextOpacity = fadeProgress.toFixed(3);

    if (nextState.tickerCurrentText !== currentText) {
      this.ui.tickerCurrentLabel.textContent = currentText;
      nextState.tickerCurrentText = currentText;
    }

    if (nextState.tickerNextText !== nextText) {
      this.ui.tickerNextLabel.textContent = nextText;
      nextState.tickerNextText = nextText;
    }

    if (nextState.tickerCurrentOpacity !== currentOpacity) {
      this.ui.tickerCurrentLabel.style.opacity = currentOpacity;
      nextState.tickerCurrentOpacity = currentOpacity;
    }

    if (nextState.tickerNextOpacity !== nextOpacity) {
      this.ui.tickerNextLabel.style.opacity = nextOpacity;
      nextState.tickerNextOpacity = nextOpacity;
    }
  }

  private createSnapshot(): GameSnapshot {
    const movementSpeed = this.currentMovementSpeed;

    return {
      phase: this.phase,
      grid: this.grid,
      snake: this.snake,
      foods: this.foods,
      starAttractors: STAR_ATTRACTOR_ENABLED ? this.starAttractors : [],
      starAttractorEffects: STAR_ATTRACTOR_ENABLED ? this.starAttractorEffects : [],
      starBeasts: this.starBeasts,
      starCores: this.starCores,
      starBeastEffects: this.starBeastEffects,
      blackHoles: this.blackHoles,
      blackHoleAlert: this.blackHoleAlert,
      blackHoleCue: this.blackHoleCue,
      rewardBurstOrigin: this.rewardBurstOrigin ? { ...this.rewardBurstOrigin } : null,
      score: this.score,
      highScore: this.highScore,
      livesRemaining: this.livesRemaining,
      deathReason: this.deathReason,
      direction: this.direction,
      speedMode: movementSpeed.mode,
      speedMultiplier: movementSpeed.multiplier,
      speedCue: this.getSpeedCueSnapshot(),
      wallGrace: this.wallGrace,
      reviveCountdownSeconds: this.getReviveCountdownSeconds(),
    };
  }

  public getUnlockedFeatures(): UnlockedFeatures {
    return computeUnlockedFeatures(this.getProgress());
  }

  private getProgress(): GameProgress {
    return {
      snakeLength: this.snake.length,
      coresEaten: this.coresEaten,
      score: this.score,
      elapsedTime: this.playElapsed / 1000
    };
  }

  private syncUi(force: boolean, measuredSize?: CanvasSize): void {
    if (!force && this.elapsed - this.lastUiUpdate < 120) {
      return;
    }

    this.lastUiUpdate = this.elapsed;
    const hasUiCache = this.uiSyncState !== null;
    const size = measuredSize ?? this.renderer.getSize();
    const unlockCopy = getNextLengthUnlockCopy(this.getProgress());
    const isReady = this.phase === "ready";
    const isRevivePrompt = this.phase === "revivePrompt";
    const isReviving = this.phase === "reviving";
    const isGameOver = this.phase === "gameOver";
    const currentLength = this.snake.length.toString();
    const currentLengthDisplay = `${currentLength}/100`;
    const nextState = this.getOrCreateUiSyncState();
    const rootPhase = this.phase;
    const boardTop = `${this.grid.offsetY}px`;
    const startPanelHidden = !(isReady || isGameOver || isRevivePrompt);
    const startButtonText = isReady ? "开始游戏" : isGameOver ? "重开" : "复活";
    const startButtonAriaLabel = isReady ? "开始游戏" : isGameOver ? "重新开始" : "确认复活";
    const startButtonDisabled = isReviving;
    const pauseButtonDisabled = this.phase !== "playing" && this.phase !== "paused";
    const pauseButtonText = this.phase === "paused" ? "▶" : "❚❚";
    const pauseButtonAriaLabel = this.phase === "paused" ? "继续游戏" : "暂停游戏";
    const panelPrimaryLabel = isReady ? "准备开始" : "当前/目标长度";
    const panelPrimaryValue = isReady ? "NEON SERPENT" : currentLengthDisplay;
    const panelSecondaryLabel = isReady ? "霓虹吞星" : this.getDeathReasonText();
    const panelMetaHidden = isRevivePrompt;
    const panelMetaLabel = isReady
      ? "长按方向键加速·长按Shift减速"
      : isGameOver
        ? "按开始重开"
        : isReviving
          ? `${this.getReviveCountdownSeconds()} 秒后开始`
          : "";
    const lengthLabel = currentLengthDisplay;
    const unlockTitleLabel = unlockCopy.title;
    const unlockValueLabel = unlockCopy.value;
    const stateLabel = PHASE_LABELS[this.phase];
    const fpsLabel = `${this.lastFps || "--"} FPS`;
    const sizeLabel = `${size.width} x ${size.height} @${size.dpr.toFixed(1)}`;

    if (!hasUiCache || nextState.rootPhase !== rootPhase) {
      this.ui.root.dataset.phase = rootPhase;
      nextState.rootPhase = rootPhase;
    }

    if (!hasUiCache || nextState.boardTop !== boardTop) {
      this.ui.root.style.setProperty("--board-top", boardTop);
      nextState.boardTop = boardTop;
    }

    if (!hasUiCache || nextState.startPanelHidden !== startPanelHidden) {
      this.ui.startPanel.hidden = startPanelHidden;
      nextState.startPanelHidden = startPanelHidden;
    }

    if (!hasUiCache || nextState.startButtonText !== startButtonText) {
      this.ui.startButton.textContent = startButtonText;
      nextState.startButtonText = startButtonText;
    }

    if (!hasUiCache || nextState.startButtonAriaLabel !== startButtonAriaLabel) {
      this.ui.startButton.setAttribute("aria-label", startButtonAriaLabel);
      nextState.startButtonAriaLabel = startButtonAriaLabel;
    }

    if (!hasUiCache || nextState.startButtonDisabled !== startButtonDisabled) {
      this.ui.startButton.disabled = startButtonDisabled;
      nextState.startButtonDisabled = startButtonDisabled;
    }

    if (!hasUiCache || nextState.pauseButtonDisabled !== pauseButtonDisabled) {
      this.ui.pauseButton.disabled = pauseButtonDisabled;
      nextState.pauseButtonDisabled = pauseButtonDisabled;
    }

    if (!hasUiCache || nextState.pauseButtonText !== pauseButtonText) {
      this.ui.pauseButton.textContent = pauseButtonText;
      nextState.pauseButtonText = pauseButtonText;
    }

    if (!hasUiCache || nextState.pauseButtonAriaLabel !== pauseButtonAriaLabel) {
      this.ui.pauseButton.setAttribute("aria-label", pauseButtonAriaLabel);
      nextState.pauseButtonAriaLabel = pauseButtonAriaLabel;
    }

    if (!hasUiCache || nextState.panelPrimaryLabel !== panelPrimaryLabel) {
      this.ui.panelPrimaryLabel.textContent = panelPrimaryLabel;
      nextState.panelPrimaryLabel = panelPrimaryLabel;
    }

    if (!hasUiCache || nextState.panelPrimaryValue !== panelPrimaryValue) {
      this.ui.panelPrimaryValue.textContent = panelPrimaryValue;
      nextState.panelPrimaryValue = panelPrimaryValue;
    }

    if (!hasUiCache || nextState.panelSecondaryLabel !== panelSecondaryLabel) {
      this.ui.panelSecondaryLabel.textContent = panelSecondaryLabel;
      nextState.panelSecondaryLabel = panelSecondaryLabel;
    }

    if (!hasUiCache || nextState.panelMetaHidden !== panelMetaHidden) {
      this.ui.panelMetaLabel.hidden = panelMetaHidden;
      nextState.panelMetaHidden = panelMetaHidden;
    }

    if (!hasUiCache || nextState.panelMetaLabel !== panelMetaLabel) {
      this.ui.panelMetaLabel.textContent = panelMetaLabel;
      nextState.panelMetaLabel = panelMetaLabel;
    }

    for (let index = 0; index < this.ui.lifeHearts.length; index += 1) {
      const heart = this.ui.lifeHearts[index];
      const active = index < this.livesRemaining ? "true" : "false";

      if (!heart) {
        continue;
      }

      if (!hasUiCache || nextState.lifeHeartActiveStates[index] !== active) {
        heart.dataset.active = active;
        nextState.lifeHeartActiveStates[index] = active;
      }
    }

    nextState.lifeHeartActiveStates.length = this.ui.lifeHearts.length;

    if (!hasUiCache || nextState.lengthLabel !== lengthLabel) {
      this.ui.lengthLabel.textContent = lengthLabel;
      nextState.lengthLabel = lengthLabel;
    }

    if (!hasUiCache || nextState.unlockTitleLabel !== unlockTitleLabel) {
      this.ui.unlockTitleLabel.textContent = unlockTitleLabel;
      nextState.unlockTitleLabel = unlockTitleLabel;
    }

    if (!hasUiCache || nextState.unlockValueLabel !== unlockValueLabel) {
      this.ui.unlockValueLabel.textContent = unlockValueLabel;
      nextState.unlockValueLabel = unlockValueLabel;
    }

    if (!hasUiCache || nextState.stateLabel !== stateLabel) {
      this.ui.stateLabel.textContent = stateLabel;
      nextState.stateLabel = stateLabel;
    }

    if (!hasUiCache || nextState.fpsLabel !== fpsLabel) {
      this.ui.fpsLabel.textContent = fpsLabel;
      nextState.fpsLabel = fpsLabel;
    }

    if (!hasUiCache || nextState.sizeLabel !== sizeLabel) {
      this.ui.sizeLabel.textContent = sizeLabel;
      nextState.sizeLabel = sizeLabel;
    }
  }

  private getOrCreateUiSyncState(): UiSyncState {
    if (this.uiSyncState) {
      return this.uiSyncState;
    }

    this.uiSyncState = {
      rootPhase: "",
      boardTop: "",
      startPanelHidden: false,
      startButtonText: "",
      startButtonAriaLabel: "",
      startButtonDisabled: false,
      pauseButtonDisabled: false,
      pauseButtonText: "",
      pauseButtonAriaLabel: "",
      panelPrimaryLabel: "",
      panelPrimaryValue: "",
      panelSecondaryLabel: "",
      panelMetaHidden: false,
      panelMetaLabel: "",
      lifeHeartActiveStates: [],
      lengthLabel: "",
      unlockTitleLabel: "",
      unlockValueLabel: "",
      stateLabel: "",
      fpsLabel: "",
      sizeLabel: "",
      tickerCurrentText: "",
      tickerNextText: "",
      tickerCurrentOpacity: "",
      tickerNextOpacity: "",
    };

    return this.uiSyncState;
  }
}
