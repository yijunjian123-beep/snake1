import type { PvpPlayerId } from "../src/pvp/net/protocol.js";
export interface MatchmakingQueueEntry {
    readonly playerId: PvpPlayerId;
    readonly joinedAt: number;
}
export declare class MatchmakingQueue {
    #private;
    get size(): number;
    has(playerId: PvpPlayerId): boolean;
    enqueue(playerId: PvpPlayerId, now?: number): MatchmakingQueueEntry;
    dequeue(): MatchmakingQueueEntry | undefined;
    remove(playerId: PvpPlayerId): MatchmakingQueueEntry | undefined;
    get(playerId: PvpPlayerId): MatchmakingQueueEntry | undefined;
    getPosition(playerId: PvpPlayerId): number | undefined;
    values(): readonly MatchmakingQueueEntry[];
}
