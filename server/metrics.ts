import type { PvpServerConfig } from "./config.js";
import type { ConnectionRegistry } from "./connectionRegistry.js";
import type { MatchmakingQueue } from "./matchmakingQueue.js";
import type { RoomManager } from "./roomManager.js";

export interface PvpServerMetricsCounters {
  totalMatches: number;
  totalGameStarts: number;
  totalGameOvers: number;
  totalQueueJoins: number;
  totalQueueCancels: number;
  totalDisconnects: number;
  rejectedByQueueFull: number;
  rejectedByRoomCapacity: number;
  totalMessagesIn: number;
  totalMessagesOut: number;
}

export interface PvpServerMessageRates {
  messagesInPerSec: number;
  messagesOutPerSec: number;
  lastSampleAt: number;
  lastMessagesInTotal: number;
  lastMessagesOutTotal: number;
}

export interface PvpServerMetricsSnapshot extends PvpServerMetricsCounters {
  readonly startedAt: number;
  readonly uptime: number;
  readonly connections: number;
  readonly queueSize: number;
  readonly rooms: number;
  readonly matchmakingRooms: number;
  readonly privateRooms: number;
  readonly countdownRooms: number;
  readonly playingRooms: number;
  readonly finishedRooms: number;
  readonly messagesInPerSec: number;
  readonly messagesOutPerSec: number;
  readonly memoryRss: number;
  readonly maxConnections: number;
  readonly maxRooms: number;
  readonly maxQueue: number;
}

export interface PvpMetricsContext {
  readonly startedAt: number;
  readonly config: PvpServerConfig;
  readonly connections: ConnectionRegistry;
  readonly matchmakingQueue: MatchmakingQueue;
  readonly rooms: RoomManager;
  readonly metrics: PvpServerMetricsCounters;
  readonly messageRates: PvpServerMessageRates;
}

export function createPvpMessageRates(now: number = Date.now()): PvpServerMessageRates {
  return {
    messagesInPerSec: 0,
    messagesOutPerSec: 0,
    lastSampleAt: now,
    lastMessagesInTotal: 0,
    lastMessagesOutTotal: 0,
  };
}

export function recordPvpIncomingMessage(context: PvpMetricsContext): void {
  context.metrics.totalMessagesIn += 1;
}

export function recordPvpOutgoingMessage(context: PvpMetricsContext, count: number = 1): void {
  context.metrics.totalMessagesOut += count;
}

export function samplePvpMessageRates(context: PvpMetricsContext, now: number = Date.now()): void {
  const elapsedMs = Math.max(1, now - context.messageRates.lastSampleAt);
  const elapsedSeconds = elapsedMs / 1_000;

  context.messageRates.messagesInPerSec = (context.metrics.totalMessagesIn - context.messageRates.lastMessagesInTotal) / elapsedSeconds;
  context.messageRates.messagesOutPerSec = (context.metrics.totalMessagesOut - context.messageRates.lastMessagesOutTotal) / elapsedSeconds;
  context.messageRates.lastSampleAt = now;
  context.messageRates.lastMessagesInTotal = context.metrics.totalMessagesIn;
  context.messageRates.lastMessagesOutTotal = context.metrics.totalMessagesOut;
}

export function createPvpMetricsSnapshot(
  context: PvpMetricsContext,
  now: number = Date.now(),
): PvpServerMetricsSnapshot {
  const rooms = context.rooms.values();
  let matchmakingRooms = 0;
  let privateRooms = 0;
  let countdownRooms = 0;
  let playingRooms = 0;
  let finishedRooms = 0;

  for (const room of rooms) {
    if (room.roomType === "matchmaking") {
      matchmakingRooms += 1;
    } else {
      privateRooms += 1;
    }

    switch (room.phase) {
      case "countdown":
        countdownRooms += 1;
        break;
      case "playing":
        playingRooms += 1;
        break;
      case "finished":
        finishedRooms += 1;
        break;
    }
  }

  return {
    startedAt: context.startedAt,
    uptime: Math.max(0, now - context.startedAt) / 1_000,
    connections: context.connections.size,
    queueSize: context.matchmakingQueue.size,
    rooms: rooms.length,
    matchmakingRooms,
    privateRooms,
    countdownRooms,
    playingRooms,
    finishedRooms,
    messagesInPerSec: context.messageRates.messagesInPerSec,
    messagesOutPerSec: context.messageRates.messagesOutPerSec,
    memoryRss: process.memoryUsage().rss,
    maxConnections: context.config.maxConnections,
    maxRooms: context.config.maxRooms,
    maxQueue: context.config.maxQueue,
    ...context.metrics,
  };
}
