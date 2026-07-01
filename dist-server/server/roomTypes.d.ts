import type { PlayerSlot, PvpPlayerId, PvpRoomPlayer, RoomCode, RoomPhase, ServerGameOverMessage, ServerSnapshotMessage } from "../src/pvp/net/protocol.js";
import type { PvpInputState, PvpPlayerInputRecord, PvpPlayerInputState, PvpRuntimeState } from "../src/pvp/shared/pvpGame.js";
export declare const CONNECTION_STATES: readonly ["idle", "in_queue", "in_room", "countdown", "playing", "finished", "disconnected"];
export type ConnectionState = (typeof CONNECTION_STATES)[number];
export declare const ROOM_TYPES: readonly ["matchmaking", "private"];
export type RoomType = (typeof ROOM_TYPES)[number];
export interface ManagedRoomPlayer {
    readonly playerId: PvpPlayerId;
    readonly playerSlot: PlayerSlot;
    nickname?: string;
    ready: boolean;
    connected: boolean;
}
export type RoomPlayerInputState = PvpPlayerInputState;
export type RoomPlayerInputRecord = PvpPlayerInputRecord;
export type RoomInputState = PvpInputState;
export interface ManagedRoom {
    readonly roomId: string;
    readonly roomCode: RoomCode;
    readonly roomType: RoomType;
    readonly players: ManagedRoomPlayer[];
    readonly createdAt: number;
    updatedAt: number;
    phase: RoomPhase;
    readonly seed: number;
    readonly tickRate: number;
    countdownTimer: NodeJS.Timeout | null;
    tickTimer: NodeJS.Timeout | null;
    countdownEndsAt?: number;
    finishedAt?: number;
    readonly startTick: number;
    readonly inputDelayTicks: number;
    inputState?: RoomInputState;
    gameState?: PvpRuntimeState;
    lastSnapshot?: ServerSnapshotMessage;
    lastGameOver?: ServerGameOverMessage;
}
export interface PlayerDepartureResult {
    readonly room: ManagedRoom;
    readonly removedPlayer: ManagedRoomPlayer;
    readonly remainingPlayers: readonly ManagedRoomPlayer[];
    readonly roomDestroyed: boolean;
}
export interface QueueStateSnapshot {
    readonly position?: number;
    readonly waitingMs: number;
    readonly estimatedWaitMs?: number;
    readonly onlineCount: number;
    readonly queuedCount: number;
}
export declare function countConnectedRoomPlayers(players: readonly ManagedRoomPlayer[]): number;
export declare function toProtocolRoomPlayers(players: readonly ManagedRoomPlayer[]): readonly PvpRoomPlayer[];
export declare function findRoomPlayerBySlot(players: readonly ManagedRoomPlayer[], playerSlot: PlayerSlot): ManagedRoomPlayer | undefined;
export declare function findRoomPlayerById(players: readonly ManagedRoomPlayer[], playerId: PvpPlayerId): ManagedRoomPlayer | undefined;
