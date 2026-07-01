import type { RawData, WebSocket } from "ws";
import type { ClientToServerMessage, ServerToClientMessage } from "../src/pvp/net/protocol.js";
import { validateClientMessage } from "../src/pvp/net/validation.js";
type ServerMessageRecorder = () => void;
export declare function setServerMessageRecorder(recorder: ServerMessageRecorder | null): void;
export declare function decodeClientMessage(data: RawData): ReturnType<typeof validateClientMessage>;
export declare function sendServerMessage(socket: WebSocket, message: ServerToClientMessage): void;
export declare function createInvalidMessageError(detail: string): ServerToClientMessage;
export declare function isHandledClientMessage(message: ClientToServerMessage): message is Extract<ClientToServerMessage, {
    readonly type: "hello" | "ping";
}>;
export {};
