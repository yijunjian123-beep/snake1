import type WebSocket from "ws";
import type { PvpPlayerId, PvpSessionToken } from "../src/pvp/net/protocol.js";
export interface PvpConnection {
    readonly playerId: PvpPlayerId;
    readonly sessionToken: PvpSessionToken;
    readonly socket: WebSocket;
    readonly connectedAt: number;
    lastSeenAt: number;
}
export declare class ConnectionRegistry {
    #private;
    get size(): number;
    add(socket: WebSocket, now?: number): PvpConnection;
    remove(playerId: PvpPlayerId): void;
    touch(playerId: PvpPlayerId, now?: number): void;
    getExpired(now: number, timeoutMs: number): readonly PvpConnection[];
    values(): readonly PvpConnection[];
}
