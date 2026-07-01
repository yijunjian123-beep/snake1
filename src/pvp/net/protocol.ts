export const DIRECTIONS = ["up", "right", "down", "left"] as const;
export type Direction = (typeof DIRECTIONS)[number];

export const PLAYER_SLOTS = ["p1", "p2"] as const;
export type PlayerSlot = (typeof PLAYER_SLOTS)[number];

export const ROOM_PHASES = ["waiting", "ready", "countdown", "playing", "finished"] as const;
export type RoomPhase = (typeof ROOM_PHASES)[number];

export const ERROR_CODES = [
  "invalid_message",
  "unsupported_version",
  "invalid_session",
  "room_not_found",
  "room_full",
  "room_capacity_reached",
  "not_in_room",
  "already_in_room",
  "queue_full",
  "capacity_reached",
  "invalid_state",
  "service_busy",
  "rate_limited",
  "server_busy",
  "server_shutdown",
  "internal_error",
] as const;
export type ErrorCode = (typeof ERROR_CODES)[number];

export const GAME_OVER_REASONS = [
  "wall",
  "snake_body",
  "head_to_head",
  "black_hole",
  "star_beast",
  "forfeit",
  "opponent_left",
  "opponent_disconnected",
  "desync",
  "timeout",
  "server_shutdown",
  "draw",
  "unknown",
] as const;
export type GameOverReason = (typeof GAME_OVER_REASONS)[number];

export type PvpTick = number;
export type PvpInputSeq = number;
export type RoomCode = string;
export type PvpPlayerId = string;
export type PvpSessionToken = string;
export type PvpStateHash = string;
export type PvpWinner = PlayerSlot | "draw" | null;

export const PVP_LIMITS = {
  minTick: 0,
  maxTick: 2_147_483_647,
  minSeq: 1,
  maxSeq: 2_147_483_647,
  minRoomCodeLength: 4,
  maxRoomCodeLength: 8,
  minPlayerIdLength: 4,
  maxPlayerIdLength: 64,
  minSessionTokenLength: 8,
  maxSessionTokenLength: 128,
  maxNicknameLength: 20,
  maxClientVersionLength: 32,
  minStateHashLength: 8,
  maxStateHashLength: 128,
  maxBoardCoordinate: 255,
  minTickRate: 1,
  maxTickRate: 60,
  maxInputDelayTicks: 10,
  maxClockTime: Number.MAX_SAFE_INTEGER,
  maxQueuePosition: 250,
  maxOnlineCount: 250,
  maxQueuedCount: 250,
  maxWaitingMs: 86_400_000,
  maxCountdownMs: 10_000,
} as const;

export interface PvpRoomPlayer {
  readonly playerId: PvpPlayerId;
  readonly playerSlot: PlayerSlot;
  readonly nickname?: string;
  readonly ready: boolean;
  readonly connected: boolean;
}

export interface PvpGridCell {
  readonly column: number;
  readonly row: number;
}

export interface PvpPlayerSnapshot {
  readonly playerSlot: PlayerSlot;
  readonly snake: readonly PvpGridCell[];
  readonly direction: Direction;
  readonly score: number;
  readonly coresEaten: number;
  readonly alive: boolean;
  readonly deathReason: GameOverReason | null;
  readonly lastProcessedSeq: PvpInputSeq;
}

export type PvpSnakeHeads = Readonly<Record<PlayerSlot, PvpGridCell | null>>;
export type PvpAliveMap = Readonly<Record<PlayerSlot, boolean>>;

export type ClientToServerMessage =
  | ClientHelloMessage
  | ClientCreateRoomMessage
  | ClientJoinRoomMessage
  | ClientLeaveRoomMessage
  | ClientReadyMessage
  | ClientMatchmakingJoinMessage
  | ClientMatchmakingCancelMessage
  | ClientInputMessage
  | ClientResultCandidateMessage
  | ClientPingMessage;

export interface ClientHelloMessage {
  readonly type: "hello";
  readonly clientVersion: string;
  readonly nickname?: string;
  readonly sessionToken?: PvpSessionToken;
}

export interface ClientCreateRoomMessage {
  readonly type: "createRoom";
}

export interface ClientJoinRoomMessage {
  readonly type: "joinRoom";
  readonly roomCode: RoomCode;
}

export interface ClientLeaveRoomMessage {
  readonly type: "leaveRoom";
}

export interface ClientReadyMessage {
  readonly type: "ready";
  readonly ready: boolean;
}

export interface ClientMatchmakingJoinMessage {
  readonly type: "matchmakingJoin";
}

export interface ClientMatchmakingCancelMessage {
  readonly type: "matchmakingCancel";
}

export interface ClientInputMessage {
  readonly type: "input";
  readonly seq: PvpInputSeq;
  readonly tick: PvpTick;
  readonly direction: Direction;
}

export interface ClientResultCandidateMessage {
  readonly type: "resultCandidate";
  readonly tick: PvpTick;
  readonly winner: PvpWinner;
  readonly reason: GameOverReason;
  readonly stateHash?: PvpStateHash;
}

export interface ClientPingMessage {
  readonly type: "ping";
  readonly clientTime: number;
}

export type ServerToClientMessage =
  | ServerWelcomeMessage
  | ServerRoomCreatedMessage
  | ServerRoomJoinedMessage
  | ServerRoomStateMessage
  | ServerQueueStateMessage
  | ServerMatchFoundMessage
  | ServerCountdownMessage
  | ServerGameStartMessage
  | ServerPeerInputMessage
  | ServerSnapshotMessage
  | ServerGameOverMessage
  | ServerOpponentLeftMessage
  | ServerReconnectResultMessage
  | ServerErrorMessage
  | ServerPongMessage
  | ServerShutdownMessage;

export interface ServerWelcomeMessage {
  readonly type: "welcome";
  readonly playerId: PvpPlayerId;
  readonly sessionToken: PvpSessionToken;
  readonly serverTime: number;
}

export interface ServerRoomCreatedMessage {
  readonly type: "roomCreated";
  readonly roomCode: RoomCode;
  readonly playerSlot: PlayerSlot;
}

export interface ServerRoomJoinedMessage {
  readonly type: "roomJoined";
  readonly roomCode: RoomCode;
  readonly playerSlot: PlayerSlot;
  readonly players: readonly PvpRoomPlayer[];
}

export interface ServerRoomStateMessage {
  readonly type: "roomState";
  readonly roomCode: RoomCode;
  readonly phase: RoomPhase;
  readonly players: readonly PvpRoomPlayer[];
}

export interface ServerQueueStateMessage {
  readonly type: "queueState";
  readonly position?: number;
  readonly waitingMs: number;
  readonly estimatedWaitMs?: number;
  readonly onlineCount: number;
  readonly queuedCount: number;
}

export interface ServerMatchFoundMessage {
  readonly type: "matchFound";
  readonly roomCode: RoomCode;
  readonly playerSlot: PlayerSlot;
}

export interface ServerCountdownMessage {
  readonly type: "countdown";
  readonly startsInMs: number;
}

export interface ServerGameStartMessage {
  readonly type: "gameStart";
  readonly seed: number;
  readonly startTick: PvpTick;
  readonly tickRate: number;
  readonly playerSlots: readonly PlayerSlot[];
  readonly inputDelayTicks: number;
}

export interface ServerPeerInputMessage {
  readonly type: "peerInput";
  readonly playerSlot: PlayerSlot;
  readonly seq: PvpInputSeq;
  readonly tick: PvpTick;
  readonly direction: Direction;
}

export interface ServerSnapshotMessage {
  readonly type: "snapshot";
  readonly phase: RoomPhase;
  readonly tick: PvpTick;
  readonly stateHash: PvpStateHash;
  readonly snakeHeads: PvpSnakeHeads;
  readonly alive: PvpAliveMap;
  readonly foods: readonly PvpGridCell[];
  readonly players: readonly PvpPlayerSnapshot[];
}

export interface ServerGameOverMessage {
  readonly type: "gameOver";
  readonly winner: PvpWinner;
  readonly reason: GameOverReason;
  readonly finalTick: PvpTick;
}

export interface ServerOpponentLeftMessage {
  readonly type: "opponentLeft";
}

export interface ServerReconnectResultMessage {
  readonly type: "reconnectResult";
  readonly ok: boolean;
  readonly roomCode?: RoomCode;
  readonly playerSlot?: PlayerSlot;
  readonly phase?: RoomPhase;
}

export interface ServerErrorMessage {
  readonly type: "error";
  readonly code: ErrorCode;
  readonly message: string;
}

export interface ServerPongMessage {
  readonly type: "pong";
  readonly clientTime: number;
  readonly serverTime: number;
}

export interface ServerShutdownMessage {
  readonly type: "serverShutdown";
  readonly message?: string;
  readonly retryAfterMs?: number;
}
