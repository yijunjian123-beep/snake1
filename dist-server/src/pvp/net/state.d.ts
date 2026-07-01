import type { ErrorCode, PlayerSlot, PvpRoomPlayer, RoomCode, RoomPhase } from "./protocol.js";
export declare const ROOM_PHASE_TRANSITIONS: Readonly<Record<RoomPhase, readonly RoomPhase[]>>;
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
export declare function isValidRoomPhaseTransition(from: RoomPhase, to: RoomPhase): boolean;
export declare function getNextRoomPhases(from: RoomPhase): readonly RoomPhase[];
export declare function assertNeverRoomPhase(phase: never): never;
export declare function getRoomPhaseAfterReadyChange(current: PvpRoomState): RoomPhase;
export declare function getRoomPhaseAfterCountdown(current: PvpRoomState): RoomPhase;
export declare function getRoomPhaseAfterGameOver(current: PvpRoomState): RoomPhase;
export declare function isTerminalRoomPhase(phase: RoomPhase): boolean;
export declare function isKnownRoomPhase(value: string): value is RoomPhase;
export declare const DEFAULT_PVP_UNAVAILABLE_MESSAGE = "\u5728\u7EBF PVP \u6682\u4E0D\u53EF\u7528\uFF0C\u53EF\u4EE5\u5148\u73A9\u5355\u4EBA\u6A21\u5F0F";
export declare const PVP_CONNECTION_STATUSES: readonly ["connecting", "connected", "matchmaking", "matched", "countdown", "playing", "disconnected", "reconnecting", "error"];
export type PvpConnectionStatus = (typeof PVP_CONNECTION_STATUSES)[number];
export declare const PVP_LOBBY_FLOWS: readonly ["matchmaking", "invite", "join"];
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
    readonly randomMatchButtonText: string;
    readonly randomMatchButtonDisabled: boolean;
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
export declare function createInitialPvpConnectionState(flow?: PvpLobbyFlow, joinCode?: string): PvpConnectionState;
export declare function normalizeRoomCodeInput(value: string): string;
export declare function hasValidRoomCode(value: string): boolean;
export declare function getPvpErrorMessage(code: ErrorCode | null, fallback?: string): string;
export declare function getPvpPanelState(state: PvpConnectionState, now?: number): PvpPanelState;
