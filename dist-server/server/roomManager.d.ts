import type { PlayerSlot, PvpPlayerId, RoomCode, RoomPhase } from "../src/pvp/net/protocol.js";
import type { PvpConnection } from "./connectionRegistry.js";
import type { ManagedRoom, PlayerDepartureResult } from "./roomTypes.js";
export interface RoomManagerConfig {
    readonly tickRate: number;
    readonly inputDelayTicks: number;
}
export type JoinPrivateRoomResult = {
    readonly ok: true;
    readonly room: ManagedRoom;
    readonly playerSlot: PlayerSlot;
} | {
    readonly ok: false;
    readonly code: "room_not_found" | "room_full";
};
export declare class RoomManager {
    #private;
    constructor(config: RoomManagerConfig);
    get size(): number;
    values(): readonly ManagedRoom[];
    get(roomId: string): ManagedRoom | undefined;
    getByCode(roomCode: RoomCode): ManagedRoom | undefined;
    getByPlayerId(playerId: PvpPlayerId): ManagedRoom | undefined;
    createMatchmakingRoom(firstPlayer: PvpConnection, secondPlayer: PvpConnection, now?: number): ManagedRoom;
    createPrivateRoom(owner: PvpConnection, now?: number): ManagedRoom;
    joinPrivateRoom(roomCode: RoomCode, guest: PvpConnection, now?: number): JoinPrivateRoomResult;
    updatePlayerReady(playerId: PvpPlayerId, ready: boolean, now?: number): ManagedRoom | undefined;
    updatePlayerNickname(playerId: PvpPlayerId, nickname: string | undefined, now?: number): ManagedRoom | undefined;
    setPhase(roomId: string, phase: RoomPhase, now?: number): ManagedRoom | undefined;
    startCountdown(roomId: string, countdownTimer: NodeJS.Timeout, countdownEndsAt: number, now?: number): ManagedRoom | undefined;
    markPlaying(roomId: string, now?: number): ManagedRoom | undefined;
    markFinished(roomId: string, now?: number): ManagedRoom | undefined;
    clearCountdown(roomId: string): void;
    destroyRoom(roomId: string): ManagedRoom | undefined;
    removePlayer(playerId: PvpPlayerId, now?: number): PlayerDepartureResult | undefined;
}
