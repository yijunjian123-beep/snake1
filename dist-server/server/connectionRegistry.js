import { randomUUID } from "node:crypto";
export class ConnectionRegistry {
    #connections = new Map();
    get size() {
        return this.#connections.size;
    }
    add(socket, now = Date.now()) {
        const connection = {
            playerId: createPlayerId(),
            sessionToken: createSessionToken(),
            socket,
            connectedAt: now,
            lastSeenAt: now,
        };
        this.#connections.set(connection.playerId, connection);
        return connection;
    }
    remove(playerId) {
        this.#connections.delete(playerId);
    }
    touch(playerId, now = Date.now()) {
        const connection = this.#connections.get(playerId);
        if (connection !== undefined) {
            connection.lastSeenAt = now;
        }
    }
    getExpired(now, timeoutMs) {
        return [...this.#connections.values()].filter((connection) => now - connection.lastSeenAt > timeoutMs);
    }
    values() {
        return [...this.#connections.values()];
    }
}
function createPlayerId() {
    return `player_${randomUUID().replaceAll("-", "")}`;
}
function createSessionToken() {
    return `session_${randomUUID().replaceAll("-", "")}`;
}
