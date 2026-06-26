import { formatBuildVersionLabel } from "../buildInfo.js";
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
  MatchSnapshot,
  PlayerSnapshot,
  ShellView,
  SpeedMode,
  StarAttractor,
  StarAttractorEffect,
  StarBeast,
  StarBeastEffect,
  StarCore,
} from "./types";
import type { SpeedCueState, UiSyncState, WallGraceState } from "./gameState";
import type { PvpConnectionStatus, PvpPanelState } from "../pvp/net/state.js";

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
  head_to_head: "和对手正面相撞了",
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
  match: MatchSnapshot;
  players?: readonly PlayerSnapshotInput[];
}

export interface PlayerSnapshotInput {
  id: PlayerSnapshot["id"];
  label: string;
  inputOrigin: PlayerSnapshot["inputOrigin"];
  snake: readonly GridCell[];
  direction: Direction;
  score: number;
  highScore: number;
  livesRemaining: number;
  deathReason: DeathReason | null;
  speedMode: SpeedMode;
  speedMultiplier: number;
  speedCue: SpeedCueState | null;
  reviving: boolean;
  reviveEndsAt: number;
  elapsed: number;
  wallGrace: WallGraceState | null;
}

export interface UiSyncInput {
  phase: GamePhase;
  shellView?: ShellView;
  grid: GridMetrics;
  progress: GameProgress;
  buildVersion: string;
  pvpConnectionStatus: PvpConnectionStatus;
  livesRemaining: number;
  lastFps: number;
  lastSimulationMs: number;
  lastRenderMs: number;
  size: CanvasSize;
  deathReason: DeathReason | null;
  reviving: boolean;
  reviveEndsAt: number;
  elapsed: number;
  lifeHeartCount: number;
  match: MatchSnapshot;
  players?: readonly PlayerUiInput[];
  roomNotice?: string;
  syncNotice?: string | null;
  pvpPanel?: PvpPanelState | null;
  debug?: PvpDebugInput | null;
}

export interface PvpDebugInput {
  visible: boolean;
  localTick: number;
  remoteInputLag: number;
  bufferedInputs: number;
  connectionState: string;
  playerSlot: string | null;
}

export interface PlayerUiInput {
  id: PlayerSnapshot["id"];
  label: string;
  inputOrigin: PlayerSnapshot["inputOrigin"];
  snakeLength: number;
  score: number;
  livesRemaining: number;
  deathReason: DeathReason | null;
}

interface PanelSecondaryLabelInput {
  isMainMenu: boolean;
  isPvpRoom: boolean;
  isPvpMatch: boolean;
  isOnlinePvp: boolean;
  isReady: boolean;
  pvpStatus: string | null;
  deathReason: DeathReason | null;
  pvpPanel: PvpPanelState | null;
}

interface PanelMetaLabelInput {
  isMainMenu: boolean;
  isPvpRoom: boolean;
  isPvpMatch: boolean;
  isOnlinePvp: boolean;
  isReady: boolean;
  isGameOver: boolean;
  isReviving: boolean;
  isRevivePrompt: boolean;
  roomNotice?: string;
  syncNotice?: string | null;
  pvpStatus: string | null;
  players: readonly PlayerUiInput[];
  reviveCountdownSeconds: number;
  pvpPanel: PvpPanelState | null;
}

export interface UiSyncModel {
  rootPhase: GamePhase;
  shellView: ShellView;
  boardTop: string;
  startPanelHidden: boolean;
  startButtonHidden: boolean;
  startButtonText: string;
  startButtonAriaLabel: string;
  startButtonDisabled: boolean;
  entryActionsHidden: boolean;
  pvpRoomPanelHidden: boolean;
  buildVersionLabel: string;
  pvpConnectionLabel: string;
  pvpConnectionState: string;
  roomStatusLabel: string;
  roomQueueStatsHidden: boolean;
  queueWaitLabel: string;
  queueOnlineLabel: string;
  queueCountLabel: string;
  roomPlayersLabel: string;
  roomPlayersHidden: boolean;
  roomCodeFieldHidden: boolean;
  roomCodeInputValue: string;
  roomCodeInputPlaceholder: string;
  roomCodeInputReadOnly: boolean;
  createRoomButtonText: string;
  createRoomButtonDisabled: boolean;
  joinRoomButtonText: string;
  joinRoomButtonDisabled: boolean;
  readyRoomButtonText: string;
  readyRoomButtonHidden: boolean;
  readyRoomButtonDisabled: boolean;
  cancelMatchmakingButtonText: string;
  cancelMatchmakingButtonHidden: boolean;
  cancelMatchmakingButtonDisabled: boolean;
  copyRoomCodeButtonHidden: boolean;
  copyRoomCodeButtonDisabled: boolean;
  settlementActionsHidden: boolean;
  continueButtonText: string;
  continueButtonAriaLabel: string;
  continueButtonDisabled: boolean;
  mainMenuButtonText: string;
  mainMenuButtonAriaLabel: string;
  mainMenuButtonDisabled: boolean;
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
  debugLocalTickLabel: string;
  debugRemoteInputLagLabel: string;
  debugBufferedInputsLabel: string;
  debugConnectionStateLabel: string;
  debugPlayerSlotLabel: string;
  perfLabel: string;
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
    shellView: "",
    boardTop: "",
    startPanelHidden: false,
    startButtonHidden: false,
    startButtonText: "",
    startButtonAriaLabel: "",
    startButtonDisabled: false,
    entryActionsHidden: true,
    pvpRoomPanelHidden: true,
    buildVersionLabel: "",
    pvpConnectionLabel: "",
    pvpConnectionState: "",
    roomStatusLabel: "",
    roomQueueStatsHidden: true,
    queueWaitLabel: "",
    queueOnlineLabel: "",
    queueCountLabel: "",
    roomPlayersLabel: "",
    roomPlayersHidden: true,
    roomCodeFieldHidden: true,
    roomCodeInputValue: "",
    roomCodeInputPlaceholder: "",
    roomCodeInputReadOnly: false,
    createRoomButtonText: "",
    createRoomButtonDisabled: false,
    joinRoomButtonText: "",
    joinRoomButtonDisabled: false,
    readyRoomButtonText: "",
    readyRoomButtonHidden: true,
    readyRoomButtonDisabled: false,
    cancelMatchmakingButtonText: "",
    cancelMatchmakingButtonHidden: true,
    cancelMatchmakingButtonDisabled: false,
    copyRoomCodeButtonHidden: true,
    copyRoomCodeButtonDisabled: true,
    settlementActionsHidden: true,
    continueButtonText: "",
    continueButtonAriaLabel: "",
    continueButtonDisabled: false,
    mainMenuButtonText: "",
    mainMenuButtonAriaLabel: "",
    mainMenuButtonDisabled: false,
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
    debugLocalTickLabel: "",
    debugRemoteInputLagLabel: "",
    debugBufferedInputsLabel: "",
    debugConnectionStateLabel: "",
    debugPlayerSlotLabel: "",
    perfLabel: "",
    tickerCurrentText: "",
    tickerNextText: "",
    tickerCurrentOpacity: "",
    tickerNextOpacity: "",
  };
}

export function buildGameSnapshot(input: GameSnapshotInput): GameSnapshot {
  const speedCue = buildSpeedCueSnapshot(input.speedCue, input.elapsed);
  const players = input.players?.map((player) => buildPlayerSnapshot(player)) ?? [
    buildPlayerSnapshot({
      id: "p1",
      label: "P1",
      inputOrigin: "local",
      snake: input.snake,
      direction: input.direction,
      score: input.score,
      highScore: input.highScore,
      livesRemaining: input.livesRemaining,
      deathReason: input.deathReason,
      speedMode: input.speedMode,
      speedMultiplier: input.speedMultiplier,
      speedCue: input.speedCue,
      reviving: input.reviving,
      reviveEndsAt: input.reviveEndsAt,
      elapsed: input.elapsed,
      wallGrace: input.wallGrace,
    }),
  ];

  return {
    phase: input.phase,
    match: input.match,
    players,
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

function buildPlayerSnapshot(input: PlayerSnapshotInput): PlayerSnapshot {
  return {
    id: input.id,
    label: input.label,
    inputOrigin: input.inputOrigin,
    snake: input.snake.map((cell) => ({ ...cell })),
    direction: input.direction,
    score: input.score,
    highScore: input.highScore,
    livesRemaining: input.livesRemaining,
    deathReason: input.deathReason,
    speedMode: input.speedMode,
    speedMultiplier: input.speedMultiplier,
    speedCue: buildSpeedCueSnapshot(input.speedCue, input.elapsed),
    wallGrace: input.wallGrace,
    reviveCountdownSeconds: getReviveCountdownSeconds(input.reviving, input.reviveEndsAt, input.elapsed),
  };
}

export function buildUiSyncModel(input: UiSyncInput): UiSyncModel {
  const shellView = input.shellView ?? "active-run";
  const unlockCopy = getNextLengthUnlockCopy(input.progress);
  const isReady = input.phase === "ready";
  const isRevivePrompt = input.phase === "revivePrompt";
  const isReviving = input.phase === "reviving";
  const isGameOver = input.phase === "gameOver";
  const isMainMenu = isReady && shellView === "main-menu";
  const isPvpRoom = isReady && shellView === "pvp-room";
  const isRunReady = isReady && shellView === "active-run";
  const isSettlement = isGameOver || isRevivePrompt;
  const currentLengthDisplay = `${input.progress.snakeLength}/100`;
  const isPvpMatch = input.match.mode !== "solo";
  const isOnlinePvp = input.match.mode === "online-pvp";
  const pvpPanel = isPvpRoom ? input.pvpPanel ?? null : null;
  const playerSummary = isPvpMatch ? getPlayerSummary(input.players ?? []) : null;
  const pvpStatus = isPvpMatch ? getPvpStatus(input.match, input.players ?? []) : null;
  const pvpConnectionState = getPvpConnectionState(input.pvpConnectionStatus);
  const panelPrimaryValue = isMainMenu
    ? "NEON SERPENT"
    : isPvpRoom
      ? pvpPanel?.heading ?? "在线 PVP"
      : isReady
        ? isPvpMatch ? (isOnlinePvp ? "ONLINE PVP" : "LOCAL PVP") : "NEON SERPENT"
        : playerSummary ?? currentLengthDisplay;
  const lengthLabel = playerSummary ?? currentLengthDisplay;
  const unlockTitleLabel = isPvpMatch ? (isOnlinePvp ? "ONLINE PVP" : "LOCAL PVP") : unlockCopy.title;
  const unlockValueLabel = isPvpMatch ? pvpStatus ?? `Tick ${input.match.tick}` : unlockCopy.value;
  const reviveCountdownSeconds = getReviveCountdownSeconds(input.reviving, input.reviveEndsAt, input.elapsed);
  const debug = input.debug ?? null;
  const panelSecondaryLabel = getPanelSecondaryLabel({
    isMainMenu,
    isPvpRoom,
    isPvpMatch,
    isOnlinePvp,
    isReady,
    pvpStatus,
    deathReason: input.deathReason,
    pvpPanel,
  });
  const panelMetaLabel = getPanelMetaLabel({
    isMainMenu,
    isPvpRoom,
    isPvpMatch,
    isOnlinePvp,
    isReady,
    isGameOver,
    isReviving,
    isRevivePrompt,
    roomNotice: input.roomNotice,
    syncNotice: input.syncNotice ?? null,
    pvpStatus,
    players: input.players ?? [],
    reviveCountdownSeconds,
    pvpPanel,
  });
  const buildVersionLabel = formatBuildVersionLabel(input.buildVersion);
  const pvpConnectionLabel = `PVP ${pvpConnectionState}`;

  return {
    rootPhase: input.phase,
    shellView,
    boardTop: `${input.grid.offsetY}px`,
    startPanelHidden: !(isReady || isGameOver || isRevivePrompt),
    startButtonHidden: !isRunReady,
    startButtonText: "开始游戏",
    startButtonAriaLabel: "开始游戏",
    startButtonDisabled: isReviving,
    entryActionsHidden: !isMainMenu,
    pvpRoomPanelHidden: !isPvpRoom,
    buildVersionLabel,
    pvpConnectionLabel,
    pvpConnectionState,
    roomStatusLabel: pvpPanel?.statusText ?? input.roomNotice ?? "点击 PVP 后会自动连接服务并寻找对手。",
    roomQueueStatsHidden: pvpPanel?.queueStatsHidden ?? true,
    queueWaitLabel: pvpPanel?.waitLabel ?? "",
    queueOnlineLabel: pvpPanel?.onlineLabel ?? "",
    queueCountLabel: pvpPanel?.queueLabel ?? "",
    roomPlayersLabel: pvpPanel?.roomPlayersLabel ?? "",
    roomPlayersHidden: pvpPanel?.roomPlayersHidden ?? true,
    roomCodeFieldHidden: pvpPanel?.roomCodeFieldHidden ?? true,
    roomCodeInputValue: pvpPanel?.roomCodeInputValue ?? "",
    roomCodeInputPlaceholder: pvpPanel?.roomCodeInputPlaceholder ?? "输入房间码",
    roomCodeInputReadOnly: pvpPanel?.roomCodeInputReadOnly ?? false,
    createRoomButtonText: pvpPanel?.createRoomButtonText ?? "邀请好友",
    createRoomButtonDisabled: pvpPanel?.createRoomButtonDisabled ?? false,
    joinRoomButtonText: pvpPanel?.joinRoomButtonText ?? "输入房间码",
    joinRoomButtonDisabled: pvpPanel?.joinRoomButtonDisabled ?? false,
    readyRoomButtonText: pvpPanel?.readyButtonText ?? "准备",
    readyRoomButtonHidden: pvpPanel?.readyButtonHidden ?? true,
    readyRoomButtonDisabled: pvpPanel?.readyButtonDisabled ?? false,
    cancelMatchmakingButtonText: pvpPanel?.cancelButtonText ?? "取消匹配",
    cancelMatchmakingButtonHidden: pvpPanel?.cancelButtonHidden ?? true,
    cancelMatchmakingButtonDisabled: pvpPanel?.cancelButtonDisabled ?? false,
    copyRoomCodeButtonHidden: pvpPanel?.copyButtonHidden ?? true,
    copyRoomCodeButtonDisabled: pvpPanel?.copyButtonDisabled ?? true,
    settlementActionsHidden: !isSettlement,
    continueButtonText: "继续游戏",
    continueButtonAriaLabel: "继续游戏",
    continueButtonDisabled: isReviving,
    mainMenuButtonText: "回到主界面",
    mainMenuButtonAriaLabel: "回到主界面",
    mainMenuButtonDisabled: false,
    pauseButtonDisabled: input.phase !== "playing" && input.phase !== "paused",
    pauseButtonText: input.phase === "paused" ? "▶" : "❚❚",
    pauseButtonAriaLabel: input.phase === "paused" ? "继续游戏" : "暂停游戏",
    panelPrimaryLabel: isMainMenu ? "选择模式" : isPvpRoom ? "在线 PVP" : isReady ? "准备开始" : isPvpMatch ? "PVP 结算" : "当前/目标长度",
    panelPrimaryValue,
    panelSecondaryLabel,
    panelMetaHidden: false,
    panelMetaLabel,
    lifeHeartActiveStates: Array.from({ length: input.lifeHeartCount }, (_, index) =>
      index < input.livesRemaining ? "true" : "false",
    ),
    lengthLabel,
    unlockTitleLabel,
    unlockValueLabel,
    stateLabel: PHASE_LABELS[input.phase],
    fpsLabel: `${input.lastFps || "--"} FPS`,
    sizeLabel: `${input.size.width} x ${input.size.height} @${input.size.dpr.toFixed(1)}`,
    debugLocalTickLabel: debug?.visible ? `localTick: ${debug.localTick}` : "",
    debugRemoteInputLagLabel: debug?.visible ? `remoteInputLag: ${debug.remoteInputLag}` : "",
    debugBufferedInputsLabel: debug?.visible ? `bufferedInputs: ${debug.bufferedInputs}` : "",
    debugConnectionStateLabel: debug?.visible ? `connectionState: ${debug.connectionState}` : "",
    debugPlayerSlotLabel: debug?.visible ? `playerSlot: ${debug.playerSlot ?? "-"}` : "",
    perfLabel: `逻辑 ${input.lastSimulationMs.toFixed(1)}ms · 渲染 ${input.lastRenderMs.toFixed(1)}ms`,
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

  if (state.shellView !== model.shellView) {
    ui.root.dataset.shellView = model.shellView;
    state.shellView = model.shellView;
  }

  if (state.boardTop !== model.boardTop) {
    ui.root.style.setProperty("--board-top", model.boardTop);
    state.boardTop = model.boardTop;
  }

  if (state.startPanelHidden !== model.startPanelHidden) {
    ui.startPanel.hidden = model.startPanelHidden;
    state.startPanelHidden = model.startPanelHidden;
  }

  if (state.startButtonHidden !== model.startButtonHidden) {
    ui.startButton.hidden = model.startButtonHidden;
    state.startButtonHidden = model.startButtonHidden;
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

  if (state.entryActionsHidden !== model.entryActionsHidden) {
    ui.entryActions.hidden = model.entryActionsHidden;
    state.entryActionsHidden = model.entryActionsHidden;
  }

  if (state.pvpRoomPanelHidden !== model.pvpRoomPanelHidden) {
    ui.pvpRoomPanel.hidden = model.pvpRoomPanelHidden;
    state.pvpRoomPanelHidden = model.pvpRoomPanelHidden;
  }

  if (state.buildVersionLabel !== model.buildVersionLabel) {
    ui.buildVersionLabel.textContent = model.buildVersionLabel;
    state.buildVersionLabel = model.buildVersionLabel;
  }

  if (state.pvpConnectionLabel !== model.pvpConnectionLabel) {
    ui.pvpConnectionLabel.textContent = model.pvpConnectionLabel;
    state.pvpConnectionLabel = model.pvpConnectionLabel;
  }

  if (state.pvpConnectionState !== model.pvpConnectionState) {
    ui.pvpConnectionLabel.dataset.state = model.pvpConnectionState;
    state.pvpConnectionState = model.pvpConnectionState;
  }

  if (state.roomStatusLabel !== model.roomStatusLabel) {
    ui.roomStatusLabel.textContent = model.roomStatusLabel;
    state.roomStatusLabel = model.roomStatusLabel;
  }

  if (state.roomQueueStatsHidden !== model.roomQueueStatsHidden) {
    ui.roomQueueStats.hidden = model.roomQueueStatsHidden;
    state.roomQueueStatsHidden = model.roomQueueStatsHidden;
  }

  if (state.queueWaitLabel !== model.queueWaitLabel) {
    ui.queueWaitLabel.textContent = model.queueWaitLabel;
    state.queueWaitLabel = model.queueWaitLabel;
  }

  if (state.queueOnlineLabel !== model.queueOnlineLabel) {
    ui.queueOnlineLabel.textContent = model.queueOnlineLabel;
    state.queueOnlineLabel = model.queueOnlineLabel;
  }

  if (state.queueCountLabel !== model.queueCountLabel) {
    ui.queueCountLabel.textContent = model.queueCountLabel;
    state.queueCountLabel = model.queueCountLabel;
  }

  if (state.roomPlayersLabel !== model.roomPlayersLabel) {
    ui.roomPlayersLabel.textContent = model.roomPlayersLabel;
    state.roomPlayersLabel = model.roomPlayersLabel;
  }

  if (state.roomPlayersHidden !== model.roomPlayersHidden) {
    ui.roomPlayersLabel.hidden = model.roomPlayersHidden;
    state.roomPlayersHidden = model.roomPlayersHidden;
  }

  if (state.roomCodeFieldHidden !== model.roomCodeFieldHidden) {
    ui.roomCodeField.hidden = model.roomCodeFieldHidden;
    state.roomCodeFieldHidden = model.roomCodeFieldHidden;
  }

  if (state.roomCodeInputValue !== model.roomCodeInputValue) {
    ui.roomCodeInput.value = model.roomCodeInputValue;
    state.roomCodeInputValue = model.roomCodeInputValue;
  }

  if (state.roomCodeInputPlaceholder !== model.roomCodeInputPlaceholder) {
    ui.roomCodeInput.placeholder = model.roomCodeInputPlaceholder;
    state.roomCodeInputPlaceholder = model.roomCodeInputPlaceholder;
  }

  if (state.roomCodeInputReadOnly !== model.roomCodeInputReadOnly) {
    ui.roomCodeInput.readOnly = model.roomCodeInputReadOnly;
    state.roomCodeInputReadOnly = model.roomCodeInputReadOnly;
  }

  if (state.createRoomButtonText !== model.createRoomButtonText) {
    ui.createRoomButton.textContent = model.createRoomButtonText;
    state.createRoomButtonText = model.createRoomButtonText;
  }

  if (state.createRoomButtonDisabled !== model.createRoomButtonDisabled) {
    ui.createRoomButton.disabled = model.createRoomButtonDisabled;
    state.createRoomButtonDisabled = model.createRoomButtonDisabled;
  }

  if (state.joinRoomButtonText !== model.joinRoomButtonText) {
    ui.joinRoomButton.textContent = model.joinRoomButtonText;
    state.joinRoomButtonText = model.joinRoomButtonText;
  }

  if (state.joinRoomButtonDisabled !== model.joinRoomButtonDisabled) {
    ui.joinRoomButton.disabled = model.joinRoomButtonDisabled;
    state.joinRoomButtonDisabled = model.joinRoomButtonDisabled;
  }

  if (state.readyRoomButtonText !== model.readyRoomButtonText) {
    ui.readyRoomButton.textContent = model.readyRoomButtonText;
    state.readyRoomButtonText = model.readyRoomButtonText;
  }

  if (state.readyRoomButtonHidden !== model.readyRoomButtonHidden) {
    ui.readyRoomButton.hidden = model.readyRoomButtonHidden;
    state.readyRoomButtonHidden = model.readyRoomButtonHidden;
  }

  if (state.readyRoomButtonDisabled !== model.readyRoomButtonDisabled) {
    ui.readyRoomButton.disabled = model.readyRoomButtonDisabled;
    state.readyRoomButtonDisabled = model.readyRoomButtonDisabled;
  }

  if (state.cancelMatchmakingButtonText !== model.cancelMatchmakingButtonText) {
    ui.cancelMatchmakingButton.textContent = model.cancelMatchmakingButtonText;
    state.cancelMatchmakingButtonText = model.cancelMatchmakingButtonText;
  }

  if (state.cancelMatchmakingButtonHidden !== model.cancelMatchmakingButtonHidden) {
    ui.cancelMatchmakingButton.hidden = model.cancelMatchmakingButtonHidden;
    state.cancelMatchmakingButtonHidden = model.cancelMatchmakingButtonHidden;
  }

  if (state.cancelMatchmakingButtonDisabled !== model.cancelMatchmakingButtonDisabled) {
    ui.cancelMatchmakingButton.disabled = model.cancelMatchmakingButtonDisabled;
    state.cancelMatchmakingButtonDisabled = model.cancelMatchmakingButtonDisabled;
  }

  if (state.copyRoomCodeButtonHidden !== model.copyRoomCodeButtonHidden) {
    ui.copyRoomCodeButton.hidden = model.copyRoomCodeButtonHidden;
    state.copyRoomCodeButtonHidden = model.copyRoomCodeButtonHidden;
  }

  if (state.copyRoomCodeButtonDisabled !== model.copyRoomCodeButtonDisabled) {
    ui.copyRoomCodeButton.disabled = model.copyRoomCodeButtonDisabled;
    state.copyRoomCodeButtonDisabled = model.copyRoomCodeButtonDisabled;
  }

  if (state.settlementActionsHidden !== model.settlementActionsHidden) {
    ui.settlementActions.hidden = model.settlementActionsHidden;
    state.settlementActionsHidden = model.settlementActionsHidden;
  }

  if (state.continueButtonText !== model.continueButtonText) {
    ui.continueButton.textContent = model.continueButtonText;
    state.continueButtonText = model.continueButtonText;
  }

  if (state.continueButtonAriaLabel !== model.continueButtonAriaLabel) {
    ui.continueButton.setAttribute("aria-label", model.continueButtonAriaLabel);
    state.continueButtonAriaLabel = model.continueButtonAriaLabel;
  }

  if (state.continueButtonDisabled !== model.continueButtonDisabled) {
    ui.continueButton.disabled = model.continueButtonDisabled;
    state.continueButtonDisabled = model.continueButtonDisabled;
  }

  if (state.mainMenuButtonText !== model.mainMenuButtonText) {
    ui.mainMenuButton.textContent = model.mainMenuButtonText;
    state.mainMenuButtonText = model.mainMenuButtonText;
  }

  if (state.mainMenuButtonAriaLabel !== model.mainMenuButtonAriaLabel) {
    ui.mainMenuButton.setAttribute("aria-label", model.mainMenuButtonAriaLabel);
    state.mainMenuButtonAriaLabel = model.mainMenuButtonAriaLabel;
  }

  if (state.mainMenuButtonDisabled !== model.mainMenuButtonDisabled) {
    ui.mainMenuButton.disabled = model.mainMenuButtonDisabled;
    state.mainMenuButtonDisabled = model.mainMenuButtonDisabled;
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

  if (state.debugLocalTickLabel !== model.debugLocalTickLabel) {
    ui.debugLocalTickLabel.hidden = !model.debugLocalTickLabel;
    ui.debugLocalTickLabel.textContent = model.debugLocalTickLabel;
    state.debugLocalTickLabel = model.debugLocalTickLabel;
  }

  if (state.debugRemoteInputLagLabel !== model.debugRemoteInputLagLabel) {
    ui.debugRemoteInputLagLabel.hidden = !model.debugRemoteInputLagLabel;
    ui.debugRemoteInputLagLabel.textContent = model.debugRemoteInputLagLabel;
    state.debugRemoteInputLagLabel = model.debugRemoteInputLagLabel;
  }

  if (state.debugBufferedInputsLabel !== model.debugBufferedInputsLabel) {
    ui.debugBufferedInputsLabel.hidden = !model.debugBufferedInputsLabel;
    ui.debugBufferedInputsLabel.textContent = model.debugBufferedInputsLabel;
    state.debugBufferedInputsLabel = model.debugBufferedInputsLabel;
  }

  if (state.debugConnectionStateLabel !== model.debugConnectionStateLabel) {
    ui.debugConnectionStateLabel.hidden = !model.debugConnectionStateLabel;
    ui.debugConnectionStateLabel.textContent = model.debugConnectionStateLabel;
    state.debugConnectionStateLabel = model.debugConnectionStateLabel;
  }

  if (state.debugPlayerSlotLabel !== model.debugPlayerSlotLabel) {
    ui.debugPlayerSlotLabel.hidden = !model.debugPlayerSlotLabel;
    ui.debugPlayerSlotLabel.textContent = model.debugPlayerSlotLabel;
    state.debugPlayerSlotLabel = model.debugPlayerSlotLabel;
  }

  if (state.perfLabel !== model.perfLabel) {
    ui.stateLabel.title = model.perfLabel;
    state.perfLabel = model.perfLabel;
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

function getPlayerSummary(players: readonly PlayerUiInput[]): string | null {
  if (players.length === 0) {
    return null;
  }

  return players
    .map((player) => `${player.label} ${player.score}/${player.snakeLength}`)
    .join(" · ");
}

function getPvpStatus(match: MatchSnapshot, players: readonly PlayerUiInput[]): string | null {
  if (match.winnerId) {
    const winner = players.find((player) => player.id === match.winnerId);

    return `${winner?.label ?? match.winnerId} 获胜`;
  }

  if (match.phase === "gameOver") {
    return "平局";
  }

  if (match.phase === "playing") {
    return `Tick ${match.tick}`;
  }

  return null;
}

function getPvpConnectionState(status: PvpConnectionStatus): "connected" | "disconnected" {
  switch (status) {
    case "connected":
    case "matchmaking":
    case "matched":
    case "countdown":
    case "playing":
      return "connected";
    case "connecting":
    case "disconnected":
    case "reconnecting":
    case "error":
      return "disconnected";
  }
}

function getPanelSecondaryLabel(input: PanelSecondaryLabelInput): string {
  if (input.isMainMenu) {
    return "PVE 单人冒险 / PVP 双蛇竞技";
  }

  if (input.isPvpRoom) {
    return input.pvpPanel?.subheading ?? "默认自动匹配";
  }

  if (input.isPvpMatch) {
    return input.pvpStatus ?? (input.isOnlinePvp ? "在线真人对战" : "本地双人模拟");
  }

  if (input.isReady) {
    return "单人冒险";
  }

  return getDeathReasonText(input.deathReason);
}

function getPanelMetaLabel(input: PanelMetaLabelInput): string {
  if (input.isMainMenu) {
    return "选择单人冒险，或进入 PVP 房间面板查看下一步联机入口。";
  }

  if (input.isPvpRoom) {
    return input.pvpPanel?.meta ?? input.roomNotice ?? "点击 PVP 后会自动连接服务并开始匹配。";
  }

  if (input.isReady) {
    return input.isPvpMatch ? (input.isOnlinePvp ? "P1 本地输入，P2 远端同步" : "P1 本地控制，P2 脚本模拟") : "长按方向键加速 · 长按 Shift 减速";
  }

  if (input.isGameOver && input.isPvpMatch) {
    return getPvpSettlementText(input.pvpStatus, input.players);
  }

  if (input.isGameOver) {
    return "可继续游戏或回到主界面";
  }

  if (input.isPvpMatch && input.isOnlinePvp && input.syncNotice) {
    return input.syncNotice;
  }

  if (input.isReviving) {
    return `${input.reviveCountdownSeconds} 秒后开始`;
  }

  if (input.isRevivePrompt) {
    return "可继续游戏或回到主界面";
  }

  return "";
}

function getPvpSettlementText(pvpStatus: string | null, players: readonly PlayerUiInput[]): string {
  const playerDetails = players
    .map((player) => {
      const death = player.deathReason ? getDeathReasonText(player.deathReason) : "存活";

      return `${player.label}：${player.score}分 / 长度${player.snakeLength} / ${death}`;
    })
    .join("；");

  return `${pvpStatus ?? "平局"}。${playerDetails}`;
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

