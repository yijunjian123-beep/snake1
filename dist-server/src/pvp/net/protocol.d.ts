export declare const DIRECTIONS: readonly ["up", "right", "down", "left"];
export type Direction = (typeof DIRECTIONS)[number];
export declare const PLAYER_SLOTS: readonly ["p1", "p2"];
export type PlayerSlot = (typeof PLAYER_SLOTS)[number];
export declare const ROOM_PHASES: readonly ["waiting", "ready", "countdown", "playing", "finished"];
export type RoomPhase = (typeof ROOM_PHASES)[number];
export declare const ERROR_CODES: readonly ["invalid_message", "unsupported_version", "invalid_session", "room_not_found", "room_full", "room_capacity_reached", "not_in_room", "already_in_room", "queue_full", "capacity_reached", "invalid_state", "service_busy", "rate_limited", "server_busy", "server_shutdown", "internal_error"];
export type ErrorCode = (typeof ERROR_CODES)[number];
export declare const GAME_OVER_REASONS: readonly ["wall", "snake_body", "head_to_head", "black_hole", "star_beast", "forfeit", "opponent_left", "opponent_disconnected", "desync", "timeout", "server_shutdown", "draw", "unknown"];
export type GameOverReason = (typeof GAME_OVER_REASONS)[number];
export type PvpTick = number;
export type PvpInputSeq = number;
export type RoomCode = string;
export type PvpPlayerId = string;
export type PvpSessionToken = string;
export type PvpStateHash = string;
export type PvpWinner = PlayerSlot | "draw" | null;
export declare const PVP_LIMITS: {
    readonly minTick: 0;
    readonly maxTick: 2147483647;
    readonly minSeq: 1;
    readonly maxSeq: 2147483647;
    readonly minRoomCodeLength: 4;
    readonly maxRoomCodeLength: 8;
    readonly minPlayerIdLength: 4;
    readonly maxPlayerIdLength: 64;
    readonly minSessionTokenLength: 8;
    readonly maxSessionTokenLength: 128;
    readonly maxNicknameLength: 20;
    readonly maxClientVersionLength: 32;
    readonly minStateHashLength: 8;
    readonly maxStateHashLength: 128;
    readonly maxBoardCoordinate: 255;
    readonly minTickRate: 1;
    readonly maxTickRate: 60;
    readonly maxInputDelayTicks: 10;
    readonly maxClockTime: number;
    readonly maxQueuePosition: 250;
    readonly maxOnlineCount: 250;
    readonly maxQueuedCount: 250;
    readonly maxWaitingMs: 86400000;
    readonly maxCountdownMs: 10000;
};
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
export type ClientToServerMessage = ClientHelloMessage | ClientCreateRoomMessage | ClientJoinRoomMessage | ClientLeaveRoomMessage | ClientReadyMessage | ClientMatchmakingJoinMessage | ClientMatchmakingCancelMessage | ClientInputMessage | ClientResultCandidateMessage | ClientPingMessage;
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
export type ServerToClientMessage = ServerWelcomeMessage | ServerRoomCreatedMessage | ServerRoomJoinedMessage | ServerRoomStateMessage | ServerQueueStateMessage | ServerMatchFoundMessage | ServerCountdownMessage | ServerGameStartMessage | ServerPeerInputMessage | ServerSnapshotMessage | ServerGameOverMessage | ServerOpponentLeftMessage | ServerReconnectResultMessage | ServerErrorMessage | ServerPongMessage | ServerShutdownMessage;
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
    readonly foods?: readonly PvpGridCell[];
    readonly players?: readonly PvpPlayerSnapshot[];
}
export type ServerFullSnapshotMessage = ServerSnapshotMessage & {
    readonly foods: readonly PvpGridCell[];
    readonly players: readonly PvpPlayerSnapshot[];
};
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
