import { readPvpServerConfig } from "./config.js";
import { logServerEvent } from "./logging.js";
import { createPvpServer } from "./pvpServer.js";
const config = readPvpServerConfig();
const runtime = createPvpServer(config);
let shutdownPromise = null;
logServerEvent("server_start", {
    port: config.port,
    wsPath: config.wsPath,
    maxConnections: config.maxConnections,
    maxRooms: config.maxRooms,
    maxQueue: config.maxQueue,
});
runtime.listen().then((port) => {
    logServerEvent("server_listening", {
        port,
        wsPath: config.wsPath,
    });
}).catch((error) => {
    logServerEvent("server_error", {
        errorCode: "internal_error",
        message: error instanceof Error ? error.message : String(error),
    });
    process.exitCode = 1;
});
function shutdown() {
    if (shutdownPromise !== null) {
        return;
    }
    logServerEvent("server_shutdown", {
        phase: "requested",
    });
    shutdownPromise = runtime.close({
        graceful: true,
        graceMs: 1_000,
    }).then(() => {
        logServerEvent("server_shutdown", {
            phase: "complete",
        });
        process.exit(0);
    }).catch((error) => {
        logServerEvent("server_error", {
            errorCode: "internal_error",
            message: error instanceof Error ? error.message : String(error),
        });
        process.exit(1);
    });
}
process.once("SIGINT", shutdown);
process.once("SIGTERM", shutdown);
