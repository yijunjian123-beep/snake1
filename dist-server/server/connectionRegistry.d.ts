import type WebSocket from "ws";
import type { PlayerSlot, PvpPlayerId, PvpSessionToken, RoomCode } from "../src/pvp/net/protocol.js";
import type { ConnectionState } from "./roomTypes.js";
export interface PvpConnection {
    playerId: PvpPlayerId;
    sessionToken: PvpSessionToken;
    socket: WebSocket | null;
    connectedAt: number;
    lastSeenAt: number;
    disconnectedAt: number | null;
    messageWindowStartedAt: number;
    messageCountInWindow: number;
    nickname?: string;
    status: ConnectionState;
    roomId: string | null;
    roomCode?: RoomCode;
    playerSlot?: PlayerSlot;
    queueJoinedAt?: number;
}
export declare class ConnectionRegistry {
    #private;
    get size(): number;
    add(socket: WebSocket, now?: number): PvpConnection;
    isCurrent(connection: PvpConnection): boolean;
    remove(connection: PvpConnection): PvpConnection | undefined;
    touch(connection: PvpConnection, now?: number): void;
    disconnect(connection: PvpConnection, now?: number): boolean;
    restoreSocket(connection: PvpConnection, sessionToken: PvpSessionToken, now?: number): PvpConnection | undefined;
    getExpired(now: number, timeoutMs: number): readonly PvpConnection[];
    takeMessageCredit(connection: PvpConnection, maxMessages: number, windowMs: number, now?: number): boolean;
    get(playerId: PvpPlayerId): PvpConnection | undefined;
    getBySessionToken(sessionToken: PvpSessionToken): PvpConnection | undefined;
    activeValues(): readonly PvpConnection[];
    values(): readonly PvpConnection[];
}
