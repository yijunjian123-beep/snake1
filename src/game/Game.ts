import { createAudioController, type AudioController } from "./audio";
import { createInputController } from "./input";
import { DEFAULT_SAFE_SPAWN_CONFIG, getUnlockedFeatures as computeUnlockedFeatures, type GameProgress, type UnlockedFeatures } from "./progression";
import { findSafeSpawnPosition } from "./spawn";
import { createRenderer } from "./render";
import { readHighScore, writeHighScore } from "./storage";
import type {
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

const STEP_MS = 120;
const BOOST_STEP_MS = 72;
const STARTING_LENGTH = 4;
const SCORE_PER_CORE = 10;
const COMBO_MAX_TIMER_MS = 4000;
const COMBO_MAX_COUNT = 99;
const COMBO_UNLOCKED_CAP_MULTIPLIER = 4;
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

export class Game {
  private readonly canvas: HTMLCanvasElement;
  private readonly ui: GameUiElements;
  private readonly renderer: Renderer;
  private readonly input: InputController;
  private readonly audio: AudioController;
  private readonly unsubscribers: Unsubscribe[] = [];

  private phase: GamePhase = "ready";
  private grid: GridMetrics;
  private snake: GridCell[] = [];
  private foods: GridCell[] = [];
  private direction: Direction = "right";
  private nextDirection: Direction = "right";
  private score = 0;
  private coresEaten = 0;
  private comboCount = 0;
  private comboMultiplier = 1;
  private comboTimer = 0;
  private comboMaxTimer = COMBO_MAX_TIMER_MS;
  private lastCoreEatTime = 0;
  private isComboUnlocked = false;
  private highScore: number;
  private frameId: number | null = null;
  private elapsed = 0;
  private playElapsed = 0;
  private stepAccumulator = 0;
  private lastFrameTime = 0;
  private lastUiUpdate = 0;
  private lastFps = 0;
  private isBoosting = false;

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
      this.refreshComboUnlockState();
      this.tickComboTimer(delta);
      this.stepAccumulator += delta;
      const stepMs = this.isBoosting ? BOOST_STEP_MS : STEP_MS;

      while (this.stepAccumulator >= stepMs && this.phase === "playing") {
        this.advanceSnake();
        this.stepAccumulator -= stepMs;
      }
    }

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

    if (command.kind !== "pressed") {
      return;
    }

    const direction = directionFromAction(command.action);

    if (direction) {
      this.queueDirection(direction);
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

  private queueDirection(direction: Direction): void {
    if (this.phase !== "playing" || direction === this.direction || direction === OPPOSITE_DIRECTIONS[this.direction]) {
      return;
    }

    this.nextDirection = direction;
  }

  private resetRun(phase: GamePhase): void {
    this.phase = phase;
    this.score = 0;
    this.coresEaten = 0;
    this.comboCount = 0;
    this.comboMultiplier = 1;
    this.comboTimer = 0;
    this.comboMaxTimer = COMBO_MAX_TIMER_MS;
    this.lastCoreEatTime = 0;
    this.isComboUnlocked = false;
    this.direction = "right";
    this.nextDirection = "right";
    this.isBoosting = false;
    this.stepAccumulator = 0;
    this.playElapsed = 0;
    this.snake = this.createStartingSnake();
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

    while (foods.length < 2) {
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
      occupiedCells: [...this.snake, ...this.foods, ...extraBlocked],
    });
  }

  private refillFoods(): void {
    while (this.foods.length < 2) {
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

    this.direction = this.nextDirection;

    const delta = DIRECTION_DELTAS[this.direction];
    const nextHead: GridCell = {
      column: head.column + delta.column,
      row: head.row + delta.row,
    };
    const ateFoodIndex = this.foods.findIndex((food) => cellsMatch(nextHead, food));
    const ateFood = ateFoodIndex !== -1;

    if (this.isOutOfBounds(nextHead) || this.collidesWithSelf(nextHead, ateFood)) {
      this.endRun();
      return;
    }

    this.snake = [nextHead, ...this.snake];

    if (ateFood) {
      this.foods.splice(ateFoodIndex, 1);
      this.coresEaten += 1;
      this.handleCoreEat();
      this.refillFoods();
      this.saveHighScoreIfNeeded();

      if (this.foods.length === 0) {
        this.endRun();
      }

      return;
    }

    this.snake.pop();
  }

  private handleCoreEat(): void {
    const wasComboUnlocked = this.isComboUnlocked;
    const timeSinceLastCore = this.lastCoreEatTime > 0 ? this.playElapsed - this.lastCoreEatTime : Number.POSITIVE_INFINITY;
    const canContinueCombo = timeSinceLastCore <= this.comboMaxTimer;
    const nextComboCount = canContinueCombo ? this.comboCount + 1 : 1;

    this.comboCount = Math.min(COMBO_MAX_COUNT, nextComboCount);
    this.comboMultiplier = this.getComboMultiplier(this.comboCount);
    this.comboTimer = this.comboMaxTimer;
    this.lastCoreEatTime = this.playElapsed;
    this.refreshComboUnlockState();
    this.score += SCORE_PER_CORE * (wasComboUnlocked ? this.comboMultiplier : 1);
  }

  private refreshComboUnlockState(): void {
    if (this.isComboUnlocked) {
      return;
    }

    const features = computeUnlockedFeatures(this.getProgress());
    this.isComboUnlocked = features.combo;
  }

  private tickComboTimer(delta: number): void {
    if (this.comboTimer <= 0) {
      return;
    }

    this.comboTimer = Math.max(0, this.comboTimer - delta);

    if (this.comboTimer === 0) {
      this.comboCount = 0;
      this.comboMultiplier = 1;
    }
  }

  private getComboMultiplier(comboCount: number): number {
    if (comboCount >= 10) return COMBO_UNLOCKED_CAP_MULTIPLIER;
    if (comboCount >= 6) return 3;
    if (comboCount >= 3) return 2;
    return 1;
  }

  private collidesWithSelf(cell: GridCell, willGrow: boolean): boolean {
    const bodyToCheck = willGrow ? this.snake : this.snake.slice(0, -1);
    return bodyToCheck.some((segment) => cellsMatch(segment, cell));
  }

  private isOutOfBounds(cell: GridCell): boolean {
    return cell.column < 0 || cell.row < 0 || cell.column >= this.grid.columns || cell.row >= this.grid.rows;
  }

  private isCurrentPlacementValid(): boolean {
    const snakeIsValid = this.snake.every((segment) => !this.isOutOfBounds(segment));
    const foodsAreValid = this.foods.every((food) => !this.isOutOfBounds(food) && !this.snake.some((segment) => cellsMatch(segment, food)));

    return snakeIsValid && foodsAreValid;
  }

  private endRun(): void {
    this.phase = "gameOver";
    this.isBoosting = false;
    this.stepAccumulator = 0;
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

  private createSnapshot(): GameSnapshot {
    return {
      phase: this.phase,
      grid: { ...this.grid },
      snake: this.snake.map((segment) => ({ ...segment })),
      foods: this.foods.map((food) => ({ ...food })),
      score: this.score,
      highScore: this.highScore,
      direction: this.direction,
      comboCount: this.comboCount,
      comboMultiplier: this.comboMultiplier,
      comboTimer: this.comboTimer,
      comboMaxTimer: this.comboMaxTimer,
      isComboUnlocked: this.isComboUnlocked,
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
    this.ui.comboPanel.dataset.unlocked = this.isComboUnlocked ? "true" : "false";
    this.ui.comboLabel.textContent = this.isComboUnlocked ? `x${this.comboMultiplier}` : "Locked";
    this.ui.comboCountLabel.textContent = this.isComboUnlocked ? `${this.comboCount} chain` : "0 chain";
    this.ui.comboTimerLabel.textContent = this.isComboUnlocked ? `${Math.ceil(this.comboTimer / 1000)}s` : "--";
    this.ui.comboTimerBar.style.width = this.isComboUnlocked && this.comboMaxTimer > 0
      ? `${Math.max(0, Math.min(100, (this.comboTimer / this.comboMaxTimer) * 100))}%`
      : "0%";
    this.ui.bestLabel.textContent = this.highScore.toString();
    this.ui.stateLabel.textContent = PHASE_LABELS[this.phase];
    this.ui.fpsLabel.textContent = `${this.lastFps || "--"} FPS`;
    this.ui.sizeLabel.textContent = `${size.width} x ${size.height} @${size.dpr.toFixed(1)}`;
  }
}
