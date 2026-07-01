import assert from "node:assert/strict";
import test from "node:test";

import { PVP_LIMITS } from "../src/pvp/net/protocol.ts";
import type { ClientToServerMessage, PvpRoomPlayer, ServerToClientMessage } from "../src/pvp/net/protocol.ts";
import {
  getNextRoomPhases,
  getRoomPhaseAfterCountdown,
  getRoomPhaseAfterGameOver,
  getRoomPhaseAfterReadyChange,
  isKnownRoomPhase,
  isTerminalRoomPhase,
  isValidRoomPhaseTransition,
} from "../src/pvp/net/state.ts";
import {
  isClientToServerMessage,
  isErrorCode,
  isGameOverReason,
  isServerToClientMessage,
  validateClientMessage,
  validateServerMessage,
} from "../src/pvp/net/validation.ts";

const players: readonly PvpRoomPlayer[] = [
  {
    playerId: "player_alpha",
    playerSlot: "p1",
    nickname: "Nova",
    ready: true,
    connected: true,
  },
  {
    playerId: "player_beta",
    playerSlot: "p2",
    ready: true,
    connected: true,
  },
];

test("valid client messages are recognized by the shared protocol validator", () => {
  const messages: readonly ClientToServerMessage[] = [
    {
      type: "hello",
      clientVersion: "0.1.0",
      nickname: "Nova",
      sessionToken: "session-token_1",
    },
    { type: "createRoom" },
    { type: "joinRoom", roomCode: "AB12" },
    { type: "leaveRoom" },
    { type: "ready", ready: true },
    { type: "matchmakingJoin" },
    { type: "matchmakingCancel" },
    { type: "input", seq: 1, tick: 0, direction: "up" },
    { type: "resultCandidate", tick: 8, winner: "p1", reason: "wall", stateHash: "tick_8_hash" },
    { type: "ping", clientTime: 1_000 },
  ];

  for (const message of messages) {
    assert.equal(isClientToServerMessage(message), true, message.type);
    assert.deepEqual(validateClientMessage(message), { ok: true, value: message });
  }
});

test("valid server messages are recognized by the shared protocol validator", () => {
  const messages: readonly ServerToClientMessage[] = [
    { type: "welcome", playerId: "player_alpha", sessionToken: "session-token_1", serverTime: 1_000 },
    { type: "roomCreated", roomCode: "AB12", playerSlot: "p1" },
    { type: "roomJoined", roomCode: "AB12", playerSlot: "p2", players },
    { type: "roomState", roomCode: "AB12", phase: "ready", players },
    { type: "queueState", position: 1, waitingMs: 250, estimatedWaitMs: 500, onlineCount: 12, queuedCount: 2 },
    { type: "matchFound", roomCode: "EF34", playerSlot: "p2" },
    { type: "countdown", startsInMs: 3_000 },
    { type: "gameStart", seed: 123, startTick: 0, tickRate: 12, playerSlots: ["p1", "p2"], inputDelayTicks: 3 },
    { type: "peerInput", playerSlot: "p2", seq: 3, tick: 9, direction: "left" },
    {
      type: "snapshot",
      phase: "playing",
      tick: 9,
      stateHash: "tick_9_hash",
      snakeHeads: { p1: { column: 4, row: 6 }, p2: null },
      alive: { p1: true, p2: false },
      foods: [{ column: 12, row: 8 }],
      players: [
        {
          playerSlot: "p1",
          snake: [{ column: 4, row: 6 }, { column: 3, row: 6 }],
          direction: "right",
          score: 10,
          coresEaten: 1,
          alive: true,
          deathReason: null,
          lastProcessedSeq: 2,
        },
        {
          playerSlot: "p2",
          snake: [{ column: 20, row: 6 }],
          direction: "left",
          score: 0,
          coresEaten: 0,
          alive: false,
          deathReason: "wall",
          lastProcessedSeq: 1,
        },
      ],
    },
    { type: "gameOver", winner: "draw", reason: "draw", finalTick: 42 },
    { type: "gameOver", winner: "p1", reason: "opponent_disconnected", finalTick: 0 },
    { type: "opponentLeft" },
    { type: "reconnectResult", ok: true, roomCode: "AB12", playerSlot: "p1", phase: "playing" },
    { type: "error", code: "invalid_message", message: "Bad payload" },
    { type: "error", code: "service_busy", message: "Server is busy" },
    { type: "pong", clientTime: 1_000, serverTime: 1_010 },
    { type: "serverShutdown", message: "Restarting", retryAfterMs: 1_000 },
  ];

  for (const message of messages) {
    assert.equal(isServerToClientMessage(message), true, message.type);
    assert.deepEqual(validateServerMessage(message), { ok: true, value: message });
  }
});

test("invalid messages are rejected without trusting unknown JSON", () => {
  const invalidMessages: readonly unknown[] = [
    null,
    [],
    { type: "hello" },
    { type: "joinRoom", roomCode: "room-1" },
    { type: "ready", ready: "yes" },
    { type: "welcome", playerId: "x", sessionToken: "short", serverTime: 1 },
    { type: "roomState", roomCode: "AB12", phase: "lobby", players },
    { type: "snapshot", phase: "playing", tick: 1, stateHash: "tick_1_hash", snakeHeads: { p1: null }, alive: { p1: true, p2: true } },
    { type: "gameStart", seed: 1, startTick: 0, tickRate: 120, playerSlots: ["p1", "p2"], inputDelayTicks: 3 },
  ];

  for (const message of invalidMessages) {
    assert.equal(isClientToServerMessage(message), false);
    assert.equal(isServerToClientMessage(message), false);
  }
});

test("invalid direction is rejected for input messages", () => {
  assert.equal(isClientToServerMessage({ type: "input", seq: 1, tick: 1, direction: "north" }), false);
  assert.equal(isServerToClientMessage({ type: "peerInput", playerSlot: "p1", seq: 1, tick: 1, direction: "north" }), false);
});

test("invalid tick and sequence boundaries are rejected", () => {
  assert.equal(isClientToServerMessage({ type: "input", seq: 0, tick: 1, direction: "up" }), false);
  assert.equal(isClientToServerMessage({ type: "input", seq: PVP_LIMITS.maxSeq + 1, tick: 1, direction: "up" }), false);
  assert.equal(isClientToServerMessage({ type: "input", seq: 1, tick: -1, direction: "up" }), false);
  assert.equal(isClientToServerMessage({ type: "input", seq: 1, tick: PVP_LIMITS.maxTick + 1, direction: "up" }), false);
  assert.equal(isServerToClientMessage({ type: "gameOver", winner: "p1", reason: "wall", finalTick: -1 }), false);
});

test("room phase transitions keep the online PVP state machine constrained", () => {
  assert.equal(isKnownRoomPhase("waiting"), true);
  assert.equal(isKnownRoomPhase("lobby"), false);
  assert.deepEqual(getNextRoomPhases("waiting"), ["ready", "countdown", "finished"]);

  assert.equal(isValidRoomPhaseTransition("waiting", "ready"), true);
  assert.equal(isValidRoomPhaseTransition("waiting", "countdown"), true);
  assert.equal(isValidRoomPhaseTransition("ready", "countdown"), true);
  assert.equal(isValidRoomPhaseTransition("countdown", "playing"), true);
  assert.equal(isValidRoomPhaseTransition("playing", "finished"), true);
  assert.equal(isValidRoomPhaseTransition("finished", "waiting"), true);
  assert.equal(isValidRoomPhaseTransition("playing", "waiting"), false);
  assert.equal(isValidRoomPhaseTransition("finished", "playing"), false);

  assert.equal(
    getRoomPhaseAfterReadyChange({
      roomCode: "AB12",
      phase: "waiting",
      players: players.map((player) => ({
        playerSlot: player.playerSlot,
        ready: player.ready,
        connected: player.connected,
      })),
    }),
    "ready",
  );
  assert.equal(getRoomPhaseAfterCountdown({ roomCode: "AB12", phase: "countdown", players: [] }), "playing");
  assert.equal(getRoomPhaseAfterGameOver({ roomCode: "AB12", phase: "playing", players: [] }), "finished");
  assert.equal(isTerminalRoomPhase("finished"), true);
});

test("error code and game-over reason guards expose stable protocol white lists", () => {
  assert.equal(isErrorCode("room_full"), true);
  assert.equal(isErrorCode("room_capacity_reached"), true);
  assert.equal(isErrorCode("service_busy"), true);
  assert.equal(isErrorCode("payment_required"), false);
  assert.equal(isGameOverReason("desync"), true);
  assert.equal(isGameOverReason("opponent_disconnected"), true);
  assert.equal(isGameOverReason("ranked_timeout"), false);
  assert.equal(isServerToClientMessage({ type: "error", code: "room_full", message: "Room is full" }), true);
  assert.equal(isServerToClientMessage({ type: "error", code: "room_capacity_reached", message: "Busy" }), true);
  assert.equal(isServerToClientMessage({ type: "error", code: "service_busy", message: "Busy" }), true);
  assert.equal(isServerToClientMessage({ type: "error", code: "payment_required", message: "Nope" }), false);
});
