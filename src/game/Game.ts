import { createAudioController, type AudioController } from "./audio";
import {
  getBlackHoleFoodAvoidRadiusCells,
  isBlackHoleCollision,
  resolveBlackHoleAlert,
  resolveBlackHoleMovement,
  type BlackHoleGravityState,
} from "./blackHole";
import { createInputController } from "./input";
import { spawnFoodCell } from "./foodSpawn";
import {
  DEFAULT_UNLOCK_CONFIG,
  getUnlockedFeatures as computeUnlockedFeatures,
  type GameProgress,
  type UnlockedFeatures,
} from "./progression";
import { findReviveSpawnPlacement } from "./spawn";
import type { ReviveSpawnPlacement } from "./spawn";
import { rollStarAttractorNeed } from "./starAttractor";
import { OPPOSITE_DIRECTIONS } from "./direction";
import {
  type ActiveDirectionalInput,
  type ActiveSpeedInput,
  type EntityRuntimeState,
  type InputRuntimeState,
  type MovementRuntimeState,
  type MovementSpeedState,
  type ProgressRuntimeState,
  type RunLifecycleState,
  type SpeedCueState,
  type SpeedRuntimeState,
  type TimingRuntimeState,
  type SpawnRuntimeState,
  type UiSyncState,
  type WallGraceState,
} from "./gameState";
import { createEntityState, createInputState, createLifecycleState, createMovementState, createProgressState, createSpawnState, createSpeedState, createTimingState, resetTimingState } from "./stateFactory";
import { cellsMatch } from "./gridMath";
import { createRenderer } from "./render";
import { readHighScore, writeHighScore } from "./storage";
import { buildFoodSpawnContext, getReviveBlockedCells as buildReviveBlockedCells, isCurrentPlacementValid } from "./spawnRuntime";
import {
  getBlackHoleSpawnBlockedCells,
  getBlackHoleSpawnDangerZones,
  getStarCoreCells,
} from "./spawnSelectors";
import {
  advanceStarAttractorSpawnSystem,
  refreshBlackHoleSpawnSystem,
  refreshStarBeastSpawnSystem,
  retryPendingStarAttractorSpawnSystem,
} from "./spawnSystems";
import {
  applyTickerUiModel,
  applyUiSyncModel,
  buildGameSnapshot,
  buildTickerUiModel,
  buildUiSyncModel,
  createUiSyncState,
} from "./viewModel";
import { runTransientSimulation, type TransientSimulationContext } from "./simulationPipeline";
import {
  canAdvanceDirection,
  evaluateSnakeAdvance,
  pickAdvanceDirection,
  type SnakeMovementEvaluationContext,
} from "./snakeMovementSystem";
import {
  updateFoodWaveSystem,
  updateStarBeastEffectSystem,
  updateStarCoreSystem,
} from "./transientSystems";
import { updateStarBeastSimulation } from "./starBeastSimulation";
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
const BOOST_STEP_RATIO = 0.6;
const ACCELERATE_SPEED_MULTIPLIER = 2.6 / 0.7 / 0.7;
const BRAKE_SPEED_MULTIPLIER = 0.35;
const SPEED_CUE_DURATION_MS = 1500;
const MAX_DIRECTION_QUEUE_LENGTH = 2;
const STARTING_LENGTH = 4;
const SCORE_PER_CORE = 10;
const WALL_GRACE_MS = 110;
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
  private readonly transientSimulationContext: TransientSimulationContext = {
    getPhase: () => this.phase,
    updateStarCores: (delta, currentTime) => this.updateStarCores(delta, currentTime),
    updateFoodWaves: (currentTimeMs) => this.updateFoodWaves(currentTimeMs),
    updateStarBeastEffects: (currentTime) => this.updateStarBeastEffects(currentTime),
    updateStarBeasts: (delta) => this.updateStarBeasts(delta),
    refreshStarBeasts: () => this.refreshStarBeastsInternal(),
  };

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

  private get nextStarAttractorEffectId(): number {
    return this.spawn.nextStarAttractorEffectId;
  }

  private set nextStarAttractorEffectId(value: number) {
    this.spawn.nextStarAttractorEffectId = value;
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
        runTransientSimulation(this.transientSimulationContext, delta, this.playElapsed);
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

    if ((this.phase === "playing" || this.phase === "paused" || this.phase === "ready") && !isCurrentPlacementValid({
      grid: this.grid,
      blackHoles: this.blackHoles,
      snake: this.snake,
      foods: this.foods,
      starAttractors: this.starAttractors,
      starBeasts: this.starBeasts,
      starCores: this.starCores,
      includeStarAttractors: STAR_ATTRACTOR_ENABLED,
    })) {
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
    return buildReviveBlockedCells({
      blackHoles: this.blackHoles,
      snake: this.snake,
      foods: this.foods,
      starAttractors: this.starAttractors,
      starBeasts: this.starBeasts,
      starCores: this.starCores,
      includeStarAttractors: STAR_ATTRACTOR_ENABLED,
    });
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
    return spawnFoodCell(buildFoodSpawnContext({
      grid: this.grid,
      blackHoles: this.blackHoles,
      snake: this.snake,
      foods: this.foods,
      starAttractors: this.starAttractors,
      starBeasts: this.starBeasts,
      starCores: this.starCores,
      includeStarAttractors: STAR_ATTRACTOR_ENABLED,
      extraBlockedCells: extraBlocked,
    }));
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
    const evaluation = evaluateSnakeAdvance(this.createSnakeMovementEvaluationContext(), this.direction);

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
    advanceStarAttractorSpawnSystem(
      {
        enabled: STAR_ATTRACTOR_ENABLED,
        grid: this.grid,
        progress: this.getProgress(),
        snake: this.snake,
        direction: this.direction,
        foods: this.foods,
        starCoreCells: getStarCoreCells(this.starCores),
        existingBlackHoles: this.blackHoles,
        existingStarAttractors: this.starAttractors,
        existingStarBeasts: this.starBeasts,
        currentTime,
        state: this.spawn,
      },
      amount,
    );
  }

  private retryPendingStarAttractorSpawn(currentTime: number): void {
    retryPendingStarAttractorSpawnSystem({
      enabled: STAR_ATTRACTOR_ENABLED,
      grid: this.grid,
      progress: this.getProgress(),
      snake: this.snake,
      direction: this.direction,
      foods: this.foods,
      starCoreCells: getStarCoreCells(this.starCores),
      existingBlackHoles: this.blackHoles,
      existingStarAttractors: this.starAttractors,
      existingStarBeasts: this.starBeasts,
      currentTime,
      state: this.spawn,
    });
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
    refreshBlackHoleSpawnSystem({
      grid: this.grid,
      progress: this.getProgress(),
      snake: this.snake,
      foods: this.foods,
      birthCell: this.birthCell,
      currentTime: this.elapsed / 1000,
      existingBlackHoles: this.blackHoles,
      futureBlockedCells: getBlackHoleSpawnBlockedCells({
        starBeasts: this.starBeasts,
        starAttractors: this.starAttractors,
        starCores: this.starCores,
        includeStarAttractors: STAR_ATTRACTOR_ENABLED,
      }),
      futureDangerZones: getBlackHoleSpawnDangerZones({
        starBeasts: this.starBeasts,
        birthCell: this.birthCell,
      }),
    });
  }

  private refreshStarBeastsInternal(): void {
    refreshStarBeastSpawnSystem({
      phase: this.phase,
      grid: this.grid,
      progress: this.getProgress(),
      snake: this.snake,
      foods: this.foods,
      starCoreCells: getStarCoreCells(this.starCores),
      existingBlackHoles: this.blackHoles,
      existingStarBeasts: this.starBeasts,
      currentTime: this.playElapsed / 1000,
      state: this.spawn,
    });
  }

  public updateStarCores(delta: number, currentTime: number): void {
    updateStarCoreSystem({
      delta,
      currentTime,
      grid: this.grid,
      snake: this.snake,
      foods: this.foods,
      starCores: this.starCores,
      extendSnakeByOne: () => this.extendSnakeByOne(),
      handleCoreCollection: (time, amount, advancesStarAttractorProgress, rewardBurstOrigin) => {
        this.handleCoreCollection(time, amount, advancesStarAttractorProgress, rewardBurstOrigin);
      },
      endRun: () => this.endRun(),
    });
  }

  public updateFoodWaves(currentTimeMs: number): void {
    updateFoodWaveSystem({
      context: buildFoodSpawnContext({
        grid: this.grid,
        blackHoles: this.blackHoles,
        snake: this.snake,
        foods: this.foods,
        starAttractors: this.starAttractors,
        starBeasts: this.starBeasts,
        starCores: this.starCores,
        includeStarAttractors: STAR_ATTRACTOR_ENABLED,
      }),
      foods: this.foods,
      state: this.spawn,
      currentTimeMs,
    });
  }

  public updateStarBeastEffects(currentTime: number): void {
    updateStarBeastEffectSystem({
      currentTime,
      starBeastEffects: this.starBeastEffects,
    });
  }

  public updateStarBeasts(stepMs: number): void {
    updateStarBeastSimulation({
      grid: this.grid,
      snake: this.snake,
      playerDirection: this.direction,
      foods: this.foods,
      blackHoles: this.blackHoles,
      starBeasts: this.starBeasts,
      starCores: this.starCores,
      starBeastEffects: this.starBeastEffects,
      spawnState: this.spawn,
      birthCell: this.birthCell,
      stepMs,
      currentTime: this.playElapsed / 1000,
      blackHoleCollisionTime: this.elapsed / 1000,
      baseStepMs: BASE_STEP_MS,
      getPhase: () => this.phase,
      isOutOfBounds: (cell) => this.isOutOfBounds(cell),
      collidesWithPlayerBody: (cell) => this.collidesWithPlayerBody(cell),
      handlePlayerDeath: (reason) => this.handlePlayerDeath(reason),
    });
  }

  public refreshStarBeasts(): void {
    this.refreshStarBeastsInternal();
  }

  private extendSnakeByOne(): void {
    const tail = this.snake[this.snake.length - 1];

    if (!tail) {
      return;
    }

    this.snake.push({ ...tail });
    this.adjustSnakeOccupancy(tail, 1);
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

  private createSnakeMovementEvaluationContext(): SnakeMovementEvaluationContext {
    return {
      grid: this.grid,
      snake: this.snake,
      foods: this.foods,
      starCores: this.starCores,
      starAttractors: this.starAttractors,
      snakeOccupancy: this.snakeOccupancy,
      pendingGrowthSegments: this.pendingGrowthSegments,
      includeStarAttractors: STAR_ATTRACTOR_ENABLED,
    };
  }

  private canAdvanceDirection(direction: Direction): boolean {
    return canAdvanceDirection(this.createSnakeMovementEvaluationContext(), direction);
  }

  private pickAdvanceDirection(primary: Direction, fallbacks: readonly Direction[] = []): { direction: Direction; primaryBlocked: boolean } {
    return pickAdvanceDirection(this.createSnakeMovementEvaluationContext(), primary, fallbacks);
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

  private collidesWithStarBeast(cell: GridCell): boolean {
    return this.starBeasts.some((beast) => beast.alive && beast.body.some((segment) => cellsMatch(segment, cell)));
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
