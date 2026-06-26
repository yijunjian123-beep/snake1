import { createServer } from "node:http";
import { WebSocketServer } from "ws";
import { ConnectionRegistry } from "./connectionRegistry.js";
import { isAllowedOrigin } from "./config.js";
import { createInvalidMessageError, decodeClientMessage, isHandledClientMessage, sendServerMessage } from "./protocolAdapter.js";
export function createPvpServer(config) {
    const startedAt = Date.now();
    const connections = new ConnectionRegistry();
    const wsServer = new WebSocketServer({ noServer: true });
    const httpServer = createServer((request, response) => {
        handleHttpRequest(request, response, startedAt, connections);
    });
    const heartbeatTimer = setInterval(() => {
        sweepHeartbeat(connections, config.connectionTimeoutMs);
    }, config.heartbeatIntervalMs);
    heartbeatTimer.unref();
    httpServer.on("upgrade", (request, socket, head) => {
        const requestUrl = new URL(request.url ?? "/", "http://localhost");
        if (requestUrl.pathname !== config.wsPath) {
            socket.write("HTTP/1.1 404 Not Found\r\n\r\n");
            socket.destroy();
            return;
        }
        if (!isAllowedOrigin(request.headers.origin, config.allowedOrigins)) {
            socket.write("HTTP/1.1 403 Forbidden\r\n\r\n");
            socket.destroy();
            return;
        }
        if (connections.size >= config.maxConnections) {
            wsServer.handleUpgrade(request, socket, head, (webSocket) => {
                sendServerMessage(webSocket, {
                    type: "error",
                    code: "capacity_reached",
                    message: "PVP server is full",
                });
                webSocket.close(1013, "capacity_reached");
            });
            return;
        }
        wsServer.handleUpgrade(request, socket, head, (webSocket) => {
            wsServer.emit("connection", webSocket, request);
        });
    });
    wsServer.on("connection", (socket) => {
        const connection = connections.add(socket);
        setImmediate(() => {
            sendIfOpen(socket, {
                type: "welcome",
                playerId: connection.playerId,
                sessionToken: connection.sessionToken,
                serverTime: Date.now(),
            });
        });
        socket.on("message", (data) => {
            connections.touch(connection.playerId);
            handleSocketMessage(connection, data);
        });
        socket.on("pong", () => {
            connections.touch(connection.playerId);
        });
        socket.on("close", () => {
            connections.remove(connection.playerId);
        });
        socket.on("error", () => {
            connections.remove(connection.playerId);
        });
    });
    return {
        httpServer,
        wsServer,
        connections,
        listen: () => listen(httpServer, config.port),
        close: async () => {
            clearInterval(heartbeatTimer);
            for (const connection of connections.values()) {
                connection.socket.close(1001, "server closing");
            }
            await closeWebSocketServer(wsServer);
            await closeHttpServer(httpServer);
        },
    };
}
function handleHttpRequest(request, response, startedAt, connections) {
    if (request.method === "GET" && request.url === "/health") {
        response.writeHead(200, { "content-type": "application/json; charset=utf-8" });
        response.end(JSON.stringify({
            ok: true,
            uptime: Math.max(0, Date.now() - startedAt) / 1_000,
            connections: connections.size,
        }));
        return;
    }
    response.writeHead(404, { "content-type": "application/json; charset=utf-8" });
    response.end(JSON.stringify({ ok: false, error: "not_found" }));
}
function handleSocketMessage(connection, data) {
    const decoded = decodeClientMessage(data);
    if (!decoded.ok) {
        sendServerMessage(connection.socket, createInvalidMessageError(decoded.error));
        return;
    }
    if (!isHandledClientMessage(decoded.value)) {
        sendServerMessage(connection.socket, {
            type: "error",
            code: "invalid_state",
            message: `${decoded.value.type} is not available before rooms are implemented`,
        });
        return;
    }
    switch (decoded.value.type) {
        case "hello":
            sendServerMessage(connection.socket, {
                type: "welcome",
                playerId: connection.playerId,
                sessionToken: connection.sessionToken,
                serverTime: Date.now(),
            });
            return;
        case "ping":
            sendServerMessage(connection.socket, {
                type: "pong",
                clientTime: decoded.value.clientTime,
                serverTime: Date.now(),
            });
            return;
    }
}
function sweepHeartbeat(connections, timeoutMs) {
    const now = Date.now();
    for (const connection of connections.values()) {
        if (now - connection.lastSeenAt > timeoutMs) {
            sendIfOpen(connection.socket, {
                type: "error",
                code: "rate_limited",
                message: "Connection timed out",
            });
            connection.socket.close(4000, "heartbeat timeout");
            connections.remove(connection.playerId);
            continue;
        }
        if (connection.socket.readyState === connection.socket.OPEN) {
            connection.socket.ping();
        }
    }
}
function sendIfOpen(socket, message) {
    if (socket.readyState === socket.OPEN) {
        sendServerMessage(socket, message);
    }
}
function listen(httpServer, port) {
    return new Promise((resolve, reject) => {
        const onError = (error) => {
            httpServer.off("listening", onListening);
            reject(error);
        };
        const onListening = () => {
            httpServer.off("error", onError);
            const address = httpServer.address();
            resolve(typeof address === "object" && address !== null ? address.port : port);
        };
        httpServer.once("error", onError);
        httpServer.once("listening", onListening);
        httpServer.listen(port, "0.0.0.0");
    });
}
function closeWebSocketServer(wsServer) {
    return new Promise((resolve, reject) => {
        wsServer.close((error) => {
            if (error !== undefined) {
                reject(error);
                return;
            }
            resolve();
        });
    });
}
function closeHttpServer(httpServer) {
    if (!httpServer.listening) {
        return Promise.resolve();
    }
    return new Promise((resolve, reject) => {
        httpServer.close((error) => {
            if (error !== undefined) {
                reject(error);
                return;
            }
            resolve();
        });
    });
}
export function getListeningPort(httpServer) {
    const address = httpServer.address();
    return typeof address === "object" && address !== null ? address.port : null;
}
