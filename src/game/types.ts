export type GamePhase = "ready" | "playing" | "revivePrompt" | "reviving" | "paused" | "gameOver";

export type Direction = "up" | "right" | "down" | "left";

export type BlackHoleKind = "small" | "medium" | "large";

export type BlackHoleBand = "core" | "strong" | "medium" | "weak";

export type StarBeastState = "spawning" | "patrol" | "chase" | "dead";

export type StarBeastDeathCause = "player_body" | "black_hole";

export type DeathReason = "wall" | "snake_body" | "black_hole" | "star_beast" | "unknown";

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

export type StarCoreSource = "regular" | "star_beast";

export interface StarBeast {
  id: number;
  alive: boolean;
  body: GridCell[];
  dir: Direction;
  length: number;
  state: StarBeastState;
  moveTimer: number;
  aiDecisionCooldown: number;
  turnCommitTicks: number;
  spawnGraceTime: number;
  coreScanStepCount: number;
  nextCoreHuntAt: number;
  coreHuntUntil: number;
  nextAttackAt: number;
  attackUntil: number;
  speedFactor: number;
  aggroRadius: number;
  loseAggroRadius: number;
}

export interface StarCore {
  id: number;
  x: number;
  y: number;
  vx: number;
  vy: number;
  spawnTime: number;
  magnetDelayMs: number;
  magnetRadius: number;
  lifetimeMs: number;
  value: number;
  source: StarCoreSource;
  burstOrigin?: GridCell;
}

export interface StarBeastEffect {
  id: number;
  cell: GridCell;
  createdAt: number;
  lifetimeMs: number;
  seed: number;
  length: number;
  cause: StarBeastDeathCause;
}

export interface StarAttractor {
  id: number;
  cell: GridCell;
  spawnTime: number;
  seed: number;
}

export interface StarAttractorEffect {
  id: number;
  origin: GridCell;
  target: GridCell;
  absorbedCells: readonly GridCell[];
  absorbCount: number;
  createdAt: number;
  lifetimeMs: number;
  seed: number;
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

export interface WallGraceSnapshot {
  direction: Direction;
  startedAt: number;
  expiresAt: number;
}

export interface GameSnapshot {
  phase: GamePhase;
  grid: GridMetrics;
  snake: readonly GridCell[];
  foods: readonly GridCell[];
  starAttractors: readonly StarAttractor[];
  starAttractorEffects: readonly StarAttractorEffect[];
  starBeasts: readonly StarBeast[];
  starCores: readonly StarCore[];
  starBeastEffects: readonly StarBeastEffect[];
  blackHoles: readonly BlackHole[];
  blackHoleAlert: BlackHoleAlert | null;
  blackHoleCue: BlackHoleCue | null;
  rewardBurstOrigin: GridCell | null;
  score: number;
  highScore: number;
  livesRemaining: number;
  deathReason: DeathReason | null;
  direction: Direction;
  speedMode: SpeedMode;
  speedMultiplier: number;
  speedCue: SpeedCue | null;
  wallGrace: WallGraceSnapshot | null;
  reviveCountdownSeconds: number;
}

export interface FrameInfo {
  now: number;
  delta: number;
  frameDelta: number;
  elapsed: number;
  phase: GamePhase;
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
  recordFrameTime(delta: number): void;
  destroy(): void;
}

export interface GameUiElements {
  root: HTMLElement;
  hudStrip: HTMLElement;
  startPanel: HTMLElement;
  panelPrimaryLabel: HTMLElement;
  panelPrimaryValue: HTMLElement;
  panelSecondaryLabel: HTMLElement;
  panelMetaLabel: HTMLElement;
  lifeHearts: readonly HTMLElement[];
  lengthLabel: HTMLElement;
  unlockTitleLabel: HTMLElement;
  unlockValueLabel: HTMLElement;
  tickerCurrentLabel: HTMLElement;
  tickerNextLabel: HTMLElement;
  stateLabel: HTMLElement;
  fpsLabel: HTMLElement;
  sizeLabel: HTMLElement;
  startButton: HTMLButtonElement;
  pauseButton: HTMLButtonElement;
  touchControls: TouchControlElements;
}
