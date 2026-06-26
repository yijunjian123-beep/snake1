import { PVP_LIMITS } from "./protocol.js";
import type { ClientToServerMessage, ErrorCode, RoomPhase, ServerToClientMessage } from "./protocol.js";
import { PvpClient, type WebSocketFactory } from "./PvpClient.js";
import {
  createInitialPvpConnectionState,
  DEFAULT_PVP_UNAVAILABLE_MESSAGE,
  getPvpErrorMessage,
  getPvpPanelState,
  normalizeRoomCodeInput,
  type PvpConnectionState,
  type PvpLobbyFlow,
  type PvpPanelState,
} from "./state.js";

interface ImportMetaEnvLike {
  readonly DEV?: boolean;
  readonly VITE_PVP_WS_URL?: string;
}

interface ImportMetaLike {
  readonly env?: ImportMetaEnvLike;
}

interface SessionStorageLike {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

export interface PvpConnectionControllerOptions {
  readonly url: string | null;
  readonly socketFactory?: WebSocketFactory;
  readonly now?: () => number;
  readonly reconnectDelayMs?: number;
  readonly maxReconnectAttempts?: number;
  readonly sessionStorage?: SessionStorageLike | null;
  readonly onPeerInput?: (message: Extract<ServerToClientMessage, { readonly type: "peerInput" }>) => void;
  readonly onSnapshot?: (message: Extract<ServerToClientMessage, { readonly type: "snapshot" }>) => void;
  readonly onGameOver?: (message: Extract<ServerToClientMessage, { readonly type: "gameOver" }>) => void;
}

export interface PvpConnectionController {
  getState(): PvpConnectionState;
  getPanelState(now?: number): PvpPanelState;
  subscribe(listener: (state: PvpConnectionState) => void): () => void;
  sendInput(message: Extract<ClientToServerMessage, { readonly type: "input" }>): boolean;
  enterMatchmaking(): void;
  createPrivateRoom(): void;
  openJoinRoomEntry(): void;
  updateJoinCode(value: string): void;
  joinPrivateRoom(): void;
  toggleReady(): void;
  cancelMatchmaking(): void;
  disconnect(): void;
  destroy(): void;
}

const DEFAULT_RECONNECT_DELAY_MS = 1_000;
const DEFAULT_MAX_RECONNECT_ATTEMPTS = 2;
const PVP_CLIENT_VERSION = "0.1.0";
const SESSION_TOKEN_STORAGE_KEY = "snake1:pvp-session-token";

const NOTICE_RECONNECTING = "正在重连";
const NOTICE_RECONNECT_SUCCESS = "重连成功";
const NOTICE_RESUME_MATCHMAKING = "重连成功，正在重新进入匹配";
const NOTICE_RESUME_PRIVATE_ROOM = "重连成功，正在重新创建房间";
const NOTICE_RESUME_JOIN_ROOM = "重连成功，正在重新加入房间";
const NOTICE_MATCHMAKING_CANCELLED = "已取消匹配";
const NOTICE_OPPONENT_LEFT = "对手已离开";
const NOTICE_OPPONENT_DISCONNECTED = "对手断线，你获胜";
const NOTICE_ROOM_CREATED = "房间已创建，把房间码发给好友";
const NOTICE_WAITING_ROOM = "等待房间状态同步";
const NOTICE_MATCHMAKING_READY = "匹配成功，正在等待对局开始";
const NOTICE_COUNTDOWN = "对局即将开始";
const NOTICE_PLAYING = "在线对局已开始";

export function resolvePvpWebSocketUrl(env?: ImportMetaEnvLike): string | null {
  const resolvedEnv = env ?? (import.meta as ImportMetaLike).env;
  const configuredUrl = resolvedEnv?.VITE_PVP_WS_URL?.trim();

  if (configuredUrl) {
    return configuredUrl;
  }

  if (!resolvedEnv?.DEV) {
    return null;
  }

  const hostname = globalThis.location?.hostname?.trim() || "127.0.0.1";
  const protocol = globalThis.location?.protocol === "https:" ? "wss" : "ws";

  return `${protocol}://${hostname}:8787/ws`;
}

function resolveSessionStorage(explicit?: SessionStorageLike | null): SessionStorageLike | null {
  if (explicit !== undefined) {
    return explicit;
  }

  try {
    const windowStorage = (globalThis as { window?: { sessionStorage?: SessionStorageLike } }).window?.sessionStorage;

    if (windowStorage !== undefined) {
      return windowStorage;
    }

    return (globalThis as { sessionStorage?: SessionStorageLike }).sessionStorage ?? null;
  } catch {
    return null;
  }
}

function readStoredSessionToken(storage: SessionStorageLike | null): string | null {
  if (storage === null) {
    return null;
  }

  try {
    return storage.getItem(SESSION_TOKEN_STORAGE_KEY);
  } catch {
    return null;
  }
}

function storeSessionToken(storage: SessionStorageLike | null, token: string | null): void {
  if (storage === null) {
    return;
  }

  try {
    if (token === null) {
      storage.removeItem(SESSION_TOKEN_STORAGE_KEY);
      return;
    }

    storage.setItem(SESSION_TOKEN_STORAGE_KEY, token);
  } catch {
    // Ignore storage failures in private browsing or restricted contexts.
  }
}

export function createPvpConnectionController(options: PvpConnectionControllerOptions): PvpConnectionController {
  const listeners = new Set<(state: PvpConnectionState) => void>();
  const now = options.now ?? (() => Date.now());
  const reconnectDelayMs = options.reconnectDelayMs ?? DEFAULT_RECONNECT_DELAY_MS;
  const maxReconnectAttempts = options.maxReconnectAttempts ?? DEFAULT_MAX_RECONNECT_ATTEMPTS;
  const sessionStorage = options.sessionStorage ?? resolveSessionStorage();
  const storedSessionToken = readStoredSessionToken(sessionStorage);

  let state: PvpConnectionState = storedSessionToken === null
    ? createInitialPvpConnectionState()
    : {
        ...createInitialPvpConnectionState(),
        sessionToken: storedSessionToken,
      };
  let client: PvpClient | null = null;
  let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  let reconnectAttempts = 0;
  let manualClose = false;
  let destroyed = false;
  let welcomedCurrentSocket = false;

  function emit(): void {
    if (destroyed) {
      return;
    }

    for (const listener of listeners) {
      listener(state);
    }
  }

  function setState(nextState: PvpConnectionState): void {
    state = nextState;
    emit();
  }

  function updateState(patch: Partial<PvpConnectionState>): void {
    setState({
      ...state,
      ...patch,
    });
  }

  function clearReconnectTimer(): void {
    if (reconnectTimer !== null) {
      clearTimeout(reconnectTimer);
      reconnectTimer = null;
    }
  }

  function buildLobbyState(flow: PvpLobbyFlow, patch: Partial<PvpConnectionState> = {}): PvpConnectionState {
    const joinCode = flow === "join" ? state.joinCode : "";

    return {
      ...createInitialPvpConnectionState(flow, joinCode),
      sessionToken: state.sessionToken,
      ...patch,
    };
  }

  function persistSessionToken(sessionToken: string | null): void {
    storeSessionToken(sessionStorage, sessionToken);
  }

  function failWithUnavailableMessage(flow: PvpLobbyFlow): void {
    setState(buildLobbyState(flow, {
      status: "error",
      errorMessage: DEFAULT_PVP_UNAVAILABLE_MESSAGE,
    }));
  }

  function closeClient(): void {
    clearReconnectTimer();

    if (client === null) {
      return;
    }

    manualClose = true;
    client.disconnect();
    client = null;
    welcomedCurrentSocket = false;
  }

  function createClientForCurrentFlow(): void {
    if (destroyed) {
      return;
    }

    if (options.url === null) {
      failWithUnavailableMessage(state.flow);
      return;
    }

    welcomedCurrentSocket = false;

    try {
      client = new PvpClient({
        url: options.url,
        socketFactory: options.socketFactory,
        onOpen: handleSocketOpen,
        onMessage: handleServerMessage,
        onError: handleSocketError,
        onClose: handleSocketClose,
        onInvalidMessage: handleInvalidMessage,
      });
      client.connect();
    } catch {
      client = null;
      failWithUnavailableMessage(state.flow);
    }
  }

  function connectWithFlow(flow: PvpLobbyFlow): void {
    closeClient();
    reconnectAttempts = 0;
    setState(buildLobbyState(flow, {
      status: "connecting",
    }));
    createClientForCurrentFlow();
  }

  function handleSocketOpen(): void {
    if (destroyed) {
      return;
    }

    if (state.status === "connecting" || state.status === "reconnecting") {
      updateState({
        errorCode: null,
        errorMessage: null,
      });
    }
  }

  function handleServerMessage(message: ServerToClientMessage): void {
    if (destroyed) {
      return;
    }

    switch (message.type) {
      case "welcome":
        handleWelcome(message);
        return;
      case "queueState":
        updateState({
          status: message.position === undefined ? "connected" : "matchmaking",
          queuePosition: message.position ?? null,
          queueStartedAt: message.position === undefined ? null : now() - message.waitingMs,
          onlineCount: message.onlineCount,
          queuedCount: message.queuedCount,
          errorCode: null,
          errorMessage: null,
          notice: message.position === undefined ? state.notice : null,
        });
        return;
      case "matchFound":
        updateState({
          status: "matched",
          roomCode: message.roomCode,
          playerSlot: message.playerSlot,
          queuePosition: null,
          queueStartedAt: null,
          roomPhase: null,
          roomPlayers: [],
          countdownEndsAt: null,
          errorCode: null,
          errorMessage: null,
          notice: NOTICE_MATCHMAKING_READY,
        });
        return;
      case "roomCreated":
        updateState({
          status: "connected",
          roomCode: message.roomCode,
          playerSlot: message.playerSlot,
          roomPhase: "waiting",
          roomPlayers: [],
          queuePosition: null,
          queueStartedAt: null,
          countdownEndsAt: null,
          errorCode: null,
          errorMessage: null,
          notice: NOTICE_ROOM_CREATED,
        });
        return;
      case "roomJoined":
        updateState({
          status: "connected",
          roomCode: message.roomCode,
          playerSlot: message.playerSlot,
          roomPhase: message.players.length === 2 ? "ready" : "waiting",
          roomPlayers: message.players,
          queuePosition: null,
          queueStartedAt: null,
          countdownEndsAt: null,
          errorCode: null,
          errorMessage: null,
          notice: message.players.length === 2 ? "双方已准备，等待开始" : NOTICE_WAITING_ROOM,
        });
        return;
      case "roomState":
        updateState({
          status: getStatusForRoomPhase(state.status, message.phase),
          roomCode: message.roomCode,
          roomPhase: message.phase,
          roomPlayers: message.players,
          errorCode: null,
          errorMessage: null,
          notice: getRoomNotice(state.flow, message.phase, message.players.length),
        });
        return;
      case "countdown":
        updateState({
          status: "countdown",
          countdownEndsAt: now() + message.startsInMs,
          errorCode: null,
          errorMessage: null,
          notice: NOTICE_COUNTDOWN,
        });
        return;
      case "gameStart":
        updateState({
          status: "playing",
          countdownEndsAt: null,
          gameStart: {
            seed: message.seed,
            startTick: message.startTick,
            tickRate: message.tickRate,
            inputDelayTicks: message.inputDelayTicks,
          },
          roomPhase: "playing",
          errorCode: null,
          errorMessage: null,
          notice: NOTICE_PLAYING,
        });
        return;
      case "opponentLeft":
        updateState({
          status: "connected",
          playerSlot: null,
          roomCode: null,
          roomPhase: null,
          roomPlayers: [],
          countdownEndsAt: null,
          queuePosition: null,
          queueStartedAt: null,
          gameStart: null,
          errorCode: null,
          errorMessage: null,
          notice: NOTICE_OPPONENT_LEFT,
        });
        return;
      case "gameOver":
        options.onGameOver?.(message);
        updateState({
          status: "connected",
          roomPhase: "finished",
          countdownEndsAt: null,
          errorCode: null,
          errorMessage: null,
          notice: message.reason === "opponent_disconnected"
            ? NOTICE_OPPONENT_DISCONNECTED
            : message.reason === "opponent_left"
              ? NOTICE_OPPONENT_LEFT
              : "对局已结束",
        });
        return;
      case "error":
        handleServerError(message.code, message.message);
        return;
      case "serverShutdown":
        handleServerError("server_shutdown", message.message ?? DEFAULT_PVP_UNAVAILABLE_MESSAGE);
        return;
      case "reconnectResult":
        handleReconnectResult(message);
        return;
      case "peerInput":
        options.onPeerInput?.(message);
        return;
      case "pong":
        return;
      case "snapshot":
        options.onSnapshot?.(message);
        return;
    }
  }

  function handleWelcome(message: Extract<ServerToClientMessage, { readonly type: "welcome" }>): void {
    welcomedCurrentSocket = true;
    reconnectAttempts = 0;
    clearReconnectTimer();

    updateState({
      playerId: message.playerId,
      errorCode: null,
      errorMessage: null,
    });

    if (state.sessionToken !== null) {
      updateState({
        status: "reconnecting",
        notice: NOTICE_RECONNECTING,
      });

      client?.send({
        type: "hello",
        clientVersion: PVP_CLIENT_VERSION,
        sessionToken: state.sessionToken,
      });
      return;
    }

    updateState({
      status: "connected",
      sessionToken: message.sessionToken,
      notice: null,
    });
    persistSessionToken(message.sessionToken);
    resumeRequestedFlowAfterReconnect(false);
  }

  function handleReconnectResult(message: Extract<ServerToClientMessage, { readonly type: "reconnectResult" }>): void {
    if (!message.ok) {
      handleServerError("invalid_session", "重连失败，请重新进入在线 PVP");
      return;
    }

    if (message.roomCode !== undefined || message.phase !== undefined || message.playerSlot !== undefined) {
      updateState({
        status: getStatusForRoomPhase("connected", message.phase ?? "waiting"),
        roomCode: message.roomCode ?? state.roomCode,
        playerSlot: message.playerSlot ?? state.playerSlot,
        roomPhase: message.phase ?? state.roomPhase,
        errorCode: null,
        errorMessage: null,
        notice: NOTICE_RECONNECT_SUCCESS,
      });
      return;
    }

    updateState({
      status: "connected",
      errorCode: null,
      errorMessage: null,
      notice: NOTICE_RECONNECT_SUCCESS,
    });
    resumeRequestedFlowAfterReconnect(true);
  }

  function resumeRequestedFlowAfterReconnect(isReconnectResume: boolean): void {
    if (client === null) {
      return;
    }

    switch (state.flow) {
      case "matchmaking":
        client.send({ type: "matchmakingJoin" });
        updateState({
          status: isReconnectResume ? "connected" : "matchmaking",
          queuePosition: null,
          queueStartedAt: isReconnectResume ? null : now(),
          errorCode: null,
          errorMessage: null,
          notice: isReconnectResume ? NOTICE_RESUME_MATCHMAKING : "已进入匹配队列",
        });
        return;
      case "invite":
        client.send({ type: "createRoom" });
        if (isReconnectResume) {
          updateState({
            status: "connected",
            errorCode: null,
            errorMessage: null,
            notice: NOTICE_RESUME_PRIVATE_ROOM,
          });
        }
        return;
      case "join":
        if (state.joinCode.length > 0) {
          client.send({ type: "joinRoom", roomCode: state.joinCode });
          if (isReconnectResume) {
            updateState({
              status: "connected",
              errorCode: null,
              errorMessage: null,
              notice: NOTICE_RESUME_JOIN_ROOM,
            });
          }
        }
        return;
    }
  }

  function handleServerError(code: ErrorCode, fallback: string): void {
    const message = getPvpErrorMessage(code, fallback);

    if (code === "invalid_session") {
      persistSessionToken(null);
      setState({
        ...createInitialPvpConnectionState(state.flow, state.joinCode),
        status: "disconnected",
        errorCode: code,
        errorMessage: message,
        notice: null,
      });
      return;
    }

    updateState({
      status: "error",
      errorCode: code,
      errorMessage: message,
      countdownEndsAt: null,
      queuePosition: null,
      queueStartedAt: null,
      notice: null,
    });
  }

  function handleInvalidMessage(detail: string): void {
    updateState({
      status: "error",
      errorCode: "invalid_message",
      errorMessage: getPvpErrorMessage("invalid_message", detail),
      notice: null,
    });
  }

  function handleSocketError(): void {
    if (destroyed) {
      return;
    }

    if (state.status === "connecting") {
      updateState({
        status: "error",
        errorMessage: DEFAULT_PVP_UNAVAILABLE_MESSAGE,
      });
    }
  }

  function handleSocketClose(): void {
    if (destroyed) {
      return;
    }

    client = null;

    if (manualClose) {
      manualClose = false;
      return;
    }

    clearReconnectTimer();

    if (shouldReconnect(state.status) && reconnectAttempts < maxReconnectAttempts) {
      startReconnectAttempt();
      return;
    }

    if (shouldReconnect(state.status)) {
      if (state.status === "connecting" && state.sessionToken === null) {
        updateState({
          status: "error",
          errorMessage: state.errorMessage ?? DEFAULT_PVP_UNAVAILABLE_MESSAGE,
          notice: null,
        });
        return;
      }

      updateState({
        status: "disconnected",
        errorCode: "invalid_session",
        errorMessage: "重连失败，请重新进入在线 PVP",
        countdownEndsAt: null,
        queuePosition: null,
        queueStartedAt: null,
        roomCode: null,
        roomPhase: null,
        roomPlayers: [],
        playerSlot: null,
        gameStart: null,
        notice: null,
      });
      return;
    }

    if (!welcomedCurrentSocket) {
      if (state.status === "connecting") {
        updateState({
          status: "error",
          errorMessage: state.errorMessage ?? DEFAULT_PVP_UNAVAILABLE_MESSAGE,
          notice: null,
        });
        return;
      }

      updateState({
        status: "disconnected",
        countdownEndsAt: null,
        queuePosition: null,
        queueStartedAt: null,
        roomCode: null,
        roomPhase: null,
        roomPlayers: [],
        playerSlot: null,
        gameStart: null,
        notice: state.flow === "matchmaking" ? "连接已断开，正在等待重试" : "连接已断开",
      });
      return;
    }
  }

  function startReconnectAttempt(): void {
    reconnectAttempts += 1;
    setState({
      ...state,
      status: "reconnecting",
      errorCode: null,
      errorMessage: null,
      queuePosition: null,
      queueStartedAt: null,
      notice: NOTICE_RECONNECTING,
    });

    reconnectTimer = setTimeout(() => {
      reconnectTimer = null;
      createClientForCurrentFlow();
    }, reconnectDelayMs * reconnectAttempts);
  }

  return {
    getState(): PvpConnectionState {
      return state;
    },
    getPanelState(currentTime: number = now()): PvpPanelState {
      return getPvpPanelState(state, currentTime);
    },
    subscribe(listener: (state: PvpConnectionState) => void): () => void {
      listeners.add(listener);

      return (): void => {
        listeners.delete(listener);
      };
    },
    sendInput(message: Extract<ClientToServerMessage, { readonly type: "input" }>): boolean {
      if (client === null || !client.isConnected) {
        return false;
      }

      client.send(message);
      return true;
    },
    enterMatchmaking(): void {
      connectWithFlow("matchmaking");
    },
    createPrivateRoom(): void {
      connectWithFlow("invite");
    },
    openJoinRoomEntry(): void {
      closeClient();
      reconnectAttempts = 0;
      setState(buildLobbyState("join", {
        status: "disconnected",
        errorCode: null,
        errorMessage: null,
        notice: null,
      }));
    },
    updateJoinCode(value: string): void {
      const joinCode = normalizeRoomCodeInput(value);

      updateState({
        flow: "join",
        joinCode,
        errorCode: null,
        errorMessage: null,
      });
    },
    joinPrivateRoom(): void {
      const joinCode = normalizeRoomCodeInput(state.joinCode);

      if (joinCode.length < PVP_LIMITS.minRoomCodeLength) {
        setState(buildLobbyState("join", {
          status: "error",
          joinCode,
          errorMessage: `请输入 ${PVP_LIMITS.minRoomCodeLength}-${PVP_LIMITS.maxRoomCodeLength} 位房间码`,
        }));
        return;
      }

      setState({
        ...state,
        flow: "join",
        joinCode,
      });
      connectWithFlow("join");
    },
    toggleReady(): void {
      if (client === null || !client.isConnected || state.playerSlot === null || state.roomCode === null) {
        return;
      }

      const currentPlayer = state.roomPlayers.find((player) => player.playerSlot === state.playerSlot);

      if (currentPlayer === undefined) {
        return;
      }

      client.send({
        type: "ready",
        ready: !currentPlayer.ready,
      });
    },
    cancelMatchmaking(): void {
      if (client !== null && client.isConnected && state.status === "matchmaking") {
        client.send({ type: "matchmakingCancel" });
      }

      persistSessionToken(null);
      closeClient();
      reconnectAttempts = 0;
      setState(buildLobbyState("matchmaking", {
        status: "disconnected",
        sessionToken: null,
        notice: NOTICE_MATCHMAKING_CANCELLED,
      }));
    },
    disconnect(): void {
      persistSessionToken(null);
      closeClient();
      reconnectAttempts = 0;
      setState(createInitialPvpConnectionState());
    },
    destroy(): void {
      destroyed = true;
      listeners.clear();
      clearReconnectTimer();
      closeClient();
    },
  };
}

function shouldReconnect(status: PvpConnectionState["status"]): boolean {
  return status !== "disconnected" && status !== "error";
}

function getStatusForRoomPhase(previousStatus: PvpConnectionState["status"], phase: RoomPhase): PvpConnectionState["status"] {
  switch (phase) {
    case "countdown":
      return "countdown";
    case "playing":
      return "playing";
    case "finished":
      return "connected";
    case "waiting":
    case "ready":
      return previousStatus === "matched" ? "matched" : "connected";
  }
}

function getRoomNotice(flow: PvpLobbyFlow, phase: RoomPhase, playerCount: number): string {
  if (phase === "countdown") {
    return NOTICE_COUNTDOWN;
  }

  if (phase === "playing") {
    return NOTICE_PLAYING;
  }

  if (phase === "finished") {
    return "对局已结束";
  }

  if (flow === "matchmaking") {
    return NOTICE_MATCHMAKING_READY;
  }

  if (playerCount < 2) {
    return NOTICE_WAITING_ROOM;
  }

  return phase === "ready" ? "双方已准备，等待开始" : "双方已进入房间";
}
