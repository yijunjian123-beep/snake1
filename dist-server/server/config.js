export const DEFAULT_PVP_SERVER_CONFIG = {
    port: 8787,
    wsPath: "/ws",
    maxConnections: 250,
    maxRooms: 120,
    maxQueue: 250,
    heartbeatIntervalMs: 10_000,
    connectionTimeoutMs: 30_000,
    reconnectGraceMs: 15_000,
    countdownMs: 3_000,
    tickRate: 12,
    inputDelayTicks: 3,
    messageRateLimitWindowMs: 5_000,
    messageRateLimitMaxCount: 120,
    cleanupIntervalMs: 1_000,
    finishedRoomTtlMs: 60_000,
    privateRoomWaitTimeoutMs: 300_000,
    allowedOrigins: ["localhost", "127.0.0.1", "::1"],
};
function readPositiveInteger(value, fallback) {
    if (value === undefined || value.trim() === "") {
        return fallback;
    }
    const parsed = Number(value);
    if (!Number.isInteger(parsed) || parsed <= 0) {
        return fallback;
    }
    return parsed;
}
function normalizeWsPath(value) {
    if (value === undefined || value.trim() === "") {
        return DEFAULT_PVP_SERVER_CONFIG.wsPath;
    }
    const trimmed = value.trim();
    return trimmed.startsWith("/") ? trimmed : `/${trimmed}`;
}
function normalizeAllowedOrigin(value) {
    const trimmed = value.trim();
    if (trimmed === "") {
        return trimmed;
    }
    if (/^[a-zA-Z][a-zA-Z\d+\-.]*:\/\//.test(trimmed)) {
        try {
            return new URL(trimmed).origin;
        }
        catch {
            return trimmed.replace(/\/+$/, "");
        }
    }
    return trimmed.replace(/\/+$/, "");
}
function parseAllowedOrigins(value, env) {
    if (value === undefined || value.trim() === "") {
        return env.NODE_ENV === "production" ? [] : DEFAULT_PVP_SERVER_CONFIG.allowedOrigins;
    }
    return value
        .split(",")
        .map((origin) => normalizeAllowedOrigin(origin))
        .filter((origin) => origin.length > 0);
}
export function readPvpServerConfig(env = process.env) {
    return {
        port: readPositiveInteger(env.PORT, DEFAULT_PVP_SERVER_CONFIG.port),
        wsPath: normalizeWsPath(env.PVP_WS_PATH),
        maxConnections: readPositiveInteger(env.PVP_MAX_CONNECTIONS, DEFAULT_PVP_SERVER_CONFIG.maxConnections),
        maxRooms: readPositiveInteger(env.PVP_MAX_ROOMS, DEFAULT_PVP_SERVER_CONFIG.maxRooms),
        maxQueue: readPositiveInteger(env.PVP_MAX_QUEUE, DEFAULT_PVP_SERVER_CONFIG.maxQueue),
        heartbeatIntervalMs: readPositiveInteger(env.PVP_HEARTBEAT_INTERVAL_MS, DEFAULT_PVP_SERVER_CONFIG.heartbeatIntervalMs),
        connectionTimeoutMs: readPositiveInteger(env.PVP_CONNECTION_TIMEOUT_MS, DEFAULT_PVP_SERVER_CONFIG.connectionTimeoutMs),
        reconnectGraceMs: readPositiveInteger(env.PVP_RECONNECT_GRACE_MS, DEFAULT_PVP_SERVER_CONFIG.reconnectGraceMs),
        countdownMs: readPositiveInteger(env.PVP_COUNTDOWN_MS, DEFAULT_PVP_SERVER_CONFIG.countdownMs),
        tickRate: readPositiveInteger(env.PVP_TICK_RATE, DEFAULT_PVP_SERVER_CONFIG.tickRate),
        inputDelayTicks: readPositiveInteger(env.PVP_INPUT_DELAY_TICKS, DEFAULT_PVP_SERVER_CONFIG.inputDelayTicks),
        messageRateLimitWindowMs: readPositiveInteger(env.PVP_MESSAGE_RATE_LIMIT_WINDOW_MS, DEFAULT_PVP_SERVER_CONFIG.messageRateLimitWindowMs),
        messageRateLimitMaxCount: readPositiveInteger(env.PVP_MESSAGE_RATE_LIMIT_MAX_COUNT, DEFAULT_PVP_SERVER_CONFIG.messageRateLimitMaxCount),
        cleanupIntervalMs: readPositiveInteger(env.PVP_CLEANUP_INTERVAL_MS, DEFAULT_PVP_SERVER_CONFIG.cleanupIntervalMs),
        finishedRoomTtlMs: readPositiveInteger(env.PVP_FINISHED_ROOM_TTL_MS, DEFAULT_PVP_SERVER_CONFIG.finishedRoomTtlMs),
        privateRoomWaitTimeoutMs: readPositiveInteger(env.PVP_PRIVATE_ROOM_WAIT_TIMEOUT_MS, DEFAULT_PVP_SERVER_CONFIG.privateRoomWaitTimeoutMs),
        allowedOrigins: parseAllowedOrigins(env.ALLOWED_ORIGINS, env),
    };
}
export function isAllowedOrigin(origin, allowedOrigins) {
    if (origin === undefined || origin.trim() === "") {
        return false;
    }
    try {
        const parsed = new URL(origin);
        return allowedOrigins.some((allowedOrigin) => {
            const normalized = normalizeAllowedOrigin(allowedOrigin);
            if (normalized.length === 0) {
                return false;
            }
            if (/^[a-zA-Z][a-zA-Z\d+\-.]*:\/\//.test(normalized)) {
                try {
                    return new URL(normalized).origin === parsed.origin;
                }
                catch {
                    return false;
                }
            }
            return normalized === parsed.origin || normalized === parsed.host || normalized === parsed.hostname;
        });
    }
    catch {
        return false;
    }
}
