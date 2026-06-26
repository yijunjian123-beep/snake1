import { readPvpServerConfig } from "./config.js";
import { createPvpServer } from "./pvpServer.js";
const config = readPvpServerConfig();
const runtime = createPvpServer(config);
runtime.listen().then((port) => {
    console.log(`PVP server listening on http://localhost:${port}`);
    console.log(`WebSocket endpoint ws://localhost:${port}${config.wsPath}`);
}).catch((error) => {
    console.error(error);
    process.exitCode = 1;
});
function shutdown() {
    runtime.close().then(() => {
        process.exit(0);
    }).catch((error) => {
        console.error(error);
        process.exit(1);
    });
}
process.once("SIGINT", shutdown);
process.once("SIGTERM", shutdown);
