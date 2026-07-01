import type { Server } from "node:http";
import { WebSocketServer } from "ws";
import { ConnectionRegistry } from "./connectionRegistry.js";
import type { PvpServerConfig } from "./config.js";
import { MatchmakingQueue } from "./matchmakingQueue.js";
import { RoomManager } from "./roomManager.js";
interface ShutdownOptions {
    readonly graceful?: boolean;
    readonly graceMs?: number;
}
export interface PvpServerRuntime {
    readonly httpServer: Server;
    readonly wsServer: WebSocketServer;
    readonly connections: ConnectionRegistry;
    readonly matchmakingQueue: MatchmakingQueue;
    readonly rooms: RoomManager;
    listen(): Promise<number>;
    close(options?: ShutdownOptions): Promise<void>;
}
export declare function createPvpServer(config: PvpServerConfig): PvpServerRuntime;
export declare function getListeningPort(httpServer: Server): number | null;
export {};
