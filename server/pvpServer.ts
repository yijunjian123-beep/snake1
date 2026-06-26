import { createServer } from "node:http";
import type { IncomingMessage, Server, ServerResponse } from "node:http";
import type { AddressInfo } from "node:net";
import type { Duplex } from "node:stream";

import { WebSocketServer } from "ws";
import type WebSocket from "ws";
import type { RawData } from "ws";

import { collectExpiredRoomIds } from "./cleanup.js";
import { ConnectionRegistry } from "./connectionRegistry.js";
import type { PvpConnection } from "./connectionRegistry.js";
import type { PvpServerConfig } from "./config.js";
import { isAllowedOrigin } from "./config.js";
import { logServerEvent } from "./logging.js";
import { MatchmakingQueue } from "./matchmakingQueue.js";
import { decodeClientMessage, sendServerMessage, setServerMessageRecorder } from "./protocolAdapter.js";
import {
  createPvpMessageRates,
  createPvpMetricsSnapshot,
  recordPvpIncomingMessage,
  samplePvpMessageRates,
  type PvpServerMessageRates,
  type PvpServerMetricsCounters,
} from "./metrics.js";
import { RoomManager } from "./roomManager.js";
import { countConnectedRoomPlayers, findRoomPlayerById, toProtocolRoomPlayers } from "./roomTypes.js";
import type { ManagedRoom } from "./roomTypes.js";
import type {
  ClientHelloMessage,
  ClientInputMessage,
  ErrorCode,
  ServerGameOverMessage,
  ServerReconnectResultMessage,
  ServerSnapshotMessage,
  ServerToClientMessage,
} from "../src/pvp/net/protocol.js";
import {
  advancePvpTick,
  createPvpBoardGrid,
  createPvpRuntime,
  createPvpSnapshot,
  recordPvpInput,
} from "../src/pvp/shared/pvpGame.js";

interface RuntimeContext {
  readonly startedAt: number;
  readonly config: PvpServerConfig;
  readonly connections: ConnectionRegistry;
  readonly matchmakingQueue: MatchmakingQueue;
  readonly rooms: RoomManager;
  readonly metrics: PvpServerMetricsCounters;
  readonly messageRates: PvpServerMessageRates;
}

interface ShutdownOptions {
  readonly graceful?: boolean;
  readonly graceMs?: number;
}

export interface PvpServerRuntime {
  readonly httpServer: Server;
  readonly wsServer: WebSocketServer;
  readonly connections: ConnectionRegistry;
  readonly matchmakingQueue: MatchmakingQueue;
  readonly rooms: RoomManager;
  listen(): Promise<number>;
  close(options?: ShutdownOptions): Promise<void>;
}

const DEFAULT_SHUTDOWN_GRACE_MS = 1_000;

export function createPvpServer(config: PvpServerConfig): PvpServerRuntime {
  const startedAt = Date.now();
  const connections = new ConnectionRegistry();
  const matchmakingQueue = new MatchmakingQueue();
  const rooms = new RoomManager({
    tickRate: config.tickRate,
    inputDelayTicks: config.inputDelayTicks,
  });
  const metrics: PvpServerMetricsCounters = {
    totalMatches: 0,
    totalGameStarts: 0,
    totalGameOvers: 0,
    totalQueueJoins: 0,
    totalQueueCancels: 0,
    totalDisconnects: 0,
    rejectedByQueueFull: 0,
    rejectedByRoomCapacity: 0,
    totalMessagesIn: 0,
    totalMessagesOut: 0,
  };
  const messageRates = createPvpMessageRates(startedAt);
  const context: RuntimeContext = {
    startedAt,
    config,
    connections,
    matchmakingQueue,
    rooms,
    metrics,
    messageRates,
  };
  setServerMessageRecorder(() => {
    context.metrics.totalMessagesOut += 1;
  });
  let shuttingDown = false;
  let closePromise: Promise<void> | null = null;
  const wsServer = new WebSocketServer({ noServer: true });
  const httpServer = createServer((request, response) => {
    handleHttpRequest(request, response, startedAt, context, shuttingDown);
  });

  const heartbeatTimer = setInterval(() => {
    sweepHeartbeat(context);
  }, config.heartbeatIntervalMs);

  const cleanupTimer = setInterval(() => {
    sweepExpiredRooms(context);
  }, config.cleanupIntervalMs);

  const messageRateTimer = setInterval(() => {
    samplePvpMessageRates(context);
  }, 1_000);

  heartbeatTimer.unref();
  cleanupTimer.unref();
  messageRateTimer.unref();

  httpServer.on("upgrade", (request, socket, head) => {
    if (shuttingDown) {
      logServerEvent("ws_upgrade_rejected", {
        errorCode: "service_unavailable",
        reason: "server_shutting_down",
      });
      rejectUpgrade(socket, 503, "server_shutting_down", "PVP server is shutting down");
      return;
    }

    const requestUrl = new URL(request.url ?? "/", "http://localhost");

    if (requestUrl.pathname !== config.wsPath) {
      logServerEvent("ws_upgrade_rejected", {
        errorCode: "not_found",
        reason: "invalid_ws_path",
      });
      rejectUpgrade(socket, 404, "not_found", "The requested websocket path was not found");
      return;
    }

    if (!isAllowedOrigin(request.headers.origin, config.allowedOrigins)) {
      logServerEvent("ws_upgrade_rejected", {
        errorCode: "invalid_state",
        reason: "invalid_origin",
      });
      rejectUpgrade(socket, 403, "origin_rejected", "Origin is not allowed");
      return;
    }

    if (connections.size >= config.maxConnections) {
      wsServer.handleUpgrade(request, socket, head, (webSocket) => {
        sendServerMessage(webSocket, {
          type: "error",
          code: "service_busy",
          message: "PVP server is busy",
        });
        logServerEvent("error", {
          errorCode: "service_busy",
          phase: "connecting",
        });
        webSocket.close(1013, "service_busy");
      });
      return;
    }

    // TODO: add a cheap per-IP cap if this deployment path needs one.
    wsServer.handleUpgrade(request, socket, head, (webSocket) => {
      wsServer.emit("connection", webSocket, request);
    });
  });

  wsServer.on("connection", (socket) => {
    const connection = connections.add(socket);
    logServerEvent("connection_open", {
      playerId: connection.playerId,
      connections: connections.size,
      rooms: rooms.size,
      queueSize: matchmakingQueue.size,
    });

    setImmediate(() => {
      sendTrackedMessage(context, socket, createWelcomeMessage(connection));
    });

    broadcastQueueStates(context);

    socket.on("message", (data) => {
      recordPvpIncomingMessage(context);
      if (!connections.takeMessageCredit(connection, config.messageRateLimitMaxCount, config.messageRateLimitWindowMs)) {
        sendError(context, connection, "rate_limited", "Messages are too frequent");
        connection.socket?.close(4008, "rate_limited");
        return;
      }

      connections.touch(connection);
      handleSocketMessage(connection, data, context);
    });

    socket.on("pong", () => {
      recordPvpIncomingMessage(context);
      connections.touch(connection);
    });

    socket.on("close", () => {
      handleConnectionGone(connection, context);
    });

    socket.on("error", () => {
      handleConnectionGone(connection, context);
    });
  });

  return {
    httpServer,
    wsServer,
    connections,
    matchmakingQueue,
    rooms,
    listen: () => listen(httpServer, config.port),
    close: async (options: ShutdownOptions = {}) => {
      if (closePromise !== null) {
        return closePromise;
      }

      shuttingDown = true;
      clearInterval(heartbeatTimer);
      clearInterval(cleanupTimer);
      clearInterval(messageRateTimer);

      const httpClosePromise = closeHttpServer(httpServer);
      const graceful = options.graceful ?? false;
      const graceMs = Math.max(0, options.graceMs ?? DEFAULT_SHUTDOWN_GRACE_MS);

      closePromise = (async () => {
        try {
          if (graceful) {
            for (const connection of connections.activeValues()) {
              sendIfOpen(connection.socket, {
                type: "serverShutdown",
                message: "PVP server is shutting down",
                retryAfterMs: graceMs,
              });
            }

            await wait(graceMs);
          }

          for (const connection of connections.activeValues()) {
            connection.socket?.close(1001, "server closing");
          }

          await closeWebSocketServer(wsServer);
          await httpClosePromise;
        } finally {
          setServerMessageRecorder(null);
        }
      })();

      return closePromise;
    },
  };
}

function handleHttpRequest(
  request: IncomingMessage,
  response: ServerResponse,
  startedAt: number,
  context: RuntimeContext,
  shuttingDown: boolean,
): void {
  const requestUrl = new URL(request.url ?? "/", "http://localhost");

  if (shuttingDown) {
    response.writeHead(503, {
      "content-type": "application/json; charset=utf-8",
      connection: "close",
    });
    response.end(JSON.stringify({
      ok: false,
      error: "server_shutting_down",
    }));
    return;
  }

  if (request.method === "GET" && requestUrl.pathname === "/health") {
    response.writeHead(200, { "content-type": "application/json; charset=utf-8" });
    response.end(
      JSON.stringify({
        ok: true,
        uptime: Math.max(0, Date.now() - startedAt) / 1_000,
        connections: context.connections.size,
        queued: context.matchmakingQueue.size,
        rooms: context.rooms.size,
      }),
    );
    return;
  }

  if (request.method === "GET" && requestUrl.pathname === "/metrics.json") {
    response.writeHead(200, { "content-type": "application/json; charset=utf-8" });
    response.end(JSON.stringify(createPvpMetricsSnapshot({
      startedAt,
      config: context.config,
      connections: context.connections,
      matchmakingQueue: context.matchmakingQueue,
      rooms: context.rooms,
      metrics: context.metrics,
      messageRates: context.messageRates,
    })));
    return;
  }

  response.writeHead(404, { "content-type": "application/json; charset=utf-8" });
  response.end(JSON.stringify({ ok: false, error: "not_found" }));
}

function handleSocketMessage(connection: PvpConnection, data: RawData, context: RuntimeContext): void {
  if (!context.connections.isCurrent(connection) || connection.socket === null) {
    return;
  }

  const decoded = decodeClientMessage(data);

  if (!decoded.ok) {
    sendError(context, connection, "invalid_message", decoded.error);
    return;
  }

  switch (decoded.value.type) {
    case "hello":
      handleHello(connection, decoded.value, context);
      return;
    case "ping":
      sendTrackedMessage(context, connection.socket, {
        type: "pong",
        clientTime: decoded.value.clientTime,
        serverTime: Date.now(),
      });
      return;
    case "matchmakingJoin":
      handleMatchmakingJoin(connection, context);
      return;
    case "matchmakingCancel":
      handleMatchmakingCancel(connection, context);
      return;
    case "createRoom":
      handleCreatePrivateRoom(connection, context);
      return;
    case "joinRoom":
      handleJoinPrivateRoom(connection, decoded.value.roomCode, context);
      return;
    case "leaveRoom":
      handleLeaveRoom(connection, context);
      return;
    case "ready":
      handleReadyChange(connection, decoded.value.ready, context);
      return;
    case "input":
      handleInputMessage(connection, decoded.value, context);
      return;
    case "resultCandidate":
      sendError(context, connection, "invalid_state", `${decoded.value.type} is not available in this room/core MVP`);
      return;
  }
}

function handleHello(connection: PvpConnection, message: ClientHelloMessage, context: RuntimeContext): void {
  if (!context.connections.isCurrent(connection) || connection.socket === null) {
    return;
  }

  if (message.sessionToken === undefined || message.sessionToken === connection.sessionToken) {
    if (message.nickname !== undefined) {
      connection.nickname = message.nickname;
      const room = context.rooms.updatePlayerNickname(connection.playerId, message.nickname);

      if (room !== undefined) {
        broadcastRoomState(room, context);
      }
    }

    return;
  }

  const restoredConnection = context.connections.restoreSocket(connection, message.sessionToken);

  if (restoredConnection === undefined || restoredConnection.socket === null) {
    sendReconnectResult(connection, context, { ok: false });
    connection.socket?.close(4001, "invalid_session");
    return;
  }

  if (restoredConnection.roomId !== null && context.rooms.get(restoredConnection.roomId) === undefined) {
    sendReconnectResult(restoredConnection, context, { ok: false });
    restoredConnection.socket?.close(4001, "invalid_session");
    return;
  }

  if (message.nickname !== undefined) {
    restoredConnection.nickname = message.nickname;
    const room = context.rooms.updatePlayerNickname(restoredConnection.playerId, message.nickname);

    if (room !== undefined) {
      broadcastRoomState(room, context);
    }
  }

  sendReconnectResult(restoredConnection, context, { ok: true });
  restoreSessionRoomState(restoredConnection, context);
}

function handleMatchmakingJoin(connection: PvpConnection, context: RuntimeContext): void {
  const now = Date.now();

  if (connection.status === "in_queue") {
    sendQueueState(connection, context, now);
    return;
  }

  if (connection.status !== "idle") {
    sendError(context, connection, "already_in_room", "Leave the current room before joining matchmaking");
    return;
  }

  context.metrics.totalQueueJoins += 1;

  if (context.rooms.size >= context.config.maxRooms) {
    context.metrics.rejectedByRoomCapacity += 1;
    sendError(context, connection, "room_capacity_reached", "All PVP rooms are busy right now");
    return;
  }

  if (context.matchmakingQueue.size >= context.config.maxQueue) {
    context.metrics.rejectedByQueueFull += 1;
    sendError(context, connection, "queue_full", "The matchmaking queue is full");
    return;
  }

  const entry = context.matchmakingQueue.enqueue(connection.playerId, now);
  setConnectionQueued(connection, entry.joinedAt);
  logServerEvent("queue_join", {
    playerId: connection.playerId,
    phase: "in_queue",
  });
  drainMatchmakingQueue(context, now);
  broadcastQueueStates(context, now);
}

function handleMatchmakingCancel(connection: PvpConnection, context: RuntimeContext): void {
  const removed = context.matchmakingQueue.remove(connection.playerId);

  if (removed === undefined || connection.status !== "in_queue") {
    sendError(context, connection, "invalid_state", "You are not currently in the matchmaking queue");
    return;
  }

  context.metrics.totalQueueCancels += 1;
  setConnectionIdle(connection);
  logServerEvent("queue_cancel", {
    playerId: connection.playerId,
    phase: "idle",
  });
  drainMatchmakingQueue(context);
  broadcastQueueStates(context);
  sendQueueState(connection, context);
}

function handleCreatePrivateRoom(connection: PvpConnection, context: RuntimeContext): void {
  if (connection.status === "in_queue") {
    sendError(context, connection, "invalid_state", "Cancel matchmaking before creating a private room");
    return;
  }

  if (connection.status !== "idle") {
    sendError(context, connection, "already_in_room", "Leave the current room before creating a new one");
    return;
  }

  if (context.rooms.size >= context.config.maxRooms) {
    context.metrics.rejectedByRoomCapacity += 1;
    sendError(context, connection, "room_capacity_reached", "All PVP rooms are busy right now");
    return;
  }

  const room = context.rooms.createPrivateRoom(connection);
  setConnectionRoomState(connection, room, "in_room");

  logServerEvent("room_created", {
    playerId: connection.playerId,
    roomCode: room.roomCode,
    phase: room.phase,
  });

  sendTrackedMessage(context, connection.socket, {
    type: "roomCreated",
    roomCode: room.roomCode,
    playerSlot: "p1",
  });
  broadcastRoomState(room, context);
}

function handleJoinPrivateRoom(connection: PvpConnection, roomCode: string, context: RuntimeContext): void {
  if (connection.status === "in_queue") {
    sendError(context, connection, "invalid_state", "Cancel matchmaking before joining a private room");
    return;
  }

  if (connection.status !== "idle") {
    sendError(context, connection, "already_in_room", "Leave the current room before joining another one");
    return;
  }

  const result = context.rooms.joinPrivateRoom(roomCode, connection);

  if (!result.ok) {
    const message = result.code === "room_full"
      ? "The private room is already full"
      : "The private room could not be found";

    sendError(context, connection, result.code, message);
    return;
  }

  setConnectionRoomState(connection, result.room, "in_room");

  logServerEvent("room_joined", {
    playerId: connection.playerId,
    roomCode: result.room.roomCode,
    phase: result.room.phase,
  });

  sendTrackedMessage(context, connection.socket, {
    type: "roomJoined",
    roomCode: result.room.roomCode,
    playerSlot: result.playerSlot,
    players: toProtocolRoomPlayers(result.room.players),
  });

  startRoomCountdown(result.room.roomId, context);
}

function handleLeaveRoom(connection: PvpConnection, context: RuntimeContext): void {
  if (connection.roomId === null) {
    sendError(context, connection, "not_in_room", "You are not currently in a room");
    return;
  }

  handleRoomDeparture(connection, context, false);
}

function handleReadyChange(connection: PvpConnection, ready: boolean, context: RuntimeContext): void {
  if (connection.roomId === null) {
    sendError(context, connection, "not_in_room", "You are not currently in a room");
    return;
  }

  const room = context.rooms.getByPlayerId(connection.playerId);

  if (room === undefined) {
    sendError(context, connection, "not_in_room", "You are not currently in a room");
    return;
  }

  if (room.roomType !== "private") {
    sendError(context, connection, "invalid_state", "Ready is only used by private rooms");
    return;
  }

  if (room.phase === "countdown" || room.phase === "playing" || room.phase === "finished") {
    sendError(context, connection, "invalid_state", "This room has already started");
    return;
  }

  const updatedRoom = context.rooms.updatePlayerReady(connection.playerId, ready);

  if (updatedRoom === undefined) {
    sendError(context, connection, "not_in_room", "You are not currently in a room");
    return;
  }

  broadcastRoomState(updatedRoom, context);

  if (updatedRoom.players.length === 2 && updatedRoom.players.every((player) => player.ready && player.connected)) {
    startRoomCountdown(updatedRoom.roomId, context);
  }
}

function handleInputMessage(connection: PvpConnection, message: ClientInputMessage, context: RuntimeContext): void {
  const room = context.rooms.getByPlayerId(connection.playerId);

  if (room === undefined || room.phase !== "playing" || room.gameState === undefined) {
    return;
  }

  const player = findRoomPlayerById(room.players, connection.playerId);

  if (player === undefined || !player.connected) {
    return;
  }

  const opponent = room.players.find((candidate) => candidate.playerId !== connection.playerId && candidate.connected);

  if (opponent === undefined) {
    return;
  }

  const now = Date.now();

  const inputAccepted = recordPvpInput(
    room.gameState.inputState,
    player.playerSlot,
    message.seq,
    message.tick,
    message.direction,
    room.inputDelayTicks,
    now,
  );

  if (!inputAccepted) {
    return;
  }

  room.inputState = room.gameState.inputState;

  const opponentConnection = context.connections.get(opponent.playerId);

  if (opponentConnection === undefined) {
    return;
  }

  sendTrackedMessage(context, opponentConnection.socket, {
    type: "peerInput",
    playerSlot: player.playerSlot,
    seq: message.seq,
    tick: message.tick,
    direction: message.direction,
  });
}

function startRoomCountdown(roomId: string, context: RuntimeContext): void {
  const room = context.rooms.get(roomId);

  if (room === undefined || room.players.length !== 2) {
    return;
  }

  if (room.phase === "countdown" || room.phase === "playing" || room.phase === "finished") {
    return;
  }

  const now = Date.now();
  const countdownEndsAt = now + context.config.countdownMs;
  logServerEvent("countdown_start", {
    roomCode: room.roomCode,
    phase: "countdown",
  });
  const countdownTimer = setTimeout(() => {
    const playingRoom = context.rooms.markPlaying(roomId);

    if (playingRoom === undefined) {
      return;
    }

    context.metrics.totalGameStarts += 1;

    const runtime = createPvpRuntime({
      seed: playingRoom.seed,
      startTick: playingRoom.startTick,
      tickRate: playingRoom.tickRate,
      inputDelayTicks: playingRoom.inputDelayTicks,
      grid: createPvpBoardGrid(),
      mode: "online-pvp",
    });

    playingRoom.gameState = runtime;
    playingRoom.inputState = runtime.inputState;
    playingRoom.lastSnapshot = {
      type: "snapshot",
      ...createPvpSnapshot(runtime),
    };

    for (const player of playingRoom.players) {
      const playerConnection = context.connections.get(player.playerId);

      if (playerConnection !== undefined) {
        setConnectionRoomState(playerConnection, playingRoom, "playing");
      }
    }

    broadcastRoomState(playingRoom, context);
    logServerEvent("game_start", {
      roomCode: playingRoom.roomCode,
      phase: "playing",
    });
    broadcastToRoom(playingRoom, context, {
      type: "gameStart",
      seed: playingRoom.seed,
      startTick: playingRoom.startTick,
      tickRate: playingRoom.tickRate,
      playerSlots: ["p1", "p2"],
      inputDelayTicks: playingRoom.inputDelayTicks,
    });
    if (playingRoom.lastSnapshot !== undefined) {
      broadcastRoomSnapshot(playingRoom, context, playingRoom.lastSnapshot);
    }
    startRoomGameLoop(playingRoom, context);
  }, context.config.countdownMs);

  countdownTimer.unref();

  const countdownRoom = context.rooms.startCountdown(roomId, countdownTimer, countdownEndsAt, now);

  if (countdownRoom === undefined) {
    clearTimeout(countdownTimer);
    return;
  }

  context.metrics.totalMatches += 1;

  for (const player of countdownRoom.players) {
    const playerConnection = context.connections.get(player.playerId);

    if (playerConnection !== undefined) {
      setConnectionRoomState(playerConnection, countdownRoom, "countdown");
    }
  }

  broadcastRoomState(countdownRoom, context);
  broadcastToRoom(countdownRoom, context, {
    type: "countdown",
    startsInMs: context.config.countdownMs,
  });
}

function handleRoomDeparture(connection: PvpConnection, context: RuntimeContext, disconnect: boolean): void {
  const roomId = connection.roomId;

  if (roomId === null) {
    if (disconnect) {
      setConnectionDisconnected(connection);
    } else {
      setConnectionIdle(connection);
    }
    return;
  }

  if (disconnect) {
    handleDisconnectedRoomDeparture(connection, context);
    return;
  }

  const roomBeforeDeparture = context.rooms.get(roomId);
  const phaseBeforeDeparture = roomBeforeDeparture?.phase;
  const departure = context.rooms.removePlayer(connection.playerId);

  setConnectionIdle(connection);

  logServerEvent("room_leave", {
    playerId: connection.playerId,
    roomCode: roomBeforeDeparture?.roomCode,
    phase: phaseBeforeDeparture,
  });

  if (departure === undefined || roomBeforeDeparture === undefined || phaseBeforeDeparture === undefined) {
    return;
  }

  if (departure.roomDestroyed) {
    return;
  }

  switch (phaseBeforeDeparture) {
    case "waiting":
    case "ready":
    case "countdown": {
      if (roomBeforeDeparture.players.length === 0) {
        context.rooms.destroyRoom(roomId);
        return;
      }

      if (phaseBeforeDeparture === "countdown") {
        context.rooms.clearCountdown(roomId);
      }

      roomBeforeDeparture.phase = "waiting";
      roomBeforeDeparture.updatedAt = Date.now();

      for (const player of roomBeforeDeparture.players) {
        player.ready = false;
      }

      for (const player of roomBeforeDeparture.players) {
        const playerConnection = context.connections.get(player.playerId);

        if (playerConnection !== undefined) {
          sendTrackedMessage(context, playerConnection.socket, { type: "opponentLeft" });
        }
      }

      broadcastRoomState(roomBeforeDeparture, context);
      return;
    }
    case "playing": {
      const winner = departure.remainingPlayers[0];

      if (winner === undefined) {
        context.rooms.destroyRoom(roomId);
        return;
      }

      const finalTick = roomBeforeDeparture.gameState?.match.tick ?? roomBeforeDeparture.startTick;
      finalizePlayingRoom(roomId, context, {
        type: "gameOver",
        winner: winner.playerSlot,
        reason: "opponent_left",
        finalTick,
      });
      return;
    }
    case "finished": {
      const finishedRoom = context.rooms.get(roomId);

      if (finishedRoom !== undefined) {
        broadcastRoomState(finishedRoom, context);
      }
      return;
    }
  }
}

function handleDisconnectedRoomDeparture(connection: PvpConnection, context: RuntimeContext): void {
  const roomId = connection.roomId;

  if (roomId === null) {
    setConnectionDisconnected(connection);
    return;
  }

  const room = context.rooms.get(roomId);

  if (room === undefined) {
    setConnectionDisconnected(connection);
    return;
  }

  const roomPlayer = findRoomPlayerById(room.players, connection.playerId);

  if (roomPlayer !== undefined) {
    roomPlayer.connected = false;
    roomPlayer.ready = false;
  }

  setConnectionDisconnected(connection);
  room.updatedAt = Date.now();

  const connectedPlayers = countConnectedRoomPlayers(room.players);

  switch (room.phase) {
    case "waiting":
    case "ready": {
      if (connectedPlayers === 0) {
        context.rooms.destroyRoom(roomId);
        return;
      }

      room.phase = "waiting";

      for (const player of room.players) {
        player.ready = false;
      }

      for (const player of room.players) {
        if (!player.connected) {
          continue;
        }

        const playerConnection = context.connections.get(player.playerId);

        if (playerConnection !== undefined) {
          sendIfOpen(playerConnection.socket, { type: "opponentLeft" });
        }
      }

      broadcastRoomState(room, context);
      return;
    }
    case "countdown": {
      context.rooms.clearCountdown(roomId);

      if (connectedPlayers === 0) {
        context.rooms.destroyRoom(roomId);
        return;
      }

      room.phase = "waiting";

      for (const player of room.players) {
        player.ready = false;
      }

      for (const player of room.players) {
        if (!player.connected) {
          continue;
        }

        const playerConnection = context.connections.get(player.playerId);

        if (playerConnection !== undefined) {
          sendIfOpen(playerConnection.socket, { type: "opponentLeft" });
        }
      }

      broadcastRoomState(room, context);
      return;
    }
    case "playing": {
      if (connectedPlayers === 0) {
        context.rooms.destroyRoom(roomId);
        return;
      }

      const winner = room.players.find((player) => player.connected);

      if (winner === undefined) {
        context.rooms.destroyRoom(roomId);
        return;
      }

      const finalTick = room.gameState?.match.tick ?? room.startTick;
      finalizePlayingRoom(roomId, context, {
        type: "gameOver",
        winner: winner.playerSlot,
        reason: "opponent_disconnected",
        finalTick,
      });
      return;
    }
    case "finished":
      return;
  }
}

function handleConnectionGone(connection: PvpConnection, context: RuntimeContext): void {
  if (!context.connections.disconnect(connection)) {
    return;
  }

  context.metrics.totalDisconnects += 1;
  const room = connection.roomId === null ? undefined : context.rooms.get(connection.roomId);
  logServerEvent("connection_close", {
    playerId: connection.playerId,
    roomCode: room?.roomCode,
    phase: room?.phase,
  });

  const removedFromQueue = context.matchmakingQueue.remove(connection.playerId);

  if (removedFromQueue !== undefined) {
    setConnectionIdle(connection);
    drainMatchmakingQueue(context);
    broadcastQueueStates(context);
    return;
  }

  if (connection.roomId !== null) {
    handleDisconnectedRoomDeparture(connection, context);
  }

  broadcastQueueStates(context);
}

function sendReconnectResult(
  connection: PvpConnection,
  context: RuntimeContext,
  result: Pick<ServerReconnectResultMessage, "ok">,
): void {
  if (connection.socket === null) {
    return;
  }

  const room = connection.roomId === null ? undefined : context.rooms.get(connection.roomId);

  const message: ServerReconnectResultMessage = {
    type: "reconnectResult",
    ok: result.ok,
    ...(result.ok && room !== undefined
      ? {
          roomCode: connection.roomCode,
          playerSlot: connection.playerSlot,
          phase: room.phase,
        }
      : {}),
  };

  sendIfOpen(connection.socket, message);
}

function restoreSessionRoomState(connection: PvpConnection, context: RuntimeContext): void {
  if (connection.socket === null || connection.roomId === null) {
    return;
  }

  const room = context.rooms.get(connection.roomId);

  if (room === undefined) {
    return;
  }

  const roomPlayer = findRoomPlayerById(room.players, connection.playerId);

  if (roomPlayer !== undefined) {
    roomPlayer.connected = true;
  }

  room.updatedAt = Date.now();

  switch (room.phase) {
    case "waiting":
    case "ready":
      setConnectionRoomState(connection, room, "in_room");
      broadcastRoomState(room, context);
      return;
    case "countdown":
      setConnectionRoomState(connection, room, "countdown");
      broadcastRoomState(room, context);
      if (room.countdownEndsAt !== undefined) {
        sendIfOpen(connection.socket, {
          type: "countdown",
          startsInMs: Math.max(0, room.countdownEndsAt - Date.now()),
        });
      }
      return;
    case "playing":
      setConnectionRoomState(connection, room, "playing");
      if (room.gameState !== undefined) {
        sendIfOpen(connection.socket, {
          type: "gameStart",
          seed: room.seed,
          startTick: room.startTick,
          tickRate: room.tickRate,
          playerSlots: ["p1", "p2"],
          inputDelayTicks: room.inputDelayTicks,
        });
        if (room.lastSnapshot !== undefined) {
          sendIfOpen(connection.socket, room.lastSnapshot);
        } else {
          sendIfOpen(connection.socket, {
            type: "snapshot",
            ...createPvpSnapshot(room.gameState),
          });
        }
      }
      return;
    case "finished":
      setConnectionRoomState(connection, room, "finished");
      if (room.lastGameOver !== undefined) {
        sendIfOpen(connection.socket, room.lastGameOver);
      }
      return;
  }
}

function drainMatchmakingQueue(context: RuntimeContext, now: number = Date.now()): void {
  while (context.rooms.size < context.config.maxRooms) {
    const candidates: PvpConnection[] = [];

    for (const entry of context.matchmakingQueue.values()) {
      const connection = context.connections.get(entry.playerId);

      if (connection === undefined || connection.status !== "in_queue") {
        context.matchmakingQueue.remove(entry.playerId);
        continue;
      }

      candidates.push(connection);

      if (candidates.length === 2) {
        break;
      }
    }

    if (candidates.length < 2) {
      return;
    }

    const first = candidates[0];
    const second = candidates[1];

    if (first === undefined || second === undefined) {
      return;
    }

    const room = context.rooms.createMatchmakingRoom(first, second, now);

    context.matchmakingQueue.remove(first.playerId);
    context.matchmakingQueue.remove(second.playerId);

    sendIfOpen(first.socket, {
      type: "matchFound",
      roomCode: room.roomCode,
      playerSlot: "p1",
    });
    sendIfOpen(second.socket, {
      type: "matchFound",
      roomCode: room.roomCode,
      playerSlot: "p2",
    });

    logServerEvent("match_found", {
      roomCode: room.roomCode,
      phase: "countdown",
    });

    startRoomCountdown(room.roomId, context);
  }
}

function broadcastQueueStates(context: RuntimeContext, now: number = Date.now()): void {
  for (const entry of context.matchmakingQueue.values()) {
    const connection = context.connections.get(entry.playerId);

    if (connection === undefined || connection.status !== "in_queue") {
      context.matchmakingQueue.remove(entry.playerId);
      continue;
    }

    sendQueueState(connection, context, now);
  }
}

function sendQueueState(connection: PvpConnection, context: RuntimeContext, now: number = Date.now()): void {
  const queuedEntry = context.matchmakingQueue.get(connection.playerId);
  const position = context.matchmakingQueue.getPosition(connection.playerId);
  const waitingMs = queuedEntry === undefined ? 0 : Math.max(0, now - queuedEntry.joinedAt);
  const estimatedWaitMs = queuedEntry === undefined ? undefined : waitingMs + context.config.countdownMs;

  sendIfOpen(connection.socket, {
    type: "queueState",
    position,
    waitingMs,
    estimatedWaitMs,
    onlineCount: context.connections.size,
    queuedCount: context.matchmakingQueue.size,
  });
}

function broadcastRoomState(room: ManagedRoom, context: RuntimeContext): void {
  broadcastToRoom(room, context, {
    type: "roomState",
    roomCode: room.roomCode,
    phase: room.phase,
    players: toProtocolRoomPlayers(room.players),
  });
}

function broadcastToRoom(room: ManagedRoom, context: RuntimeContext, message: ServerToClientMessage): void {
  for (const player of room.players) {
    const connection = context.connections.get(player.playerId);

    if (connection !== undefined) {
      sendIfOpen(connection.socket, message);
    }
  }
}

function broadcastRoomSnapshot(room: ManagedRoom, context: RuntimeContext, snapshot: ServerSnapshotMessage): void {
  room.lastSnapshot = snapshot;
  broadcastToRoom(room, context, snapshot);
}

function startRoomGameLoop(room: ManagedRoom, context: RuntimeContext): void {
  if (room.gameState === undefined || room.phase !== "playing") {
    return;
  }

  if (room.tickTimer !== null) {
    clearInterval(room.tickTimer);
  }

  const tickIntervalMs = Math.max(1, Math.round(1_000 / room.tickRate));
  room.tickTimer = setInterval(() => {
    advancePlayingRoom(room.roomId, context);
  }, tickIntervalMs);
  room.tickTimer.unref();
}

function advancePlayingRoom(roomId: string, context: RuntimeContext): void {
  const room = context.rooms.get(roomId);

  if (room === undefined || room.phase !== "playing" || room.gameState === undefined) {
    return;
  }

  const result = advancePvpTick(room.gameState);
  room.lastSnapshot = {
    type: "snapshot",
    ...result.snapshot,
  };
  broadcastRoomSnapshot(room, context, room.lastSnapshot);

  if (result.gameOver !== null) {
    finalizePlayingRoom(roomId, context, result.gameOver);
  }
}

function finalizePlayingRoom(roomId: string, context: RuntimeContext, gameOver: ServerGameOverMessage): void {
  const finishedRoom = context.rooms.markFinished(roomId);

  if (finishedRoom === undefined) {
    return;
  }

  context.metrics.totalGameOvers += 1;

  if (finishedRoom.gameState !== undefined) {
    finishedRoom.gameState.match.phase = "gameOver";
    finishedRoom.gameState.match.winnerId = gameOver.winner === "draw" ? null : gameOver.winner;
  }

  finishedRoom.lastGameOver = gameOver;

  logServerEvent("game_over", {
    roomCode: finishedRoom.roomCode,
    phase: "finished",
    errorCode: gameOver.reason,
  });

  for (const player of finishedRoom.players) {
    const playerConnection = context.connections.get(player.playerId);

    if (playerConnection !== undefined) {
      setConnectionRoomState(playerConnection, finishedRoom, "finished");
    }
  }

  broadcastRoomState(finishedRoom, context);
  broadcastToRoom(finishedRoom, context, gameOver);
}

function sweepHeartbeat(context: RuntimeContext): void {
  const now = Date.now();

  for (const connection of context.connections.activeValues()) {
    if (connection.socket === null) {
      continue;
    }

    if (now - connection.lastSeenAt > context.config.connectionTimeoutMs) {
      connection.socket.close(4000, "heartbeat timeout");
      continue;
    }

    if (connection.socket.readyState === connection.socket.OPEN) {
      connection.socket.ping();
    }
  }
}

function sweepExpiredRooms(context: RuntimeContext): void {
  const now = Date.now();
  const expiredRoomIds = collectExpiredRoomIds(context.rooms.values(), {
    finishedRoomTtlMs: context.config.finishedRoomTtlMs,
    privateRoomWaitTimeoutMs: context.config.privateRoomWaitTimeoutMs,
    reconnectGraceMs: context.config.reconnectGraceMs,
  });

  for (const roomId of expiredRoomIds.expiredPrivateRoomIds) {
    const room = context.rooms.get(roomId);

    if (room === undefined) {
      continue;
    }

    for (const player of room.players) {
      const connection = context.connections.get(player.playerId);

      if (connection !== undefined) {
        setConnectionIdle(connection);
        if (connection.socket !== null) {
          sendServerMessage(connection.socket, {
            type: "error",
            code: "invalid_state",
            message: "The private room expired because nobody started the match in time",
          });
        }
      }
    }

    context.rooms.destroyRoom(roomId);
  }

  for (const roomId of expiredRoomIds.finishedRoomIds) {
    const room = context.rooms.destroyRoom(roomId);

    if (room === undefined) {
      continue;
    }

    for (const player of room.players) {
      const connection = context.connections.get(player.playerId);

      if (connection !== undefined && connection.roomId === roomId) {
        setConnectionIdle(connection);
      }
    }
  }

  for (const connection of context.connections.getExpired(now, context.config.reconnectGraceMs)) {
    context.connections.remove(connection);
  }
}

function createWelcomeMessage(connection: PvpConnection): ServerToClientMessage {
  return {
    type: "welcome",
    playerId: connection.playerId,
    sessionToken: connection.sessionToken,
    serverTime: Date.now(),
  };
}

function sendError(context: RuntimeContext, connection: PvpConnection, code: ErrorCode, message: string): void {
  const room = connection.roomId === null ? undefined : context.rooms.get(connection.roomId);

  logServerEvent("error", {
    errorCode: code,
    playerId: connection.playerId,
    roomCode: room?.roomCode,
    phase: room?.phase,
  });

  sendTrackedMessage(context, connection.socket, {
    type: "error",
    code,
    message,
  });
}

function setConnectionQueued(connection: PvpConnection, joinedAt: number): void {
  connection.status = "in_queue";
  connection.queueJoinedAt = joinedAt;
  connection.roomId = null;
  connection.roomCode = undefined;
  connection.playerSlot = undefined;
}

function setConnectionRoomState(connection: PvpConnection, room: ManagedRoom, status: "in_room" | "countdown" | "playing" | "finished"): void {
  const roomPlayer = findRoomPlayerById(room.players, connection.playerId);

  connection.status = status;
  connection.queueJoinedAt = undefined;
  connection.roomId = room.roomId;
  connection.roomCode = room.roomCode;
  connection.playerSlot = roomPlayer?.playerSlot;
}

function setConnectionIdle(connection: PvpConnection): void {
  connection.status = "idle";
  connection.queueJoinedAt = undefined;
  connection.roomId = null;
  connection.roomCode = undefined;
  connection.playerSlot = undefined;
}

function setConnectionDisconnected(connection: PvpConnection): void {
  connection.status = "disconnected";
  connection.queueJoinedAt = undefined;
}

function sendTrackedMessage(context: RuntimeContext, socket: WebSocket | null, message: ServerToClientMessage): void {
  void context;
  if (socket !== null && socket.readyState === socket.OPEN) {
    sendServerMessage(socket, message);
  }
}

function sendIfOpen(socket: WebSocket | null, message: ServerToClientMessage): void {
  if (socket !== null && socket.readyState === socket.OPEN) {
    sendServerMessage(socket, message);
  }
}

function rejectUpgrade(socket: Duplex, statusCode: number, errorCode: string, message: string): void {
  const body = JSON.stringify({
    ok: false,
    error: errorCode,
    message,
  });
  const statusText = statusCode === 403
    ? "Forbidden"
    : statusCode === 404
      ? "Not Found"
      : statusCode === 503
        ? "Service Unavailable"
        : "Error";

  socket.write(
    `HTTP/1.1 ${statusCode} ${statusText}\r\n`
    + "Content-Type: application/json; charset=utf-8\r\n"
    + `Content-Length: ${Buffer.byteLength(body)}\r\n`
    + "Connection: close\r\n"
    + "\r\n"
    + body,
  );
  socket.end();
}

function listen(httpServer: Server, port: number): Promise<number> {
  return new Promise((resolve, reject) => {
    const onError = (error: Error): void => {
      httpServer.off("listening", onListening);
      reject(error);
    };

    const onListening = (): void => {
      httpServer.off("error", onError);
      const address = httpServer.address();
      resolve(typeof address === "object" && address !== null ? address.port : port);
    };

    httpServer.once("error", onError);
    httpServer.once("listening", onListening);
    httpServer.listen(port, "0.0.0.0");
  });
}

function wait(milliseconds: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, milliseconds);
  });
}

function closeWebSocketServer(wsServer: WebSocketServer): Promise<void> {
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

function closeHttpServer(httpServer: Server): Promise<void> {
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

export function getListeningPort(httpServer: Server): number | null {
  const address = httpServer.address() as AddressInfo | string | null;
  return typeof address === "object" && address !== null ? address.port : null;
}
