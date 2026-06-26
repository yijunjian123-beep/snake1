import { PVP_LIMITS, ROOM_PHASES } from "./protocol.js";
import type { ErrorCode, PlayerSlot, PvpRoomPlayer, RoomCode, RoomPhase } from "./protocol.js";

export const ROOM_PHASE_TRANSITIONS: Readonly<Record<RoomPhase, readonly RoomPhase[]>> = {
  waiting: ["ready", "countdown", "finished"],
  ready: ["waiting", "countdown", "finished"],
  countdown: ["ready", "playing", "finished"],
  playing: ["finished"],
  finished: ["waiting"],
};

export interface RoomPlayerState {
  readonly playerSlot: PlayerSlot;
  readonly ready: boolean;
  readonly connected: boolean;
}

export interface PvpRoomState {
  readonly roomCode: RoomCode;
  readonly phase: RoomPhase;
  readonly players: readonly RoomPlayerState[];
}

export function isValidRoomPhaseTransition(from: RoomPhase, to: RoomPhase): boolean {
  return from === to || ROOM_PHASE_TRANSITIONS[from].includes(to);
}

export function getNextRoomPhases(from: RoomPhase): readonly RoomPhase[] {
  return ROOM_PHASE_TRANSITIONS[from];
}

export function assertNeverRoomPhase(phase: never): never {
  throw new Error(`Unhandled room phase: ${phase}`);
}

export function getRoomPhaseAfterReadyChange(current: PvpRoomState): RoomPhase {
  if (current.phase === "playing" || current.phase === "finished" || current.phase === "countdown") {
    return current.phase;
  }

  if (current.players.length === 2 && current.players.every((player) => player.ready && player.connected)) {
    return "ready";
  }

  return "waiting";
}

export function getRoomPhaseAfterCountdown(current: PvpRoomState): RoomPhase {
  if (current.phase !== "countdown") {
    return current.phase;
  }

  return "playing";
}

export function getRoomPhaseAfterGameOver(current: PvpRoomState): RoomPhase {
  if (current.phase !== "playing" && current.phase !== "countdown") {
    return current.phase;
  }

  return "finished";
}

export function isTerminalRoomPhase(phase: RoomPhase): boolean {
  return phase === "finished";
}

export function isKnownRoomPhase(value: string): value is RoomPhase {
  return ROOM_PHASES.includes(value as RoomPhase);
}

export const DEFAULT_PVP_UNAVAILABLE_MESSAGE = "在线 PVP 暂不可用，可以先玩单人模式";

export const PVP_CONNECTION_STATUSES = [
  "connecting",
  "connected",
  "matchmaking",
  "matched",
  "countdown",
  "playing",
  "disconnected",
  "reconnecting",
  "error",
] as const;
export type PvpConnectionStatus = (typeof PVP_CONNECTION_STATUSES)[number];

export const PVP_LOBBY_FLOWS = ["matchmaking", "invite", "join"] as const;
export type PvpLobbyFlow = (typeof PVP_LOBBY_FLOWS)[number];

export interface PvpConnectionState {
  readonly status: PvpConnectionStatus;
  readonly flow: PvpLobbyFlow;
  readonly playerId: string | null;
  readonly sessionToken: string | null;
  readonly playerSlot: PlayerSlot | null;
  readonly gameStart: PvpGameStartState | null;
  readonly roomCode: RoomCode | null;
  readonly roomPhase: RoomPhase | null;
  readonly roomPlayers: readonly PvpRoomPlayer[];
  readonly joinCode: string;
  readonly queuePosition: number | null;
  readonly queueStartedAt: number | null;
  readonly onlineCount: number | null;
  readonly queuedCount: number | null;
  readonly countdownEndsAt: number | null;
  readonly errorCode: ErrorCode | null;
  readonly errorMessage: string | null;
  readonly notice: string | null;
}

export interface PvpGameStartState {
  readonly seed: number;
  readonly startTick: number;
  readonly tickRate: number;
  readonly inputDelayTicks: number;
}

export interface PvpPanelState {
  readonly status: PvpConnectionStatus;
  readonly heading: string;
  readonly subheading: string;
  readonly meta: string;
  readonly statusText: string;
  readonly waitLabel: string;
  readonly onlineLabel: string;
  readonly queueLabel: string;
  readonly queueStatsHidden: boolean;
  readonly roomPlayersLabel: string;
  readonly roomPlayersHidden: boolean;
  readonly roomCodeFieldHidden: boolean;
  readonly roomCodeInputValue: string;
  readonly roomCodeInputPlaceholder: string;
  readonly roomCodeInputReadOnly: boolean;
  readonly createRoomButtonText: string;
  readonly createRoomButtonDisabled: boolean;
  readonly joinRoomButtonText: string;
  readonly joinRoomButtonDisabled: boolean;
  readonly readyButtonText: string;
  readonly readyButtonHidden: boolean;
  readonly readyButtonDisabled: boolean;
  readonly cancelButtonText: string;
  readonly cancelButtonHidden: boolean;
  readonly cancelButtonDisabled: boolean;
  readonly copyButtonHidden: boolean;
  readonly copyButtonDisabled: boolean;
}

const PVP_ERROR_MESSAGES: Readonly<Record<ErrorCode, string>> = {
  invalid_message: "联机消息异常，请稍后再试",
  unsupported_version: DEFAULT_PVP_UNAVAILABLE_MESSAGE,
  invalid_session: "联机会话已失效，请重新进入",
  room_not_found: "未找到对应房间码",
  room_full: "该房间已满",
  room_capacity_reached: "房间服务繁忙，请稍后再试",
  not_in_room: "当前不在房间中",
  already_in_room: "你已在房间中",
  queue_full: "匹配队列已满，请稍后再试",
  capacity_reached: "当前在线人数较多，请稍后再试",
  invalid_state: "当前联机状态已变化，请重新操作",
  service_busy: "房间服务繁忙，请稍后再试",
  rate_limited: "连接已超时，请重新进入联机",
  server_busy: DEFAULT_PVP_UNAVAILABLE_MESSAGE,
  server_shutdown: DEFAULT_PVP_UNAVAILABLE_MESSAGE,
  internal_error: DEFAULT_PVP_UNAVAILABLE_MESSAGE,
};

export function createInitialPvpConnectionState(
  flow: PvpLobbyFlow = "matchmaking",
  joinCode = "",
): PvpConnectionState {
  return {
    status: "disconnected",
    flow,
    playerId: null,
    sessionToken: null,
    playerSlot: null,
    gameStart: null,
    roomCode: null,
    roomPhase: null,
    roomPlayers: [],
    joinCode,
    queuePosition: null,
    queueStartedAt: null,
    onlineCount: null,
    queuedCount: null,
    countdownEndsAt: null,
    errorCode: null,
    errorMessage: null,
    notice: null,
  };
}

export function normalizeRoomCodeInput(value: string): string {
  return value
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, "")
    .slice(0, PVP_LIMITS.maxRoomCodeLength);
}

export function hasValidRoomCode(value: string): boolean {
  return value.length >= PVP_LIMITS.minRoomCodeLength && value.length <= PVP_LIMITS.maxRoomCodeLength;
}

export function getPvpErrorMessage(code: ErrorCode | null, fallback?: string): string {
  if (code !== null) {
    return PVP_ERROR_MESSAGES[code];
  }

  if (fallback && fallback.trim().length > 0) {
    return fallback;
  }

  return DEFAULT_PVP_UNAVAILABLE_MESSAGE;
}

export function getPvpPanelState(state: PvpConnectionState, now: number = Date.now()): PvpPanelState {
  const flowLabel = getFlowLabel(state.flow);
  const queueWaitingMs = state.queueStartedAt === null ? 0 : Math.max(0, now - state.queueStartedAt);
  const countdownSeconds = state.countdownEndsAt === null ? 0 : Math.max(1, Math.ceil((state.countdownEndsAt - now) / 1000));
  const waitLabel = state.queueStartedAt === null ? "" : `等待 ${formatDuration(queueWaitingMs)}`;
  const onlineLabel = state.onlineCount === null ? "" : `在线 ${state.onlineCount}`;
  const queueLabel = state.queuedCount === null ? "" : `排队 ${state.queuedCount}`;
  const queueStatsHidden = state.status !== "matchmaking" || (waitLabel === "" && onlineLabel === "" && queueLabel === "");
  const roomPlayersLabel = getRoomPlayersLabel(state);
  const roomPlayersHidden = roomPlayersLabel.length === 0;
  const roomCodeFieldHidden = state.flow === "matchmaking" || (state.roomCode === null && state.flow !== "join");
  const roomCodeInputValue = state.flow === "matchmaking" ? "" : state.roomCode ?? state.joinCode;
  const roomCodeInputReadOnly = state.roomCode !== null;
  const joinRoomEntryActive = state.flow === "join" && state.roomCode === null;
  const currentPlayer = getCurrentRoomPlayer(state);
  const readyButtonHidden = state.flow === "matchmaking"
    || state.roomCode === null
    || (state.roomPhase !== null && state.roomPhase !== "waiting" && state.roomPhase !== "ready");
  const readyButtonDisabled = readyButtonHidden || currentPlayer === null;
  const copyButtonHidden = state.flow === "matchmaking" || state.roomCode === null;
  const cancelButtonHidden = state.flow !== "matchmaking"
    || (state.status !== "connecting"
      && state.status !== "connected"
      && state.status !== "matchmaking"
      && state.status !== "reconnecting");

  let heading = "在线 PVP";
  let subheading = flowLabel;
  let statusText = state.notice ?? "";

  switch (state.status) {
    case "connecting":
      heading = state.flow === "matchmaking" ? "正在连接 PVP 服务" : state.flow === "invite" ? "正在创建私人房间" : "正在连接好友房间";
      statusText = state.flow === "matchmaking"
        ? "连接成功后会自动进入匹配队列"
        : state.flow === "invite"
          ? "连接成功后会自动生成房间码"
          : "连接成功后会自动尝试加入房间";
      break;
    case "connected":
      if (state.notice === "已取消匹配") {
        heading = "已取消匹配";
        subheading = "在线 PVP";
        statusText = "可以重新匹配，或改走房间码入口";
      } else if (state.notice === "对手已离开") {
        heading = "对手已离开";
        subheading = "在线 PVP";
        statusText = "可以重新匹配，或邀请好友再开一局";
      } else if (state.flow === "invite" && state.roomCode !== null) {
        heading = "邀请好友";
        subheading = "私人房间";
        statusText = state.notice ?? "房间已创建，把房间码发给好友";
      } else if (joinRoomEntryActive) {
        heading = "输入房间码";
        subheading = "好友房间";
        statusText = state.notice ?? "输入好友给你的房间码后加入房间";
      } else if (state.flow !== "matchmaking" && state.roomCode !== null) {
        heading = "好友房间";
        subheading = "私人房间";
        statusText = state.notice ?? "等待房间状态同步";
      } else {
        heading = "在线 PVP";
        subheading = "默认自动匹配";
        statusText = state.notice ?? "点击 PVP 后会自动连接服务并开始匹配";
      }
      break;
    case "matchmaking":
      heading = "正在寻找对手";
      subheading = "默认自动匹配";
      statusText = "已进入匹配队列，找到对手后会直接进入倒计时";
      break;
    case "matched":
      heading = "匹配成功";
      subheading = "准备对局";
      statusText = "对手已匹配成功，正在准备倒计时";
      break;
    case "countdown":
      heading = String(countdownSeconds);
      subheading = "对局即将开始";
      statusText = `${countdownSeconds} 秒后开始`;
      break;
    case "playing":
      heading = "在线对局开始";
      subheading = "PVP";
      statusText = "已进入在线 PVP 对局";
      break;
    case "reconnecting":
      heading = "正在重连";
      subheading = "在线 PVP";
      statusText = "正在恢复联机连接";
      break;
    case "disconnected":
      if (state.errorMessage !== null) {
        heading = "重连失败";
        subheading = "在线 PVP";
        statusText = state.errorMessage;
      } else if (joinRoomEntryActive) {
        heading = "输入房间码";
        subheading = "好友房间";
        statusText = state.notice ?? "输入好友给你的房间码后加入房间";
      } else if (state.notice === "已取消匹配") {
        heading = "已取消匹配";
        subheading = "在线 PVP";
        statusText = "可以重新匹配，或改走房间码入口";
      } else if (state.flow === "invite") {
        heading = "邀请好友";
        subheading = "私人房间";
        statusText = state.notice ?? "点击邀请好友后会自动创建房间";
      } else {
        heading = "在线 PVP";
        subheading = state.flow === "matchmaking" ? "默认自动匹配" : flowLabel;
        statusText = state.notice ?? "点击 PVP 后会自动连接服务";
      }
      break;
    case "error":
      heading = getErrorHeading(state.errorCode);
      statusText = state.errorMessage ?? getPvpErrorMessage(state.errorCode);
      break;
  }

  return {
    status: state.status,
    heading,
    subheading,
    meta: getMetaText(state.flow),
    statusText,
    waitLabel,
    onlineLabel,
    queueLabel,
    queueStatsHidden,
    roomPlayersLabel,
    roomPlayersHidden,
    roomCodeFieldHidden,
    roomCodeInputValue,
    roomCodeInputPlaceholder: "输入房间码",
    roomCodeInputReadOnly,
    createRoomButtonText: "邀请好友",
    createRoomButtonDisabled: false,
    joinRoomButtonText: joinRoomEntryActive ? "加入房间" : "输入房间码",
    joinRoomButtonDisabled: joinRoomEntryActive && !hasValidRoomCode(state.joinCode),
    readyButtonText: currentPlayer?.ready ? "取消准备" : "准备",
    readyButtonHidden,
    readyButtonDisabled,
    cancelButtonText: "取消匹配",
    cancelButtonHidden,
    cancelButtonDisabled: false,
    copyButtonHidden,
    copyButtonDisabled: state.roomCode === null,
  };
}

function getErrorHeading(code: ErrorCode | null): string {
  switch (code) {
    case "queue_full":
      return "匹配队列已满";
    case "capacity_reached":
      return "当前在线人数较多";
    case "room_capacity_reached":
    case "service_busy":
      return "房间服务繁忙";
    case "room_not_found":
      return "房间不存在";
    case "room_full":
      return "房间已满";
    default:
      return "在线 PVP 暂不可用";
  }
}

function getFlowLabel(flow: PvpLobbyFlow): string {
  switch (flow) {
    case "matchmaking":
      return "默认自动匹配";
    case "invite":
      return "邀请好友";
    case "join":
      return "好友房间";
  }
}

function getMetaText(flow: PvpLobbyFlow): string {
  switch (flow) {
    case "matchmaking":
      return "点击 PVP 后会自动连接服务并加入匹配；房间码只作为邀请好友、输入房间码和 QA 的次级入口。";
    case "invite":
      return "私人房间是次级入口，适合邀请好友、房间码联调和 QA 测试。";
    case "join":
      return "输入好友提供的房间码后加入房间；默认主流程仍然是自动匹配。";
  }
}

function getCurrentRoomPlayer(state: PvpConnectionState): PvpRoomPlayer | null {
  if (state.playerSlot === null) {
    return null;
  }

  return state.roomPlayers.find((player) => player.playerSlot === state.playerSlot) ?? null;
}

function getRoomPlayersLabel(state: PvpConnectionState): string {
  if (state.roomCode === null) {
    return "";
  }

  if (state.roomPlayers.length === 0) {
    return state.roomPhase === "countdown" ? "正在同步房间状态" : "等待房间状态同步";
  }

  if (state.roomPlayers.length === 1) {
    const [player] = state.roomPlayers;

    if (player === undefined) {
      return "";
    }

    return `${getPlayerLabel(player, state.playerSlot)} ${getPlayerPresenceLabel(player)}，等待好友加入`;
  }

  return state.roomPlayers
    .map((player) => `${getPlayerLabel(player, state.playerSlot)} ${getPlayerPresenceLabel(player)}`)
    .join(" · ");
}

function getPlayerLabel(player: PvpRoomPlayer, currentSlot: PlayerSlot | null): string {
  return player.playerSlot === currentSlot ? "你" : player.playerSlot.toUpperCase();
}

function getPlayerPresenceLabel(player: PvpRoomPlayer): string {
  if (!player.connected) {
    return "已断开";
  }

  return player.ready ? "已准备" : "已连接";
}

function formatDuration(milliseconds: number): string {
  const totalSeconds = Math.max(0, Math.floor(milliseconds / 1000));
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;

  return `${minutes}:${String(seconds).padStart(2, "0")}`;
}
