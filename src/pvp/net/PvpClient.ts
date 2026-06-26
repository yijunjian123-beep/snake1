import type { ClientToServerMessage, PvpSessionToken, ServerToClientMessage } from "./protocol.js";
import { validateServerMessage } from "./validation.js";

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
  readonly onClose?: (event: { readonly code: number; readonly reason: string; readonly wasClean: boolean }) => void;
  readonly onInvalidMessage?: (detail: string) => void;
}

interface GlobalWithWebSocket {
  readonly WebSocket?: new (url: string) => WebSocketLike;
}

function createBrowserSocket(url: string): WebSocketLike {
  const WebSocketConstructor = (globalThis as unknown as GlobalWithWebSocket).WebSocket;

  if (WebSocketConstructor === undefined) {
    throw new Error("WebSocket is not available in this environment");
  }

  return new WebSocketConstructor(url);
}

function decodeSocketPayload(data: unknown): string | null {
  if (typeof data === "string") {
    return data;
  }

  if (data instanceof ArrayBuffer) {
    return new TextDecoder().decode(data);
  }

  if (ArrayBuffer.isView(data)) {
    return new TextDecoder().decode(new Uint8Array(data.buffer, data.byteOffset, data.byteLength));
  }

  return null;
}

export class PvpClient {
  private socket: WebSocketLike | null = null;
  private manualClose = false;
  private sessionToken: PvpSessionToken | null = null;
  private readonly options: PvpClientOptions;

  public constructor(options: PvpClientOptions) {
    this.options = options;
  }

  public get isConnected(): boolean {
    return this.socket?.readyState === 1;
  }

  public get currentSessionToken(): PvpSessionToken | null {
    return this.sessionToken;
  }

  public connect(): void {
    if (this.socket !== null && this.socket.readyState <= 1) {
      return;
    }

    const socketFactory = this.options.socketFactory ?? createBrowserSocket;
    this.manualClose = false;
    this.socket = socketFactory(this.options.url);
    this.attachSocket(this.socket);
  }

  public send(message: ClientToServerMessage): boolean {
    if (!this.isConnected || this.socket === null) {
      return false;
    }

    this.socket.send(JSON.stringify(message));
    return true;
  }

  public disconnect(code = 1000, reason = "client_close"): void {
    this.manualClose = true;

    if (this.socket === null) {
      return;
    }

    if (this.socket.readyState >= 2) {
      this.detachSocket(this.socket);
      this.socket = null;
      return;
    }

    this.socket.close(code, reason);
  }

  private readonly handleOpen = (): void => {
    this.options.onOpen?.();
  };

  private readonly handleMessage = (event: WebSocketMessageEventLike): void => {
    const payload = decodeSocketPayload(event.data);

    if (payload === null) {
      this.options.onInvalidMessage?.("message must be valid UTF-8 text");
      return;
    }

    let parsed: unknown;

    try {
      parsed = JSON.parse(payload);
    } catch {
      this.options.onInvalidMessage?.("message must be valid JSON");
      return;
    }

    const validation = validateServerMessage(parsed);

    if (!validation.ok) {
      this.options.onInvalidMessage?.(validation.error);
      return;
    }

    if (validation.value.type === "welcome") {
      this.sessionToken = validation.value.sessionToken;
    }

    this.options.onMessage?.(validation.value);
  };

  private readonly handleError = (): void => {
    this.options.onError?.();
  };

  private readonly handleClose = (event: WebSocketCloseEventLike): void => {
    const socket = this.socket;

    if (socket !== null) {
      this.detachSocket(socket);
      this.socket = null;
    }

    const wasManualClose = this.manualClose;
    this.manualClose = false;

    this.options.onClose?.({
      code: event.code ?? (wasManualClose ? 1000 : 1006),
      reason: event.reason ?? "",
      wasClean: event.wasClean ?? wasManualClose,
    });
  };

  private attachSocket(socket: WebSocketLike): void {
    socket.addEventListener("open", this.handleOpen);
    socket.addEventListener("message", this.handleMessage);
    socket.addEventListener("error", this.handleError);
    socket.addEventListener("close", this.handleClose);
  }

  private detachSocket(socket: WebSocketLike): void {
    socket.removeEventListener("open", this.handleOpen);
    socket.removeEventListener("message", this.handleMessage);
    socket.removeEventListener("error", this.handleError);
    socket.removeEventListener("close", this.handleClose);
  }
}
