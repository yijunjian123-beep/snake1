import { createAudioController, type AudioController } from "./audio";
import { resolveBuildVersion } from "../buildInfo.js";
import {
  getBlackHoleFoodAvoidRadiusCells,
  resolveBlackHoleAlert,
  resolveBlackHoleMovement,
  type BlackHoleGravityState,
} from "./blackHole";
import {
  cellCollidesWithPlayerBody,
  resolveMultiplayerSnakeCollisions,
  resolveSnakeCollision,
  type MultiplayerSnakeEvaluation,
} from "./collisionSystem";
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
import { absorbStarAttractorSystem } from "./starAttractorSystem";
import { OPPOSITE_DIRECTIONS } from "./direction";
import {
  type ActiveDirectionalInput,
  type ActiveSpeedInput,
  type InputRuntimeState,
  type MatchRuntimeState,
  type MovementRuntimeState,
  type PlayerInputCommand,
  type PlayerRuntimeState,
  type MovementSpeedState,
  type ProgressRuntimeState,
  type RunLifecycleState,
  type SpeedCueState,
  type SpeedRuntimeState,
  type TimingRuntimeState,
  type SpawnRuntimeState,
  type UiSyncState,
  type WallGraceState,
  type WorldRuntimeState,
} from "./gameState";
import { createInputState, createLocalPvpPlayers, createMatchState, createOnlinePvpPlayers, createSoloPlayers, createSpawnState, createTimingState, createWorldState, resetTimingState } from "./stateFactory";
import {
  DEFAULT_REVIVE_COUNTDOWN_MS,
  canConfirmRevive,
  enterGameOverState,
  resolvePlayerDeathTransition,
  resolveReviveCountdown,
  startReviveCountdown,
} from "./reviveSystem";
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
  type PlayerSnapshotInput,
} from "./viewModel";
import { runTransientSimulation, type TransientSimulationContext } from "./simulationPipeline";
import { createPrng, createSeed } from "./random";
import {
  canAdvanceDirection,
  commitSnakeMovement,
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
  PlayerInputOrigin,
  Renderer,
  MatchMode,
  ShellView,
  SpeedCueMode,
  SpeedMode,
  StarAttractor,
  StarAttractorEffect,
  StarBeast,
  StarBeastEffect,
  StarCore,
  DeathReason,
  Unsubscribe,
  PlayerId,
} from "./types";
import { createPvpConnectionController, resolvePvpWebSocketUrl, type PvpConnectionController, type PvpConnectionControllerOptions } from "../pvp/net/usePvpConnection.js";
import type { PvpConnectionState } from "../pvp/net/state.js";
import type { ServerGameOverMessage, ServerPeerInputMessage, ServerSnapshotMessage } from "../pvp/net/protocol.js";
import {
  advancePvpTick,
  createPvpBoardGrid,
  createPvpRuntime,
  createPvpSnapshot,
  recordPvpInput,
  type PvpGameSnapshot,
  type PvpRuntimeState,
} from "../pvp/shared/pvpGame.js";

const STAR_ATTRACTOR_ENABLED = DEFAULT_UNLOCK_CONFIG.featureFlags.starAttractor;

interface GameOptions {
  canvas: HTMLCanvasElement;
  ui: GameUiElements;
  pvpConnectionOptions?: Partial<PvpConnectionControllerOptions>;
}

interface OnlinePvpSessionState {
  readonly localPlayerId: PlayerId;
  readonly inputDelayTicks: number;
  readonly seed: number;
  readonly startTick: number;
  readonly tickRate: number;
  runtime: PvpRuntimeState;
  latestSnapshot: PvpGameSnapshot | null;
  lastSnapshotHash: string | null;
  lastSnapshotTick: number;
  lastServerGameOver: ServerGameOverMessage | null;
  syncNotice: string | null;
  tickAccumulatorMs: number;
  nextSequence: number;
}

interface ResetMatchRunOptions {
  readonly seed?: number;
  readonly startTick?: number;
  readonly localPlayerId?: PlayerId;
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
const MIN_COLUMNS = 12;
const MAX_COLUMNS = 34;
const MIN_ROWS = 10;
const MAX_ROWS = 24;
const DEFAULT_TOP_MARGIN = 214;
const COMPACT_LANDSCAPE_TOP_MARGIN = 170;
const SHORT_SCREEN_TOP_MARGIN = 112;
const DEFAULT_HUD_GAP = 12;
const COMPACT_LANDSCAPE_HUD_GAP = 10;
const LOCAL_PVP_SEARCH_PARAM = "localPvp";

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

function createFixedPvpGrid(size: CanvasSize, topMargin: number): GridMetrics {
  const board = createPvpBoardGrid();
  const isCompactLandscape = isCompactLandscapeSize(size);
  const sideMargin = Math.max(14, Math.min(40, Math.floor(size.width * 0.05)));
  const bottomMargin = isCompactLandscape ? 104 : size.height < 430 ? 30 : 58;
  const availableWidth = Math.max(220, size.width - sideMargin * 2);
  const availableHeight = Math.max(size.height < 430 ? 150 : 180, size.height - topMargin - bottomMargin);
  const cellSize = Math.max(12, Math.floor(Math.min(availableWidth / board.columns, availableHeight / board.rows)));
  const boardWidth = board.columns * cellSize;
  const boardHeight = board.rows * cellSize;

  return createPvpBoardGrid(
    cellSize,
    Math.floor((size.width - boardWidth) / 2),
    Math.max(8, Math.floor(topMargin + (availableHeight - boardHeight) / 2)),
  );
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

function directionToInputAction(direction: Direction): InputAction {
  switch (direction) {
    case "up":
      return "move-up";
    case "right":
      return "move-right";
    case "down":
      return "move-down";
    case "left":
      return "move-left";
  }
}

function shouldStartInLocalPvpMode(): boolean {
  if (typeof window === "undefined") {
    return false;
  }

  try {
    return new URLSearchParams(window.location.search).get(LOCAL_PVP_SEARCH_PARAM) === "1";
  } catch {
    return false;
  }
}

function shouldShowPvpDebugMode(): boolean {
  if (typeof window === "undefined") {
    return false;
  }

  try {
    const searchParams = new URLSearchParams(window.location.search);
    return searchParams.get("debugPvp") === "1" || searchParams.get("debug") === "1";
  } catch {
    return false;
  }
}

export class Game {
  private readonly canvas: HTMLCanvasElement;
  private readonly ui: GameUiElements;
  private readonly renderer: Renderer;
  private readonly input: InputController;
  private readonly audio: AudioController;
  private readonly pvpConnection: PvpConnectionController;
  private readonly unsubscribers: Unsubscribe[] = [];
  private readonly activeDirectionalInputs = new Map<string, ActiveDirectionalInput>();
  private readonly activeSpeedInputs = new Map<string, ActiveSpeedInput>();
  private readonly bootMode: "solo" | "local-pvp";
  private readonly debugPvpVisible: boolean;
  private readonly buildVersion: string;
  private shellView: ShellView = "main-menu";
  private runMode: MatchMode = "solo";
  private roomNotice = "联机房间服务将在下一步接入；当前不会创建真实房间。";
  private isOnlinePvpSession = false;
  private onlineSession: OnlinePvpSessionState | null = null;
  private random = createPrng(createSeed());

  private match: MatchRuntimeState = createMatchState();
  private players: PlayerRuntimeState[] = createSoloPlayers();
  private grid: GridMetrics;
  private frameId: number | null = null;
  private timing: TimingRuntimeState = createTimingState();
  private world: WorldRuntimeState = createWorldState();
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

  private get primaryPlayer(): PlayerRuntimeState {
    const onlineSession = this.onlineSession;

    if (this.match.mode === "online-pvp" && onlineSession !== null) {
      const onlinePlayer = this.players.find((player) => player.id === onlineSession.localPlayerId);

      if (onlinePlayer) {
        return onlinePlayer;
      }
    }

    return this.players[0] ?? this.createFallbackPrimaryPlayer();
  }

  private createFallbackPrimaryPlayer(): PlayerRuntimeState {
    const [player] = createSoloPlayers("ready", 0);

    if (!player) {
      throw new Error("Failed to create primary player state.");
    }

    this.players = [player];
    return player;
  }

  private get lifecycle(): RunLifecycleState {
    return this.primaryPlayer.lifecycle;
  }

  private set lifecycle(value: RunLifecycleState) {
    this.primaryPlayer.lifecycle = value;
  }

  private get movement(): MovementRuntimeState {
    return this.primaryPlayer.movement;
  }

  private set movement(value: MovementRuntimeState) {
    this.primaryPlayer.movement = value;
  }

  private get speedRuntime(): SpeedRuntimeState {
    return this.primaryPlayer.speed;
  }

  private set speedRuntime(value: SpeedRuntimeState) {
    this.primaryPlayer.speed = value;
  }

  private get progress(): ProgressRuntimeState {
    return this.primaryPlayer.progress;
  }

  private set progress(value: ProgressRuntimeState) {
    this.primaryPlayer.progress = value;
  }

  private get phase(): GamePhase {
    return this.match.phase;
  }

  private set phase(value: GamePhase) {
    this.match.phase = value;
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

  private get lastSimulationMs(): number {
    return this.timing.lastSimulationMs;
  }

  private set lastSimulationMs(value: number) {
    this.timing.lastSimulationMs = value;
  }

  private get lastRenderMs(): number {
    return this.timing.lastRenderMs;
  }

  private set lastRenderMs(value: number) {
    this.timing.lastRenderMs = value;
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
    return this.primaryPlayer.snake;
  }

  private set snake(value: GridCell[]) {
    this.primaryPlayer.snake = value;
  }

  private get foods(): GridCell[] {
    return this.world.foods;
  }

  private set foods(value: GridCell[]) {
    this.world.foods = value;
  }

  private get starAttractors(): StarAttractor[] {
    return this.world.starAttractors;
  }

  private set starAttractors(value: StarAttractor[]) {
    this.world.starAttractors = value;
  }

  private get starAttractorEffects(): StarAttractorEffect[] {
    return this.world.starAttractorEffects;
  }

  private set starAttractorEffects(value: StarAttractorEffect[]) {
    this.world.starAttractorEffects = value;
  }

  private get starBeasts(): StarBeast[] {
    return this.world.starBeasts;
  }

  private set starBeasts(value: StarBeast[]) {
    this.world.starBeasts = value;
  }

  private get starCores(): StarCore[] {
    return this.world.starCores;
  }

  private set starCores(value: StarCore[]) {
    this.world.starCores = value;
  }

  private get starBeastEffects(): StarBeastEffect[] {
    return this.world.starBeastEffects;
  }

  private set starBeastEffects(value: StarBeastEffect[]) {
    this.world.starBeastEffects = value;
  }

  private get blackHoles(): BlackHole[] {
    return this.world.blackHoles;
  }

  private set blackHoles(value: BlackHole[]) {
    this.world.blackHoles = value;
  }

  private get blackHoleAlert(): GameSnapshot["blackHoleAlert"] {
    return this.world.blackHoleAlert;
  }

  private set blackHoleAlert(value: GameSnapshot["blackHoleAlert"]) {
    this.world.blackHoleAlert = value;
  }

  private get blackHoleGravityState(): BlackHoleGravityState {
    return this.world.blackHoleGravityState;
  }

  private set blackHoleGravityState(value: BlackHoleGravityState) {
    this.world.blackHoleGravityState = value;
  }

  private get blackHoleCue(): GameSnapshot["blackHoleCue"] {
    return this.world.blackHoleCue;
  }

  private set blackHoleCue(value: GameSnapshot["blackHoleCue"]) {
    this.world.blackHoleCue = value;
  }

  private get blackHoleRecoveryDirection(): Direction | null {
    return this.world.blackHoleRecoveryDirection;
  }

  private set blackHoleRecoveryDirection(value: Direction | null) {
    this.world.blackHoleRecoveryDirection = value;
  }

  private get rewardBurstOrigin(): GridCell | null {
    return this.world.rewardBurstOrigin;
  }

  private set rewardBurstOrigin(value: GridCell | null) {
    this.world.rewardBurstOrigin = value;
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

  public constructor(options: GameOptions) {
    this.canvas = options.canvas;
    this.ui = options.ui;
    this.renderer = createRenderer(this.canvas);
    this.input = createInputController({ target: window, touchControls: this.ui.touchControls });
    this.audio = createAudioController();
    this.debugPvpVisible = shouldShowPvpDebugMode();
    this.buildVersion = resolveBuildVersion();
    this.pvpConnection = createPvpConnectionController({
      url: options.pvpConnectionOptions?.url ?? resolvePvpWebSocketUrl(),
      socketFactory: options.pvpConnectionOptions?.socketFactory,
      now: options.pvpConnectionOptions?.now,
      reconnectDelayMs: options.pvpConnectionOptions?.reconnectDelayMs,
      maxReconnectAttempts: options.pvpConnectionOptions?.maxReconnectAttempts,
      sessionStorage: options.pvpConnectionOptions?.sessionStorage,
      onPeerInput: this.handlePeerInput,
      onSnapshot: this.handlePvpSnapshot,
      onGameOver: this.handlePvpGameOver,
    });
    this.unsubscribers.push(this.pvpConnection.subscribe(this.handlePvpConnectionState));
    this.bootMode = shouldStartInLocalPvpMode() ? "local-pvp" : "solo";
    this.runMode = this.bootMode;
    this.shellView = this.bootMode === "local-pvp" ? "active-run" : "main-menu";
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
    this.runMode = this.bootMode;
    this.shellView = this.bootMode === "local-pvp" ? "active-run" : "main-menu";
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
    this.pvpConnection.destroy();
    this.input.destroy();
    this.audio.destroy();
    this.renderer.destroy();
  }

  private readonly loop = (now: number): void => {
    const frameDelta = now - this.lastFrameTime;
    const delta = Math.min(50, frameDelta);
    this.lastFrameTime = now;
    this.elapsed += delta;

    const simulationStart = performance.now();

    if (this.phase === "playing") {
      this.playElapsed += delta;

      if (this.match.mode === "online-pvp") {
        this.advanceOnlinePvp(delta);
      } else if (this.match.mode === "local-pvp") {
        this.advanceLocalPvp(delta);
      } else {
        this.advanceSolo(delta);
      }
    } else if (this.phase === "reviving") {
      this.currentMovementSpeed = { mode: "base", multiplier: 1, stepMs: BASE_STEP_MS };
      this.updateReviveState();
    } else {
      this.currentMovementSpeed = { mode: "base", multiplier: 1, stepMs: BASE_STEP_MS };
    }

    this.lastSimulationMs = performance.now() - simulationStart;
    this.renderer.recordFrameTime(frameDelta);
    this.expireSpeedCue();
    this.updateTickerUi();
    const renderStart = performance.now();
    this.renderer.render({
      now,
      delta,
      frameDelta,
      elapsed: this.elapsed,
      phase: this.phase,
      snapshot: this.createSnapshot(),
    });
    this.lastRenderMs = performance.now() - renderStart;

    this.lastFps = frameDelta > 0 ? Math.round(1000 / frameDelta) : this.lastFps;
    this.syncUi(false);
    this.frameId = window.requestAnimationFrame(this.loop);
  };

  private advanceSolo(delta: number): void {
    this.stepAccumulator += delta;
    this.updateWallGraceState();

    if (this.phase !== "playing") {
      return;
    }

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

  private advanceLocalPvp(delta: number): void {
    for (const player of this.players) {
      const movementSpeed = this.getLocalPvpMovementSpeedState(player);
      player.movement.stepAccumulator += delta;
      player.speed.currentMovementSpeed = movementSpeed;
      this.updatePlayerSpeedCueState(player, movementSpeed);
    }

    let advanced = false;
    let guard = 0;

    while (this.phase === "playing" && this.hasLocalPvpPlayerReadyToMove() && guard < 8) {
      this.advanceLocalPvpTick(this.getLocalPvpReadyPlayers());
      advanced = true;
      guard += 1;
    }

    if (advanced && this.phase === "playing") {
      this.refillFoods();
      this.updateBlackHoleAlert(this.elapsed / 1000);
    }

    if (this.phase === "playing") {
      this.updateLocalPvpWorld();
    }
  }

  private advanceOnlinePvp(delta: number): void {
    const session = this.onlineSession;

    if (session === null) {
      return;
    }

    session.tickAccumulatorMs += delta;

    const tickIntervalMs = Math.max(1, Math.round(1_000 / session.tickRate));
    let advanced = false;
    let guard = 0;

    while (session.tickAccumulatorMs >= tickIntervalMs && guard < 8) {
      session.tickAccumulatorMs -= tickIntervalMs;
      guard += 1;
      advanced = true;

      const result = advancePvpTick(session.runtime);

      if (result.gameOver !== null && session.lastServerGameOver === null) {
        session.syncNotice = session.syncNotice ?? "等待服务端结算";
      }
    }

    this.syncOnlinePvpRuntimeState();

    if (!advanced && session.runtime.match.phase === "gameOver" && session.lastServerGameOver === null) {
      session.tickAccumulatorMs = 0;
    }
  }

  private syncOnlinePvpRuntimeState(options: { readonly authoritativeGameOver?: ServerGameOverMessage | null } = {}): void {
    const session = this.onlineSession;

    if (session === null) {
      return;
    }

    const runtime = session.runtime;
    const authoritativeGameOver = options.authoritativeGameOver ?? session.lastServerGameOver;

    this.grid = runtime.grid;
    this.match.mode = "online-pvp";
    this.match.tick = runtime.match.tick;
    this.match.winnerId = authoritativeGameOver === null
      ? null
      : authoritativeGameOver.winner === "draw"
        ? null
        : authoritativeGameOver.winner;
    this.match.phase = authoritativeGameOver === null ? "playing" : "gameOver";

    for (const runtimePlayer of runtime.players) {
      const appPlayer = this.players.find((player) => player.id === runtimePlayer.id);

      if (!appPlayer) {
        continue;
      }

      appPlayer.label = runtimePlayer.id.toUpperCase();
      appPlayer.inputOrigin = runtimePlayer.id === session.localPlayerId ? "local" : "remote";
      appPlayer.snake = runtimePlayer.snake.map((cell) => ({ ...cell }));
      appPlayer.movement.direction = runtimePlayer.movement.direction;
      appPlayer.movement.directionQueue = [...runtimePlayer.movement.directionQueue];
      appPlayer.movement.pendingGrowthSegments = runtimePlayer.movement.pendingGrowthSegments;
      appPlayer.lifecycle.phase = runtimePlayer.lifecycle.phase;
      appPlayer.lifecycle.deathReason = runtimePlayer.lifecycle.deathReason;
      appPlayer.lifecycle.birthCell = appPlayer.snake[0] ? { ...appPlayer.snake[0] } : appPlayer.lifecycle.birthCell;
      appPlayer.progress.score = runtimePlayer.progress.score;
      appPlayer.progress.coresEaten = runtimePlayer.progress.coresEaten;
    }

    this.rebuildAllPlayerSnakeOccupancy();
  }

  private applyOnlinePvpSnapshotCorrection(message: ServerSnapshotMessage): void {
    const session = this.onlineSession;

    if (session === null) {
      return;
    }

    const runtime = session.runtime;
    runtime.match.tick = message.tick;
    runtime.match.winnerId = null;

    if (message.phase === "finished") {
      runtime.match.phase = "gameOver";
    } else {
      runtime.match.phase = "playing";
    }

    for (const runtimePlayer of runtime.players) {
      const head = message.snakeHeads[runtimePlayer.id];
      const alive = message.alive[runtimePlayer.id];

      runtimePlayer.lifecycle.phase = alive ? "playing" : "gameOver";
      runtimePlayer.lifecycle.deathReason = alive ? null : runtimePlayer.lifecycle.deathReason ?? "unknown";

      if (head !== null && runtimePlayer.snake[0] !== undefined) {
        const deltaColumn = head.column - runtimePlayer.snake[0].column;
        const deltaRow = head.row - runtimePlayer.snake[0].row;

        runtimePlayer.snake = runtimePlayer.snake.map((cell) => ({
          column: cell.column + deltaColumn,
          row: cell.row + deltaRow,
        }));
      }

      this.rebuildOnlinePvpSnakeOccupancy(runtimePlayer, runtime.grid);
    }
  }

  private rebuildOnlinePvpSnakeOccupancy(player: PvpRuntimeState["players"][number], grid: GridMetrics): void {
    const cellCount = grid.columns * grid.rows;

    if (player.movement.snakeOccupancy.length !== cellCount) {
      player.movement.snakeOccupancy = new Uint8Array(cellCount);
    } else {
      player.movement.snakeOccupancy.fill(0);
    }

    for (const segment of player.snake) {
      if (segment.column < 0 || segment.column >= grid.columns || segment.row < 0 || segment.row >= grid.rows) {
        continue;
      }

      player.movement.snakeOccupancy[segment.row * grid.columns + segment.column] = 1;
    }
  }

  private recordOnlinePvpInput(playerId: PlayerId, tick: number, sequence: number, direction: Direction): boolean {
    const session = this.onlineSession;

    if (session === null) {
      return false;
    }

    return recordPvpInput(
      session.runtime.inputState,
      playerId,
      sequence,
      tick,
      direction,
      session.inputDelayTicks,
      Date.now(),
    );
  }

  private getLocalPvpMovementSpeedState(player: PlayerRuntimeState): MovementSpeedState {
    if (player.id === "p1") {
      const movementSpeed = this.getMovementSpeedState();
      this.currentMovementSpeed = movementSpeed;
      return movementSpeed;
    }

    return player.movement.isBoosting
      ? this.getMovementSpeedStateFromMode("boost")
      : this.getMovementSpeedStateFromMode("base");
  }

  private hasLocalPvpPlayerReadyToMove(): boolean {
    return this.players.some((player) =>
      player.lifecycle.phase === "playing"
      && player.movement.stepAccumulator >= player.speed.currentMovementSpeed.stepMs
    );
  }

  private getLocalPvpReadyPlayers(): Set<PlayerRuntimeState> {
    return new Set(this.players.filter((player) =>
      player.lifecycle.phase === "playing"
      && player.movement.stepAccumulator >= player.speed.currentMovementSpeed.stepMs
    ));
  }

  private updateLocalPvpWorld(): void {
    this.updateFoodWaves(this.playElapsed);
    this.updateStarBeastEffects(this.playElapsed / 1000);
    this.updateBlackHoleAlert(this.elapsed / 1000);
  }

  private advanceLocalPvpTick(readyPlayers: ReadonlySet<PlayerRuntimeState> = new Set(this.players)): void {
    this.match.tick += 1;
    this.applyQueuedInputCommandsForTick(this.match.tick);

    const evaluations: MultiplayerSnakeEvaluation[] = [];
    const intendedDirections = new Map<PlayerRuntimeState, Direction>();

    for (const player of this.players) {
      const willCommit = readyPlayers.has(player);
      const intendedDirection = this.resolveLocalPvpDirection(player);
      const context = this.createPlayerMovementEvaluationContext(player, { includeOpponentBodies: false });
      const selection = pickAdvanceDirection(context, intendedDirection, [player.movement.direction]);
      const evaluation = evaluateSnakeAdvance(context, selection.direction);

      if (!evaluation) {
        this.finishLocalPvpPlayer(player, "unknown");
        continue;
      }

      intendedDirections.set(player, selection.direction);
      evaluations.push({
        playerId: player.id,
        direction: selection.direction,
        evaluation,
        snake: player.snake,
        willCommit,
      });
    }

    const collisions = resolveMultiplayerSnakeCollisions({
      grid: this.grid,
      blackHoles: this.blackHoles,
      starBeasts: [],
      currentTime: this.elapsed / 1000,
    }, evaluations);

    for (const entry of evaluations) {
      const player = this.players.find((candidate) => candidate.id === entry.playerId);
      const direction = player ? intendedDirections.get(player) : null;
      const result = collisions.find((candidate) => candidate.playerId === entry.playerId);

      if (!player || !direction || !result) {
        continue;
      }

      if (!entry.willCommit) {
        continue;
      }

      if (result.collision.kind !== "none") {
        this.finishLocalPvpPlayer(player, result.collision.kind === "wall" ? "wall" : result.collision.reason);
        continue;
      }

      player.movement.direction = direction;
      player.movement.stepAccumulator -= player.speed.currentMovementSpeed.stepMs;
      const moveResult = commitSnakeMovement(
        {
          grid: this.grid,
          snake: player.snake,
          snakeOccupancy: player.movement.snakeOccupancy,
          pendingGrowthSegments: player.movement.pendingGrowthSegments,
        },
        entry.evaluation,
      );

      player.movement.pendingGrowthSegments = moveResult.pendingGrowthSegments;

      if (!result.pickupConflict && moveResult.pickup?.kind === "food") {
        this.foods.splice(moveResult.pickup.index, 1);
        this.handleLocalPvpCoreCollection(player, moveResult.nextHead);
      } else if (!result.pickupConflict && moveResult.pickup?.kind === "starCore") {
        this.starCores.splice(moveResult.pickup.index, 1);
        this.handleLocalPvpCoreCollection(player, moveResult.nextHead);
      }
    }

    this.resolveLocalPvpWinner();
  }

  private resolveLocalPvpDirection(player: PlayerRuntimeState): Direction {
    if (this.match.mode === "online-pvp") {
      return player.movement.directionQueue.shift() ?? player.movement.direction;
    }

    if (player.id === "p1") {
      return player.movement.directionQueue.shift() ?? player.movement.direction;
    }

    return this.pickScriptedPvpDirection(player);
  }

  private applyQueuedInputCommandsForTick(tick: number): void {
    for (const player of this.players) {
      this.applyQueuedInputCommandsForPlayer(player, tick);
    }

    for (let index = this.inputState.queue.length - 1; index >= 0; index -= 1) {
      const command = this.inputState.queue[index];

      if (!command || command.tick > tick) {
        continue;
      }

      this.inputState.queue.splice(index, 1);
    }
  }

  private applyQueuedInputCommandsForPlayer(player: PlayerRuntimeState, tick: number): void {
    let lastAppliedSequence = this.inputState.lastAppliedSequenceByPlayer[player.id] ?? 0;

    for (const command of this.inputState.queue) {
      if (command.playerId !== player.id || command.tick > tick) {
        continue;
      }

      if (command.kind === "pressed") {
        const direction = directionFromAction(command.action);

        if (direction) {
          this.queuePlayerDirection(player, direction);
        } else if (command.action === "boost") {
          player.movement.isBoosting = true;
        }
      } else if (command.action === "boost") {
        player.movement.isBoosting = false;
      }

      lastAppliedSequence = Math.max(lastAppliedSequence, command.sequence);
    }

    this.inputState.lastAppliedSequenceByPlayer[player.id] = lastAppliedSequence;
    this.inputState.lastProcessedTickByPlayer[player.id] = tick;
  }

  private pickScriptedPvpDirection(player: PlayerRuntimeState): Direction {
    const head = player.snake[0];

    if (!head) {
      return player.movement.direction;
    }

    const target = this.findNearestFood(head);
    const horizontal: Direction | null = target && target.column !== head.column
      ? target.column > head.column ? "right" : "left"
      : null;
    const vertical: Direction | null = target && target.row !== head.row
      ? target.row > head.row ? "down" : "up"
      : null;
    const candidates: Direction[] = [
      ...(horizontal ? [horizontal] : []),
      ...(vertical ? [vertical] : []),
      player.movement.direction,
      "up",
      "right",
      "down",
      "left",
    ];
    const context = this.createPlayerMovementEvaluationContext(player, { includeOpponentBodies: true });

    for (const direction of candidates) {
      if (direction === OPPOSITE_DIRECTIONS[player.movement.direction]) {
        continue;
      }

      if (canAdvanceDirection(context, direction)) {
        return direction;
      }
    }

    return player.movement.direction;
  }

  private findNearestFood(origin: GridCell): GridCell | null {
    let nearest: GridCell | null = null;
    let nearestDistance = Number.POSITIVE_INFINITY;

    for (const food of this.foods) {
      const distance = Math.abs(food.column - origin.column) + Math.abs(food.row - origin.row);

      if (distance < nearestDistance) {
        nearest = food;
        nearestDistance = distance;
      }
    }

    return nearest;
  }

  private handleLocalPvpCoreCollection(player: PlayerRuntimeState, rewardBurstOrigin: GridCell): void {
    this.rewardBurstOrigin = { ...rewardBurstOrigin };
    player.progress.coresEaten += 1;
    player.progress.score += SCORE_PER_CORE;
    this.refreshBlackHoles();
    this.updateBlackHoleAlert(this.elapsed / 1000);
    this.syncUi(true);
  }

  private finishLocalPvpPlayer(player: PlayerRuntimeState, reason: DeathReason): void {
    player.lifecycle.deathReason = reason;
    player.lifecycle.phase = "gameOver";
  }

  private resolveLocalPvpWinner(): void {
    const alivePlayers = this.players.filter((player) => player.lifecycle.phase === "playing");

    if (alivePlayers.length > 1 || this.phase === "gameOver") {
      return;
    }

    this.match.winnerId = alivePlayers[0]?.id ?? null;
    this.phase = "gameOver";
    this.syncUi(true);
  }

  private readonly handleResize = (): void => {
    const size = this.renderer.resize();
    this.grid = this.match.mode === "online-pvp" ? this.buildOnlinePvpGrid(size) : this.buildGrid(size);

    if (this.match.mode === "online-pvp") {
      if (this.onlineSession) {
        this.onlineSession.runtime.grid = this.grid;
      }

      this.syncUi(true, size);
      return;
    }

    if ((this.phase === "playing" || this.phase === "paused" || this.phase === "ready") && !isCurrentPlacementValid({
      grid: this.grid,
      blackHoles: this.blackHoles,
      snake: this.getPlayerOccupiedCells(),
      foods: this.foods,
      starAttractors: this.starAttractors,
      starBeasts: this.starBeasts,
      starCores: this.starCores,
      includeStarAttractors: STAR_ATTRACTOR_ENABLED,
    })) {
      this.resetRun(this.phase === "paused" ? "paused" : this.phase);
    } else {
      this.rebuildAllPlayerSnakeOccupancy();
    }

    this.syncUi(true, size);
  };

  private readonly handleInput = (command: InputCommand): void => {
    if (this.shellView === "main-menu" || this.shellView === "pvp-room") {
      return;
    }

    if (this.match.mode === "online-pvp") {
      this.handleOnlinePvpInput(command);
      return;
    }

    this.enqueueInputCommand(command, "local");

    if (this.match.mode === "local-pvp") {
      this.handleLocalPvpInput(command);
      return;
    }

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
      this.continueRun();
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

  private handleOnlinePvpInput(command: InputCommand): void {
    if (command.kind !== "pressed") {
      return;
    }

    const direction = directionFromAction(command.action);

    if (!direction || this.onlineSession === null || this.onlineSession.runtime.match.phase === "gameOver") {
      return;
    }

    const session = this.onlineSession;
    const playerId = session.localPlayerId;
    const scheduledTick = session.runtime.match.tick + session.inputDelayTicks;
    const sequence = session.nextSequence;
    session.nextSequence += 1;

    const accepted = this.recordOnlinePvpInput(playerId, scheduledTick, sequence, direction);

    if (!accepted) {
      return;
    }

    this.queuePlayerInputCommand({
      playerId,
      tick: scheduledTick,
      action: command.action,
      kind: command.kind,
      origin: "local",
      sequence,
    });

    this.pvpConnection.sendInput({
      type: "input",
      seq: sequence,
      tick: scheduledTick,
      direction,
    });
  }

  private handleLocalPvpInput(command: InputCommand): void {
    if (command.kind !== "pressed") {
      return;
    }

    if (command.action === "start") {
      this.continueRun();
      return;
    }

    if (command.action === "pause") {
      this.togglePause();
      return;
    }

    if (command.action === "restart") {
      this.restartRun();
    }
  }

  private enqueueInputCommand(command: InputCommand, origin: PlayerInputOrigin): void {
    this.activeInputSequence += 1;
    this.queuePlayerInputCommand({
      playerId: command.playerId ?? "p1",
      tick: this.match.tick,
      action: command.action,
      kind: command.kind,
      origin,
      sequence: this.activeInputSequence,
    });
  }

  private queuePlayerInputCommand(command: PlayerInputCommand): boolean {
    const lastProcessedTick = this.inputState.lastProcessedTickByPlayer[command.playerId] ?? -1;
    const seenSequences = this.inputState.seenSequencesByPlayer[command.playerId] ?? new Set<number>();

    if (command.tick <= lastProcessedTick || seenSequences.has(command.sequence)) {
      return false;
    }

    seenSequences.add(command.sequence);
    this.inputState.seenSequencesByPlayer[command.playerId] = seenSequences;
    this.inputState.lastReceivedSequenceByPlayer[command.playerId] = Math.max(
      this.inputState.lastReceivedSequenceByPlayer[command.playerId] ?? 0,
      command.sequence,
    );

    const insertionIndex = this.inputState.queue.findIndex((existing) => {
      if (existing.tick !== command.tick) {
        return existing.tick > command.tick;
      }

      if (existing.sequence !== command.sequence) {
        return existing.sequence > command.sequence;
      }

      return existing.playerId > command.playerId;
    });

    if (insertionIndex === -1) {
      this.inputState.queue.push(command);
    } else {
      this.inputState.queue.splice(insertionIndex, 0, command);
    }

    if (this.inputState.queue.length > 96) {
      this.inputState.queue.splice(0, this.inputState.queue.length - 96);
    }

    return true;
  }

  private readonly handleStartPointer = (event: PointerEvent): void => {
    event.preventDefault();

    this.continueRun();
  };

  private readonly handlePvePointer = (event: PointerEvent): void => {
    event.preventDefault();
    this.startPveRun();
  };

  private readonly handlePvpPointer = (event: PointerEvent): void => {
    event.preventDefault();
    this.openPvpRoomPanel();
  };

  private readonly handleCreateRoomPointer = (event: PointerEvent): void => {
    event.preventDefault();
    this.pvpConnection.createPrivateRoom();
  };

  private readonly handleJoinRoomPointer = (event: PointerEvent): void => {
    event.preventDefault();

    if (this.pvpConnection.getState().flow === "join" && this.pvpConnection.getState().roomCode === null) {
      this.pvpConnection.joinPrivateRoom();
      return;
    }

    this.pvpConnection.openJoinRoomEntry();
  };

  private readonly handleReadyRoomPointer = (event: PointerEvent): void => {
    event.preventDefault();
    this.pvpConnection.toggleReady();
  };

  private readonly handleCancelMatchmakingPointer = (event: PointerEvent): void => {
    event.preventDefault();
    this.pvpConnection.cancelMatchmaking();
  };

  private readonly handleCopyRoomCodePointer = (event: PointerEvent): void => {
    event.preventDefault();
    const roomCode = this.pvpConnection.getState().roomCode;

    if (!roomCode || typeof navigator === "undefined" || navigator.clipboard?.writeText === undefined) {
      return;
    }

    void navigator.clipboard.writeText(roomCode).catch(() => undefined);
  };

  private readonly handleRoomCodeInput = (): void => {
    this.pvpConnection.updateJoinCode(this.ui.roomCodeInput.value);
    this.syncUi(true);
  };

  private readonly handleContinuePointer = (event: PointerEvent): void => {
    event.preventDefault();
    this.continueRun();
  };

  private readonly handleMainMenuPointer = (event: PointerEvent): void => {
    event.preventDefault();
    this.returnToMainMenu();
  };

  private readonly handleRoomBackPointer = (event: PointerEvent): void => {
    event.preventDefault();
    this.returnToMainMenu();
  };

  private readonly handlePausePointer = (event: PointerEvent): void => {
    event.preventDefault();
    this.togglePause();
  };

  private readonly handlePvpConnectionState = (pvpState: PvpConnectionState): void => {
    if (pvpState.status === "playing" && this.shellView === "pvp-room" && !this.isOnlinePvpSession) {
      this.startOnlinePvpRun();
      return;
    }

    this.syncUi(true);
  };

  private readonly handlePvpSnapshot = (message: ServerSnapshotMessage): void => {
    if (this.match.mode !== "online-pvp" || this.onlineSession === null) {
      return;
    }

    const session = this.onlineSession;
    const predictedSnapshot = createPvpSnapshot(session.runtime);

    session.latestSnapshot = {
      phase: message.phase,
      tick: message.tick,
      stateHash: message.stateHash,
      snakeHeads: message.snakeHeads,
      alive: message.alive,
    };
    session.lastSnapshotHash = message.stateHash;
    session.lastSnapshotTick = message.tick;

    if (predictedSnapshot.stateHash !== message.stateHash) {
      session.syncNotice = `同步修正 tick ${message.tick}`;
      this.applyOnlinePvpSnapshotCorrection(message);
    } else if (session.syncNotice !== null) {
      session.syncNotice = null;
    }

    this.syncOnlinePvpRuntimeState();
    this.syncUi(true);
  };

  private readonly handlePvpGameOver = (message: ServerGameOverMessage): void => {
    if (this.match.mode !== "online-pvp" || this.onlineSession === null) {
      return;
    }

    const session = this.onlineSession;
    session.lastServerGameOver = message;
    session.syncNotice = null;
    session.runtime.match.phase = "gameOver";
    session.runtime.match.winnerId = message.winner === "draw" ? null : message.winner;
    session.runtime.match.tick = message.finalTick;
    this.syncOnlinePvpRuntimeState({ authoritativeGameOver: message });
    this.syncUi(true);
  };

  private readonly handlePeerInput = (message: ServerPeerInputMessage): void => {
    if (this.match.mode !== "online-pvp" || this.onlineSession === null) {
      return;
    }

    const playerId = message.playerSlot;

    if (playerId === this.onlineSession.localPlayerId) {
      return;
    }

    const accepted = this.recordOnlinePvpInput(playerId, message.tick, message.seq, message.direction);

    if (!accepted) {
      return;
    }

    this.queuePlayerInputCommand({
      playerId,
      tick: message.tick,
      action: directionToInputAction(message.direction),
      kind: "pressed",
      origin: "remote",
      sequence: message.seq,
    });
  };

  private buildPvpDebugInput(): {
    visible: boolean;
    localTick: number;
    remoteInputLag: number;
    bufferedInputs: number;
    connectionState: string;
    playerSlot: string | null;
  } | null {
    if (!this.debugPvpVisible) {
      return null;
    }

    const connectionState = this.pvpConnection.getState();
    const playerSlot = connectionState.playerSlot;
    const localPlayerId = this.onlineSession?.localPlayerId ?? playerSlot;
    const remotePlayerId = localPlayerId === "p1" ? "p2" : "p1";
    let nextRemoteInputTick = Number.POSITIVE_INFINITY;

    for (const command of this.inputState.queue) {
      if (command.playerId !== remotePlayerId) {
        continue;
      }

      nextRemoteInputTick = Math.min(nextRemoteInputTick, command.tick);
    }

    return {
      visible: true,
      localTick: this.match.tick,
      remoteInputLag: Number.isFinite(nextRemoteInputTick) ? Math.max(0, nextRemoteInputTick - this.match.tick) : 0,
      bufferedInputs: this.inputState.queue.length,
      connectionState: connectionState.status,
      playerSlot,
    };
  }

  private bindUi(): void {
    this.ui.startButton.addEventListener("pointerup", this.handleStartPointer);
    this.ui.pveButton.addEventListener("pointerup", this.handlePvePointer);
    this.ui.pvpButton.addEventListener("pointerup", this.handlePvpPointer);
    this.ui.continueButton.addEventListener("pointerup", this.handleContinuePointer);
    this.ui.mainMenuButton.addEventListener("pointerup", this.handleMainMenuPointer);
    this.ui.roomBackButton.addEventListener("pointerup", this.handleRoomBackPointer);
    this.ui.createRoomButton.addEventListener("pointerup", this.handleCreateRoomPointer);
    this.ui.joinRoomButton.addEventListener("pointerup", this.handleJoinRoomPointer);
    this.ui.readyRoomButton.addEventListener("pointerup", this.handleReadyRoomPointer);
    this.ui.cancelMatchmakingButton.addEventListener("pointerup", this.handleCancelMatchmakingPointer);
    this.ui.copyRoomCodeButton.addEventListener("pointerup", this.handleCopyRoomCodePointer);
    this.ui.roomCodeInput.addEventListener("input", this.handleRoomCodeInput);
    this.ui.pauseButton.addEventListener("pointerup", this.handlePausePointer);
  }

  private unbindUi(): void {
    this.ui.startButton.removeEventListener("pointerup", this.handleStartPointer);
    this.ui.pveButton.removeEventListener("pointerup", this.handlePvePointer);
    this.ui.pvpButton.removeEventListener("pointerup", this.handlePvpPointer);
    this.ui.continueButton.removeEventListener("pointerup", this.handleContinuePointer);
    this.ui.mainMenuButton.removeEventListener("pointerup", this.handleMainMenuPointer);
    this.ui.roomBackButton.removeEventListener("pointerup", this.handleRoomBackPointer);
    this.ui.createRoomButton.removeEventListener("pointerup", this.handleCreateRoomPointer);
    this.ui.joinRoomButton.removeEventListener("pointerup", this.handleJoinRoomPointer);
    this.ui.readyRoomButton.removeEventListener("pointerup", this.handleReadyRoomPointer);
    this.ui.cancelMatchmakingButton.removeEventListener("pointerup", this.handleCancelMatchmakingPointer);
    this.ui.copyRoomCodeButton.removeEventListener("pointerup", this.handleCopyRoomCodePointer);
    this.ui.roomCodeInput.removeEventListener("input", this.handleRoomCodeInput);
    this.ui.pauseButton.removeEventListener("pointerup", this.handlePausePointer);
  }

  private startPveRun(): void {
    this.runMode = "solo";
    this.isOnlinePvpSession = false;
    this.onlineSession = null;
    this.shellView = "active-run";
    this.pvpConnection.disconnect();
    this.roomNotice = "联机房间服务将在下一步接入；当前不会创建真实房间。";
    this.beginRun();
  }

  private openPvpRoomPanel(): void {
    this.runMode = "solo";
    this.isOnlinePvpSession = false;
    this.onlineSession = null;
    this.shellView = "pvp-room";
    this.roomNotice = "点击 PVP 后会自动连接服务并开始匹配。";
    this.resetMatchRun("solo", "ready");
    this.pvpConnection.enterMatchmaking();
  }

  private continueRun(): void {
    if (this.shellView !== "active-run") {
      return;
    }

    if (this.phase === "revivePrompt") {
      this.confirmRevive();
      return;
    }

    if (this.phase === "ready" || this.phase === "gameOver") {
      this.beginRun();
    }
  }

  private returnToMainMenu(): void {
    this.runMode = "solo";
    this.isOnlinePvpSession = false;
    this.onlineSession = null;
    this.shellView = "main-menu";
    this.pvpConnection.disconnect();
    this.roomNotice = "联机房间服务将在下一步接入；当前不会创建真实房间。";
    this.resetMatchRun("solo", "ready");
  }

  private beginRun(): void {
    if (this.phase !== "ready" && this.phase !== "gameOver") {
      return;
    }

    this.audio.unlock();
    this.audio.playUiPulse();
    this.resetRun("playing");
  }

  private startOnlinePvpRun(): void {
    const connectionState = this.pvpConnection.getState();
    const gameStart = connectionState.gameStart;

    if (!gameStart || connectionState.playerSlot === null) {
      return;
    }

    this.runMode = "online-pvp";
    this.shellView = "active-run";
    this.isOnlinePvpSession = true;
    this.roomNotice = "在线对局已开始";
    this.grid = this.buildOnlinePvpGrid(this.renderer.getSize());
    this.random = createPrng(gameStart.seed);
    this.match = createMatchState("online-pvp", "playing");
    this.match.tick = gameStart.startTick;
    this.players = createOnlinePvpPlayers(connectionState.playerSlot, "playing");
    this.timing = resetTimingState(createTimingState());
    this.world = createWorldState();
    this.spawn = createSpawnState();
    this.inputState = createInputState();
    this.inputState.lastProcessedTickByPlayer.p1 = gameStart.startTick - 1;
    this.inputState.lastProcessedTickByPlayer.p2 = gameStart.startTick - 1;
    this.activeDirectionalInputs.clear();
    this.activeSpeedInputs.clear();
    this.speedRuntime.currentMovementSpeed = { mode: "base", multiplier: 1, stepMs: BASE_STEP_MS };
    const runtime = createPvpRuntime({
      seed: gameStart.seed,
      startTick: gameStart.startTick,
      tickRate: gameStart.tickRate,
      inputDelayTicks: gameStart.inputDelayTicks,
      grid: this.grid,
      mode: "online-pvp",
    });
    this.onlineSession = {
      localPlayerId: connectionState.playerSlot,
      inputDelayTicks: gameStart.inputDelayTicks,
      seed: gameStart.seed,
      startTick: gameStart.startTick,
      tickRate: gameStart.tickRate,
      runtime,
      latestSnapshot: null,
      lastSnapshotHash: null,
      lastSnapshotTick: gameStart.startTick,
      lastServerGameOver: null,
      syncNotice: null,
      tickAccumulatorMs: 0,
      nextSequence: 1,
    };
    this.syncOnlinePvpRuntimeState();
    this.syncUi(true);
  }

  private restartRun(): void {
    if (this.shellView !== "active-run") {
      return;
    }

    if (this.match.mode === "online-pvp") {
      return;
    }

    this.audio.unlock();
    this.audio.playUiPulse();
    this.resetRun("playing");
  }

  private togglePause(): void {
    if (this.phase !== "playing" && this.phase !== "paused") {
      return;
    }

    if (this.match.mode === "online-pvp") {
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
    this.updatePlayerSpeedCueState(this.primaryPlayer, movementSpeed);
  }

  private updatePlayerSpeedCueState(player: PlayerRuntimeState, movementSpeed: MovementSpeedState): void {
    if (movementSpeed.mode !== player.speed.lastMovementSpeedMode) {
      player.speed.lastMovementSpeedMode = movementSpeed.mode;

      if (movementSpeed.mode !== "base") {
        const head = player.snake[0];

        if (head) {
          player.speed.speedCue = {
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
    this.queuePlayerDirection(this.primaryPlayer, direction);
  }

  private queuePlayerDirection(player: PlayerRuntimeState, direction: Direction): void {
    if (this.phase !== "playing" || player.lifecycle.phase !== "playing") {
      return;
    }

    if (player.lifecycle.wallGrace) {
      if (direction === OPPOSITE_DIRECTIONS[player.movement.direction]) {
        return;
      }

      if (!this.canPlayerAdvanceDirection(player, direction)) {
        return;
      }

      player.movement.directionQueue = [direction];
      return;
    }

    const lastQueuedDirection = player.movement.directionQueue[player.movement.directionQueue.length - 1]
      ?? player.movement.direction;

    if (
      direction === lastQueuedDirection ||
      direction === OPPOSITE_DIRECTIONS[lastQueuedDirection] ||
      player.movement.directionQueue.length >= MAX_DIRECTION_QUEUE_LENGTH
    ) {
      return;
    }

    if (!this.canPlayerAdvanceDirection(player, direction)) {
      return;
    }

    player.movement.directionQueue.push(direction);
  }

  private resetRun(phase: GamePhase): void {
    this.resetMatchRun(this.runMode, phase);
  }

  private resetMatchRun(mode: MatchMode, phase: GamePhase, options: ResetMatchRunOptions = {}): void {
    const seed = options.seed ?? createSeed();
    const startTick = options.startTick ?? 0;
    const localPlayerId = options.localPlayerId ?? "p1";

    this.random = createPrng(seed);
    this.match = createMatchState(mode, phase);
    this.match.tick = startTick;
    this.players = mode === "local-pvp"
      ? createLocalPvpPlayers(phase)
      : mode === "online-pvp"
        ? createOnlinePvpPlayers(localPlayerId, phase)
        : createSoloPlayers(phase, this.highScore);
    this.timing = resetTimingState(createTimingState());
    this.world = createWorldState();
    this.spawn = createSpawnState();
    this.inputState = createInputState();
    this.inputState.lastProcessedTickByPlayer.p1 = startTick - 1;
    this.inputState.lastProcessedTickByPlayer.p2 = startTick - 1;
    this.activeDirectionalInputs.clear();
    this.activeSpeedInputs.clear();
    this.placeStartingPlayers(mode, localPlayerId);
    this.world.foods = this.createFoods();
    this.progress.score = 0;
    this.progress.coresEaten = 0;
    this.spawn.starAttractorNeed = STAR_ATTRACTOR_ENABLED ? rollStarAttractorNeed(this.spawn.starAttractorNeedIndex, this.random) : 0;
    this.speedRuntime.currentMovementSpeed = { mode: "base", multiplier: 1, stepMs: BASE_STEP_MS };
    this.rebuildSnakeOccupancy();
    this.syncUi(true);
  }

  private placeStartingPlayers(mode: MatchMode, localPlayerId: PlayerId = "p1"): void {
    if (mode === "local-pvp") {
      this.placeLocalPvpPlayers();
      return;
    }

    if (mode === "online-pvp") {
      this.placeOnlinePvpPlayers(localPlayerId);
      return;
    }

    this.snake = this.createStartingSnake();
    this.lifecycle.birthCell = this.snake[0] ? { ...this.snake[0] } : { column: 0, row: 0 };
  }

  private placeOnlinePvpPlayers(localPlayerId: PlayerId): void {
    const localPlayer = this.players.find((player) => player.id === localPlayerId);
    const remotePlayer = this.players.find((player) => player.id !== localPlayerId);

    if (!localPlayer || !remotePlayer) {
      return;
    }

    const localIsFirst = localPlayerId === "p1";
    const firstHead = {
      column: Math.max(STARTING_LENGTH, Math.floor(this.grid.columns * 0.32)),
      row: Math.floor(this.grid.rows / 2),
    };
    const secondHead = {
      column: Math.min(this.grid.columns - STARTING_LENGTH - 1, Math.ceil(this.grid.columns * 0.68)),
      row: Math.floor(this.grid.rows / 2),
    };

    const localHead = localIsFirst ? firstHead : secondHead;
    const remoteHead = localIsFirst ? secondHead : firstHead;
    const localDirection = localIsFirst ? "right" : "left";
    const remoteDirection = localIsFirst ? "left" : "right";

    localPlayer.snake = this.createStartingSnakeFrom(localHead, localDirection);
    localPlayer.movement.direction = localDirection;
    localPlayer.lifecycle.birthCell = { ...localHead };

    remotePlayer.snake = this.createStartingSnakeFrom(remoteHead, remoteDirection);
    remotePlayer.movement.direction = remoteDirection;
    remotePlayer.lifecycle.birthCell = { ...remoteHead };

    for (const player of this.players) {
      this.rebuildPlayerSnakeOccupancy(player);
    }
  }

  private placeLocalPvpPlayers(): void {
    const firstPlayer = this.players[0];
    const secondPlayer = this.players[1];

    if (!firstPlayer || !secondPlayer) {
      return;
    }

    const firstHead = {
      column: Math.max(STARTING_LENGTH, Math.floor(this.grid.columns * 0.32)),
      row: Math.floor(this.grid.rows / 2),
    };
    const secondHead = {
      column: Math.min(this.grid.columns - STARTING_LENGTH - 1, Math.ceil(this.grid.columns * 0.68)),
      row: Math.floor(this.grid.rows / 2),
    };

    firstPlayer.snake = this.createStartingSnakeFrom(firstHead, "right");
    firstPlayer.movement.direction = "right";
    firstPlayer.lifecycle.birthCell = { ...firstHead };
    secondPlayer.snake = this.createStartingSnakeFrom(secondHead, "left");
    secondPlayer.movement.direction = "left";
    secondPlayer.lifecycle.birthCell = { ...secondHead };

    for (const player of this.players) {
      this.rebuildPlayerSnakeOccupancy(player);
    }
  }

  private handlePlayerDeath(reason: DeathReason): void {
    const transition = resolvePlayerDeathTransition(this.lifecycle, reason);
    this.match.phase = this.lifecycle.phase;

    if (transition === "revivePrompt") {
      this.resetTransientRunState();
      this.syncUi(true);
    } else if (transition === "gameOver") {
      this.resetTransientRunState();
      this.saveHighScoreIfNeeded();
      this.syncUi(true);
    }
  }

  private confirmRevive(): void {
    if (!canConfirmRevive(this.lifecycle)) {
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
      random: this.random,
    });

    if (!placement) {
      this.livesRemaining = 0;
      this.finishGameOver(this.deathReason ?? "unknown");
      return;
    }

    this.applyRevivePlacement(placement);
    if (startReviveCountdown(this.lifecycle, this.elapsed, DEFAULT_REVIVE_COUNTDOWN_MS)) {
      this.match.phase = this.lifecycle.phase;
    }
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
    if (resolveReviveCountdown(this.lifecycle, this.elapsed) === "completed") {
      this.match.phase = this.lifecycle.phase;
      this.syncUi(true);
    }
  }

  private finishGameOver(reason: DeathReason | null = null): void {
    enterGameOverState(this.lifecycle, reason);
    this.match.phase = this.lifecycle.phase;
    this.resetTransientRunState();
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

  private getPlayerOccupiedCells(): GridCell[] {
    return this.players.flatMap((player) => player.snake);
  }

  private createStartingSnake(): GridCell[] {
    const headColumn = Math.floor(this.grid.columns / 2);
    const headRow = Math.floor(this.grid.rows / 2);

    return this.createStartingSnakeFrom({ column: headColumn, row: headRow }, "right");
  }

  private createStartingSnakeFrom(head: GridCell, direction: Direction): GridCell[] {
    const offset = direction === "right"
      ? { column: -1, row: 0 }
      : direction === "left"
        ? { column: 1, row: 0 }
        : direction === "down"
          ? { column: 0, row: -1 }
          : { column: 0, row: 1 };

    return Array.from({ length: STARTING_LENGTH }, (_, index) => ({
      column: head.column + offset.column * index,
      row: head.row + offset.row * index,
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
      snake: this.getPlayerOccupiedCells(),
      foods: this.foods,
      starAttractors: this.starAttractors,
      starBeasts: this.starBeasts,
      starCores: this.starCores,
      includeStarAttractors: STAR_ATTRACTOR_ENABLED,
      extraBlockedCells: extraBlocked,
    }), this.random);
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

    const collision = resolveSnakeCollision(
      {
        blackHoles: this.blackHoles,
        starBeasts: this.starBeasts,
        currentTime,
      },
      evaluation,
      this.direction,
    );

    if (collision.kind === "wall") {
      this.startWallGrace(collision.direction);
      return;
    }

    if (collision.kind === "death") {
      this.handlePlayerDeath(collision.reason);
      return;
    }

    const moveResult = commitSnakeMovement(
      {
        grid: this.grid,
        snake: this.snake,
        snakeOccupancy: this.snakeOccupancy,
        pendingGrowthSegments: this.pendingGrowthSegments,
      },
      evaluation,
    );
    this.pendingGrowthSegments = moveResult.pendingGrowthSegments;

    if (moveResult.pickup?.kind === "food") {
      this.foods.splice(moveResult.pickup.index, 1);
      this.handleCoreCollection(currentTime, 1, true, moveResult.nextHead);
    } else if (moveResult.pickup?.kind === "starCore") {
      this.starCores.splice(moveResult.pickup.index, 1);
      this.handleCoreCollection(currentTime, 1, false, moveResult.nextHead);
    } else if (moveResult.pickup?.kind === "starAttractor") {
      this.starAttractors.splice(moveResult.pickup.index, 1);
      this.absorbStarAttractor(moveResult.nextHead, currentTime);
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
        random: this.random,
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
      random: this.random,
    });
  }

  private absorbStarAttractor(attractorCell: GridCell, currentTime: number): void {
    const result = absorbStarAttractorSystem({
      enabled: STAR_ATTRACTOR_ENABLED,
      attractorCell,
      currentTime,
      foods: this.foods,
      snakeHead: this.snake[0] ?? null,
      birthCell: this.birthCell,
      starAttractorEffects: this.starAttractorEffects,
      spawnState: this.spawn,
    });

    if (!result) {
      return;
    }

    if (result.absorbCount > 0) {
      this.pendingGrowthSegments += result.pendingGrowthDelta;
      this.handleCoreCollection(currentTime, result.absorbCount, false, attractorCell);
    } else {
      this.saveHighScoreIfNeeded();
      this.refreshBlackHoles();
      this.refillFoods();
      this.updateBlackHoleAlert(currentTime);
      this.syncUi(true);
    }

    this.audio.playRewardPulse(result.absorbCount);
  }

  private refreshBlackHoles(): void {
    refreshBlackHoleSpawnSystem({
      grid: this.grid,
      progress: this.getProgress(),
      snake: this.getPlayerOccupiedCells(),
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
      random: this.random,
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
      random: this.random,
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
        snake: this.getPlayerOccupiedCells(),
        foods: this.foods,
        starAttractors: this.starAttractors,
        starBeasts: this.starBeasts,
        starCores: this.starCores,
        includeStarAttractors: STAR_ATTRACTOR_ENABLED,
      }),
      foods: this.foods,
      state: this.spawn,
      currentTimeMs,
      random: this.random,
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
      random: this.random,
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
    this.rebuildPlayerSnakeOccupancy(this.primaryPlayer);
  }

  private rebuildAllPlayerSnakeOccupancy(): void {
    for (const player of this.players) {
      this.rebuildPlayerSnakeOccupancy(player);
    }
  }

  private rebuildPlayerSnakeOccupancy(player: PlayerRuntimeState): void {
    const cellCount = this.grid.columns * this.grid.rows;

    if (player.movement.snakeOccupancy.length !== cellCount) {
      player.movement.snakeOccupancy = new Uint8Array(cellCount);
    } else {
      player.movement.snakeOccupancy.fill(0);
    }

    for (const segment of player.snake) {
      this.adjustPlayerSnakeOccupancy(player, segment, 1);
    }
  }

  private adjustSnakeOccupancy(cell: GridCell, delta: number): void {
    this.adjustPlayerSnakeOccupancy(this.primaryPlayer, cell, delta);
  }

  private adjustPlayerSnakeOccupancy(player: PlayerRuntimeState, cell: GridCell, delta: number): void {
    const index = this.getSnakeCellIndex(cell);

    if (index === null) {
      return;
    }

    const currentValue = player.movement.snakeOccupancy[index] ?? 0;
    const nextValue = currentValue + delta;
    player.movement.snakeOccupancy[index] = Math.max(0, Math.min(255, nextValue));
  }

  private getSnakeCellIndex(cell: GridCell): number | null {
    if (this.isOutOfBounds(cell)) {
      return null;
    }

    return cell.row * this.grid.columns + cell.column;
  }

  private createSnakeMovementEvaluationContext(): SnakeMovementEvaluationContext {
    return this.createPlayerMovementEvaluationContext(this.primaryPlayer);
  }

  private createPlayerMovementEvaluationContext(
    player: PlayerRuntimeState,
    options: { includeOpponentBodies?: boolean } = {},
  ): SnakeMovementEvaluationContext {
    const includeOpponentBodies = options.includeOpponentBodies ?? this.match.mode !== "local-pvp";
    const otherPlayerCells = this.players
      .filter((candidate) => candidate.id !== player.id && candidate.lifecycle.phase === "playing")
      .flatMap((candidate) => candidate.snake);

    return {
      grid: this.grid,
      snake: player.snake,
      foods: this.foods,
      starCores: this.starCores,
      starAttractors: this.starAttractors,
      snakeOccupancy: player.movement.snakeOccupancy,
      pendingGrowthSegments: player.movement.pendingGrowthSegments,
      includeStarAttractors: STAR_ATTRACTOR_ENABLED,
      extraBlockedCells: includeOpponentBodies ? otherPlayerCells : undefined,
    };
  }

  private canAdvanceDirection(direction: Direction): boolean {
    return this.canPlayerAdvanceDirection(this.primaryPlayer, direction);
  }

  private canPlayerAdvanceDirection(player: PlayerRuntimeState, direction: Direction): boolean {
    return canAdvanceDirection(this.createPlayerMovementEvaluationContext(player), direction);
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
    return cellCollidesWithPlayerBody({
      grid: this.grid,
      snake: this.snake,
      snakeOccupancy: this.snakeOccupancy,
    }, cell);
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
    let nearestAlert: GameSnapshot["blackHoleAlert"] = null;

    for (const player of this.players) {
      if (player.lifecycle.phase !== "playing") {
        continue;
      }

      const head = player.snake[0];
      const alert = head ? resolveBlackHoleAlert(head, this.blackHoles, currentTime) : null;

      if (!alert) {
        continue;
      }

      if (!nearestAlert || alert.distance < nearestAlert.distance) {
        nearestAlert = alert;
      }
    }

    this.blackHoleAlert = nearestAlert;
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

  private buildOnlinePvpGrid(size: CanvasSize): GridMetrics {
    return createFixedPvpGrid(size, this.measureTopMargin(size));
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
    if (this.match.mode === "online-pvp" && this.onlineSession !== null) {
      return this.buildOnlinePvpSnapshot();
    }

    return buildGameSnapshot({
      phase: this.phase,
      match: {
        mode: this.match.mode,
        phase: this.match.phase,
        tick: this.match.tick,
        winnerId: this.match.winnerId,
      },
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
      players: this.players.map((player) => ({
        id: player.id,
        label: player.label,
        inputOrigin: player.inputOrigin,
        snake: player.snake,
        direction: player.movement.direction,
        score: player.progress.score,
        highScore: player.progress.highScore,
        livesRemaining: player.lifecycle.livesRemaining,
        deathReason: player.lifecycle.deathReason,
        speedMode: player.speed.currentMovementSpeed.mode,
        speedMultiplier: player.speed.currentMovementSpeed.multiplier,
        speedCue: player.speed.speedCue,
        reviving: player.lifecycle.reviving,
        reviveEndsAt: player.lifecycle.reviveEndsAt,
        elapsed: this.elapsed,
        wallGrace: player.lifecycle.wallGrace,
      })),
    });
  }

  private buildOnlinePvpSnapshot(): GameSnapshot {
    const session = this.onlineSession;

    if (session === null) {
      return buildGameSnapshot({
        phase: this.phase,
        match: {
          mode: this.match.mode,
          phase: this.match.phase,
          tick: this.match.tick,
          winnerId: this.match.winnerId,
        },
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
        includeStarAttractor: false,
        players: this.players.map((player) => ({
          id: player.id,
          label: player.label,
          inputOrigin: player.inputOrigin,
          snake: player.snake,
          direction: player.movement.direction,
          score: player.progress.score,
          highScore: player.progress.highScore,
          livesRemaining: player.lifecycle.livesRemaining,
          deathReason: player.lifecycle.deathReason,
          speedMode: player.speed.currentMovementSpeed.mode,
          speedMultiplier: player.speed.currentMovementSpeed.multiplier,
          speedCue: player.speed.speedCue,
          reviving: player.lifecycle.reviving,
          reviveEndsAt: player.lifecycle.reviveEndsAt,
          elapsed: this.elapsed,
          wallGrace: player.lifecycle.wallGrace,
        })),
      });
    }

    const localPlayer = session.runtime.players.find((player) => player.id === session.localPlayerId) ?? session.runtime.players[0];
    const players: PlayerSnapshotInput[] = session.runtime.players.map((player) => ({
      id: player.id,
      label: player.id.toUpperCase(),
      inputOrigin: (player.id === session.localPlayerId ? "local" : "remote") as PlayerInputOrigin,
      snake: player.snake,
      direction: player.movement.direction,
      score: player.progress.score,
      highScore: 0,
      livesRemaining: this.ui.lifeHearts.length,
      deathReason: player.lifecycle.phase === "playing" ? null : player.lifecycle.deathReason,
      speedMode: "base" as const,
      speedMultiplier: 1,
      speedCue: null,
      reviving: false,
      reviveEndsAt: 0,
      elapsed: this.elapsed,
      wallGrace: null,
    }));

    return buildGameSnapshot({
      phase: this.match.phase,
      match: {
        mode: this.match.mode,
        phase: this.match.phase,
        tick: this.match.tick,
        winnerId: this.match.winnerId,
      },
      grid: this.grid,
      snake: localPlayer?.snake ?? [],
      foods: session.runtime.foods,
      starAttractors: [],
      starAttractorEffects: [],
      starBeasts: [],
      starCores: [],
      starBeastEffects: [],
      blackHoles: [],
      blackHoleAlert: null,
      blackHoleCue: null,
      rewardBurstOrigin: null,
      score: localPlayer?.progress.score ?? 0,
      highScore: 0,
      livesRemaining: this.ui.lifeHearts.length,
      deathReason: localPlayer?.lifecycle.phase === "playing" ? null : localPlayer?.lifecycle.deathReason ?? null,
      direction: localPlayer?.movement.direction ?? "right",
      speedMode: "base",
      speedMultiplier: 1,
      speedCue: null,
      reviving: false,
      reviveEndsAt: 0,
      elapsed: this.elapsed,
      wallGrace: null,
      includeStarAttractor: false,
      players,
    });
  }

  public getUnlockedFeatures(): UnlockedFeatures {
    return computeUnlockedFeatures(this.getProgress());
  }

  private getProgress(): GameProgress {
    if (this.match.mode === "local-pvp") {
      return this.getMatchProgress();
    }

    return {
      snakeLength: this.snake.length,
      coresEaten: this.coresEaten,
      score: this.score,
      elapsedTime: this.playElapsed / 1000
    };
  }

  private getMatchProgress(): GameProgress {
    return {
      snakeLength: Math.max(...this.players.map((player) => player.snake.length), 0),
      coresEaten: this.players.reduce((total, player) => total + player.progress.coresEaten, 0),
      score: this.players.reduce((total, player) => total + player.progress.score, 0),
      elapsedTime: this.playElapsed / 1000,
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
      shellView: this.shellView,
      grid: this.grid,
      progress,
      buildVersion: this.buildVersion,
      pvpConnectionStatus: this.pvpConnection.getState().status,
      livesRemaining: this.livesRemaining,
      lastFps: this.lastFps,
      lastSimulationMs: this.lastSimulationMs,
      lastRenderMs: this.lastRenderMs,
      size,
      deathReason: this.deathReason,
      reviving: this.reviving,
      reviveEndsAt: this.reviveEndsAt,
      elapsed: this.elapsed,
      lifeHeartCount: this.ui.lifeHearts.length,
      roomNotice: this.roomNotice,
      syncNotice: this.onlineSession?.syncNotice ?? null,
      pvpPanel: this.shellView === "pvp-room" ? this.pvpConnection.getPanelState(Date.now()) : null,
      debug: this.buildPvpDebugInput(),
      match: {
        mode: this.match.mode,
        phase: this.match.phase,
        tick: this.match.tick,
        winnerId: this.match.winnerId,
      },
      players: this.players.map((player) => ({
        id: player.id,
        label: player.label,
        inputOrigin: player.inputOrigin,
        snakeLength: player.snake.length,
        score: player.progress.score,
        livesRemaining: player.lifecycle.livesRemaining,
        deathReason: player.lifecycle.deathReason,
      })),
    });

    applyUiSyncModel(this.ui, this.uiSyncState, model);
  }
}
