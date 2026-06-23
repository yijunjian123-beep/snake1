export type GamePhase = "ready" | "playing" | "paused" | "gameOver";

export type Direction = "up" | "right" | "down" | "left";

export type BlackHoleKind = "small" | "large";

export type BlackHoleBand = "core" | "strong" | "medium" | "weak";

export type InputSource = "keyboard" | "pointer";

export type InputEventKind = "pressed" | "released";

export type SpeedMode = "base" | "accelerate" | "brake" | "boost";

export type SpeedCueMode = Exclude<SpeedMode, "base">;

export type InputAction =
  | "start"
  | "pause"
  | "restart"
  | "boost"
  | "speed-accelerate"
  | "speed-brake"
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
  kind: BlackHoleKind;
  cell: GridCell;
  seed: number;
  spawnTime: number;
  activateAt: number;
}

export interface BlackHoleAlert {
  blackHole: BlackHole;
  distance: number;
}

export interface BlackHoleCue {
  blackHole: BlackHole;
  band: Exclude<BlackHoleBand, "core">;
  distance: number;
  charge: number;
  chargeThreshold: number;
  pullDirection: Direction | null;
  isFirstTick: boolean;
  isPulling: boolean;
  isEscaping: boolean;
}

export interface SpeedCue {
  mode: SpeedCueMode;
  anchor: GridCell;
  startedAt: number;
  fadeProgress: number;
}

export interface GameSnapshot {
  phase: GamePhase;
  grid: GridMetrics;
  snake: readonly GridCell[];
  foods: readonly GridCell[];
  blackHoles: readonly BlackHole[];
  blackHoleAlert: BlackHoleAlert | null;
  blackHoleCue: BlackHoleCue | null;
  score: number;
  highScore: number;
  direction: Direction;
  speedMode: SpeedMode;
  speedMultiplier: number;
  speedCue: SpeedCue | null;
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
  lengthLabel: HTMLElement;
  bestLabel: HTMLElement;
  stateLabel: HTMLElement;
  fpsLabel: HTMLElement;
  sizeLabel: HTMLElement;
  startButton: HTMLButtonElement;
  pauseButton: HTMLButtonElement;
  touchControls: TouchControlElements;
}
