import type { PvpPlayerId } from "../src/pvp/net/protocol.js";

export interface MatchmakingQueueEntry {
  readonly playerId: PvpPlayerId;
  readonly joinedAt: number;
}

export class MatchmakingQueue {
  readonly #entriesByPlayerId = new Map<PvpPlayerId, MatchmakingQueueEntry>();
  readonly #order: PvpPlayerId[] = [];

  get size(): number {
    return this.#order.length;
  }

  has(playerId: PvpPlayerId): boolean {
    return this.#entriesByPlayerId.has(playerId);
  }

  enqueue(playerId: PvpPlayerId, now: number = Date.now()): MatchmakingQueueEntry {
    const existing = this.#entriesByPlayerId.get(playerId);

    if (existing !== undefined) {
      return existing;
    }

    const entry: MatchmakingQueueEntry = {
      playerId,
      joinedAt: now,
    };

    this.#entriesByPlayerId.set(playerId, entry);
    this.#order.push(playerId);
    return entry;
  }

  dequeue(): MatchmakingQueueEntry | undefined {
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

  remove(playerId: PvpPlayerId): MatchmakingQueueEntry | undefined {
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

  get(playerId: PvpPlayerId): MatchmakingQueueEntry | undefined {
    return this.#entriesByPlayerId.get(playerId);
  }

  getPosition(playerId: PvpPlayerId): number | undefined {
    const index = this.#order.indexOf(playerId);
    return index >= 0 ? index + 1 : undefined;
  }

  values(): readonly MatchmakingQueueEntry[] {
    return this.#order
      .map((playerId) => this.#entriesByPlayerId.get(playerId))
      .filter((entry): entry is MatchmakingQueueEntry => entry !== undefined);
  }
}

