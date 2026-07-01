import type { ClientToServerMessage, ServerToClientMessage } from "./protocol.js";
import { type WebSocketFactory } from "./PvpClient.js";
import { type PvpConnectionState, type PvpPanelState } from "./state.js";
interface ImportMetaEnvLike {
    readonly DEV?: boolean;
    readonly VITE_PVP_WS_URL?: string;
}
interface SessionStorageLike {
    getItem(key: string): string | null;
    setItem(key: string, value: string): void;
    removeItem(key: string): void;
}
export interface PvpConnectionControllerOptions {
    readonly url: string | null;
    readonly socketFactory?: WebSocketFactory;
    readonly now?: () => number;
    readonly reconnectDelayMs?: number;
    readonly maxReconnectAttempts?: number;
    readonly connectTimeoutMs?: number;
    readonly sessionStorage?: SessionStorageLike | null;
    readonly onPeerInput?: (message: Extract<ServerToClientMessage, {
        readonly type: "peerInput";
    }>) => void;
    readonly onSnapshot?: (message: Extract<ServerToClientMessage, {
        readonly type: "snapshot";
    }>) => void;
    readonly onGameOver?: (message: Extract<ServerToClientMessage, {
        readonly type: "gameOver";
    }>) => void;
}
export interface PvpConnectionController {
    getState(): PvpConnectionState;
    getPanelState(now?: number): PvpPanelState;
    subscribe(listener: (state: PvpConnectionState) => void): () => void;
    sendInput(message: Extract<ClientToServerMessage, {
        readonly type: "input";
    }>): boolean;
    enterMatchmaking(): void;
    resumeSession(): boolean;
    openLobby(): void;
    createPrivateRoom(): void;
    openJoinRoomEntry(): void;
    updateJoinCode(value: string): void;
    joinPrivateRoom(): void;
    toggleReady(): void;
    cancelMatchmaking(): void;
    disconnect(): void;
    destroy(): void;
}
export declare function resolvePvpWebSocketUrl(env?: ImportMetaEnvLike): string | null;
export declare function createPvpConnectionController(options: PvpConnectionControllerOptions): PvpConnectionController;
export {};
