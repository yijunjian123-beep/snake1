import type { ClientToServerMessage, Direction, ErrorCode, GameOverReason, PlayerSlot, PvpPlayerId, PvpSessionToken, PvpStateHash, PvpWinner, RoomCode, RoomPhase, ServerToClientMessage } from "./protocol.js";
export type ValidationResult<T> = {
    readonly ok: true;
    readonly value: T;
} | {
    readonly ok: false;
    readonly error: string;
};
export declare function isDirection(value: unknown): value is Direction;
export declare function isPlayerSlot(value: unknown): value is PlayerSlot;
export declare function isRoomPhase(value: unknown): value is RoomPhase;
export declare function isErrorCode(value: unknown): value is ErrorCode;
export declare function isGameOverReason(value: unknown): value is GameOverReason;
export declare function isValidTick(value: unknown): value is number;
export declare function isValidInputSeq(value: unknown): value is number;
export declare function isValidRoomCode(value: unknown): value is RoomCode;
export declare function isValidPlayerId(value: unknown): value is PvpPlayerId;
export declare function isValidSessionToken(value: unknown): value is PvpSessionToken;
export declare function isValidStateHash(value: unknown): value is PvpStateHash;
export declare function isWinner(value: unknown): value is PvpWinner;
export declare function validateClientMessage(value: unknown): ValidationResult<ClientToServerMessage>;
export declare function validateServerMessage(value: unknown): ValidationResult<ServerToClientMessage>;
export declare function isClientToServerMessage(value: unknown): value is ClientToServerMessage;
export declare function isServerToClientMessage(value: unknown): value is ServerToClientMessage;
