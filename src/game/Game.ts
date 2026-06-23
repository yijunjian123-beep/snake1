import { createAudioController, type AudioController } from "./audio";
import {
  getBlackHoleFoodAvoidRadiusCells,
  getBlackHoleKindForSpawn,
  getDesiredBlackHoleCount,
  isBlackHoleCollision,
  resolveBlackHoleAlert,
  resolveBlackHoleMovement,
  spawnBlackHole,
  type BlackHoleGravityState,
} from "./blackHole";
import { createInputController } from "./input";
import { DEFAULT_SAFE_SPAWN_CONFIG, getUnlockedFeatures as computeUnlockedFeatures, type GameProgress, type UnlockedFeatures } from "./progression";
import { findSafeSpawnPosition } from "./spawn";
import { createRenderer } from "./render";
import { readHighScore, writeHighScore } from "./storage";
import type {
  BlackHole,
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
  Unsubscribe,
} from "./types";

interface GameOptions {
  canvas: HTMLCanvasElement;
  ui: GameUiElements;
}

const PHASE_LABELS: Record<GamePhase, string> = {
  ready: "Ready",
  playing: "Playing",
  paused: "Paused",
  gameOver: "Game Over",
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

const BASE_STEP_MS = 180;
const BOOST_STEP_RATIO = 0.6;
const ACCELERATE_SPEED_MULTIPLIER = 2;
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

function clampInteger(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, Math.floor(value)));
}

function createGrid(size: CanvasSize): GridMetrics {
  const isCompactLandscape = size.width > size.height && size.width <= 980 && size.height <= 520;
  const sideMargin = Math.max(14, Math.min(40, Math.floor(size.width * 0.05)));
  const topMargin = size.height < 430 ? 70 : 96;
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
  private blackHoles: BlackHole[] = [];
  private blackHoleAlert: GameSnapshot["blackHoleAlert"] = null;
  private blackHoleGravityState: BlackHoleGravityState = { key: null, charge: 0 };
  private blackHoleCue: GameSnapshot["blackHoleCue"] = null;
  private blackHoleRecoveryDirection: Direction | null = null;
  private wallGrace: WallGraceState | null = null;
  private birthCell: GridCell = { column: 0, row: 0 };
  private direction: Direction = "right";
  private directionQueue: Direction[] = [];
  private score = 0;
  private coresEaten = 0;
  private highScore: number;
  private frameId: number | null = null;
  private elapsed = 0;
  private playElapsed = 0;
  private movementTick = 0;
  private stepAccumulator = 0;
  private lastFrameTime = 0;
  private lastUiUpdate = 0;
  private lastFps = 0;
  private isBoosting = false;
  private speedCue: SpeedCueState | null = null;
  private lastMovementSpeedMode: SpeedMode = "base";
  private activeInputSequence = 0;

  public constructor(options: GameOptions) {
    this.canvas = options.canvas;
    this.ui = options.ui;
    this.renderer = createRenderer(this.canvas);
    this.input = createInputController({ target: window, touchControls: this.ui.touchControls });
    this.audio = createAudioController();
    this.highScore = readHighScore();
    this.grid = createGrid(this.renderer.getSize());
    this.resetRun("ready");
  }

  public start(): void {
    if (this.frameId !== null) {
      return;
    }

    const size = this.renderer.resize();
    this.grid = createGrid(size);
    this.resetRun("ready");
    this.bindUi();
    this.unsubscribers.push(this.input.subscribe(this.handleInput));

    window.addEventListener("resize", this.handleResize);
    window.addEventListener("orientationchange", this.handleResize);

    this.lastFrameTime = performance.now();
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
    const delta = Math.min(50, now - this.lastFrameTime);
    this.lastFrameTime = now;
    this.elapsed += delta;

    if (this.phase === "playing") {
      this.playElapsed += delta;
      this.stepAccumulator += delta;
      this.updateWallGraceState();

      if (this.phase === "playing") {
        let movementSpeed = this.getMovementSpeedState();
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
            this.updateSpeedCueState(movementSpeed);
          }
        }
      }
    }

    this.expireSpeedCue();

    const size = this.renderer.getSize();
    this.renderer.render({
      now,
      delta,
      elapsed: this.elapsed,
      phase: this.phase,
      size,
      snapshot: this.createSnapshot(),
    });

    this.lastFps = delta > 0 ? Math.round(1000 / delta) : this.lastFps;
    this.syncUi(false);
    this.frameId = window.requestAnimationFrame(this.loop);
  };

  private readonly handleResize = (): void => {
    const size = this.renderer.resize();
    this.grid = createGrid(size);

    if (!this.isCurrentPlacementValid()) {
      this.resetRun(this.phase === "paused" ? "paused" : this.phase);
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
      this.beginRun();
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

    const candidates: Array<{ mode: SpeedCueMode; order: number }> = [];
    const activeDirectionalInput = this.getActiveDirectionalInput();

    if (activeDirectionalInput) {
      if (activeDirectionalInput.action === this.direction) {
        candidates.push({ mode: "accelerate", order: activeDirectionalInput.order });
      } else if (activeDirectionalInput.action === OPPOSITE_DIRECTIONS[this.direction]) {
        candidates.push({ mode: "brake", order: activeDirectionalInput.order });
      }
    }

    const activeSpeedInput = this.getActiveSpeedInput();

    if (activeSpeedInput) {
      candidates.push({ mode: activeSpeedInput.mode, order: activeSpeedInput.order });
    }

    const latestCandidate = candidates.reduce<{ mode: SpeedCueMode; order: number } | null>(
      (latest, candidate) => (!latest || candidate.order > latest.order ? candidate : latest),
      null,
    );

    return latestCandidate ? this.getMovementSpeedStateFromMode(latestCandidate.mode) : { mode: "base", multiplier: 1, stepMs: BASE_STEP_MS };
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

      const head = this.snake[0];

      if (!head) {
        return;
      }

      const delta = DIRECTION_DELTAS[direction];
      const nextCell: GridCell = {
        column: head.column + delta.column,
        row: head.row + delta.row,
      };

      if (this.isOutOfBounds(nextCell)) {
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
    this.lastMovementSpeedMode = "base";
    this.stepAccumulator = 0;
    this.playElapsed = 0;
    this.movementTick = 0;
    this.blackHoleGravityState = { key: null, charge: 0 };
    this.blackHoleAlert = null;
    this.blackHoleCue = null;
    this.blackHoleRecoveryDirection = null;
    this.wallGrace = null;
    this.snake = this.createStartingSnake();
    this.birthCell = this.snake[0] ? { ...this.snake[0] } : { column: 0, row: 0 };
    this.blackHoles = [];
    this.foods = this.createFoods();
    this.syncUi(true);
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

  private advanceSnake(): void {
    const head = this.snake[0];

    if (!head) {
      this.endRun();
      return;
    }

    const recoveryDirection = this.blackHoleRecoveryDirection;

    if (recoveryDirection !== null) {
      this.movementTick += 1;
      this.blackHoleRecoveryDirection = null;
      this.blackHoleGravityState = { key: null, charge: 0 };
      this.blackHoleCue = null;
      this.direction = recoveryDirection;
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
      this.endRun();
      return;
    }

    this.movementTick += 1;
    const currentTime = this.elapsed / 1000;
    const resolution = resolveBlackHoleMovement(
      head,
      intendedDirection,
      this.direction,
      this.blackHoles,
      currentTime,
      this.blackHoleGravityState,
    );

    this.blackHoleGravityState = resolution.nextGravityState;
    this.blackHoleCue = resolution.cue;

    if (resolution.shouldDie) {
      this.direction = resolution.finalDirection;
      this.endRun();
      return;
    }

    this.direction = resolution.finalDirection;

    if (resolution.shouldPlayPull) {
      this.blackHoleRecoveryDirection = intendedDirection;
    }

    this.commitSnakeStep();
  }

  private commitSnakeStep(): void {
    const head = this.snake[0];

    if (!head) {
      this.endRun();
      return;
    }

    const currentTime = this.elapsed / 1000;
    const delta = DIRECTION_DELTAS[this.direction];
    const nextHead: GridCell = {
      column: head.column + delta.column,
      row: head.row + delta.row,
    };
    const ateFoodIndex = this.foods.findIndex((food) => cellsMatch(nextHead, food));
    const ateFood = ateFoodIndex !== -1;

    if (this.isOutOfBounds(nextHead)) {
      this.startWallGrace(this.direction);
      return;
    }

    if (this.collidesWithSelf(nextHead, ateFood)) {
      this.endRun();
      return;
    }

    if (this.collidesWithBlackHole(nextHead)) {
      this.endRun();
      return;
    }

    this.snake = [nextHead, ...this.snake];

    if (ateFood) {
      this.foods.splice(ateFoodIndex, 1);
      this.coresEaten += 1;
      this.handleCoreEat();
      this.refreshBlackHoles();
      this.refillFoods();
      this.updateBlackHoleAlert(currentTime);
      this.saveHighScoreIfNeeded();

      if (this.foods.length === 0) {
        this.endRun();
      }

      return;
    }

    this.snake.pop();
    this.updateBlackHoleAlert(currentTime);
  }

  private handleCoreEat(): void {
    this.score += SCORE_PER_CORE;
  }

  private refreshBlackHoles(): void {
    const desiredCount = getDesiredBlackHoleCount(this.getProgress());

    while (this.blackHoles.length < desiredCount) {
      const nextBlackHole = spawnBlackHole({
        grid: this.grid,
        progress: this.getProgress(),
        snake: this.snake,
        foods: this.foods,
        existingBlackHoles: this.blackHoles,
        birthCell: this.birthCell,
        currentTime: this.elapsed / 1000,
        kind: getBlackHoleKindForSpawn(this.getProgress(), this.grid),
      });

      if (!nextBlackHole) {
        break;
      }

      this.blackHoles.push(nextBlackHole);
    }
  }

  private collidesWithSelf(cell: GridCell, willGrow: boolean): boolean {
    const bodyToCheck = willGrow ? this.snake : this.snake.slice(0, -1);
    return bodyToCheck.some((segment) => cellsMatch(segment, cell));
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
        this.endRun();
      }

      return;
    }

    this.wallGrace = null;
    this.stepAccumulator = 0;
    this.advanceSnakeFromDirection(recoveryDirection);
  }

  private getWallGraceRecoveryDirection(): Direction | null {
    const head = this.snake[0];

    if (!head) {
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

      const delta = DIRECTION_DELTAS[direction];
      const candidate: GridCell = {
        column: head.column + delta.column,
        row: head.row + delta.row,
      };

      if (this.isOutOfBounds(candidate)) {
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
    const foodsAreValid = this.foods.every((food) => {
      if (this.isOutOfBounds(food) || this.snake.some((segment) => cellsMatch(segment, food))) {
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

      return true;
    });

    return snakeIsValid && foodsAreValid && blackHolesAreValid;
  }

  private endRun(): void {
    this.phase = "gameOver";
    this.isBoosting = false;
    this.stepAccumulator = 0;
    this.blackHoleRecoveryDirection = null;
    this.wallGrace = null;
    this.speedCue = null;
    this.lastMovementSpeedMode = "base";
    this.saveHighScoreIfNeeded();
    this.syncUi(true);
  }

  private saveHighScoreIfNeeded(): void {
    if (this.score <= this.highScore) {
      return;
    }

    this.highScore = this.score;
    writeHighScore(this.highScore);
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

  private createSnapshot(): GameSnapshot {
    const movementSpeed = this.getMovementSpeedState();

    return {
      phase: this.phase,
      grid: { ...this.grid },
      snake: this.snake.map((segment) => ({ ...segment })),
      foods: this.foods.map((food) => ({ ...food })),
      blackHoles: this.blackHoles.map((blackHole) => ({
        ...blackHole,
        cell: { ...blackHole.cell },
      })),
      blackHoleAlert: this.blackHoleAlert
        ? {
            ...this.blackHoleAlert,
            blackHole: {
              ...this.blackHoleAlert.blackHole,
              cell: { ...this.blackHoleAlert.blackHole.cell },
            },
          }
        : null,
      blackHoleCue: this.blackHoleCue
        ? {
            ...this.blackHoleCue,
            blackHole: {
              ...this.blackHoleCue.blackHole,
              cell: { ...this.blackHoleCue.blackHole.cell },
            },
          }
        : null,
      score: this.score,
      highScore: this.highScore,
      direction: this.direction,
      speedMode: movementSpeed.mode,
      speedMultiplier: movementSpeed.multiplier,
      speedCue: this.getSpeedCueSnapshot(),
      wallGrace: this.wallGrace
        ? {
            ...this.wallGrace,
          }
        : null,
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
    const size = measuredSize ?? this.renderer.getSize();

    this.ui.root.dataset.phase = this.phase;
    this.ui.startPanel.hidden = this.phase !== "ready" && this.phase !== "gameOver";
    this.ui.startButton.textContent = this.phase === "gameOver" ? "RESTART" : "START";
    this.ui.startButton.setAttribute("aria-label", this.phase === "gameOver" ? "Restart" : "Start");
    this.ui.pauseButton.disabled = this.phase === "ready" || this.phase === "gameOver";
    this.ui.pauseButton.textContent = this.phase === "paused" ? ">" : "P";
    this.ui.pauseButton.setAttribute("aria-label", this.phase === "paused" ? "Resume" : "Pause");
    this.ui.scoreLabel.textContent = this.score.toString();
    this.ui.lengthLabel.textContent = this.snake.length.toString();
    this.ui.bestLabel.textContent = this.highScore.toString();
    this.ui.stateLabel.textContent = PHASE_LABELS[this.phase];
    this.ui.fpsLabel.textContent = `${this.lastFps || "--"} FPS`;
    this.ui.sizeLabel.textContent = `${size.width} x ${size.height} @${size.dpr.toFixed(1)}`;
  }
}
