export class MatchmakingQueue {
    #entriesByPlayerId = new Map();
    #order = [];
    get size() {
        return this.#order.length;
    }
    has(playerId) {
        return this.#entriesByPlayerId.has(playerId);
    }
    enqueue(playerId, now = Date.now()) {
        const existing = this.#entriesByPlayerId.get(playerId);
        if (existing !== undefined) {
            return existing;
        }
        const entry = {
            playerId,
            joinedAt: now,
        };
        this.#entriesByPlayerId.set(playerId, entry);
        this.#order.push(playerId);
        return entry;
    }
    dequeue() {
        while (this.#order.length > 0) {
            const playerId = this.#order.shift();
            if (playerId === undefined) {
                return undefined;
            }
            const entry = this.#entriesByPlayerId.get(playerId);
            if (entry === undefined) {
                continue;
            }
            this.#entriesByPlayerId.delete(playerId);
            return entry;
        }
        return undefined;
    }
    remove(playerId) {
        const entry = this.#entriesByPlayerId.get(playerId);
        if (entry === undefined) {
            return undefined;
        }
        this.#entriesByPlayerId.delete(playerId);
        const index = this.#order.indexOf(playerId);
        if (index >= 0) {
            this.#order.splice(index, 1);
        }
        return entry;
    }
    get(playerId) {
        return this.#entriesByPlayerId.get(playerId);
    }
    getPosition(playerId) {
        const index = this.#order.indexOf(playerId);
        return index >= 0 ? index + 1 : undefined;
    }
    values() {
        return this.#order
            .map((playerId) => this.#entriesByPlayerId.get(playerId))
            .filter((entry) => entry !== undefined);
    }
}
