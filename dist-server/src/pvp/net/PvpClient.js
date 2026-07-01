import { validateServerMessage } from "./validation.js";
function createBrowserSocket(url) {
    const WebSocketConstructor = globalThis.WebSocket;
    if (WebSocketConstructor === undefined) {
        throw new Error("WebSocket is not available in this environment");
    }
    return new WebSocketConstructor(url);
}
function decodeSocketPayload(data) {
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
    socket = null;
    manualClose = false;
    sessionToken = null;
    options;
    constructor(options) {
        this.options = options;
    }
    get isConnected() {
        return this.socket?.readyState === 1;
    }
    get currentSessionToken() {
        return this.sessionToken;
    }
    connect() {
        if (this.socket !== null && this.socket.readyState <= 1) {
            return;
        }
        const socketFactory = this.options.socketFactory ?? createBrowserSocket;
        this.manualClose = false;
        this.socket = socketFactory(this.options.url);
        this.attachSocket(this.socket);
    }
    send(message) {
        if (!this.isConnected || this.socket === null) {
            return false;
        }
        this.socket.send(JSON.stringify(message));
        return true;
    }
    disconnect(code = 1000, reason = "client_close") {
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
    handleOpen = () => {
        this.options.onOpen?.();
    };
    handleMessage = (event) => {
        const payload = decodeSocketPayload(event.data);
        if (payload === null) {
            this.options.onInvalidMessage?.("message must be valid UTF-8 text");
            return;
        }
        let parsed;
        try {
            parsed = JSON.parse(payload);
        }
        catch {
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
    handleError = () => {
        this.options.onError?.();
    };
    handleClose = (event) => {
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
    attachSocket(socket) {
        socket.addEventListener("open", this.handleOpen);
        socket.addEventListener("message", this.handleMessage);
        socket.addEventListener("error", this.handleError);
        socket.addEventListener("close", this.handleClose);
    }
    detachSocket(socket) {
        socket.removeEventListener("open", this.handleOpen);
        socket.removeEventListener("message", this.handleMessage);
        socket.removeEventListener("error", this.handleError);
        socket.removeEventListener("close", this.handleClose);
    }
}
