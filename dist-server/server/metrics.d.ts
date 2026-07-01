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
    readonly tickRate: number;
    readonly inputDelayTicks: number;
    readonly pvpTargetStepMs: number;
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
export declare function createPvpMessageRates(now?: number): PvpServerMessageRates;
export declare function recordPvpIncomingMessage(context: PvpMetricsContext): void;
export declare function recordPvpOutgoingMessage(context: PvpMetricsContext, count?: number): void;
export declare function samplePvpMessageRates(context: PvpMetricsContext, now?: number): void;
export declare function createPvpMetricsSnapshot(context: PvpMetricsContext, now?: number): PvpServerMetricsSnapshot;
