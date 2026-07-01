import type { ClientToServerMessage, PvpSessionToken, ServerToClientMessage } from "./protocol.js";
export interface WebSocketMessageEventLike {
    readonly data: unknown;
}
export interface WebSocketCloseEventLike {
    readonly code?: number;
    readonly reason?: string;
    readonly wasClean?: boolean;
}
export interface WebSocketLike {
    readonly readyState: number;
    send(data: string): void;
    close(code?: number, reason?: string): void;
    addEventListener(type: "open", listener: () => void): void;
    addEventListener(type: "message", listener: (event: WebSocketMessageEventLike) => void): void;
    addEventListener(type: "error", listener: () => void): void;
    addEventListener(type: "close", listener: (event: WebSocketCloseEventLike) => void): void;
    removeEventListener(type: "open", listener: () => void): void;
    removeEventListener(type: "message", listener: (event: WebSocketMessageEventLike) => void): void;
    removeEventListener(type: "error", listener: () => void): void;
    removeEventListener(type: "close", listener: (event: WebSocketCloseEventLike) => void): void;
}
export type WebSocketFactory = (url: string) => WebSocketLike;
export interface PvpClientOptions {
    readonly url: string;
    readonly socketFactory?: WebSocketFactory;
    readonly onOpen?: () => void;
    readonly onMessage?: (message: ServerToClientMessage) => void;
    readonly onError?: () => void;
    readonly onClose?: (event: {
        readonly code: number;
        readonly reason: string;
        readonly wasClean: boolean;
    }) => void;
    readonly onInvalidMessage?: (detail: string) => void;
}
export declare class PvpClient {
    private socket;
    private manualClose;
    private sessionToken;
    private readonly options;
    constructor(options: PvpClientOptions);
    get isConnected(): boolean;
    get currentSessionToken(): PvpSessionToken | null;
    connect(): void;
    send(message: ClientToServerMessage): boolean;
    disconnect(code?: number, reason?: string): void;
    private readonly handleOpen;
    private readonly handleMessage;
    private readonly handleError;
    private readonly handleClose;
    private attachSocket;
    private detachSocket;
}
