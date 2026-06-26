export const DEFAULT_PVP_SERVER_CONFIG = {
    port: 8787,
    wsPath: "/ws",
    maxConnections: 250,
    heartbeatIntervalMs: 10_000,
    connectionTimeoutMs: 30_000,
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
function parseAllowedOrigins(value) {
    if (value === undefined || value.trim() === "") {
        return DEFAULT_PVP_SERVER_CONFIG.allowedOrigins;
    }
    return value
        .split(",")
        .map((origin) => origin.trim())
        .filter((origin) => origin.length > 0);
}
export function readPvpServerConfig(env = process.env) {
    return {
        port: readPositiveInteger(env.PORT, DEFAULT_PVP_SERVER_CONFIG.port),
        wsPath: normalizeWsPath(env.PVP_WS_PATH),
        maxConnections: readPositiveInteger(env.PVP_MAX_CONNECTIONS, DEFAULT_PVP_SERVER_CONFIG.maxConnections),
        heartbeatIntervalMs: readPositiveInteger(env.PVP_HEARTBEAT_INTERVAL_MS, DEFAULT_PVP_SERVER_CONFIG.heartbeatIntervalMs),
        connectionTimeoutMs: readPositiveInteger(env.PVP_CONNECTION_TIMEOUT_MS, DEFAULT_PVP_SERVER_CONFIG.connectionTimeoutMs),
        allowedOrigins: parseAllowedOrigins(env.ALLOWED_ORIGINS),
    };
}
export function isAllowedOrigin(origin, allowedOrigins) {
    if (origin === undefined || origin.trim() === "") {
        return true;
    }
    if (allowedOrigins.includes("*")) {
        return true;
    }
    try {
        const parsed = new URL(origin);
        return allowedOrigins.some((allowedOrigin) => {
            if (allowedOrigin === origin || allowedOrigin === parsed.origin || allowedOrigin === parsed.hostname) {
                return true;
            }
            return parsed.hostname.endsWith(`.${allowedOrigin}`);
        });
    }
    catch {
        return false;
    }
}
