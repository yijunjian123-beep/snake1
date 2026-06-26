import type { Server } from "node:http";
import { WebSocketServer } from "ws";
import { ConnectionRegistry } from "./connectionRegistry.js";
import type { PvpServerConfig } from "./config.js";
export interface PvpServerRuntime {
    readonly httpServer: Server;
    readonly wsServer: WebSocketServer;
    readonly connections: ConnectionRegistry;
    listen(): Promise<number>;
    close(): Promise<void>;
}
export declare function createPvpServer(config: PvpServerConfig): PvpServerRuntime;
export declare function getListeningPort(httpServer: Server): number | null;
