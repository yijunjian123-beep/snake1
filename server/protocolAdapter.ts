import type { RawData, WebSocket } from "ws";

import type { ClientToServerMessage, ServerToClientMessage } from "../src/pvp/net/protocol.js";
import { validateClientMessage, validateServerMessage } from "../src/pvp/net/validation.js";

type ServerMessageRecorder = () => void;

let serverMessageRecorder: ServerMessageRecorder | null = null;

export function setServerMessageRecorder(recorder: ServerMessageRecorder | null): void {
  serverMessageRecorder = recorder;
}

export function decodeClientMessage(data: RawData): ReturnType<typeof validateClientMessage> {
  const text = rawDataToText(data);

  if (text === null) {
    return { ok: false, error: "message must be valid UTF-8 text" };
  }

  try {
    return validateClientMessage(JSON.parse(text));
  } catch {
    return { ok: false, error: "message must be valid JSON" };
  }
}

export function sendServerMessage(socket: WebSocket, message: ServerToClientMessage): void {
  const validation = validateServerMessage(message);

  if (!validation.ok) {
    throw new Error(`invalid server message: ${validation.error}`);
  }

  serverMessageRecorder?.();
  socket.send(JSON.stringify(message));
}

export function createInvalidMessageError(detail: string): ServerToClientMessage {
  return {
    type: "error",
    code: "invalid_message",
    message: detail,
  };
}

export function isHandledClientMessage(message: ClientToServerMessage): message is Extract<
  ClientToServerMessage,
  { readonly type: "hello" | "ping" }
> {
  return message.type === "hello" || message.type === "ping";
}

function rawDataToText(data: RawData): string | null {
  if (typeof data === "string") {
    return data;
  }

  if (Buffer.isBuffer(data)) {
    return data.toString("utf8");
  }

  if (data instanceof ArrayBuffer) {
    return Buffer.from(data).toString("utf8");
  }

  if (Array.isArray(data)) {
    return Buffer.concat(data).toString("utf8");
  }

  return null;
}
