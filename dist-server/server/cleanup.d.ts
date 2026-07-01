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
export declare function collectExpiredRoomIds(rooms: readonly ManagedRoom[], config: CleanupSweepConfig, now?: number): CleanupSweepResult;
