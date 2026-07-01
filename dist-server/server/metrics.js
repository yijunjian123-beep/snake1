import { PVP_TARGET_STEP_MS } from "../src/pvp/shared/pvpGame.js";
export function createPvpMessageRates(now = Date.now()) {
    return {
        messagesInPerSec: 0,
        messagesOutPerSec: 0,
        lastSampleAt: now,
        lastMessagesInTotal: 0,
        lastMessagesOutTotal: 0,
    };
}
export function recordPvpIncomingMessage(context) {
    context.metrics.totalMessagesIn += 1;
}
export function recordPvpOutgoingMessage(context, count = 1) {
    context.metrics.totalMessagesOut += count;
}
export function samplePvpMessageRates(context, now = Date.now()) {
    const elapsedMs = Math.max(1, now - context.messageRates.lastSampleAt);
    const elapsedSeconds = elapsedMs / 1_000;
    context.messageRates.messagesInPerSec = (context.metrics.totalMessagesIn - context.messageRates.lastMessagesInTotal) / elapsedSeconds;
    context.messageRates.messagesOutPerSec = (context.metrics.totalMessagesOut - context.messageRates.lastMessagesOutTotal) / elapsedSeconds;
    context.messageRates.lastSampleAt = now;
    context.messageRates.lastMessagesInTotal = context.metrics.totalMessagesIn;
    context.messageRates.lastMessagesOutTotal = context.metrics.totalMessagesOut;
}
export function createPvpMetricsSnapshot(context, now = Date.now()) {
    const rooms = context.rooms.values();
    let matchmakingRooms = 0;
    let privateRooms = 0;
    let countdownRooms = 0;
    let playingRooms = 0;
    let finishedRooms = 0;
    for (const room of rooms) {
        if (room.roomType === "matchmaking") {
            matchmakingRooms += 1;
        }
        else {
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
        tickRate: context.config.tickRate,
        inputDelayTicks: context.config.inputDelayTicks,
        pvpTargetStepMs: PVP_TARGET_STEP_MS,
        ...context.metrics,
    };
}
