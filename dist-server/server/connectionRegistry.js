import { randomUUID } from "node:crypto";
export class ConnectionRegistry {
    #connectionsByPlayerId = new Map();
    #connectionsBySessionToken = new Map();
    get size() {
        let activeCount = 0;
        for (const connection of this.#connectionsByPlayerId.values()) {
            if (connection.socket !== null) {
                activeCount += 1;
            }
        }
        return activeCount;
    }
    add(socket, now = Date.now()) {
        const connection = {
            playerId: createPlayerId(),
            sessionToken: createSessionToken(),
            socket,
            connectedAt: now,
            lastSeenAt: now,
            disconnectedAt: null,
            messageWindowStartedAt: now,
            messageCountInWindow: 0,
            status: "idle",
            roomId: null,
        };
        this.#connectionsByPlayerId.set(connection.playerId, connection);
        this.#connectionsBySessionToken.set(connection.sessionToken, connection);
        return connection;
    }
    isCurrent(connection) {
        return this.#connectionsByPlayerId.get(connection.playerId) === connection;
    }
    remove(connection) {
        if (!this.isCurrent(connection)) {
            return undefined;
        }
        this.#connectionsByPlayerId.delete(connection.playerId);
        this.#connectionsBySessionToken.delete(connection.sessionToken);
        return connection;
    }
    touch(connection, now = Date.now()) {
        if (!this.isCurrent(connection)) {
            return;
        }
        connection.lastSeenAt = now;
    }
    disconnect(connection, now = Date.now()) {
        if (!this.isCurrent(connection)) {
            return false;
        }
        connection.socket = null;
        connection.lastSeenAt = now;
        connection.disconnectedAt = now;
        return true;
    }
    restoreSocket(connection, sessionToken, now = Date.now()) {
        const restored = this.#connectionsBySessionToken.get(sessionToken);
        if (restored === undefined || restored === connection) {
            return undefined;
        }
        if (!this.isCurrent(connection)) {
            return undefined;
        }
        const { socket: restoredSocket, ...restoredState } = restored;
        this.#connectionsByPlayerId.delete(connection.playerId);
        this.#connectionsBySessionToken.delete(connection.sessionToken);
        this.#connectionsByPlayerId.delete(restored.playerId);
        this.#connectionsBySessionToken.delete(restored.sessionToken);
        connection.playerId = restoredState.playerId;
        connection.sessionToken = restoredState.sessionToken;
        connection.connectedAt = restoredState.connectedAt;
        connection.lastSeenAt = now;
        connection.disconnectedAt = null;
        connection.messageWindowStartedAt = now;
        connection.messageCountInWindow = 0;
        connection.nickname = restoredState.nickname;
        connection.status = restoredState.status;
        connection.roomId = restoredState.roomId;
        connection.roomCode = restoredState.roomCode;
        connection.playerSlot = restoredState.playerSlot;
        connection.queueJoinedAt = restoredState.queueJoinedAt;
        this.#connectionsByPlayerId.set(connection.playerId, connection);
        this.#connectionsBySessionToken.set(connection.sessionToken, connection);
        if (restoredSocket !== null && restoredSocket !== connection.socket) {
            restoredSocket.close(1000, "reconnected");
        }
        return connection;
    }
    getExpired(now, timeoutMs) {
        return [...this.#connectionsByPlayerId.values()].filter((connection) => connection.socket === null && connection.disconnectedAt !== null && now - connection.disconnectedAt > timeoutMs);
    }
    takeMessageCredit(connection, maxMessages, windowMs, now = Date.now()) {
        if (!this.isCurrent(connection) || connection.socket === null) {
            return false;
        }
        if (now - connection.messageWindowStartedAt >= windowMs) {
            connection.messageWindowStartedAt = now;
            connection.messageCountInWindow = 0;
        }
        connection.messageCountInWindow += 1;
        return connection.messageCountInWindow <= maxMessages;
    }
    get(playerId) {
        return this.#connectionsByPlayerId.get(playerId);
    }
    getBySessionToken(sessionToken) {
        return this.#connectionsBySessionToken.get(sessionToken);
    }
    activeValues() {
        return [...this.#connectionsByPlayerId.values()].filter((connection) => connection.socket !== null);
    }
    values() {
        return [...this.#connectionsByPlayerId.values()];
    }
}
function createPlayerId() {
    return `player_${randomUUID().replaceAll("-", "")}`;
}
function createSessionToken() {
    return `session_${randomUUID().replaceAll("-", "")}`;
}
