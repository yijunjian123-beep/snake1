export interface PvpServerConfig {
    readonly port: number;
    readonly wsPath: string;
    readonly maxConnections: number;
    readonly maxRooms: number;
    readonly maxQueue: number;
    readonly heartbeatIntervalMs: number;
    readonly connectionTimeoutMs: number;
    readonly reconnectGraceMs: number;
    readonly countdownMs: number;
    readonly tickRate: number;
    readonly inputDelayTicks: number;
    readonly messageRateLimitWindowMs: number;
    readonly messageRateLimitMaxCount: number;
    readonly cleanupIntervalMs: number;
    readonly finishedRoomTtlMs: number;
    readonly privateRoomWaitTimeoutMs: number;
    readonly allowedOrigins: readonly string[];
}
export declare const DEFAULT_PVP_SERVER_CONFIG: PvpServerConfig;
export declare function readPvpServerConfig(env?: NodeJS.ProcessEnv): PvpServerConfig;
export declare function isAllowedOrigin(origin: string | undefined, allowedOrigins: readonly string[]): boolean;
