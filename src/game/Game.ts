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
import { DIRECTION_DELTAS, OPPOSITE_DIRECTIONS } from "./direction";
import {
  type ActiveDirectionalInput,
  type ActiveSpeedInput,
  type EntityRuntimeState,
  type InputRuntimeState,
  type MovementRuntimeState,
  type MovementSpeedState,
  type ProgressRuntimeState,
  type RunLifecycleState,
  type SnakeAdvanceEvaluation,
  type SpeedCueState,
  type SpeedRuntimeState,
  type TimingRuntimeState,
  type SpawnRuntimeState,
  type UiSyncState,
  type WallGraceState,
} from "./gameState";
import { createEntityState, createInputState, createLifecycleState, createMovementState, createProgressState, createSpawnState, createSpeedState, createTimingState, resetTimingState } from "./stateFactory";
import { cellKey, cellsMatch, chebyshevDistance } from "./gridMath";
import { createRenderer } from "./render";
import { readHighScore, writeHighScore } from "./storage";
import {
  applyTickerUiModel,
  applyUiSyncModel,
  buildGameSnapshot,
  buildTickerUiModel,
  buildUiSyncModel,
  createUiSyncState,
} from "./viewModel";
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

const BASE_STEP_MS = 180 / 0.7 / 0.7;
const BEAST_BASE_STEP_MS = BASE_STEP_MS;
const BOOST_STEP_RATIO = 0.6;
const ACCELERATE_SPEED_MULTIPLIER = 2.6 / 0.7 / 0.7;
const BRAKE_SPEED_MULTIPLIER = 0.35;
const SPEED_CUE_DURATION_MS = 1500;
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

export class Game {
  private readonly canvas: HTMLCanvasElement;
  private readonly ui: GameUiElements;
  private readonly renderer: Renderer;
  private readonly input: InputController;
  private readonly audio: AudioController;
  private readonly unsubscribers: Unsubscribe[] = [];
  private readonly activeDirectionalInputs = new Map<string, ActiveDirectionalInput>();
  private readonly activeSpeedInputs = new Map<string, ActiveSpeedInput>();

  private lifecycle: RunLifecycleState = createLifecycleState();
  private grid: GridMetrics;
  private movement: MovementRuntimeState = createMovementState();
  private frameId: number | null = null;
  private timing: TimingRuntimeState = createTimingState();
  private speedRuntime: SpeedRuntimeState = createSpeedState();
  private entities: EntityRuntimeState = createEntityState();
  private progress: ProgressRuntimeState = createProgressState();
  private spawn: SpawnRuntimeState = createSpawnState();
  private inputState: InputRuntimeState = createInputState();
  private uiSyncState: UiSyncState = createUiSyncState();

  private get phase(): GamePhase {
    return this.lifecycle.phase;
  }

  private set phase(value: GamePhase) {
    this.lifecycle.phase = value;
  }

  private get livesRemaining(): number {
    return this.lifecycle.livesRemaining;
  }

  private set livesRemaining(value: number) {
    this.lifecycle.livesRemaining = value;
  }

  private get deathReason(): DeathReason | null {
    return this.lifecycle.deathReason;
  }

  private set deathReason(value: DeathReason | null) {
    this.lifecycle.deathReason = value;
  }

  private get reviving(): boolean {
    return this.lifecycle.reviving;
  }

  private set reviving(value: boolean) {
    this.lifecycle.reviving = value;
  }

  private get reviveEndsAt(): number {
    return this.lifecycle.reviveEndsAt;
  }

  private set reviveEndsAt(value: number) {
    this.lifecycle.reviveEndsAt = value;
  }

  private get wallGrace(): WallGraceState | null {
    return this.lifecycle.wallGrace;
  }

  private set wallGrace(value: WallGraceState | null) {
    this.lifecycle.wallGrace = value;
  }

  private get birthCell(): GridCell {
    return this.lifecycle.birthCell;
  }

  private set birthCell(value: GridCell) {
    this.lifecycle.birthCell = value;
  }

  private get direction(): Direction {
    return this.movement.direction;
  }

  private set direction(value: Direction) {
    this.movement.direction = value;
  }

  private get directionQueue(): Direction[] {
    return this.movement.directionQueue;
  }

  private set directionQueue(value: Direction[]) {
    this.movement.directionQueue = value;
  }

  private get snakeOccupancy(): Uint8Array {
    return this.movement.snakeOccupancy;
  }

  private set snakeOccupancy(value: Uint8Array) {
    this.movement.snakeOccupancy = value;
  }

  private get movementTick(): number {
    return this.movement.movementTick;
  }

  private set movementTick(value: number) {
    this.movement.movementTick = value;
  }

  private get stepAccumulator(): number {
    return this.movement.stepAccumulator;
  }

  private set stepAccumulator(value: number) {
    this.movement.stepAccumulator = value;
  }

  private get isBoosting(): boolean {
    return this.movement.isBoosting;
  }

  private set isBoosting(value: boolean) {
    this.movement.isBoosting = value;
  }

  private get pendingGrowthSegments(): number {
    return this.movement.pendingGrowthSegments;
  }

  private set pendingGrowthSegments(value: number) {
    this.movement.pendingGrowthSegments = value;
  }

  private get elapsed(): number {
    return this.timing.elapsed;
  }

  private set elapsed(value: number) {
    this.timing.elapsed = value;
  }

  private get playElapsed(): number {
    return this.timing.playElapsed;
  }

  private set playElapsed(value: number) {
    this.timing.playElapsed = value;
  }

  private get lastFrameTime(): number {
    return this.timing.lastFrameTime;
  }

  private set lastFrameTime(value: number) {
    this.timing.lastFrameTime = value;
  }

  private get lastUiUpdate(): number {
    return this.timing.lastUiUpdate;
  }

  private set lastUiUpdate(value: number) {
    this.timing.lastUiUpdate = value;
  }

  private get lastTickerUpdate(): number {
    return this.timing.lastTickerUpdate;
  }

  private set lastTickerUpdate(value: number) {
    this.timing.lastTickerUpdate = value;
  }

  private get lastFps(): number {
    return this.timing.lastFps;
  }

  private set lastFps(value: number) {
    this.timing.lastFps = value;
  }

  private get speedCue(): SpeedCueState | null {
    return this.speedRuntime.speedCue;
  }

  private set speedCue(value: SpeedCueState | null) {
    this.speedRuntime.speedCue = value;
  }

  private get lastMovementSpeedMode(): SpeedMode {
    return this.speedRuntime.lastMovementSpeedMode;
  }

  private set lastMovementSpeedMode(value: SpeedMode) {
    this.speedRuntime.lastMovementSpeedMode = value;
  }

  private get currentMovementSpeed(): MovementSpeedState {
    return this.speedRuntime.currentMovementSpeed;
  }

  private set currentMovementSpeed(value: MovementSpeedState) {
    this.speedRuntime.currentMovementSpeed = value;
  }

  private get snake(): GridCell[] {
    return this.entities.snake;
  }

  private set snake(value: GridCell[]) {
    this.entities.snake = value;
  }

  private get foods(): GridCell[] {
    return this.entities.foods;
  }

  private set foods(value: GridCell[]) {
    this.entities.foods = value;
  }

  private get starAttractors(): StarAttractor[] {
    return this.entities.starAttractors;
  }

  private set starAttractors(value: StarAttractor[]) {
    this.entities.starAttractors = value;
  }

  private get starAttractorEffects(): StarAttractorEffect[] {
    return this.entities.starAttractorEffects;
  }

  private set starAttractorEffects(value: StarAttractorEffect[]) {
    this.entities.starAttractorEffects = value;
  }

  private get starBeasts(): StarBeast[] {
    return this.entities.starBeasts;
  }

  private set starBeasts(value: StarBeast[]) {
    this.entities.starBeasts = value;
  }

  private get starCores(): StarCore[] {
    return this.entities.starCores;
  }

  private set starCores(value: StarCore[]) {
    this.entities.starCores = value;
  }

  private get starBeastEffects(): StarBeastEffect[] {
    return this.entities.starBeastEffects;
  }

  private set starBeastEffects(value: StarBeastEffect[]) {
    this.entities.starBeastEffects = value;
  }

  private get blackHoles(): BlackHole[] {
    return this.entities.blackHoles;
  }

  private set blackHoles(value: BlackHole[]) {
    this.entities.blackHoles = value;
  }

  private get blackHoleAlert(): GameSnapshot["blackHoleAlert"] {
    return this.entities.blackHoleAlert;
  }

  private set blackHoleAlert(value: GameSnapshot["blackHoleAlert"]) {
    this.entities.blackHoleAlert = value;
  }

  private get blackHoleGravityState(): BlackHoleGravityState {
    return this.entities.blackHoleGravityState;
  }

  private set blackHoleGravityState(value: BlackHoleGravityState) {
    this.entities.blackHoleGravityState = value;
  }

  private get blackHoleCue(): GameSnapshot["blackHoleCue"] {
    return this.entities.blackHoleCue;
  }

  private set blackHoleCue(value: GameSnapshot["blackHoleCue"]) {
    this.entities.blackHoleCue = value;
  }

  private get blackHoleRecoveryDirection(): Direction | null {
    return this.entities.blackHoleRecoveryDirection;
  }

  private set blackHoleRecoveryDirection(value: Direction | null) {
    this.entities.blackHoleRecoveryDirection = value;
  }

  private get rewardBurstOrigin(): GridCell | null {
    return this.entities.rewardBurstOrigin;
  }

  private set rewardBurstOrigin(value: GridCell | null) {
    this.entities.rewardBurstOrigin = value;
  }

  private get score(): number {
    return this.progress.score;
  }

  private set score(value: number) {
    this.progress.score = value;
  }

  private get coresEaten(): number {
    return this.progress.coresEaten;
  }

  private set coresEaten(value: number) {
    this.progress.coresEaten = value;
  }

  private get highScore(): number {
    return this.progress.highScore;
  }

  private set highScore(value: number) {
    this.progress.highScore = value;
  }

  private get activeInputSequence(): number {
    return this.inputState.activeInputSequence;
  }

  private set activeInputSequence(value: number) {
    this.inputState.activeInputSequence = value;
  }

  private get starAttractorEatCount(): number {
    return this.spawn.starAttractorEatCount;
  }

  private set starAttractorEatCount(value: number) {
    this.spawn.starAttractorEatCount = value;
  }

  private get starAttractorNeedIndex(): number {
    return this.spawn.starAttractorNeedIndex;
  }

  private set starAttractorNeedIndex(value: number) {
    this.spawn.starAttractorNeedIndex = value;
  }

  private get starAttractorNeed(): number {
    return this.spawn.starAttractorNeed;
  }

  private set starAttractorNeed(value: number) {
    this.spawn.starAttractorNeed = value;
  }

  private get starAttractorSpawnPending(): boolean {
    return this.spawn.starAttractorSpawnPending;
  }

  private set starAttractorSpawnPending(value: boolean) {
    this.spawn.starAttractorSpawnPending = value;
  }

  private get starBeastNextSpawnCheckAt(): number {
    return this.spawn.starBeastNextSpawnCheckAt;
  }

  private set starBeastNextSpawnCheckAt(value: number) {
    this.spawn.starBeastNextSpawnCheckAt = value;
  }

  private get starBeastRespawnLockUntil(): number {
    return this.spawn.starBeastRespawnLockUntil;
  }

  private set starBeastRespawnLockUntil(value: number) {
    this.spawn.starBeastRespawnLockUntil = value;
  }

  private get foodWaveBag(): FoodWaveKind[] {
    return this.spawn.foodWaveBag;
  }

  private set foodWaveBag(value: FoodWaveKind[]) {
    this.spawn.foodWaveBag = value;
  }

  private get foodWaveNextSpawnAt(): number {
    return this.spawn.foodWaveNextSpawnAt;
  }

  private set foodWaveNextSpawnAt(value: number) {
    this.spawn.foodWaveNextSpawnAt = value;
  }

  private get nextStarAttractorId(): number {
    return this.spawn.nextStarAttractorId;
  }

  private set nextStarAttractorId(value: number) {
    this.spawn.nextStarAttractorId = value;
  }

  private get nextStarAttractorEffectId(): number {
    return this.spawn.nextStarAttractorEffectId;
  }

  private set nextStarAttractorEffectId(value: number) {
    this.spawn.nextStarAttractorEffectId = value;
  }

  private get nextStarBeastId(): number {
    return this.spawn.nextStarBeastId;
  }

  private set nextStarBeastId(value: number) {
    this.spawn.nextStarBeastId = value;
  }

  private get nextStarCoreId(): number {
    return this.spawn.nextStarCoreId;
  }

  private set nextStarCoreId(value: number) {
    this.spawn.nextStarCoreId = value;
  }

  private get nextStarBeastEffectId(): number {
    return this.spawn.nextStarBeastEffectId;
  }

  private set nextStarBeastEffectId(value: number) {
    this.spawn.nextStarBeastEffectId = value;
  }

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
    this.lifecycle = createLifecycleState(phase);
    this.movement = createMovementState();
    this.timing = resetTimingState(createTimingState());
    this.speedRuntime = createSpeedState();
    this.entities = createEntityState();
    this.progress = createProgressState(this.highScore);
    this.spawn = createSpawnState();
    this.inputState = createInputState();
    this.activeDirectionalInputs.clear();
    this.activeSpeedInputs.clear();
    this.entities.snake = this.createStartingSnake();
    this.lifecycle.birthCell = this.entities.snake[0] ? { ...this.entities.snake[0] } : { column: 0, row: 0 };
    this.entities.foods = this.createFoods();
    this.progress.score = 0;
    this.progress.coresEaten = 0;
    this.spawn.starAttractorNeed = STAR_ATTRACTOR_ENABLED ? rollStarAttractorNeed(this.spawn.starAttractorNeedIndex) : 0;
    this.speedRuntime.currentMovementSpeed = { mode: "base", multiplier: 1, stepMs: BASE_STEP_MS };
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

  private updateTickerUi(): void {
    if (this.elapsed - this.lastTickerUpdate < 75) {
      return;
    }

    this.lastTickerUpdate = this.elapsed;
    applyTickerUiModel(this.ui, this.uiSyncState, buildTickerUiModel({ elapsed: this.elapsed }));
  }

  private createSnapshot(): GameSnapshot {
    return buildGameSnapshot({
      phase: this.phase,
      grid: this.grid,
      snake: this.snake,
      foods: this.foods,
      starAttractors: this.starAttractors,
      starAttractorEffects: this.starAttractorEffects,
      starBeasts: this.starBeasts,
      starCores: this.starCores,
      starBeastEffects: this.starBeastEffects,
      blackHoles: this.blackHoles,
      blackHoleAlert: this.blackHoleAlert,
      blackHoleCue: this.blackHoleCue,
      rewardBurstOrigin: this.rewardBurstOrigin,
      score: this.score,
      highScore: this.highScore,
      livesRemaining: this.livesRemaining,
      deathReason: this.deathReason,
      direction: this.direction,
      speedMode: this.currentMovementSpeed.mode,
      speedMultiplier: this.currentMovementSpeed.multiplier,
      speedCue: this.speedCue,
      reviving: this.reviving,
      reviveEndsAt: this.reviveEndsAt,
      elapsed: this.elapsed,
      wallGrace: this.wallGrace,
      includeStarAttractor: STAR_ATTRACTOR_ENABLED,
    });
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
    const size = measuredSize ?? this.renderer.getSize();
    const progress = this.getProgress();
    const model = buildUiSyncModel({
      phase: this.phase,
      grid: this.grid,
      progress,
      livesRemaining: this.livesRemaining,
      lastFps: this.lastFps,
      size,
      deathReason: this.deathReason,
      reviving: this.reviving,
      reviveEndsAt: this.reviveEndsAt,
      elapsed: this.elapsed,
      lifeHeartCount: this.ui.lifeHearts.length,
    });

    applyUiSyncModel(this.ui, this.uiSyncState, model);
  }
}
