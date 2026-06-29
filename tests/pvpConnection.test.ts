import assert from "node:assert/strict";
import test from "node:test";

import type { ClientToServerMessage, PvpRoomPlayer, ServerToClientMessage } from "../src/pvp/net/protocol.ts";
import type { WebSocketCloseEventLike, WebSocketFactory, WebSocketLike, WebSocketMessageEventLike } from "../src/pvp/net/PvpClient.ts";
import { createPvpConnectionController, resolvePvpWebSocketUrl } from "../src/pvp/net/usePvpConnection.ts";
import type { GameSnapshot } from "../src/game/types.ts";
import { createGameHarness } from "./test-support.ts";

function dispatchPointerUp(target: EventTarget): void {
  target.dispatchEvent(new Event("pointerup", { cancelable: true }));
}

function dispatchInput(target: EventTarget): void {
  target.dispatchEvent(new Event("input"));
}

function createWelcomeMessage(): Extract<ServerToClientMessage, { readonly type: "welcome" }> {
  return {
    type: "welcome",
    playerId: "player_alpha",
    sessionToken: "session-token_1",
    serverTime: 1_000,
  };
}

function createRoomPlayers(players: readonly Partial<PvpRoomPlayer>[]): readonly PvpRoomPlayer[] {
  return players.map((player, index) => ({
    playerId: player.playerId ?? `player_${index + 1}`,
    playerSlot: player.playerSlot ?? (index === 0 ? "p1" : "p2"),
    ready: player.ready ?? false,
    connected: player.connected ?? true,
    nickname: player.nickname,
  }));
}

class FakeSocket implements WebSocketLike {
  public readyState = 0;
  public readonly sent: string[] = [];
  public emitCloseOnClose = true;
  private readonly openListeners = new Set<() => void>();
  private readonly messageListeners = new Set<(event: WebSocketMessageEventLike) => void>();
  private readonly errorListeners = new Set<() => void>();
  private readonly closeListeners = new Set<(event: WebSocketCloseEventLike) => void>();

  public send(data: string): void {
    this.sent.push(data);
  }

  public close(code = 1000, reason = "client_close"): void {
    this.readyState = 3;
    if (!this.emitCloseOnClose) {
      return;
    }

    this.emitClose({ code, reason, wasClean: true });
  }

  public addEventListener(type: "open", listener: () => void): void;
  public addEventListener(type: "message", listener: (event: WebSocketMessageEventLike) => void): void;
  public addEventListener(type: "error", listener: () => void): void;
  public addEventListener(type: "close", listener: (event: WebSocketCloseEventLike) => void): void;
  public addEventListener(
    type: "open" | "message" | "error" | "close",
    listener: (() => void) | ((event: WebSocketMessageEventLike) => void) | ((event: WebSocketCloseEventLike) => void),
  ): void {
    switch (type) {
      case "open":
        this.openListeners.add(listener as () => void);
        return;
      case "message":
        this.messageListeners.add(listener as (event: WebSocketMessageEventLike) => void);
        return;
      case "error":
        this.errorListeners.add(listener as () => void);
        return;
      case "close":
        this.closeListeners.add(listener as (event: WebSocketCloseEventLike) => void);
        return;
    }
  }

  public removeEventListener(type: "open", listener: () => void): void;
  public removeEventListener(type: "message", listener: (event: WebSocketMessageEventLike) => void): void;
  public removeEventListener(type: "error", listener: () => void): void;
  public removeEventListener(type: "close", listener: (event: WebSocketCloseEventLike) => void): void;
  public removeEventListener(
    type: "open" | "message" | "error" | "close",
    listener: (() => void) | ((event: WebSocketMessageEventLike) => void) | ((event: WebSocketCloseEventLike) => void),
  ): void {
    switch (type) {
      case "open":
        this.openListeners.delete(listener as () => void);
        return;
      case "message":
        this.messageListeners.delete(listener as (event: WebSocketMessageEventLike) => void);
        return;
      case "error":
        this.errorListeners.delete(listener as () => void);
        return;
      case "close":
        this.closeListeners.delete(listener as (event: WebSocketCloseEventLike) => void);
        return;
    }
  }

  public emitOpen(): void {
    this.readyState = 1;

    for (const listener of Array.from(this.openListeners)) {
      listener();
    }
  }

  public emitServerMessage(message: ServerToClientMessage): void {
    for (const listener of Array.from(this.messageListeners)) {
      listener({ data: JSON.stringify(message) });
    }
  }

  public emitError(): void {
    for (const listener of Array.from(this.errorListeners)) {
      listener();
    }
  }

  public emitClose(event: WebSocketCloseEventLike = { code: 1006, reason: "network", wasClean: false }): void {
    this.readyState = 3;

    for (const listener of Array.from(this.closeListeners)) {
      listener(event);
    }
  }

  public getClientMessages(): readonly ClientToServerMessage[] {
    return this.sent.map((payload) => JSON.parse(payload) as ClientToServerMessage);
  }
}

class FakeSocketFactoryHarness {
  public readonly sockets: FakeSocket[] = [];
  public readonly urls: string[] = [];

  public readonly factory: WebSocketFactory = (url: string) => {
    const socket = new FakeSocket();

    this.sockets.push(socket);
    this.urls.push(url);
    return socket;
  };
}

class MemoryStorage {
  private readonly values = new Map<string, string>();

  public getItem(key: string): string | null {
    return this.values.get(key) ?? null;
  }

  public setItem(key: string, value: string): void {
    this.values.set(key, value);
  }

  public removeItem(key: string): void {
    this.values.delete(key);
  }
}

const PVP_SESSION_TOKEN_STORAGE_KEY = "snake1:pvp-session-token";

function getLastClientMessage(socket: FakeSocket): ClientToServerMessage | undefined {
  const messages = socket.getClientMessages();

  return messages[messages.length - 1];
}

function bootOnlinePvpHarness(
  harness: ReturnType<typeof createGameHarness>,
  socketHarness: FakeSocketFactoryHarness,
  playerSlot: "p1" | "p2",
): FakeSocket {
  harness.game.start();
  dispatchPointerUp(harness.ui.pvpButton);
  const socket = socketHarness.sockets[0];

  assert.ok(socket);

  socket.emitOpen();
  socket.emitServerMessage(createWelcomeMessage());
  socket.emitServerMessage({
    type: "matchFound",
    roomCode: "AB12CD",
    playerSlot,
  });
  socket.emitServerMessage({
    type: "gameStart",
    seed: 7,
    startTick: 0,
    tickRate: 20,
    playerSlots: ["p1", "p2"],
    inputDelayTicks: 2,
  });

  return socket;
}

function projectOnlineSnapshot(harness: ReturnType<typeof createGameHarness>): {
  readonly match: {
    readonly mode: string;
    readonly phase: string;
    readonly tick: number;
    readonly winnerId: string | null;
  };
  readonly local: {
    readonly inputOrigin: string;
    readonly direction: string;
    readonly score: number;
    readonly snake: readonly Readonly<{ column: number; row: number }>[];
  };
  readonly remote: {
    readonly inputOrigin: string;
    readonly direction: string;
    readonly score: number;
    readonly snake: readonly Readonly<{ column: number; row: number }>[];
  };
} {
  const internals = harness.game as unknown as {
    readonly createSnapshot: () => GameSnapshot;
    readonly onlineSession: { readonly localPlayerId: "p1" | "p2" } | null;
  };
  const snapshot = internals.createSnapshot();
  const localPlayerId = internals.onlineSession?.localPlayerId;
  const shouldMirror = localPlayerId === "p2";

  assert.ok(localPlayerId);

  const localPlayer = snapshot.players.find((player) => player.id === localPlayerId);
  const remotePlayer = snapshot.players.find((player) => player.id !== localPlayerId);

  assert.ok(localPlayer);
  assert.ok(remotePlayer);

  return {
    match: {
      mode: snapshot.match.mode,
      phase: snapshot.match.phase,
      tick: snapshot.match.tick,
      winnerId: snapshot.match.winnerId,
    },
    local: {
      inputOrigin: localPlayer.inputOrigin,
      direction: shouldMirror ? mirrorDirection(localPlayer.direction) : localPlayer.direction,
      score: localPlayer.score,
      snake: localPlayer.snake.map((cell) => (shouldMirror ? mirrorCell(cell, snapshot.grid.columns) : { ...cell })),
    },
    remote: {
      inputOrigin: remotePlayer.inputOrigin,
      direction: shouldMirror ? mirrorDirection(remotePlayer.direction) : remotePlayer.direction,
      score: remotePlayer.score,
      snake: remotePlayer.snake.map((cell) => (shouldMirror ? mirrorCell(cell, snapshot.grid.columns) : { ...cell })),
    },
  };
}

function projectOnlineReplayDelta(
  before: ReturnType<typeof projectOnlineSnapshot>,
  after: ReturnType<typeof projectOnlineSnapshot>,
): {
  readonly match: ReturnType<typeof projectOnlineSnapshot>["match"];
  readonly local: {
    readonly inputOrigin: string;
    readonly direction: string;
    readonly scoreDelta: number;
    readonly snakeDeltas: readonly Readonly<{ column: number; row: number }>[];
  };
  readonly remote: {
    readonly inputOrigin: string;
    readonly direction: string;
    readonly scoreDelta: number;
    readonly snakeDeltas: readonly Readonly<{ column: number; row: number }>[];
  };
} {
  return {
    match: after.match,
    local: {
      inputOrigin: after.local.inputOrigin,
      direction: after.local.direction,
      scoreDelta: after.local.score - before.local.score,
      snakeDeltas: after.local.snake.map((cell, index) => {
        const baselineCell = before.local.snake[index];

        assert.ok(baselineCell);

        return {
          column: cell.column - baselineCell.column,
          row: cell.row - baselineCell.row,
        };
      }),
    },
    remote: {
      inputOrigin: after.remote.inputOrigin,
      direction: after.remote.direction,
      scoreDelta: after.remote.score - before.remote.score,
      snakeDeltas: after.remote.snake.map((cell, index) => {
        const baselineCell = before.remote.snake[index];

        assert.ok(baselineCell);

        return {
          column: cell.column - baselineCell.column,
          row: cell.row - baselineCell.row,
        };
      }),
    },
  };
}

function mirrorCell(cell: Readonly<{ column: number; row: number }>, width: number): { column: number; row: number } {
  return {
    column: width - 1 - cell.column,
    row: cell.row,
  };
}

function mirrorDirection(direction: string): string {
  switch (direction) {
    case "left":
      return "right";
    case "right":
      return "left";
    default:
      return direction;
  }
}

test("resolvePvpWebSocketUrl falls back to the current host in dev", () => {
  assert.equal(resolvePvpWebSocketUrl({ DEV: true }), "ws://127.0.0.1:8787/ws");
  assert.equal(resolvePvpWebSocketUrl({ DEV: false }), null);
  assert.equal(resolvePvpWebSocketUrl({ DEV: false, VITE_PVP_WS_URL: "wss://example.com/ws" }), "wss://example.com/ws");
});

test("clicking PVP auto connects, joins matchmaking, and hands off on gameStart", () => {
  const socketHarness = new FakeSocketFactoryHarness();
  const harness = createGameHarness({
    pvpConnectionOptions: {
      url: "ws://example.test/ws",
      socketFactory: socketHarness.factory,
    },
  });

  try {
    harness.game.start();
    dispatchPointerUp(harness.ui.pvpButton);

    const socket = socketHarness.sockets[0];

    assert.ok(socket);
    assert.equal(socketHarness.urls[0], "ws://example.test/ws");
    assert.equal(harness.ui.root.dataset.shellView, "pvp-room");
    assert.equal(harness.ui.panelPrimaryValue.textContent, "正在连接 PVP 服务");
    assert.equal(harness.ui.pvpSoloButton.textContent, "单人模式");
    assert.equal(harness.ui.createRoomButton.textContent, "创建房间");
    assert.equal(harness.ui.joinRoomButton.textContent, "加入房间");
    assert.equal(harness.ui.randomMatchButton.textContent, "随机匹配中");
    assert.equal(harness.ui.randomMatchButton.disabled, true);
    assert.equal(harness.ui.roomCodeField.hidden, true);
    assert.equal(harness.ui.readyRoomButton.hidden, true);

    socket.emitOpen();
    socket.emitServerMessage(createWelcomeMessage());

    assert.deepEqual(getLastClientMessage(socket), { type: "matchmakingJoin" });

    socket.emitServerMessage({
      type: "queueState",
      position: 1,
      waitingMs: 1_500,
      onlineCount: 12,
      queuedCount: 2,
    });

    assert.equal(harness.ui.panelPrimaryValue.textContent, "正在寻找对手");
    assert.equal(harness.ui.roomStatusLabel.textContent, "已进入匹配队列，找到对手后会直接进入倒计时");
    assert.equal(harness.ui.queueWaitLabel.textContent, "等待 0:01");
    assert.equal(harness.ui.queueOnlineLabel.textContent, "在线 12");
    assert.equal(harness.ui.queueCountLabel.textContent, "排队 2");
    assert.equal(harness.ui.roomCodeField.hidden, true);
    assert.equal(harness.ui.readyRoomButton.hidden, true);

    socket.emitServerMessage({
      type: "matchFound",
      roomCode: "AB12CD",
      playerSlot: "p1",
    });

    assert.equal(harness.ui.panelPrimaryValue.textContent, "匹配成功");

    socket.emitServerMessage({
      type: "countdown",
      startsInMs: 3_000,
    });

    assert.equal(harness.ui.panelPrimaryValue.textContent, "3");
    assert.equal(harness.ui.roomStatusLabel.textContent, "3 秒后开始");

    socket.emitServerMessage({
      type: "gameStart",
      seed: 7,
      startTick: 0,
      tickRate: 20,
      playerSlots: ["p1", "p2"],
      inputDelayTicks: 2,
    });

    assert.equal(harness.ui.root.dataset.shellView, "active-run");
    assert.equal(harness.ui.root.dataset.phase, "playing");
  } finally {
    harness.cleanup();
  }
});

test("cancel matchmaking sends matchmakingCancel and keeps the PVP hall visible", () => {
  const socketHarness = new FakeSocketFactoryHarness();
  const harness = createGameHarness({
    pvpConnectionOptions: {
      url: "ws://example.test/ws",
      socketFactory: socketHarness.factory,
    },
  });

  try {
    harness.game.start();
    dispatchPointerUp(harness.ui.pvpButton);

    const socket = socketHarness.sockets[0];

    assert.ok(socket);
    socket.emitOpen();
    socket.emitServerMessage(createWelcomeMessage());
    socket.emitServerMessage({
      type: "queueState",
      position: 1,
      waitingMs: 500,
      onlineCount: 4,
      queuedCount: 1,
    });

    dispatchPointerUp(harness.ui.cancelMatchmakingButton);

    const messages = socket.getClientMessages();

    assert.deepEqual(messages[0], { type: "matchmakingJoin" });
    assert.deepEqual(messages[1], { type: "matchmakingCancel" });
    assert.equal(harness.ui.root.dataset.shellView, "pvp-room");
    assert.equal(harness.ui.panelPrimaryValue.textContent, "已取消匹配");
    assert.equal(harness.ui.roomStatusLabel.textContent, "可以重新匹配，或改走房间码入口");
    assert.equal(harness.ui.randomMatchButton.textContent, "随机匹配");
    assert.equal(harness.ui.randomMatchButton.disabled, false);
  } finally {
    harness.cleanup();
  }
});

test("PVP hall solo entry starts PVE when the service is unavailable", () => {
  const harness = createGameHarness({
    pvpConnectionOptions: {
      url: null,
    },
  });

  try {
    harness.game.start();
    dispatchPointerUp(harness.ui.pvpButton);

    assert.equal(harness.ui.panelPrimaryValue.textContent, "在线 PVP 暂不可用");
    (harness.game as unknown as {
      audio: {
        unlock(): void;
      playUiPulse(): void;
      destroy(): void;
    };
  }).audio = {
      unlock(): void {
        // No-op.
      },
      playUiPulse(): void {
        // No-op.
      },
      destroy(): void {
        // No-op.
      },
    };
    dispatchPointerUp(harness.ui.pvpSoloButton);

    assert.equal(harness.ui.root.dataset.shellView, "active-run");
    assert.equal(harness.ui.root.dataset.phase, "playing");
  } finally {
    harness.cleanup();
  }
});

test("invite friend flow can create a private room", () => {
  const socketHarness = new FakeSocketFactoryHarness();
  const harness = createGameHarness({
    pvpConnectionOptions: {
      url: "ws://example.test/ws",
      socketFactory: socketHarness.factory,
    },
  });

  try {
    harness.game.start();
    dispatchPointerUp(harness.ui.pvpButton);

    assert.equal(socketHarness.sockets.length, 1);
    dispatchPointerUp(harness.ui.createRoomButton);

    const socket = socketHarness.sockets[1];

    assert.ok(socket);
    socket.emitOpen();
    socket.emitServerMessage(createWelcomeMessage());

    assert.deepEqual(getLastClientMessage(socket), { type: "createRoom" });

    socket.emitServerMessage({
      type: "roomCreated",
      roomCode: "ZX12CV",
      playerSlot: "p1",
    });
    socket.emitServerMessage({
      type: "roomState",
      roomCode: "ZX12CV",
      phase: "waiting",
      players: createRoomPlayers([
        { playerId: "player_alpha", playerSlot: "p1", ready: false },
      ]),
    });

    assert.equal(harness.ui.panelPrimaryValue.textContent, "邀请好友");
    assert.equal(harness.ui.roomCodeField.hidden, false);
    assert.equal(harness.ui.roomCodeInput.value, "ZX12CV");
    assert.equal(harness.ui.roomCodeInput.readOnly, true);
    assert.equal(harness.ui.copyRoomCodeButton.hidden, false);
    assert.equal(harness.ui.roomPlayersLabel.hidden, false);
    assert.equal(harness.ui.roomPlayersLabel.textContent, "你 已连接，等待好友加入");
  } finally {
    harness.cleanup();
  }
});

test("switching from auto matchmaking to invite ignores the old socket close", () => {
  const socketHarness = new FakeSocketFactoryHarness();
  const harness = createGameHarness({
    pvpConnectionOptions: {
      url: "ws://example.test/ws",
      socketFactory: socketHarness.factory,
    },
  });

  try {
    harness.game.start();
    dispatchPointerUp(harness.ui.pvpButton);

    const matchmakingSocket = socketHarness.sockets[0];

    assert.ok(matchmakingSocket);
    matchmakingSocket.emitCloseOnClose = false;
    matchmakingSocket.emitOpen();
    matchmakingSocket.emitServerMessage(createWelcomeMessage());

    assert.deepEqual(getLastClientMessage(matchmakingSocket), { type: "matchmakingJoin" });

    dispatchPointerUp(harness.ui.createRoomButton);

    const inviteSocket = socketHarness.sockets[1];

    assert.ok(inviteSocket);
    matchmakingSocket.emitClose({ code: 1000, reason: "client_close", wasClean: true });
    inviteSocket.emitOpen();
    inviteSocket.emitServerMessage(createWelcomeMessage());

    assert.deepEqual(getLastClientMessage(inviteSocket), { type: "createRoom" });

    inviteSocket.emitServerMessage({
      type: "roomCreated",
      roomCode: "ZX12CV",
      playerSlot: "p1",
    });

    assert.equal(harness.ui.panelPrimaryValue.textContent, "邀请好友");
    assert.equal(harness.ui.roomCodeInput.value, "ZX12CV");
  } finally {
    harness.cleanup();
  }
});

test("join room flow can submit a room code", () => {
  const socketHarness = new FakeSocketFactoryHarness();
  const harness = createGameHarness({
    pvpConnectionOptions: {
      url: "ws://example.test/ws",
      socketFactory: socketHarness.factory,
    },
  });

  try {
    harness.game.start();
    dispatchPointerUp(harness.ui.pvpButton);
    dispatchPointerUp(harness.ui.joinRoomButton);

    assert.equal(harness.ui.roomCodeField.hidden, false);
    assert.equal(harness.ui.joinRoomButton.textContent, "加入房间");

    harness.ui.roomCodeInput.value = "ab12";
    dispatchInput(harness.ui.roomCodeInput);

    assert.equal(harness.ui.roomCodeInput.value, "AB12");

    dispatchPointerUp(harness.ui.joinRoomButton);

    const socket = socketHarness.sockets[1];

    assert.ok(socket);
    socket.emitOpen();
    socket.emitServerMessage(createWelcomeMessage());

    assert.deepEqual(getLastClientMessage(socket), {
      type: "joinRoom",
      roomCode: "AB12",
    });

    socket.emitServerMessage({
      type: "roomJoined",
      roomCode: "AB12",
      playerSlot: "p2",
      players: createRoomPlayers([
        { playerId: "player_owner", playerSlot: "p1", ready: true },
        { playerId: "player_alpha", playerSlot: "p2", ready: false },
      ]),
    });

    assert.equal(harness.ui.roomCodeInput.readOnly, true);
    assert.equal(harness.ui.roomPlayersLabel.hidden, false);
    assert.equal(harness.ui.roomPlayersLabel.textContent, "P1 已准备 · 你 已连接");
  } finally {
    harness.cleanup();
  }
});

test("join room input normalizes pasted characters before connecting", () => {
  const socketHarness = new FakeSocketFactoryHarness();
  const controller = createPvpConnectionController({
    url: "ws://example.test/ws",
    socketFactory: socketHarness.factory,
  });

  try {
    controller.openJoinRoomEntry();
    controller.updateJoinCode(" ab-12 cd! ");

    assert.equal(controller.getState().joinCode, "AB12CD");
    assert.equal(controller.getPanelState().joinRoomButtonDisabled, false);

    controller.joinPrivateRoom();

    assert.equal(socketHarness.sockets.length, 1);

    const socket = socketHarness.sockets[0];

    assert.ok(socket);
    socket.emitOpen();
    socket.emitServerMessage(createWelcomeMessage());

    assert.deepEqual(getLastClientMessage(socket), {
      type: "joinRoom",
      roomCode: "AB12CD",
    });
  } finally {
    controller.destroy();
  }
});

test("short room codes stay disabled and do not open a join request", () => {
  const socketHarness = new FakeSocketFactoryHarness();
  const controller = createPvpConnectionController({
    url: "ws://example.test/ws",
    socketFactory: socketHarness.factory,
  });

  try {
    controller.openJoinRoomEntry();
    controller.updateJoinCode(" a-1 ");

    assert.equal(controller.getState().joinCode, "A1");
    assert.equal(controller.getPanelState().joinRoomButtonDisabled, true);

    controller.joinPrivateRoom();

    assert.equal(socketHarness.sockets.length, 0);
    assert.equal(controller.getState().status, "error");
    assert.match(controller.getPanelState().statusText, /4-8/);
  } finally {
    controller.destroy();
  }
});

test("room_not_found maps to a clear Chinese message", () => {
  const socketHarness = new FakeSocketFactoryHarness();
  const controller = createPvpConnectionController({
    url: "ws://example.test/ws",
    socketFactory: socketHarness.factory,
  });

  try {
    controller.openJoinRoomEntry();
    controller.updateJoinCode("AB12CD");
    controller.joinPrivateRoom();

    const socket = socketHarness.sockets[0];

    assert.ok(socket);
    socket.emitOpen();
    socket.emitServerMessage(createWelcomeMessage());
    socket.emitServerMessage({
      type: "error",
      code: "room_not_found",
      message: "The private room could not be found",
    });

    assert.equal(controller.getState().status, "error");
    assert.equal(controller.getState().errorCode, "room_not_found");
    assert.equal(controller.getPanelState().statusText, "未找到对应房间码");
  } finally {
    controller.destroy();
  }
});

test("queue full errors map to a clear Chinese message", () => {
  const socketHarness = new FakeSocketFactoryHarness();
  const controller = createPvpConnectionController({
    url: "ws://example.test/ws",
    socketFactory: socketHarness.factory,
  });

  try {
    controller.enterMatchmaking();

    const socket = socketHarness.sockets[0];

    assert.ok(socket);
    socket.emitOpen();
    socket.emitServerMessage(createWelcomeMessage());
    socket.emitServerMessage({
      type: "error",
      code: "queue_full",
      message: "The matchmaking queue is full",
    });

    assert.equal(controller.getState().status, "error");
    assert.equal(controller.getPanelState().statusText, "当前在线人数较多，请稍后再试");
  } finally {
    controller.destroy();
  }
});

test("room capacity errors map to a clear Chinese message", () => {
  const socketHarness = new FakeSocketFactoryHarness();
  const controller = createPvpConnectionController({
    url: "ws://example.test/ws",
    socketFactory: socketHarness.factory,
  });

  try {
    controller.enterMatchmaking();

    const socket = socketHarness.sockets[0];

    assert.ok(socket);
    socket.emitOpen();
    socket.emitServerMessage(createWelcomeMessage());
    socket.emitServerMessage({
      type: "error",
      code: "room_capacity_reached",
      message: "All PVP rooms are busy right now",
    });

    assert.equal(controller.getState().status, "error");
    assert.equal(controller.getPanelState().statusText, "当前在线人数较多，请稍后再试");
  } finally {
    controller.destroy();
  }
});

test("connection timeout exits loading with the PVP unavailable message", async () => {
  const socketHarness = new FakeSocketFactoryHarness();
  const controller = createPvpConnectionController({
    url: "ws://example.test/ws",
    socketFactory: socketHarness.factory,
    connectTimeoutMs: 5,
  });

  try {
    controller.enterMatchmaking();
    assert.equal(controller.getState().status, "connecting");

    await new Promise((resolve) => setTimeout(resolve, 15));

    assert.equal(controller.getState().status, "error");
    assert.equal(controller.getPanelState().statusText, "在线 PVP 暂不可用，可以先玩单人模式");
  } finally {
    controller.destroy();
  }
});

test("service unavailable does not break the PVP hall or PVE flow", () => {
  const harness = createGameHarness({
    pvpConnectionOptions: {
      url: null,
    },
  });
  const internals = harness.game as unknown as Record<string, unknown>;

  try {
    harness.game.start();
    dispatchPointerUp(harness.ui.pvpButton);

    assert.equal(harness.ui.root.dataset.shellView, "pvp-room");
    assert.equal(harness.ui.pvpRoomPanel.hidden, false);
    assert.equal(harness.ui.panelPrimaryValue.textContent, "在线 PVP 暂不可用");
    assert.equal(harness.ui.roomStatusLabel.textContent, "在线 PVP 暂不可用，可以先玩单人模式");

    internals.audio = {
      unlock(): void {
        // No-op.
      },
      playUiPulse(): void {
        // No-op.
      },
      destroy(): void {
        // No-op.
      },
    };

    dispatchPointerUp(harness.ui.roomBackButton);
    dispatchPointerUp(harness.ui.pveButton);

    assert.equal(harness.ui.root.dataset.shellView, "active-run");
  } finally {
    harness.cleanup();
  }
});

test("online PVP sends local input and queues peerInput through the same tick path", () => {
  const socketHarness = new FakeSocketFactoryHarness();
  const harness = createGameHarness({
    pvpConnectionOptions: {
      url: "ws://example.test/ws",
      socketFactory: socketHarness.factory,
    },
  });

  try {
    const socket = bootOnlinePvpHarness(harness, socketHarness, "p1");
    const internals = harness.game as unknown as Record<string, unknown>;

    (internals.handleInput as (command: {
      readonly action: "move-up";
      readonly kind: "pressed";
      readonly source: "keyboard";
      readonly playerId: "p1";
    }) => void)({
      action: "move-up",
      kind: "pressed",
      source: "keyboard",
      playerId: "p1",
    });

    assert.deepEqual(getLastClientMessage(socket), {
      type: "input",
      seq: 1,
      tick: 2,
      direction: "up",
    });

    socket.emitServerMessage({
      type: "peerInput",
      playerSlot: "p2",
      seq: 5,
      tick: 2,
      direction: "up",
    });

    const inputState = internals.inputState as {
      readonly queue: Array<{
        readonly playerId: string;
        readonly tick: number;
        readonly action: string;
        readonly kind: string;
        readonly origin: string;
        readonly sequence: number;
      }>;
    };
    const remoteQueued = inputState.queue.find((command) => command.playerId === "p2");

    assert.deepEqual(remoteQueued, {
      playerId: "p2",
      tick: 2,
      action: "move-up",
      kind: "pressed",
      origin: "remote",
      sequence: 5,
    });

    (internals.advanceOnlinePvp as (delta: number) => void)(50);
    (internals.advanceOnlinePvp as (delta: number) => void)(50);

    assert.equal((internals.createSnapshot as () => GameSnapshot)().players.find((player) => player.id === "p1")?.direction, "up");
    assert.equal((internals.createSnapshot as () => GameSnapshot)().players.find((player) => player.id === "p2")?.direction, "up");
  } finally {
    harness.cleanup();
  }
});

test("two online clients with the same seed and role-based inputs stay in sync", () => {
  const firstProjection = runOnlineReplay("p1");
  const secondProjection = runOnlineReplay("p2");

  assert.deepEqual(firstProjection, secondProjection);
});

test("server snapshots flag mismatches and server gameOver overrides local predictions", () => {
  const socketHarness = new FakeSocketFactoryHarness();
  const harness = createGameHarness({
    pvpConnectionOptions: {
      url: "ws://example.test/ws",
      socketFactory: socketHarness.factory,
    },
  });

  try {
    const socket = bootOnlinePvpHarness(harness, socketHarness, "p1");
    const internals = harness.game as unknown as Record<string, unknown>;
    const onlineSession = internals.onlineSession as {
      runtime: {
        match: { phase: string; winnerId: string | null };
      };
    };

    onlineSession.runtime.match.phase = "gameOver";
    onlineSession.runtime.match.winnerId = "p1";
    (internals.match as { phase: string; winnerId: string | null }).phase = "gameOver";
    (internals.match as { phase: string; winnerId: string | null }).winnerId = "p1";

    socket.emitServerMessage({
      type: "snapshot",
      phase: "playing",
      tick: 1,
      stateHash: "pvp:deadbeefdeadbeef",
      snakeHeads: {
        p1: { column: 4, row: 6 },
        p2: { column: 22, row: 6 },
      },
      alive: { p1: true, p2: true },
    });

    assert.equal(harness.ui.panelMetaLabel.textContent, "已按服务端同步修正");

    socket.emitServerMessage({
      type: "gameOver",
      winner: "p2",
      reason: "wall",
      finalTick: 1,
    });

    const snapshot = (internals.createSnapshot as () => GameSnapshot)();

    assert.equal(snapshot.match.phase, "gameOver");
    assert.equal(snapshot.match.winnerId, "p2");
    assert.equal(harness.ui.continueButton.textContent, "再来一局");
    assert.equal(harness.ui.mainMenuButton.textContent, "返回大厅");
  } finally {
    harness.cleanup();
  }
});

test("online PVP settlement can rematch or return to the PVP hall", () => {
  const socketHarness = new FakeSocketFactoryHarness();
  const harness = createGameHarness({
    pvpConnectionOptions: {
      url: "ws://example.test/ws",
      socketFactory: socketHarness.factory,
    },
  });

  try {
    const firstSocket = bootOnlinePvpHarness(harness, socketHarness, "p1");

    firstSocket.emitServerMessage({
      type: "gameOver",
      winner: "p1",
      reason: "opponent_disconnected",
      finalTick: 12,
    });

    assert.equal(harness.ui.root.dataset.phase, "gameOver");
    assert.equal(harness.ui.continueButton.textContent, "再来一局");
    dispatchPointerUp(harness.ui.continueButton);

    const rematchSocket = socketHarness.sockets[1];

    assert.ok(rematchSocket);
    assert.equal(harness.ui.root.dataset.shellView, "pvp-room");
    rematchSocket.emitOpen();
    rematchSocket.emitServerMessage(createWelcomeMessage());
    assert.deepEqual(getLastClientMessage(rematchSocket), { type: "matchmakingJoin" });

    rematchSocket.emitServerMessage({
      type: "matchFound",
      roomCode: "CD34EF",
      playerSlot: "p1",
    });
    rematchSocket.emitServerMessage({
      type: "gameStart",
      seed: 9,
      startTick: 0,
      tickRate: 20,
      playerSlots: ["p1", "p2"],
      inputDelayTicks: 2,
    });
    rematchSocket.emitServerMessage({
      type: "gameOver",
      winner: "p2",
      reason: "wall",
      finalTick: 3,
    });

    dispatchPointerUp(harness.ui.mainMenuButton);

    assert.equal(harness.ui.root.dataset.shellView, "pvp-room");
    assert.equal(harness.ui.root.dataset.phase, "ready");
    assert.equal(harness.ui.randomMatchButton.disabled, false);
    assert.equal(harness.ui.roomStatusLabel.textContent, "选择单人模式、创建房间、加入房间，或随机匹配。");
  } finally {
    harness.cleanup();
  }
});

function runOnlineReplay(playerSlot: "p1" | "p2"): ReturnType<typeof projectOnlineReplayDelta> {
  const socketHarness = new FakeSocketFactoryHarness();
  const harness = createGameHarness({
    pvpConnectionOptions: {
      url: "ws://example.test/ws",
      socketFactory: socketHarness.factory,
    },
  });

  try {
    const socket = bootOnlinePvpHarness(harness, socketHarness, playerSlot);
    const internals = harness.game as unknown as Record<string, unknown>;
    const before = projectOnlineSnapshot(harness);

    (internals.handleInput as (command: {
      readonly action: "move-up";
      readonly kind: "pressed";
      readonly source: "keyboard";
      readonly playerId: "p1" | "p2";
    }) => void)({
      action: "move-up",
      kind: "pressed",
      source: "keyboard",
      playerId: playerSlot,
    });

    assert.deepEqual(getLastClientMessage(socket), {
      type: "input",
      seq: 1,
      tick: 2,
      direction: "up",
    });

    socket.emitServerMessage({
      type: "peerInput",
      playerSlot: playerSlot === "p1" ? "p2" : "p1",
      seq: 1,
      tick: 2,
      direction: "up",
    });

    (internals.advanceOnlinePvp as (delta: number) => void)(50);
    (internals.advanceOnlinePvp as (delta: number) => void)(50);

    return projectOnlineReplayDelta(before, projectOnlineSnapshot(harness));
  } finally {
    harness.cleanup();
  }
}

test("queued disconnect surfaces reconnecting, replays hello, and can retry matchmaking", async () => {
  const socketHarness = new FakeSocketFactoryHarness();
  const controller = createPvpConnectionController({
    url: "ws://example.test/ws",
    socketFactory: socketHarness.factory,
    reconnectDelayMs: 1,
    maxReconnectAttempts: 1,
  });

  try {
    controller.enterMatchmaking();

    const firstSocket = socketHarness.sockets[0];

    assert.ok(firstSocket);
    firstSocket.emitOpen();
    firstSocket.emitServerMessage(createWelcomeMessage());
    firstSocket.emitServerMessage({
      type: "queueState",
      position: 1,
      waitingMs: 250,
      onlineCount: 9,
      queuedCount: 2,
    });

    firstSocket.emitClose({ code: 1006, reason: "network", wasClean: false });

    assert.equal(controller.getState().status, "reconnecting");

    await new Promise((resolve) => setTimeout(resolve, 10));

    const secondSocket = socketHarness.sockets[1];

    assert.ok(secondSocket);
    secondSocket.emitOpen();
    secondSocket.emitServerMessage({
      type: "welcome",
      playerId: "player_beta",
      sessionToken: "session-token_2",
      serverTime: 1_001,
    });

    assert.deepEqual(getLastClientMessage(secondSocket), {
      type: "hello",
      clientVersion: "0.1.0",
      sessionToken: "session-token_1",
    });

    secondSocket.emitServerMessage({
      type: "reconnectResult",
      ok: true,
    });

    assert.equal(controller.getPanelState().statusText, "重连成功，正在重新进入匹配");
    assert.deepEqual(getLastClientMessage(secondSocket), { type: "matchmakingJoin" });
  } finally {
    controller.destroy();
  }
});

test("disconnect budget exhaustion leaves the controller disconnected", () => {
  const socketHarness = new FakeSocketFactoryHarness();
  const controller = createPvpConnectionController({
    url: "ws://example.test/ws",
    socketFactory: socketHarness.factory,
    maxReconnectAttempts: 0,
  });

  try {
    controller.enterMatchmaking();

    const socket = socketHarness.sockets[0];

    assert.ok(socket);
    socket.emitOpen();
    socket.emitServerMessage(createWelcomeMessage());
    socket.emitServerMessage({
      type: "queueState",
      position: 1,
      waitingMs: 100,
      onlineCount: 6,
      queuedCount: 1,
    });
    socket.emitClose({ code: 1006, reason: "network", wasClean: false });

    assert.equal(controller.getState().status, "disconnected");
    assert.equal(controller.getPanelState().statusText, "重连失败，请重新进入在线 PVP");
  } finally {
    controller.destroy();
  }
});

test("playing disconnect reconnects with the stored session token and restores the final room state", async () => {
  const socketHarness = new FakeSocketFactoryHarness();
  const sessionStorage = new MemoryStorage();
  const controller = createPvpConnectionController({
    url: "ws://example.test/ws",
    socketFactory: socketHarness.factory,
    sessionStorage,
    reconnectDelayMs: 1,
    maxReconnectAttempts: 1,
  });

  try {
    controller.enterMatchmaking();

    const firstSocket = socketHarness.sockets[0];

    assert.ok(firstSocket);
    firstSocket.emitOpen();
    firstSocket.emitServerMessage(createWelcomeMessage());

    assert.equal(sessionStorage.getItem(PVP_SESSION_TOKEN_STORAGE_KEY), "session-token_1");
    assert.deepEqual(getLastClientMessage(firstSocket), { type: "matchmakingJoin" });

    firstSocket.emitServerMessage({
      type: "queueState",
      position: 1,
      waitingMs: 250,
      onlineCount: 9,
      queuedCount: 2,
    });
    firstSocket.emitServerMessage({
      type: "matchFound",
      roomCode: "AB12",
      playerSlot: "p1",
    });
    firstSocket.emitServerMessage({
      type: "countdown",
      startsInMs: 1_000,
    });
    firstSocket.emitServerMessage({
      type: "gameStart",
      seed: 7,
      startTick: 0,
      tickRate: 20,
      playerSlots: ["p1", "p2"],
      inputDelayTicks: 2,
    });

    firstSocket.emitClose({ code: 1006, reason: "network", wasClean: false });
    assert.equal(controller.getState().status, "reconnecting");

    await new Promise((resolve) => setTimeout(resolve, 10));

    const secondSocket = socketHarness.sockets[1];

    assert.ok(secondSocket);
    secondSocket.emitOpen();
    secondSocket.emitServerMessage({
      type: "welcome",
      playerId: "player_beta",
      sessionToken: "session-token_2",
      serverTime: 1_001,
    });

    assert.deepEqual(getLastClientMessage(secondSocket), {
      type: "hello",
      clientVersion: "0.1.0",
      sessionToken: "session-token_1",
    });

    secondSocket.emitServerMessage({
      type: "reconnectResult",
      ok: true,
      roomCode: "AB12",
      playerSlot: "p1",
      phase: "finished",
    });

    assert.equal(controller.getPanelState().statusText, "重连成功");

    secondSocket.emitServerMessage({
      type: "roomState",
      roomCode: "AB12",
      phase: "finished",
      players: createRoomPlayers([
        { playerId: "player_alpha", playerSlot: "p1", ready: true, connected: true },
        { playerId: "player_beta", playerSlot: "p2", ready: true, connected: true },
      ]),
    });
    secondSocket.emitServerMessage({
      type: "gameOver",
      winner: "p1",
      reason: "opponent_disconnected",
      finalTick: 12,
    });

    assert.equal(controller.getState().roomPhase, "finished");
    assert.equal(controller.getPanelState().statusText, "对手断线，你获胜");
  } finally {
    controller.destroy();
  }
});

test("game startup resumes a stored online PVP session", () => {
  const socketHarness = new FakeSocketFactoryHarness();
  const sessionStorage = new MemoryStorage();

  sessionStorage.setItem(PVP_SESSION_TOKEN_STORAGE_KEY, "session-token_1");

  const harness = createGameHarness({
    pvpConnectionOptions: {
      url: "ws://example.test/ws",
      socketFactory: socketHarness.factory,
      sessionStorage,
    },
  });

  try {
    harness.game.start();

    const socket = socketHarness.sockets[0];

    assert.ok(socket);
    assert.equal(harness.ui.root.dataset.shellView, "pvp-room");
    assert.equal(harness.ui.panelPrimaryValue.textContent, "正在连接 PVP 服务");

    socket.emitOpen();
    socket.emitServerMessage(createWelcomeMessage());

    assert.deepEqual(getLastClientMessage(socket), {
      type: "hello",
      clientVersion: "0.1.0",
      sessionToken: "session-token_1",
    });

    socket.emitServerMessage({
      type: "reconnectResult",
      ok: true,
      roomCode: "AB12",
      playerSlot: "p1",
      phase: "playing",
    });
    socket.emitServerMessage({
      type: "gameStart",
      seed: 7,
      startTick: 0,
      tickRate: 20,
      playerSlots: ["p1", "p2"],
      inputDelayTicks: 2,
    });

    assert.equal(harness.ui.root.dataset.shellView, "active-run");
    assert.equal(harness.ui.root.dataset.phase, "playing");
  } finally {
    harness.cleanup();
  }
});

test("game startup can recover a finished online PVP settlement", () => {
  const socketHarness = new FakeSocketFactoryHarness();
  const sessionStorage = new MemoryStorage();

  sessionStorage.setItem(PVP_SESSION_TOKEN_STORAGE_KEY, "session-token_1");

  const harness = createGameHarness({
    pvpConnectionOptions: {
      url: "ws://example.test/ws",
      socketFactory: socketHarness.factory,
      sessionStorage,
    },
  });

  try {
    harness.game.start();

    const socket = socketHarness.sockets[0];

    assert.ok(socket);
    socket.emitOpen();
    socket.emitServerMessage(createWelcomeMessage());
    socket.emitServerMessage({
      type: "reconnectResult",
      ok: true,
      roomCode: "AB12",
      playerSlot: "p1",
      phase: "finished",
    });
    socket.emitServerMessage({
      type: "gameOver",
      winner: "p2",
      reason: "opponent_disconnected",
      finalTick: 12,
    });

    assert.equal(harness.ui.root.dataset.shellView, "active-run");
    assert.equal(harness.ui.root.dataset.phase, "gameOver");
    assert.equal(harness.ui.panelSecondaryLabel.textContent, "P2 获胜");
    assert.equal(harness.ui.roomStatusLabel.textContent, "你已断线，对手获胜");
  } finally {
    harness.cleanup();
  }
});

test("service_busy maps to a clear Chinese message", () => {
  const socketHarness = new FakeSocketFactoryHarness();
  const controller = createPvpConnectionController({
    url: "ws://example.test/ws",
    socketFactory: socketHarness.factory,
  });

  try {
    controller.enterMatchmaking();

    const socket = socketHarness.sockets[0];

    assert.ok(socket);
    socket.emitOpen();
    socket.emitServerMessage(createWelcomeMessage());
    socket.emitServerMessage({
      type: "error",
      code: "service_busy",
      message: "PVP server is busy",
    });

    assert.equal(controller.getState().status, "error");
    assert.equal(controller.getPanelState().statusText, "当前在线人数较多，请稍后再试");
  } finally {
    controller.destroy();
  }
});

test("capacity_reached maps to a clear Chinese message", () => {
  const socketHarness = new FakeSocketFactoryHarness();
  const controller = createPvpConnectionController({
    url: "ws://example.test/ws",
    socketFactory: socketHarness.factory,
  });

  try {
    controller.enterMatchmaking();

    const socket = socketHarness.sockets[0];

    assert.ok(socket);
    socket.emitOpen();
    socket.emitServerMessage(createWelcomeMessage());
    socket.emitServerMessage({
      type: "error",
      code: "capacity_reached",
      message: "PVP server is busy",
    });

    assert.equal(controller.getState().status, "error");
    assert.equal(controller.getPanelState().statusText, "当前在线人数较多，请稍后再试");
  } finally {
    controller.destroy();
  }
});
