import { getNextLengthUnlockCopy, type GameProgress } from "./progression";
import type {
  BlackHole,
  BlackHoleAlert,
  BlackHoleCue,
  CanvasSize,
  DeathReason,
  Direction,
  GamePhase,
  GameSnapshot,
  GameUiElements,
  GridCell,
  GridMetrics,
  SpeedMode,
  StarAttractor,
  StarAttractorEffect,
  StarBeast,
  StarBeastEffect,
  StarCore,
} from "./types";
import type { SpeedCueState, UiSyncState, WallGraceState } from "./gameState";

export const PHASE_LABELS: Record<GamePhase, string> = {
  ready: "待机",
  playing: "运行中",
  revivePrompt: "待复活",
  reviving: "复活中",
  paused: "已暂停",
  gameOver: "结束",
};

export const HUD_TICKER_LINES = [
  "长按Shift减速，长按方向键加速",
  "注意，黑洞会把你吸入深渊",
  "杀死星兽，可以吃它的能量！",
] as const;

const DEATH_REASON_LABELS: Record<DeathReason, string> = {
  wall: "撞到墙壁了",
  snake_body: "撞到蛇身体了",
  black_hole: "被黑洞吸入了",
  star_beast: "被星兽撞到了",
  unknown: "意外死亡",
};

const SPEED_CUE_DURATION_MS = 1500;
const HUD_TICKER_INTERVAL_MS = 10000;
const HUD_TICKER_FADE_MS = 720;

export interface GameSnapshotInput {
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
  speedCue: SpeedCueState | null;
  reviving: boolean;
  reviveEndsAt: number;
  elapsed: number;
  wallGrace: WallGraceState | null;
  includeStarAttractor: boolean;
}

export interface UiSyncInput {
  phase: GamePhase;
  grid: GridMetrics;
  progress: GameProgress;
  livesRemaining: number;
  lastFps: number;
  size: CanvasSize;
  deathReason: DeathReason | null;
  reviving: boolean;
  reviveEndsAt: number;
  elapsed: number;
  lifeHeartCount: number;
}

export interface UiSyncModel {
  rootPhase: GamePhase;
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
}

export interface TickerUiInput {
  elapsed: number;
}

export interface TickerUiModel {
  currentText: string;
  nextText: string;
  currentOpacity: string;
  nextOpacity: string;
}

export function createUiSyncState(): UiSyncState {
  return {
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
}

export function buildGameSnapshot(input: GameSnapshotInput): GameSnapshot {
  const speedCue = buildSpeedCueSnapshot(input.speedCue, input.elapsed);

  return {
    phase: input.phase,
    grid: input.grid,
    snake: input.snake,
    foods: input.foods,
    starAttractors: input.includeStarAttractor ? input.starAttractors : [],
    starAttractorEffects: input.includeStarAttractor ? input.starAttractorEffects : [],
    starBeasts: input.starBeasts,
    starCores: input.starCores,
    starBeastEffects: input.starBeastEffects,
    blackHoles: input.blackHoles,
    blackHoleAlert: input.blackHoleAlert,
    blackHoleCue: input.blackHoleCue,
    rewardBurstOrigin: input.rewardBurstOrigin ? { ...input.rewardBurstOrigin } : null,
    score: input.score,
    highScore: input.highScore,
    livesRemaining: input.livesRemaining,
    deathReason: input.deathReason,
    direction: input.direction,
    speedMode: input.speedMode,
    speedMultiplier: input.speedMultiplier,
    speedCue,
    wallGrace: input.wallGrace,
    reviveCountdownSeconds: getReviveCountdownSeconds(input.reviving, input.reviveEndsAt, input.elapsed),
  };
}

export function buildUiSyncModel(input: UiSyncInput): UiSyncModel {
  const unlockCopy = getNextLengthUnlockCopy(input.progress);
  const isReady = input.phase === "ready";
  const isRevivePrompt = input.phase === "revivePrompt";
  const isReviving = input.phase === "reviving";
  const isGameOver = input.phase === "gameOver";
  const currentLengthDisplay = `${input.progress.snakeLength}/100`;
  const reviveCountdownSeconds = getReviveCountdownSeconds(input.reviving, input.reviveEndsAt, input.elapsed);

  return {
    rootPhase: input.phase,
    boardTop: `${input.grid.offsetY}px`,
    startPanelHidden: !(isReady || isGameOver || isRevivePrompt),
    startButtonText: isReady ? "开始游戏" : isGameOver ? "重开" : "复活",
    startButtonAriaLabel: isReady ? "开始游戏" : isGameOver ? "重新开始" : "确认复活",
    startButtonDisabled: isReviving,
    pauseButtonDisabled: input.phase !== "playing" && input.phase !== "paused",
    pauseButtonText: input.phase === "paused" ? "▶" : "❚❚",
    pauseButtonAriaLabel: input.phase === "paused" ? "继续游戏" : "暂停游戏",
    panelPrimaryLabel: isReady ? "准备开始" : "当前/目标长度",
    panelPrimaryValue: isReady ? "NEON SERPENT" : currentLengthDisplay,
    panelSecondaryLabel: isReady ? "霓虹吞星" : getDeathReasonText(input.deathReason),
    panelMetaHidden: isRevivePrompt,
    panelMetaLabel: isReady
      ? "长按方向键加速·长按Shift减速"
      : isGameOver
        ? "按开始重开"
        : isReviving
          ? `${reviveCountdownSeconds} 秒后开始`
          : "",
    lifeHeartActiveStates: Array.from({ length: input.lifeHeartCount }, (_, index) =>
      index < input.livesRemaining ? "true" : "false",
    ),
    lengthLabel: currentLengthDisplay,
    unlockTitleLabel: unlockCopy.title,
    unlockValueLabel: unlockCopy.value,
    stateLabel: PHASE_LABELS[input.phase],
    fpsLabel: `${input.lastFps || "--"} FPS`,
    sizeLabel: `${input.size.width} x ${input.size.height} @${input.size.dpr.toFixed(1)}`,
  };
}

export function buildTickerUiModel(input: TickerUiInput): TickerUiModel {
  const cycleIndex = Math.floor(input.elapsed / HUD_TICKER_INTERVAL_MS);
  const cycleProgress = input.elapsed - cycleIndex * HUD_TICKER_INTERVAL_MS;
  const currentIndex = cycleIndex % HUD_TICKER_LINES.length;
  const nextIndex = (currentIndex + 1) % HUD_TICKER_LINES.length;
  const crossfadeStart = HUD_TICKER_INTERVAL_MS - HUD_TICKER_FADE_MS;
  const isCrossfading = cycleProgress >= crossfadeStart;
  const fadeProgress = isCrossfading
    ? Math.max(0, Math.min(1, (cycleProgress - crossfadeStart) / HUD_TICKER_FADE_MS))
    : 0;

  return {
    currentText: HUD_TICKER_LINES[currentIndex] ?? "",
    nextText: HUD_TICKER_LINES[nextIndex] ?? "",
    currentOpacity: (1 - fadeProgress).toFixed(3),
    nextOpacity: fadeProgress.toFixed(3),
  };
}

export function applyUiSyncModel(ui: GameUiElements, state: UiSyncState, model: UiSyncModel): void {
  if (state.rootPhase !== model.rootPhase) {
    ui.root.dataset.phase = model.rootPhase;
    state.rootPhase = model.rootPhase;
  }

  if (state.boardTop !== model.boardTop) {
    ui.root.style.setProperty("--board-top", model.boardTop);
    state.boardTop = model.boardTop;
  }

  if (state.startPanelHidden !== model.startPanelHidden) {
    ui.startPanel.hidden = model.startPanelHidden;
    state.startPanelHidden = model.startPanelHidden;
  }

  if (state.startButtonText !== model.startButtonText) {
    ui.startButton.textContent = model.startButtonText;
    state.startButtonText = model.startButtonText;
  }

  if (state.startButtonAriaLabel !== model.startButtonAriaLabel) {
    ui.startButton.setAttribute("aria-label", model.startButtonAriaLabel);
    state.startButtonAriaLabel = model.startButtonAriaLabel;
  }

  if (state.startButtonDisabled !== model.startButtonDisabled) {
    ui.startButton.disabled = model.startButtonDisabled;
    state.startButtonDisabled = model.startButtonDisabled;
  }

  if (state.pauseButtonDisabled !== model.pauseButtonDisabled) {
    ui.pauseButton.disabled = model.pauseButtonDisabled;
    state.pauseButtonDisabled = model.pauseButtonDisabled;
  }

  if (state.pauseButtonText !== model.pauseButtonText) {
    ui.pauseButton.textContent = model.pauseButtonText;
    state.pauseButtonText = model.pauseButtonText;
  }

  if (state.pauseButtonAriaLabel !== model.pauseButtonAriaLabel) {
    ui.pauseButton.setAttribute("aria-label", model.pauseButtonAriaLabel);
    state.pauseButtonAriaLabel = model.pauseButtonAriaLabel;
  }

  if (state.panelPrimaryLabel !== model.panelPrimaryLabel) {
    ui.panelPrimaryLabel.textContent = model.panelPrimaryLabel;
    state.panelPrimaryLabel = model.panelPrimaryLabel;
  }

  if (state.panelPrimaryValue !== model.panelPrimaryValue) {
    ui.panelPrimaryValue.textContent = model.panelPrimaryValue;
    state.panelPrimaryValue = model.panelPrimaryValue;
  }

  if (state.panelSecondaryLabel !== model.panelSecondaryLabel) {
    ui.panelSecondaryLabel.textContent = model.panelSecondaryLabel;
    state.panelSecondaryLabel = model.panelSecondaryLabel;
  }

  if (state.panelMetaHidden !== model.panelMetaHidden) {
    ui.panelMetaLabel.hidden = model.panelMetaHidden;
    state.panelMetaHidden = model.panelMetaHidden;
  }

  if (state.panelMetaLabel !== model.panelMetaLabel) {
    ui.panelMetaLabel.textContent = model.panelMetaLabel;
    state.panelMetaLabel = model.panelMetaLabel;
  }

  for (let index = 0; index < ui.lifeHearts.length; index += 1) {
    const heart = ui.lifeHearts[index];
    const active = model.lifeHeartActiveStates[index] ?? "false";

    if (!heart) {
      continue;
    }

    if (state.lifeHeartActiveStates[index] !== active) {
      heart.dataset.active = active;
      state.lifeHeartActiveStates[index] = active;
    }
  }

  state.lifeHeartActiveStates.length = ui.lifeHearts.length;

  if (state.lengthLabel !== model.lengthLabel) {
    ui.lengthLabel.textContent = model.lengthLabel;
    state.lengthLabel = model.lengthLabel;
  }

  if (state.unlockTitleLabel !== model.unlockTitleLabel) {
    ui.unlockTitleLabel.textContent = model.unlockTitleLabel;
    state.unlockTitleLabel = model.unlockTitleLabel;
  }

  if (state.unlockValueLabel !== model.unlockValueLabel) {
    ui.unlockValueLabel.textContent = model.unlockValueLabel;
    state.unlockValueLabel = model.unlockValueLabel;
  }

  if (state.stateLabel !== model.stateLabel) {
    ui.stateLabel.textContent = model.stateLabel;
    state.stateLabel = model.stateLabel;
  }

  if (state.fpsLabel !== model.fpsLabel) {
    ui.fpsLabel.textContent = model.fpsLabel;
    state.fpsLabel = model.fpsLabel;
  }

  if (state.sizeLabel !== model.sizeLabel) {
    ui.sizeLabel.textContent = model.sizeLabel;
    state.sizeLabel = model.sizeLabel;
  }
}

export function applyTickerUiModel(ui: GameUiElements, state: UiSyncState, model: TickerUiModel): void {
  if (state.tickerCurrentText !== model.currentText) {
    ui.tickerCurrentLabel.textContent = model.currentText;
    state.tickerCurrentText = model.currentText;
  }

  if (state.tickerNextText !== model.nextText) {
    ui.tickerNextLabel.textContent = model.nextText;
    state.tickerNextText = model.nextText;
  }

  if (state.tickerCurrentOpacity !== model.currentOpacity) {
    ui.tickerCurrentLabel.style.opacity = model.currentOpacity;
    state.tickerCurrentOpacity = model.currentOpacity;
  }

  if (state.tickerNextOpacity !== model.nextOpacity) {
    ui.tickerNextLabel.style.opacity = model.nextOpacity;
    state.tickerNextOpacity = model.nextOpacity;
  }
}

function buildSpeedCueSnapshot(speedCue: SpeedCueState | null, elapsed: number): GameSnapshot["speedCue"] {
  if (!speedCue) {
    return null;
  }

  const age = elapsed - speedCue.startedAt;

  if (age >= SPEED_CUE_DURATION_MS) {
    return null;
  }

  return {
    mode: speedCue.mode,
    anchor: { ...speedCue.anchor },
    startedAt: speedCue.startedAt,
    fadeProgress: Math.max(0, Math.min(1, age / SPEED_CUE_DURATION_MS)),
  };
}

function getDeathReasonText(reason: DeathReason | null): string {
  if (reason) {
    return DEATH_REASON_LABELS[reason];
  }

  return "本局已结束";
}

function getReviveCountdownSeconds(reviving: boolean, reviveEndsAt: number, elapsed: number): number {
  if (!reviving) {
    return 0;
  }

  return Math.max(1, Math.ceil((reviveEndsAt - elapsed) / 1000));
}
