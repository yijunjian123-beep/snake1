import assert from "node:assert/strict";
import test from "node:test";

import WebSocket from "ws";
import type { RawData } from "ws";

import { DEFAULT_PVP_SERVER_CONFIG, isAllowedOrigin, readPvpServerConfig } from "../config.js";
import type { PvpServerConfig } from "../config.js";
import { createPvpServer } from "../pvpServer.js";
import type { PvpServerRuntime } from "../pvpServer.js";
import type { ServerToClientMessage } from "../../src/pvp/net/protocol.js";
import { validateServerMessage } from "../../src/pvp/net/validation.js";
import { PVP_OPENING_SAFETY_TICKS } from "../../src/pvp/shared/pvpGame.js";

const TEST_TIMEOUT_MS = 10_000;

test("GET /health returns 200 with status fields", async () => {
  const server = await startTestServer();

  try {
    const response = await fetch(`http://127.0.0.1:${server.port}/health`);
    const body = await response.json() as unknown;

    assert.equal(response.status, 200);
    assert.equal(typeof body, "object");
    assert.notEqual(body, null);
    assert.equal((body as { ok?: unknown }).ok, true);
    assert.equal(typeof (body as { uptime?: unknown }).uptime, "number");
    assert.equal((body as { connections?: unknown }).connections, 0);
    assert.equal((body as { queued?: unknown }).queued, 0);
    assert.equal((body as { rooms?: unknown }).rooms, 0);
  } finally {
    await server.runtime.close();
  }
});

test("GET /metrics.json returns live room and queue counters", async () => {
  const server = await startTestServer({ countdownMs: 20 });

  try {
    const first = await openSocket(server.port);
    const second = await openSocket(server.port);
    await first.readMessage();
    await second.readMessage();

    first.socket.send(JSON.stringify({ type: "matchmakingJoin" }));
    await readUntilType(first, "queueState");

    second.socket.send(JSON.stringify({ type: "matchmakingJoin" }));
    await readUntilType(first, "gameStart");
    await readUntilType(second, "gameStart");

    const response = await fetch(`http://127.0.0.1:${server.port}/metrics.json`);
    const body = await response.json() as Record<string, unknown>;

    assert.equal(response.status, 200);
    assert.equal(body.connections, 2);
    assert.equal(body.queueSize, 0);
    assert.equal(body.rooms, 1);
    assert.equal(body.matchmakingRooms, 1);
    assert.equal(body.privateRooms, 0);
    assert.equal(body.countdownRooms, 0);
    assert.equal(body.playingRooms, 1);
    assert.equal(typeof body.finishedRooms, "number");
    assert.equal(body.totalQueueJoins, 2);
    assert.equal(body.totalMatches, 1);
    assert.equal(body.totalGameStarts, 1);
    assert.equal(body.totalGameOvers, 0);
    assert.equal(typeof body.messagesInPerSec, "number");
    assert.equal(typeof body.messagesOutPerSec, "number");
    assert.equal(typeof body.memoryRss, "number");
    assert.equal(body.maxConnections, DEFAULT_PVP_SERVER_CONFIG.maxConnections);
    assert.equal(body.maxRooms, DEFAULT_PVP_SERVER_CONFIG.maxRooms);
    assert.equal(body.maxQueue, DEFAULT_PVP_SERVER_CONFIG.maxQueue);
    assert.equal(typeof body.uptime, "number");

    await closeSocket(first.socket);
    await closeSocket(second.socket);
  } finally {
    await server.runtime.close();
  }
});

test("production config keeps websocket origins explicit", () => {
  const defaultProductionConfig = readPvpServerConfig({
    NODE_ENV: "production",
  });
  const explicitProductionConfig = readPvpServerConfig({
    NODE_ENV: "production",
    ALLOWED_ORIGINS: "https://game.example.com, localhost:5173, https://mirror.example.com/",
  });

  assert.deepEqual(defaultProductionConfig.allowedOrigins, []);
  assert.deepEqual(explicitProductionConfig.allowedOrigins, [
    "https://game.example.com",
    "localhost:5173",
    "https://mirror.example.com",
  ]);
  assert.equal(isAllowedOrigin("https://game.example.com", explicitProductionConfig.allowedOrigins), true);
  assert.equal(isAllowedOrigin("http://localhost:5173", explicitProductionConfig.allowedOrigins), true);
  assert.equal(isAllowedOrigin("https://evil.example.com", explicitProductionConfig.allowedOrigins), false);
});

test("ws upgrade rejects disallowed origins with 403", async () => {
  const server = await startTestServer({
    allowedOrigins: ["https://allowed.example.com"],
  });

  try {
    await new Promise<void>((resolve, reject) => {
      const socket = new WebSocket(`ws://127.0.0.1:${server.port}/ws`, {
        origin: "https://blocked.example.com",
      });
      const timer = setTimeout(() => {
        socket.terminate();
        reject(new Error("websocket rejection timeout"));
      }, TEST_TIMEOUT_MS);

      socket.once("unexpected-response", (_request, response) => {
        const chunks: Buffer[] = [];

        response.on("data", (chunk: Buffer | string) => {
          chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
        });
        response.on("end", () => {
          clearTimeout(timer);
          assert.equal(response.statusCode, 403);
          assert.match(Buffer.concat(chunks).toString("utf8"), /origin_rejected/);
          socket.terminate();
          resolve();
        });
        response.resume();
      });
      socket.once("open", () => {
        clearTimeout(timer);
        reject(new Error("unexpected websocket open"));
      });
      socket.once("error", (error) => {
        clearTimeout(timer);
        reject(error);
      });
    });
  } finally {
    await server.runtime.close();
  }
});

test("graceful shutdown sends serverShutdown before closing clients", async () => {
  const server = await startTestServer();

  try {
    const client = await openSocket(server.port);
    await client.readMessage();

    const closing = server.runtime.close({
      graceful: true,
      graceMs: 50,
    });
    const shutdownMessage = await client.readMessage();

    assert.deepEqual(shutdownMessage, {
      type: "serverShutdown",
      message: "PVP server is shutting down",
      retryAfterMs: 50,
    });

    await closing;
    await closeSocket(client.socket);
  } finally {
    await server.runtime.close();
  }
});

test("websocket connection receives welcome", async () => {
  const server = await startTestServer();

  try {
    const client = await openSocket(server.port);
    const welcome = await client.readMessage();

    assert.equal(welcome.type, "welcome");
    assert.match(welcome.playerId, /^player_/);
    assert.match(welcome.sessionToken, /^session_/);
    assert.equal(server.runtime.connections.size, 1);

    await closeSocket(client.socket);
  } finally {
    await server.runtime.close();
  }
});

test("hello is accepted and returns a validated server response", async () => {
  const server = await startTestServer();

  try {
    const client = await openSocket(server.port);
    const welcome = await client.readMessage();

    client.socket.send(JSON.stringify({ type: "hello", clientVersion: "0.1.0", nickname: "Nova" }));
    await sleep(10);

    assert.equal(validateServerMessage(welcome).ok, true);
    assert.equal(welcome.type, "welcome");
    assert.equal(server.runtime.connections.get(welcome.playerId)?.nickname, "Nova");

    await closeSocket(client.socket);
  } finally {
    await server.runtime.close();
  }
});

test("ping returns pong with the same clientTime", async () => {
  const server = await startTestServer();

  try {
    const client = await openSocket(server.port);
    await client.readMessage();

    client.socket.send(JSON.stringify({ type: "ping", clientTime: 1_234 }));
    const response = await client.readMessage();

    assert.equal(response.type, "pong");
    assert.equal(response.clientTime, 1_234);
    assert.equal(typeof response.serverTime, "number");

    await closeSocket(client.socket);
  } finally {
    await server.runtime.close();
  }
});

test("single matchmakingJoin enters the queue and returns queueState", async () => {
  const server = await startTestServer();

  try {
    const client = await openSocket(server.port);
    await client.readMessage();

    client.socket.send(JSON.stringify({ type: "matchmakingJoin" }));
    const queueState = await readUntilType(client, "queueState");

    assert.equal(queueState.position, 1);
    assert.equal(queueState.queuedCount, 1);
    assert.equal(queueState.onlineCount, 1);
    assert.equal(queueState.waitingMs >= 0, true);
    assert.equal(typeof queueState.estimatedWaitMs, "number");
    assert.equal(server.runtime.matchmakingQueue.size, 1);

    await closeSocket(client.socket);
  } finally {
    await server.runtime.close();
  }
});

test("two matchmakingJoin requests auto-create a room, countdown, and gameStart without ready", async () => {
  const server = await startTestServer({ countdownMs: 40 });

  try {
    const first = await openSocket(server.port);
    const second = await openSocket(server.port);
    await first.readMessage();
    await second.readMessage();

    first.socket.send(JSON.stringify({ type: "matchmakingJoin" }));
    const firstQueueState = await readUntilType(first, "queueState");
    assert.equal(firstQueueState.position, 1);

    second.socket.send(JSON.stringify({ type: "matchmakingJoin" }));

    const firstMatch = await readUntilType(first, "matchFound");
    const secondMatch = await readUntilType(second, "matchFound");
    const firstCountdownState = await readUntilType(first, "roomState", (message) => message.phase === "countdown");
    const firstCountdown = await readUntilType(first, "countdown");
    const secondCountdown = await readUntilType(second, "countdown");
    const firstGameStart = await readUntilType(first, "gameStart");
    const secondGameStart = await readUntilType(second, "gameStart");

    assert.equal(firstMatch.playerSlot, "p1");
    assert.equal(secondMatch.playerSlot, "p2");
    assert.equal(firstMatch.roomCode, secondMatch.roomCode);
    assert.equal(firstCountdownState.phase, "countdown");
    assert.equal(firstCountdownState.players.length, 2);
    assert.deepEqual(firstGameStart.playerSlots, ["p1", "p2"]);
    assert.deepEqual(secondGameStart.playerSlots, ["p1", "p2"]);
    assert.equal(firstCountdown.startsInMs, 40);
    assert.equal(secondCountdown.startsInMs, 40);
    assert.equal(server.runtime.matchmakingQueue.size, 0);
    assert.equal(server.runtime.rooms.size, 1);
    assert.equal(server.runtime.rooms.values()[0]?.roomType, "matchmaking");

    await closeSocket(first.socket);
    await closeSocket(second.socket);
  } finally {
    await server.runtime.close();
  }
});

test("matchmakingCancel removes a player from the queue", async () => {
  const server = await startTestServer();

  try {
    const client = await openSocket(server.port);
    await client.readMessage();

    client.socket.send(JSON.stringify({ type: "matchmakingJoin" }));
    await readUntilType(client, "queueState");

    client.socket.send(JSON.stringify({ type: "matchmakingCancel" }));
    const canceledState = await readUntilType(client, "queueState");

    assert.equal(canceledState.position, undefined);
    assert.equal(canceledState.queuedCount, 0);
    assert.equal(canceledState.waitingMs, 0);
    assert.equal(server.runtime.matchmakingQueue.size, 0);

    await closeSocket(client.socket);
  } finally {
    await server.runtime.close();
  }
});

test("duplicate matchmakingCancel returns an error without crashing the server", async () => {
  const server = await startTestServer();

  try {
    const client = await openSocket(server.port);
    await client.readMessage();

    client.socket.send(JSON.stringify({ type: "matchmakingJoin" }));
    await readUntilType(client, "queueState");

    client.socket.send(JSON.stringify({ type: "matchmakingCancel" }));
    await readUntilType(client, "queueState");

    client.socket.send(JSON.stringify({ type: "matchmakingCancel" }));
    const response = await readUntilType(client, "error");

    assert.deepEqual(response, {
      type: "error",
      code: "invalid_state",
      message: "You are not currently in the matchmaking queue",
    });
    assert.equal(server.runtime.matchmakingQueue.size, 0);

    await closeSocket(client.socket);
  } finally {
    await server.runtime.close();
  }
});

test("disconnect removes a queued player", async () => {
  const server = await startTestServer();

  try {
    const client = await openSocket(server.port);
    await client.readMessage();

    client.socket.send(JSON.stringify({ type: "matchmakingJoin" }));
    await readUntilType(client, "queueState");
    assert.equal(server.runtime.matchmakingQueue.size, 1);

    await closeSocket(client.socket);
    await waitFor(() => server.runtime.matchmakingQueue.size === 0);
  } finally {
    await server.runtime.close();
  }
});

test("disconnect from a waiting private room destroys the room when no opponent is present", async () => {
  const server = await startTestServer();

  try {
    const owner = await openSocket(server.port);
    await owner.readMessage();

    owner.socket.send(JSON.stringify({ type: "createRoom" }));
    const roomCreated = await readUntilType(owner, "roomCreated");
    const roomState = await readUntilType(owner, "roomState", (message) => message.phase === "waiting");

    assert.match(roomCreated.roomCode, /^[A-Z0-9]{6}$/);
    assert.equal(roomState.players.length, 1);

    await closeSocket(owner.socket);
    await waitFor(() => server.runtime.rooms.size === 0);
    assert.equal(server.runtime.rooms.size, 0);
  } finally {
    await server.runtime.close();
  }
});

test("reconnect within grace restores a waiting private room", async () => {
  const server = await startTestServer({
    countdownMs: 100,
    reconnectGraceMs: 100,
    privateRoomWaitTimeoutMs: 10_000,
    cleanupIntervalMs: 5,
  });

  try {
    const owner = await openSocket(server.port);
    const guest = await openSocket(server.port);
    const ownerWelcome = await owner.readMessage();
    await guest.readMessage();

    owner.socket.send(JSON.stringify({ type: "createRoom" }));
    const roomCreated = await readUntilType(owner, "roomCreated");
    await readUntilType(owner, "roomState", (message) => message.phase === "waiting");

    guest.socket.send(JSON.stringify({ type: "joinRoom", roomCode: roomCreated.roomCode }));
    await readUntilType(guest, "roomJoined");
    const joinedState = await readUntilType(owner, "roomState", (message) => (
      message.phase === "waiting"
      && message.players.length === 2
    ));

    assert.equal(joinedState.players.every((player) => !player.ready), true);

    await closeSocket(owner.socket);
    await readUntilType(guest, "opponentLeft");
    await readUntilType(guest, "roomState", (message) => message.phase === "waiting");

    const reconnect = await openSocket(server.port);
    await reconnect.readMessage();

    reconnect.socket.send(JSON.stringify({
      type: "hello",
      clientVersion: "0.1.0",
      sessionToken: ownerWelcome.sessionToken,
    }));

    const reconnectResult = await readUntilType(reconnect, "reconnectResult");
    const roomState = await readUntilType(reconnect, "roomState", (message) => message.phase === "waiting");

    assert.equal(reconnectResult.ok, true);
    assert.equal(reconnectResult.roomCode, roomCreated.roomCode);
    assert.equal(reconnectResult.playerSlot, "p1");
    assert.equal(reconnectResult.phase, "waiting");
    assert.equal(roomState.roomCode, roomCreated.roomCode);
    assert.equal(roomState.players.length, 2);
    assert.equal(roomState.players.find((player) => player.playerSlot === "p1")?.connected, true);
    assert.equal(roomState.players.find((player) => player.playerSlot === "p2")?.connected, true);

    await closeSocket(reconnect.socket);
    await closeSocket(guest.socket);
    await waitFor(() => server.runtime.rooms.size === 0);
    assert.equal(server.runtime.rooms.size, 0);
  } finally {
    await server.runtime.close();
  }
});

test("waiting private room is cleaned after the idle timeout", async () => {
  const server = await startTestServer({
    privateRoomWaitTimeoutMs: 20,
    cleanupIntervalMs: 5,
  });

  try {
    const owner = await openSocket(server.port);
    await owner.readMessage();

    owner.socket.send(JSON.stringify({ type: "createRoom" }));
    const roomCreated = await readUntilType(owner, "roomCreated");
    const roomState = await readUntilType(owner, "roomState", (message) => message.phase === "waiting");

    assert.match(roomCreated.roomCode, /^[A-Z0-9]{6}$/);
    assert.equal(roomState.players.length, 1);

    await waitFor(() => server.runtime.rooms.size === 0);

    const expiredError = await readUntilType(owner, "error");
    assert.deepEqual(expiredError, {
      type: "error",
      code: "invalid_state",
      message: "The private room expired because nobody started the match in time",
    });

    await closeSocket(owner.socket);
  } finally {
    await server.runtime.close();
  }
});

test("disconnect from a ready private room returns the room to waiting and notifies the opponent", async () => {
  const server = await startTestServer({ countdownMs: 200 });

  try {
    const owner = await openSocket(server.port);
    const guest = await openSocket(server.port);
    await owner.readMessage();
    await guest.readMessage();

    owner.socket.send(JSON.stringify({ type: "createRoom" }));
    const roomCreated = await readUntilType(owner, "roomCreated");
    await readUntilType(owner, "roomState", (message) => message.phase === "waiting");

    guest.socket.send(JSON.stringify({ type: "joinRoom", roomCode: roomCreated.roomCode }));
    await readUntilType(guest, "roomJoined");
    await readUntilType(owner, "roomState", (message) => (
      message.phase === "waiting"
      && message.players.length === 2
    ));

    owner.socket.send(JSON.stringify({ type: "ready", ready: true }));
    const readyState = await readUntilType(guest, "roomState", (message) => (
      message.phase === "ready"
      && message.players.some((player) => player.playerSlot === "p1" && player.ready)
      && message.players.some((player) => player.playerSlot === "p2" && !player.ready)
    ));

    assert.equal(readyState.players.length, 2);

    await closeSocket(owner.socket);
    const opponentLeft = await readUntilType(guest, "opponentLeft");

    assert.equal(opponentLeft.type, "opponentLeft");
    await waitFor(() => server.runtime.rooms.values()[0]?.phase === "waiting");
    assert.equal(server.runtime.rooms.size, 1);
    assert.equal(server.runtime.rooms.values()[0]?.players.length, 2);
    assert.equal(server.runtime.rooms.values()[0]?.players.filter((player) => player.connected).length, 1);

    await closeSocket(guest.socket);
  } finally {
    await server.runtime.close();
  }
});

test("reconnect fails after the grace window expires", async () => {
  const server = await startTestServer({
    countdownMs: 100,
    reconnectGraceMs: 20,
    privateRoomWaitTimeoutMs: 10_000,
    cleanupIntervalMs: 5,
  });

  try {
    const owner = await openSocket(server.port);
    const guest = await openSocket(server.port);
    const ownerWelcome = await owner.readMessage();
    await guest.readMessage();

    owner.socket.send(JSON.stringify({ type: "createRoom" }));
    const roomCreated = await readUntilType(owner, "roomCreated");
    await readUntilType(owner, "roomState", (message) => message.phase === "waiting");

    guest.socket.send(JSON.stringify({ type: "joinRoom", roomCode: roomCreated.roomCode }));
    await readUntilType(guest, "roomJoined");
    const joinedState = await readUntilType(owner, "roomState", (message) => (
      message.phase === "waiting"
      && message.players.length === 2
    ));

    assert.equal(joinedState.players.every((player) => !player.ready), true);

    await closeSocket(owner.socket);
    await readUntilType(guest, "opponentLeft");
    await readUntilType(guest, "roomState", (message) => message.phase === "waiting");

    await waitFor(() => server.runtime.connections.getBySessionToken(ownerWelcome.sessionToken) === undefined);

    const reconnect = await openSocket(server.port);
    await reconnect.readMessage();

    reconnect.socket.send(JSON.stringify({
      type: "hello",
      clientVersion: "0.1.0",
      sessionToken: ownerWelcome.sessionToken,
    }));

    const reconnectResult = await readUntilType(reconnect, "reconnectResult");

    assert.equal(reconnectResult.ok, false);
    await closeSocket(reconnect.socket);
    await closeSocket(guest.socket);
  } finally {
    await server.runtime.close();
  }
});

test("duplicate matchmakingJoin does not create duplicate queue entries", async () => {
  const server = await startTestServer();

  try {
    const client = await openSocket(server.port);
    await client.readMessage();

    client.socket.send(JSON.stringify({ type: "matchmakingJoin" }));
    const firstQueueState = await readUntilType(client, "queueState");

    client.socket.send(JSON.stringify({ type: "matchmakingJoin" }));
    const secondQueueState = await readUntilType(client, "queueState");

    assert.equal(firstQueueState.position, 1);
    assert.equal(secondQueueState.position, 1);
    assert.equal(secondQueueState.queuedCount, 1);
    assert.equal(server.runtime.matchmakingQueue.size, 1);

    await closeSocket(client.socket);
  } finally {
    await server.runtime.close();
  }
});

test("queue_full returns a clear error", async () => {
  const server = await startTestServer({ maxQueue: 0 });

  try {
    const client = await openSocket(server.port);
    await client.readMessage();

    client.socket.send(JSON.stringify({ type: "matchmakingJoin" }));
    const response = await readUntilType(client, "error");

    assert.deepEqual(response, {
      type: "error",
      code: "queue_full",
      message: "The matchmaking queue is full",
    });

    await closeSocket(client.socket);
  } finally {
    await server.runtime.close();
  }
});

test("room_capacity_reached returns a clear error when no more rooms can be created", async () => {
  const server = await startTestServer({ maxRooms: 0 });

  try {
    const client = await openSocket(server.port);
    await client.readMessage();

    client.socket.send(JSON.stringify({ type: "matchmakingJoin" }));
    const response = await readUntilType(client, "error");

    assert.deepEqual(response, {
      type: "error",
      code: "room_capacity_reached",
      message: "All PVP rooms are busy right now",
    });

    await closeSocket(client.socket);
  } finally {
    await server.runtime.close();
  }
});

test("createRoom is rejected when PVP_MAX_ROOMS is reached", async () => {
  const server = await startTestServer({ maxRooms: 0 });

  try {
    const client = await openSocket(server.port);
    await client.readMessage();

    client.socket.send(JSON.stringify({ type: "createRoom" }));
    const response = await readUntilType(client, "error");

    assert.deepEqual(response, {
      type: "error",
      code: "room_capacity_reached",
      message: "All PVP rooms are busy right now",
    });

    await closeSocket(client.socket);
  } finally {
    await server.runtime.close();
  }
});

test("matchmakingJoin is rejected while already playing", async () => {
  const server = await startTestServer({ countdownMs: 20 });

  try {
    const { first, second } = await startMatchedGame(server);

    first.socket.send(JSON.stringify({ type: "matchmakingJoin" }));
    const response = await readUntilType(first, "error");

    assert.deepEqual(response, {
      type: "error",
      code: "already_in_room",
      message: "Leave the current room before joining matchmaking",
    });

    await closeSocket(first.socket);
    await closeSocket(second.socket);
  } finally {
    await server.runtime.close();
  }
});

test("createRoom generates a private room code and waits for both players to ready before countdown", async () => {
  const server = await startTestServer({ countdownMs: 40 });

  try {
    const owner = await openSocket(server.port);
    const guest = await openSocket(server.port);
    await owner.readMessage();
    await guest.readMessage();

    owner.socket.send(JSON.stringify({ type: "createRoom" }));
    const roomCreated = await readUntilType(owner, "roomCreated");
    const ownerWaitingState = await readUntilType(owner, "roomState", (message) => message.phase === "waiting");

    assert.match(roomCreated.roomCode, /^[A-Z0-9]{6}$/);
    assert.equal(ownerWaitingState.players.length, 1);

    guest.socket.send(JSON.stringify({ type: "joinRoom", roomCode: roomCreated.roomCode }));

    const roomJoined = await readUntilType(guest, "roomJoined");
    const ownerJoinedState = await readUntilType(owner, "roomState", (message) => (
      message.phase === "waiting"
      && message.players.length === 2
    ));

    assert.equal(roomJoined.roomCode, roomCreated.roomCode);
    assert.equal(roomJoined.playerSlot, "p2");
    assert.equal(ownerJoinedState.players.every((player) => !player.ready), true);

    owner.socket.send(JSON.stringify({ type: "ready", ready: true }));
    const ownerReadyState = await readUntilType(owner, "roomState", (message) => (
      message.phase === "ready"
      && message.players.some((player) => player.playerSlot === "p1" && player.ready)
      && message.players.some((player) => player.playerSlot === "p2" && !player.ready)
    ));

    assert.equal(ownerReadyState.players.length, 2);

    guest.socket.send(JSON.stringify({ type: "ready", ready: true }));
    const ownerCountdownState = await readUntilType(owner, "roomState", (message) => message.phase === "countdown");
    const ownerCountdown = await readUntilType(owner, "countdown");
    const guestCountdown = await readUntilType(guest, "countdown");
    const ownerGameStart = await readUntilType(owner, "gameStart");
    const guestGameStart = await readUntilType(guest, "gameStart");

    assert.equal(ownerCountdownState.phase, "countdown");
    assert.equal(ownerCountdownState.players.length, 2);
    assert.equal(ownerCountdown.startsInMs, 40);
    assert.equal(guestCountdown.startsInMs, 40);
    assert.deepEqual(ownerGameStart.playerSlots, ["p1", "p2"]);
    assert.deepEqual(guestGameStart.playerSlots, ["p1", "p2"]);
    assert.equal(server.runtime.rooms.values()[0]?.roomType, "private");

    await closeSocket(owner.socket);
    await closeSocket(guest.socket);
  } finally {
    await server.runtime.close();
  }
});

test("playing room relays inputs, keeps out-of-order ticks sorted, and rejects duplicates, reverses, and stale inputs", async () => {
  const server = await startTestServer({ countdownMs: 40, inputDelayTicks: 3 });

  try {
    const owner = await openSocket(server.port);
    const guest = await openSocket(server.port);
    const ownerWelcome = await readUntilType(owner, "welcome");
    await readUntilType(guest, "welcome");

    owner.socket.send(JSON.stringify({ type: "createRoom" }));
    const roomCreated = await readUntilType(owner, "roomCreated");
    await readUntilType(owner, "roomState", (message) => message.phase === "waiting");

    guest.socket.send(JSON.stringify({ type: "joinRoom", roomCode: roomCreated.roomCode }));
    await readUntilType(guest, "roomJoined");
    owner.socket.send(JSON.stringify({ type: "ready", ready: true }));
    await readUntilType(owner, "roomState", (message) => (
      message.phase === "ready"
      && message.players.some((player) => player.playerSlot === "p1" && player.ready)
      && message.players.some((player) => player.playerSlot === "p2" && !player.ready)
    ));
    guest.socket.send(JSON.stringify({ type: "ready", ready: true }));
    await readUntilType(owner, "countdown");
    await readUntilType(guest, "countdown");
    await readUntilType(owner, "gameStart");
    await readUntilType(guest, "gameStart");

    const room = server.runtime.rooms.values()[0];

    assert.ok(room);
    assert.ok(room.inputState);

    const ownerInputState = room.inputState.playersById.get("p1");

    assert.ok(ownerInputState);

    owner.socket.send(JSON.stringify({ type: "input", seq: 1, tick: 10, direction: "right" }));
    const firstPeerInput = await readUntilType(guest, "peerInput");

    assert.deepEqual(firstPeerInput, {
      type: "peerInput",
      playerSlot: "p1",
      seq: 1,
      tick: 10,
      direction: "right",
    });

    await sleep(35);
    owner.socket.send(JSON.stringify({ type: "input", seq: 2, tick: 9, direction: "up" }));
    const secondPeerInput = await readUntilType(guest, "peerInput", (message) => message.seq === 2);

    assert.deepEqual(secondPeerInput, {
      type: "peerInput",
      playerSlot: "p1",
      seq: 2,
      tick: 9,
      direction: "up",
    });
    assert.deepEqual(
      ownerInputState.recentInputs.map((input) => ({ tick: input.tick, direction: input.direction, seq: input.seq })),
      [
        { tick: 9, direction: "up", seq: 2 },
        { tick: 10, direction: "right", seq: 1 },
      ],
    );

    await sleep(35);
    owner.socket.send(JSON.stringify({ type: "input", seq: 2, tick: 12, direction: "up" }));
    assert.equal(ownerInputState.recentInputs.length, 2);

    await sleep(35);
    owner.socket.send(JSON.stringify({ type: "input", seq: 3, tick: 11, direction: "left" }));
    assert.equal(ownerInputState.recentInputs.length, 2);

    await sleep(35);
    owner.socket.send(JSON.stringify({ type: "input", seq: 4, tick: 6, direction: "down" }));
    assert.equal(ownerInputState.recentInputs.length, 2);

    await closeSocket(owner.socket);
    await closeSocket(guest.socket);
  } finally {
    await server.runtime.close();
  }
});

test("rapid input bursts are rate limited", async () => {
  const server = await startTestServer({ countdownMs: 40 });

  try {
    const owner = await openSocket(server.port);
    const guest = await openSocket(server.port);
    const ownerWelcome = await readUntilType(owner, "welcome");

    owner.socket.send(JSON.stringify({ type: "createRoom" }));
    const roomCreated = await readUntilType(owner, "roomCreated");
    await readUntilType(owner, "roomState", (message) => message.phase === "waiting");

    guest.socket.send(JSON.stringify({ type: "joinRoom", roomCode: roomCreated.roomCode }));
    await readUntilType(guest, "roomJoined");
    owner.socket.send(JSON.stringify({ type: "ready", ready: true }));
    await readUntilType(owner, "roomState", (message) => (
      message.phase === "ready"
      && message.players.some((player) => player.playerSlot === "p1" && player.ready)
      && message.players.some((player) => player.playerSlot === "p2" && !player.ready)
    ));
    guest.socket.send(JSON.stringify({ type: "ready", ready: true }));
    await readUntilType(owner, "countdown");
    await readUntilType(guest, "countdown");
    await readUntilType(owner, "gameStart");
    await readUntilType(guest, "gameStart");

    const room = server.runtime.rooms.values()[0];

    assert.ok(room);
    assert.ok(room.inputState);

    const ownerInputState = room.inputState.playersById.get("p1");

    assert.ok(ownerInputState);

    owner.socket.send(JSON.stringify({ type: "input", seq: 1, tick: 10, direction: "right" }));
    await readUntilType(guest, "peerInput");

    owner.socket.send(JSON.stringify({ type: "input", seq: 2, tick: 11, direction: "up" }));

    assert.equal(ownerInputState.recentInputs.length, 1);

    await closeSocket(owner.socket);
    await closeSocket(guest.socket);
  } finally {
    await server.runtime.close();
  }
});

test("room_full is returned when trying to join a full private room", async () => {
  const server = await startTestServer({ countdownMs: 100 });

  try {
    const owner = await openSocket(server.port);
    const guest = await openSocket(server.port);
    const intruder = await openSocket(server.port);
    await owner.readMessage();
    await guest.readMessage();
    await intruder.readMessage();

    owner.socket.send(JSON.stringify({ type: "createRoom" }));
    const roomCreated = await readUntilType(owner, "roomCreated");

    guest.socket.send(JSON.stringify({ type: "joinRoom", roomCode: roomCreated.roomCode }));
    await readUntilType(guest, "roomJoined");

    intruder.socket.send(JSON.stringify({ type: "joinRoom", roomCode: roomCreated.roomCode }));
    const error = await readUntilType(intruder, "error");

    assert.deepEqual(error, {
      type: "error",
      code: "room_full",
      message: "The private room is already full",
    });

    await closeSocket(owner.socket);
    await closeSocket(guest.socket);
    await closeSocket(intruder.socket);
  } finally {
    await server.runtime.close();
  }
});

test("room_not_found is returned when joining a missing private room", async () => {
  const server = await startTestServer();

  try {
    const client = await openSocket(server.port);
    await client.readMessage();

    client.socket.send(JSON.stringify({ type: "joinRoom", roomCode: "AB12CD" }));
    const error = await readUntilType(client, "error");

    assert.deepEqual(error, {
      type: "error",
      code: "room_not_found",
      message: "The private room could not be found",
    });

    await closeSocket(client.socket);
  } finally {
    await server.runtime.close();
  }
});

test("disconnect during countdown returns the room to waiting and notifies the opponent", async () => {
  const server = await startTestServer({ countdownMs: 100 });

  try {
    const first = await openSocket(server.port);
    const second = await openSocket(server.port);
    await first.readMessage();
    await second.readMessage();

    first.socket.send(JSON.stringify({ type: "matchmakingJoin" }));
    await readUntilType(first, "queueState");

    second.socket.send(JSON.stringify({ type: "matchmakingJoin" }));
    await readUntilType(first, "countdown");
    await readUntilType(second, "countdown");

    await closeSocket(second.socket);
    const opponentLeft = await readUntilType(first, "opponentLeft");

    assert.equal(opponentLeft.type, "opponentLeft");
    await waitFor(() => server.runtime.rooms.values()[0]?.phase === "waiting");
    const room = server.runtime.rooms.values()[0];

    assert.equal(server.runtime.rooms.size, 1);
    assert.equal(room?.phase, "waiting");
    assert.equal(room?.players.length, 2);
    assert.equal(room?.players.filter((player) => player.connected).length, 1);

    await closeSocket(first.socket);
  } finally {
    await server.runtime.close();
  }
});

test("disconnect during playing awards the opponent a win after reconnect grace expires", async () => {
  const server = await startTestServer({
    countdownMs: 20,
    reconnectGraceMs: 30,
    finishedRoomTtlMs: 1_000,
    cleanupIntervalMs: 10,
  });

  try {
    const first = await openSocket(server.port);
    const second = await openSocket(server.port);
    await first.readMessage();
    await second.readMessage();

    first.socket.send(JSON.stringify({ type: "matchmakingJoin" }));
    await readUntilType(first, "queueState");

    second.socket.send(JSON.stringify({ type: "matchmakingJoin" }));
    await readUntilType(first, "gameStart");
    await readUntilType(second, "gameStart");

    await closeSocket(second.socket);
    await waitFor(() => (
      server.runtime.rooms.values()[0]?.phase === "playing"
      && server.runtime.rooms.values()[0]?.players.filter((player) => player.connected).length === 1
    ));
    const playingRoom = server.runtime.rooms.values()[0];

    assert.equal(playingRoom?.phase, "playing");
    assert.equal(playingRoom?.players.filter((player) => player.connected).length, 1);

    const gameOver = await readUntilType(first, "gameOver");

    assert.deepEqual(gameOver, {
      type: "gameOver",
      winner: "p1",
      reason: "opponent_disconnected",
      finalTick: 0,
    });
    await waitFor(() => server.runtime.rooms.values()[0]?.phase === "finished");
    const room = server.runtime.rooms.values()[0];

    assert.equal(room?.players.length, 2);
    assert.equal(room?.players.filter((player) => player.connected).length, 1);
    await waitFor(() => server.runtime.rooms.size === 0);
    assert.equal(server.runtime.rooms.size, 0);

    await closeSocket(first.socket);
  } finally {
    await server.runtime.close();
  }
});

test("playing reconnect within grace restores the room before awarding a disconnect win", async () => {
  const server = await startTestServer({
    countdownMs: 20,
    reconnectGraceMs: 200,
    cleanupIntervalMs: 10,
    tickRate: 20,
  });

  try {
    const first = await openSocket(server.port);
    const second = await openSocket(server.port);
    const firstWelcome = await first.readMessage();
    await second.readMessage();

    first.socket.send(JSON.stringify({ type: "matchmakingJoin" }));
    await readUntilType(first, "queueState");

    second.socket.send(JSON.stringify({ type: "matchmakingJoin" }));
    await readUntilType(first, "gameStart");
    await readUntilType(second, "gameStart");

    await closeSocket(first.socket);
    await readUntilType(second, "roomState", (message) => (
      message.phase === "playing"
      && message.players.some((player) => player.playerSlot === "p1" && !player.connected)
      && message.players.some((player) => player.playerSlot === "p2" && player.connected)
    ));

    const reconnect = await openSocket(server.port);
    await reconnect.readMessage();

    reconnect.socket.send(JSON.stringify({
      type: "hello",
      clientVersion: "0.1.0",
      sessionToken: firstWelcome.sessionToken,
    }));

    const reconnectResult = await readUntilType(reconnect, "reconnectResult");
    const roomState = await readUntilType(reconnect, "roomState", (message) => (
      message.phase === "playing"
      && message.players.every((player) => player.connected)
    ));
    const gameStart = await readUntilType(reconnect, "gameStart");
    const snapshot = await readUntilType(reconnect, "snapshot");

    assert.equal(reconnectResult.ok, true);
    assert.equal(reconnectResult.phase, "playing");
    assert.equal(reconnectResult.playerSlot, "p1");
    assert.equal(roomState.players.length, 2);
    assert.deepEqual(gameStart.playerSlots, ["p1", "p2"]);
    assert.equal(snapshot.phase, "playing");
    assert.equal(server.runtime.rooms.values()[0]?.phase, "playing");

    await closeSocket(reconnect.socket);
    await closeSocket(second.socket);
  } finally {
    await server.runtime.close();
  }
});

test("playing room broadcasts matching authoritative snapshots to both players", async () => {
  const server = await startTestServer({ countdownMs: 20, tickRate: 20 });

  try {
    const { first, second } = await startMatchedGame(server);
    const [firstSnapshot, secondSnapshot] = await Promise.all([
      readUntilType(first, "snapshot"),
      readUntilType(second, "snapshot"),
    ]);

    assert.deepEqual(firstSnapshot, secondSnapshot);
    assert.equal(firstSnapshot.phase, "playing");
    assert.equal(firstSnapshot.tick, 0);
    assert.match(firstSnapshot.stateHash, /^pvp:/);
    assert.ok(firstSnapshot.snakeHeads.p1);
    assert.ok(firstSnapshot.snakeHeads.p2);

    await closeSocket(first.socket);
    await closeSocket(second.socket);
  } finally {
    await server.runtime.close();
  }
});

test("playing room opening stays alive without immediate player input", async () => {
  const server = await startTestServer({ countdownMs: 20, tickRate: 60 });

  try {
    const { first, second, room } = await startMatchedGame(server);
    let latestTick = 0;

    while (latestTick < PVP_OPENING_SAFETY_TICKS) {
      const [firstSnapshot, secondSnapshot] = await Promise.all([
        readUntilType(first, "snapshot", (message) => message.tick > latestTick),
        readUntilType(second, "snapshot", (message) => message.tick > latestTick),
      ]);

      assert.deepEqual(firstSnapshot, secondSnapshot);
      assert.equal(firstSnapshot.phase, "playing");
      assert.equal(firstSnapshot.alive.p1, true);
      assert.equal(firstSnapshot.alive.p2, true);
      latestTick = firstSnapshot.tick;
    }

    const metricsResponse = await fetch(`http://127.0.0.1:${server.port}/metrics.json`);
    const metrics = await metricsResponse.json() as Record<string, unknown>;

    assert.equal(room.phase, "playing");
    assert.equal(room.lastGameOver, undefined);
    assert.equal(metricsResponse.status, 200);
    assert.equal(metrics.totalGameOvers, 0);

    await closeSocket(first.socket);
    await closeSocket(second.socket);
  } finally {
    await server.runtime.close();
  }
});

for (const scenario of [
  {
    name: "wall collisions",
    expected: { winner: "p2" as const, reason: "wall" as const },
    setup(runtime: any): void {
      setRuntimePlayer(runtime, "p1", [{ column: 0, row: 2 }], "left");
      setRuntimePlayer(runtime, "p2", [{ column: 10, row: 10 }], "right");
    },
  },
  {
    name: "self collisions",
    expected: { winner: "p2" as const, reason: "snake_body" as const },
    setup(runtime: any): void {
      setRuntimePlayer(runtime, "p1", [
        { column: 2, row: 2 },
        { column: 1, row: 2 },
        { column: 0, row: 2 },
      ], "left");
      setRuntimePlayer(runtime, "p2", [{ column: 10, row: 10 }], "right");
    },
  },
  {
    name: "opponent collisions",
    expected: { winner: "p2" as const, reason: "snake_body" as const },
    setup(runtime: any): void {
      setRuntimePlayer(runtime, "p1", [{ column: 1, row: 2 }], "right");
      setRuntimePlayer(runtime, "p2", [
        { column: 4, row: 2 },
        { column: 3, row: 2 },
        { column: 2, row: 2 },
        { column: 2, row: 3 },
      ], "up");
    },
  },
  {
    name: "draws",
    expected: { winner: "draw" as const, reason: "draw" as const },
    setup(runtime: any): void {
      setRuntimePlayer(runtime, "p1", [{ column: 2, row: 2 }], "right");
      setRuntimePlayer(runtime, "p2", [{ column: 4, row: 2 }], "left");
    },
  },
] as const) {
  test(`playing room authoritative结算 handles ${scenario.name}`, async () => {
    const server = await startTestServer({ countdownMs: 20, tickRate: 20 });

    try {
      const { first, second, room } = await startMatchedGame(server);
      assert.ok(room.gameState);
      scenario.setup(room.gameState as any);
      room.gameState.foods = [];
      room.gameState.starCores = [];

      const [firstGameOver, secondGameOver] = await Promise.all([
        readUntilType(first, "gameOver"),
        readUntilType(second, "gameOver"),
      ]);

      assert.deepEqual(firstGameOver, secondGameOver);
      assert.equal(firstGameOver.winner, scenario.expected.winner);
      assert.equal(firstGameOver.reason, scenario.expected.reason);
      assert.equal(firstGameOver.finalTick, 1);

      await closeSocket(first.socket);
      await closeSocket(second.socket);
    } finally {
      await server.runtime.close();
    }
  });
}

test("invalid message returns error without crashing the server", async () => {
  const server = await startTestServer();

  try {
    const client = await openSocket(server.port);
    await client.readMessage();

    client.socket.send("{bad json");
    const response = await client.readMessage();

    assert.deepEqual(response, {
      type: "error",
      code: "invalid_message",
      message: "message must be valid JSON",
    });
    assert.equal(server.runtime.connections.size, 1);

    await closeSocket(client.socket);
  } finally {
    await server.runtime.close();
  }
});

test("maxConnections rejects the boundary connection", async () => {
  const server = await startTestServer({ maxConnections: 1 });

  try {
    const firstClient = await openSocket(server.port);
    await firstClient.readMessage();

    const secondClient = await openSocket(server.port);
    const response = await secondClient.readMessage();

    assert.deepEqual(response, {
      type: "error",
      code: "capacity_reached",
      message: "PVP server is busy",
    });
    assert.equal(server.runtime.connections.size, 1);

    await closeSocket(firstClient.socket);
    await closeSocket(secondClient.socket);
  } finally {
    await server.runtime.close();
  }
});

test("connections count decreases after disconnect", async () => {
  const server = await startTestServer();

  try {
    const client = await openSocket(server.port);
    await client.readMessage();
    assert.equal(server.runtime.connections.size, 1);

    await closeSocket(client.socket);
    await waitFor(() => server.runtime.connections.size === 0);

    const response = await fetch(`http://127.0.0.1:${server.port}/health`);
    const body = await response.json() as { readonly connections: number };
    assert.equal(body.connections, 0);
  } finally {
    await server.runtime.close();
  }
});

test("200 simulated clients can be paired into about 100 rooms", async () => {
  const server = await startTestServer({ countdownMs: 1 });
  const clients: TestSocket[] = [];

  try {
    for (let index = 0; index < 200; index += 1) {
      const client = await openSocket(server.port);
      clients.push(client);
    }

    await Promise.all(clients.map(async (client) => client.readMessage()));
    for (const client of clients) {
      client.socket.send(JSON.stringify({ type: "matchmakingJoin" }));
    }

    await waitFor(() => server.runtime.rooms.size === 100 && server.runtime.matchmakingQueue.size === 0);
    assert.equal(server.runtime.rooms.size, 100);
    assert.equal(server.runtime.matchmakingQueue.size, 0);

    const metricsResponse = await fetch(`http://127.0.0.1:${server.port}/metrics.json`);
    const metrics = await metricsResponse.json() as Record<string, unknown>;

    assert.equal(metricsResponse.status, 200);
    assert.equal(metrics.connections, 200);
    assert.equal(metrics.queueSize, 0);
    assert.equal(metrics.rooms, 100);
    assert.equal(metrics.matchmakingRooms, 100);
    assert.equal(metrics.privateRooms, 0);

    const seenPlayerIds = new Set<string>();

    for (const room of server.runtime.rooms.values()) {
      assert.equal(room.roomType, "matchmaking");
      assert.equal(room.players.length, 2);

      for (const player of room.players) {
        assert.equal(seenPlayerIds.has(player.playerId), false);
        seenPlayerIds.add(player.playerId);
      }
    }

    assert.equal(seenPlayerIds.size, 200);
  } finally {
    await Promise.all(clients.map(async (client) => closeSocket(client.socket)));
    await server.runtime.close();
  }
});

async function startTestServer(overrides: Partial<PvpServerConfig> = {}): Promise<{
  readonly runtime: PvpServerRuntime;
  readonly port: number;
}> {
  const runtime = createPvpServer({
    ...DEFAULT_PVP_SERVER_CONFIG,
    port: 0,
    heartbeatIntervalMs: 50,
    connectionTimeoutMs: 500,
    cleanupIntervalMs: 10,
    ...overrides,
  });
  const port = await runtime.listen();

  return { runtime, port };
}

interface TestSocket {
  readonly socket: WebSocket;
  readMessage(): Promise<ServerToClientMessage>;
}

async function startMatchedGame(server: { readonly port: number }): Promise<{
  readonly first: TestSocket;
  readonly second: TestSocket;
  readonly room: any;
}> {
  const first = await openSocket(server.port);
  const second = await openSocket(server.port);
  await first.readMessage();
  await second.readMessage();

  first.socket.send(JSON.stringify({ type: "matchmakingJoin" }));
  await readUntilType(first, "queueState");

  second.socket.send(JSON.stringify({ type: "matchmakingJoin" }));
  await readUntilType(first, "gameStart");
  await readUntilType(second, "gameStart");

  return {
    first,
    second,
    room: getPlayingRoom(server),
  };
}

function getPlayingRoom(server: { readonly runtime: PvpServerRuntime }): any {
  const room = server.runtime.rooms.values()[0];

  assert.ok(room);
  assert.ok(room.gameState);
  return room;
}

function setRuntimePlayer(
  runtime: any,
  playerSlot: "p1" | "p2",
  snake: readonly Readonly<{ column: number; row: number }>[],
  direction: "up" | "right" | "down" | "left",
): void {
  const player = runtime.players.find((candidate: any) => candidate.id === playerSlot);

  assert.ok(player);
  player.snake = snake.map((cell) => ({ ...cell }));
  player.movement.direction = direction;
  player.movement.directionQueue = [];
  player.movement.pendingGrowthSegments = 0;
  player.lifecycle.phase = "playing";
  player.lifecycle.deathReason = null;
  player.movement.snakeOccupancy = new Uint8Array(runtime.grid.columns * runtime.grid.rows);

  for (const segment of player.snake) {
    player.movement.snakeOccupancy[segment.row * runtime.grid.columns + segment.column] = 1;
  }
}

function openSocket(port: number): Promise<TestSocket> {
  const socket = new WebSocket(`ws://127.0.0.1:${port}/ws`, {
    origin: "http://localhost:5173",
  });
  const pendingMessages: RawData[] = [];
  const pendingReaders: Array<{
    readonly resolve: (message: ServerToClientMessage) => void;
    readonly reject: (error: Error) => void;
  }> = [];

  socket.on("message", (data) => {
    const reader = pendingReaders.shift();

    if (reader === undefined) {
      pendingMessages.push(data);
      return;
    }

    resolveRawMessage(data, reader.resolve, reader.reject);
  });

  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      cleanup();
      socket.terminate();
      reject(new Error("websocket open timeout"));
    }, TEST_TIMEOUT_MS);

    const cleanup = (): void => {
      clearTimeout(timer);
      socket.off("open", handleOpen);
      socket.off("error", handleError);
      socket.off("unexpected-response", handleUnexpectedResponse);
    };

    const handleOpen = (): void => {
      cleanup();
      resolve({
        socket,
        readMessage: () => readBufferedMessage(socket, pendingMessages, pendingReaders),
      });
    };

    const handleError = (error: Error): void => {
      cleanup();
      reject(error);
    };

    const handleUnexpectedResponse = (): void => {
      cleanup();
      reject(new Error("unexpected websocket response"));
    };

    socket.once("open", handleOpen);
    socket.once("error", handleError);
    socket.once("unexpected-response", handleUnexpectedResponse);
  });
}

async function readUntilType<TType extends ServerToClientMessage["type"]>(
  client: TestSocket,
  type: TType,
  predicate?: (message: Extract<ServerToClientMessage, { readonly type: TType }>) => boolean,
): Promise<Extract<ServerToClientMessage, { readonly type: TType }>> {
  const startedAt = Date.now();

  while (Date.now() - startedAt <= TEST_TIMEOUT_MS) {
    const message = await client.readMessage();

    if (message.type !== type) {
      continue;
    }

    const typedMessage = message as Extract<ServerToClientMessage, { readonly type: TType }>;

    if (predicate === undefined || predicate(typedMessage)) {
      return typedMessage;
    }
  }

  throw new Error(`timed out waiting for ${type}`);
}

function readBufferedMessage(
  socket: WebSocket,
  pendingMessages: RawData[],
  pendingReaders: Array<{
    readonly resolve: (message: ServerToClientMessage) => void;
    readonly reject: (error: Error) => void;
  }>,
): Promise<ServerToClientMessage> {
  const pendingMessage = pendingMessages.shift();

  if (pendingMessage !== undefined) {
    return new Promise((resolve, reject) => {
      resolveRawMessage(pendingMessage, resolve, reject);
    });
  }

  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      cleanup();
      reject(new Error("websocket message timeout"));
    }, TEST_TIMEOUT_MS);

    const cleanup = (): void => {
      clearTimeout(timer);
      socket.off("error", handleError);
    };

    const reader = {
      resolve: (message: ServerToClientMessage): void => {
        cleanup();
        resolve(message);
      },
      reject: (error: Error): void => {
        cleanup();
        reject(error);
      },
    };

    const handleError = (error: Error): void => {
      cleanup();
      reject(error);
    };

    pendingReaders.push(reader);
    socket.once("error", handleError);
  });
}

function resolveRawMessage(
  data: RawData,
  resolve: (message: ServerToClientMessage) => void,
  reject: (error: Error) => void,
): void {
  try {
    const parsed = JSON.parse(data.toString()) as unknown;
    const validation = validateServerMessage(parsed);

    if (!validation.ok) {
      reject(new Error(validation.error));
      return;
    }

    resolve(validation.value);
  } catch (error) {
    reject(error instanceof Error ? error : new Error("failed to parse websocket message"));
  }
}

function closeSocket(socket: WebSocket): Promise<void> {
  if (socket.readyState === WebSocket.CLOSED) {
    return Promise.resolve();
  }

  return new Promise((resolve) => {
    socket.once("close", () => {
      resolve();
    });
    socket.close();
  });
}

async function waitFor(predicate: () => boolean): Promise<void> {
  const startedAt = Date.now();

  while (!predicate()) {
    if (Date.now() - startedAt > TEST_TIMEOUT_MS) {
      throw new Error("waitFor timeout");
    }

    await new Promise((resolve) => {
      setTimeout(resolve, 10);
    });
  }
}

function sleep(milliseconds: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, milliseconds);
  });
}
