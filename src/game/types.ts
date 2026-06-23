export type GamePhase = "ready" | "playing" | "paused" | "gameOver";

export type Direction = "up" | "right" | "down" | "left";

export type InputSource = "keyboard" | "pointer";

export type InputEventKind = "pressed" | "released";

export type InputAction =
  | "start"
  | "pause"
  | "restart"
  | "boost"
  | "move-up"
  | "move-right"
  | "move-down"
  | "move-left";

export interface CanvasSize {
  width: number;
  height: number;
  dpr: number;
  pixelWidth: number;
  pixelHeight: number;
}

export interface GridMetrics {
  columns: number;
  rows: number;
  cellSize: number;
  offsetX: number;
  offsetY: number;
}

export interface GridCell {
  column: number;
  row: number;
}

export interface BlackHole {
  cell: GridCell;
  seed: number;
  spawnTime: number;
}

export interface GameSnapshot {
  phase: GamePhase;
  grid: GridMetrics;
  snake: readonly GridCell[];
  foods: readonly GridCell[];
  blackHoles: readonly BlackHole[];
  score: number;
  highScore: number;
  direction: Direction;
  comboCount: number;
  comboMultiplier: number;
  comboTimer: number;
  comboMaxTimer: number;
  isComboUnlocked: boolean;
}

export interface FrameInfo {
  now: number;
  delta: number;
  elapsed: number;
  phase: GamePhase;
  size: CanvasSize;
  snapshot: GameSnapshot;
}

export interface InputCommand {
  action: InputAction;
  kind: InputEventKind;
  source: InputSource;
}

export type InputListener = (command: InputCommand) => void;

export type Unsubscribe = () => void;

export interface InputController {
  subscribe(listener: InputListener): Unsubscribe;
  destroy(): void;
}

export interface TouchControlElements {
  container: HTMLElement;
  joystick: HTMLElement;
  joystickKnob: HTMLElement;
  joystickLine: HTMLElement;
  boostButton: HTMLButtonElement;
}

export interface InputControllerOptions {
  target?: EventTarget;
  touchControls?: TouchControlElements;
}

export interface Renderer {
  resize(): CanvasSize;
  render(frame: FrameInfo): void;
  getSize(): CanvasSize;
  destroy(): void;
}

export interface GameUiElements {
  root: HTMLElement;
  startPanel: HTMLElement;
  scoreLabel: HTMLElement;
  comboPanel: HTMLElement;
  comboLabel: HTMLElement;
  comboCountLabel: HTMLElement;
  comboTimerLabel: HTMLElement;
  comboTimerBar: HTMLElement;
  bestLabel: HTMLElement;
  stateLabel: HTMLElement;
  fpsLabel: HTMLElement;
  sizeLabel: HTMLElement;
  startButton: HTMLButtonElement;
  pauseButton: HTMLButtonElement;
  touchControls: TouchControlElements;
}
