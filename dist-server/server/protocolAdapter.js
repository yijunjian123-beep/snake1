import { validateClientMessage, validateServerMessage } from "../src/pvp/net/validation.js";
export function decodeClientMessage(data) {
    const text = rawDataToText(data);
    if (text === null) {
        return { ok: false, error: "message must be valid UTF-8 text" };
    }
    try {
        return validateClientMessage(JSON.parse(text));
    }
    catch {
        return { ok: false, error: "message must be valid JSON" };
    }
}
export function sendServerMessage(socket, message) {
    const validation = validateServerMessage(message);
    if (!validation.ok) {
        throw new Error(`invalid server message: ${validation.error}`);
    }
    socket.send(JSON.stringify(message));
}
export function createInvalidMessageError(detail) {
    return {
        type: "error",
        code: "invalid_message",
        message: detail,
    };
}
export function isHandledClientMessage(message) {
    return message.type === "hello" || message.type === "ping";
}
function rawDataToText(data) {
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
