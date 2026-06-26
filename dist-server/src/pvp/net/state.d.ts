import type { PlayerSlot, RoomCode, RoomPhase } from "./protocol.js";
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
