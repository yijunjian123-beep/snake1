import type { ManagedRoom } from "./roomTypes.js";

export interface CleanupSweepConfig {
  readonly finishedRoomTtlMs: number;
  readonly privateRoomWaitTimeoutMs: number;
  readonly reconnectGraceMs: number;
}

export interface CleanupSweepResult {
  readonly finishedRoomIds: readonly string[];
  readonly expiredPrivateRoomIds: readonly string[];
}

export function collectExpiredRoomIds(
  rooms: readonly ManagedRoom[],
  config: CleanupSweepConfig,
  now: number = Date.now(),
): CleanupSweepResult {
  const finishedRoomIds: string[] = [];
  const expiredPrivateRoomIds: string[] = [];

  for (const room of rooms) {
    if (room.phase === "finished" && room.finishedAt !== undefined) {
      if (now - room.finishedAt >= config.finishedRoomTtlMs) {
        finishedRoomIds.push(room.roomId);
      }

      continue;
    }

    if (room.phase === "waiting" || room.phase === "ready") {
      const connectedPlayers = room.players.filter((player) => player.connected).length;
      const timeoutMs = connectedPlayers === 0 ? config.reconnectGraceMs : config.privateRoomWaitTimeoutMs;

      if (now - room.updatedAt >= timeoutMs) {
        expiredPrivateRoomIds.push(room.roomId);
      }
    }
  }

  return {
    finishedRoomIds,
    expiredPrivateRoomIds,
  };
}
