import assert from "node:assert/strict";
import test from "node:test";

import type { GameSnapshot, InputCommand } from "../src/game/types.ts";
import { createGameHarness } from "./test-support.ts";

type LocalPvpPlayerProbe = {
  snake: Array<{ column: number; row: number }>;
  lifecycle: {
    phase: string;
    deathReason: string | null;
  };
  movement: {
    direction: string;
    directionQueue: string[];
    isBoosting: boolean;
    stepAccumulator: number;
  };
  progress: {
    score: number;
    coresEaten: number;
  };
};

type LocalPvpInputStateProbe = {
  queue: Array<{
    playerId: string;
    tick: number;
    action: string;
    kind: string;
    origin: string;
    sequence: number;
  }>;
  lastAppliedSequenceByPlayer: {
    p1: number;
    p2: number;
  };
};

function dispatchPointerUp(target: EventTarget): void {
  target.dispatchEvent(new Event("pointerup", { cancelable: true }));
}

test("local PVP mode creates two player snapshots and advances a shared tick", () => {
  const harness = createGameHarness({ search: "?localPvp=1" });
  const internals = harness.game as unknown as Record<string, unknown>;

  try {
    (internals.resetRun as (phase: "ready" | "playing" | "paused" | "gameOver") => void)("playing");

    const initialSnapshot = (internals.createSnapshot as () => GameSnapshot)();

    assert.equal(initialSnapshot.match.mode, "local-pvp");
    assert.equal(initialSnapshot.players.length, 2);
    assert.equal(initialSnapshot.players[0]?.id, "p1");
    assert.equal(initialSnapshot.players[1]?.id, "p2");
    assert.notDeepEqual(initialSnapshot.players[0]?.snake[0], initialSnapshot.players[1]?.snake[0]);

    const initialFirstHead = { ...initialSnapshot.players[0]!.snake[0]! };
    const initialSecondHead = { ...initialSnapshot.players[1]!.snake[0]! };

    (internals.advanceLocalPvpTick as () => void)();

    const nextSnapshot = (internals.createSnapshot as () => GameSnapshot)();

    assert.equal(nextSnapshot.match.tick, initialSnapshot.match.tick + 1);
    assert.equal(nextSnapshot.players.length, 2);
    assert.notDeepEqual(nextSnapshot.players[0]?.snake[0], initialFirstHead);
    assert.notDeepEqual(nextSnapshot.players[1]?.snake[0], initialSecondHead);
  } finally {
    harness.cleanup();
  }
});

test("PVP room shell shows unavailable room actions and returns to the main menu", () => {
  const harness = createGameHarness();

  try {
    harness.game.start();
    dispatchPointerUp(harness.ui.pvpButton);

    assert.equal(harness.ui.root.dataset.shellView, "pvp-room");
    assert.equal(harness.ui.entryActions.hidden, true);
    assert.equal(harness.ui.pvpRoomPanel.hidden, false);
    assert.equal(harness.ui.panelPrimaryValue.textContent, "PVP 房间");
    assert.equal(harness.ui.roomStatusLabel.textContent, "联机房间服务将在下一步接入；当前不会创建真实房间。");

    dispatchPointerUp(harness.ui.createRoomButton);

    assert.equal(
      harness.ui.roomStatusLabel.textContent,
      "暂未接入房间服务：创建、加入和准备会在下一步真实房间 MVP 中实现。",
    );

    dispatchPointerUp(harness.ui.roomBackButton);

    assert.equal(harness.ui.root.dataset.shellView, "main-menu");
    assert.equal(harness.ui.entryActions.hidden, false);
    assert.equal(harness.ui.pvpRoomPanel.hidden, true);
  } finally {
    harness.cleanup();
  }
});

test("PVE settlement buttons revive or return to the main menu", () => {
  const harness = createGameHarness();
  const internals = harness.game as unknown as Record<string, unknown>;

  try {
    harness.game.start();
    internals.audio = {
      unlock(): void {
        // No-op.
      },
      playUiPulse(): void {
        // No-op.
      },
      playRewardPulse(): void {
        // No-op.
      },
      destroy(): void {
        // No-op.
      },
    };

    dispatchPointerUp(harness.ui.pveButton);
    (internals.handlePlayerDeath as (reason: "wall") => void)("wall");

    assert.equal(harness.ui.root.dataset.shellView, "active-run");
    assert.equal(harness.ui.root.dataset.phase, "revivePrompt");
    assert.equal(harness.ui.settlementActions.hidden, false);
    assert.equal(harness.ui.continueButton.textContent, "继续游戏");
    assert.equal(harness.ui.mainMenuButton.textContent, "回到主界面");

    dispatchPointerUp(harness.ui.continueButton);

    let snapshot = (internals.createSnapshot as () => GameSnapshot)();

    assert.equal(snapshot.phase, "reviving");
    assert.equal(snapshot.match.mode, "solo");

    (internals.finishGameOver as (reason: "wall") => void)("wall");
    dispatchPointerUp(harness.ui.mainMenuButton);

    snapshot = (internals.createSnapshot as () => GameSnapshot)();

    assert.equal(harness.ui.root.dataset.shellView, "main-menu");
    assert.equal(harness.ui.entryActions.hidden, false);
    assert.equal(harness.ui.settlementActions.hidden, true);
    assert.equal(snapshot.phase, "ready");
    assert.equal(snapshot.match.mode, "solo");
  } finally {
    harness.cleanup();
  }
});

test("local PVP settlement buttons continue the match or return to the main menu without query re-entry", () => {
  const harness = createGameHarness({ search: "?localPvp=1" });
  const internals = harness.game as unknown as Record<string, unknown>;

  try {
    harness.game.start();
    (internals.resetRun as (phase: "ready" | "playing" | "paused" | "gameOver") => void)("playing");
    internals.audio = {
      unlock(): void {
        // No-op.
      },
      playUiPulse(): void {
        // No-op.
      },
      playRewardPulse(): void {
        // No-op.
      },
      destroy(): void {
        // No-op.
      },
    };

    const players = internals.players as LocalPvpPlayerProbe[];
    const match = internals.match as { phase: string; winnerId: string | null; tick: number };

    match.winnerId = "p2";
    players[0]!.lifecycle.phase = "gameOver";
    players[0]!.lifecycle.deathReason = "snake_body";
    players[1]!.progress.score = 20;
    (internals.phase as string) = "gameOver";
    (internals.syncUi as (force: boolean) => void)(true);

    assert.equal(harness.ui.root.dataset.shellView, "active-run");
    assert.equal(harness.ui.root.dataset.phase, "gameOver");
    assert.equal(harness.ui.settlementActions.hidden, false);
    assert.equal(harness.ui.continueButton.textContent, "继续游戏");
    assert.equal(harness.ui.mainMenuButton.textContent, "回到主界面");

    dispatchPointerUp(harness.ui.continueButton);

    let snapshot = (internals.createSnapshot as () => GameSnapshot)();

    assert.equal(snapshot.phase, "playing");
    assert.equal(snapshot.match.mode, "local-pvp");
    assert.equal(snapshot.match.tick, 0);
    assert.equal(snapshot.match.winnerId, null);

    match.winnerId = "p1";
    players[1]!.lifecycle.phase = "gameOver";
    players[1]!.lifecycle.deathReason = "wall";
    (internals.phase as string) = "gameOver";
    (internals.syncUi as (force: boolean) => void)(true);

    dispatchPointerUp(harness.ui.mainMenuButton);

    snapshot = (internals.createSnapshot as () => GameSnapshot)();

    assert.equal(harness.ui.root.dataset.shellView, "main-menu");
    assert.equal(harness.ui.entryActions.hidden, false);
    assert.equal(harness.ui.settlementActions.hidden, true);
    assert.equal(snapshot.phase, "ready");
    assert.equal(snapshot.match.mode, "solo");
  } finally {
    harness.cleanup();
  }
});

test("local PVP starting placement keeps both snakes separated and inside the grid", () => {
  const harness = createGameHarness({ search: "?localPvp=1" });
  const internals = harness.game as unknown as Record<string, unknown>;

  try {
    (internals.resetRun as (phase: "ready" | "playing" | "paused" | "gameOver") => void)("playing");

    const snapshot = (internals.createSnapshot as () => GameSnapshot)();
    const occupiedCells = new Set<string>();

    assert.equal(snapshot.match.mode, "local-pvp");
    assert.equal(snapshot.players.length, 2);

    for (const player of snapshot.players) {
      assert.equal(player.deathReason, null);
      assert.ok(player.snake.length >= 3);

      for (const cell of player.snake) {
        assert.ok(cell.column >= 0 && cell.column < snapshot.grid.columns);
        assert.ok(cell.row >= 0 && cell.row < snapshot.grid.rows);

        const key = `${cell.column}:${cell.row}`;
        assert.equal(occupiedCells.has(key), false, `duplicate starting cell ${key}`);
        occupiedCells.add(key);
      }
    }

    const [firstHead, secondHead] = snapshot.players.map((player) => player.snake[0]);

    assert.ok(firstHead);
    assert.ok(secondHead);
    assert.ok(Math.abs(firstHead.column - secondHead.column) > 4);
  } finally {
    harness.cleanup();
  }
});

test("local PVP input commands enter the tick-addressed queue", () => {
  const harness = createGameHarness({ search: "?localPvp=1" });
  const internals = harness.game as unknown as Record<string, unknown>;

  try {
    (internals.resetRun as (phase: "ready" | "playing" | "paused" | "gameOver") => void)("playing");
    (internals.advanceLocalPvpTick as () => void)();

    const command: InputCommand = {
      action: "move-up",
      kind: "pressed",
      source: "keyboard",
      playerId: "p1",
    };

    (internals.handleInput as (command: InputCommand) => void)(command);

    const inputState = internals.inputState as {
      queue: Array<{
        playerId: string;
        tick: number;
        action: string;
        kind: string;
        origin: string;
        sequence: number;
      }>;
    };
    const queued = inputState.queue.at(-1);

    assert.ok(queued);
    assert.equal(typeof queued.sequence, "number");
    assert.ok(queued.sequence > 0);
    assert.deepEqual({
      playerId: queued.playerId,
      tick: queued.tick,
      action: queued.action,
      kind: queued.kind,
      origin: queued.origin,
    }, {
      playerId: "p1",
      tick: 1,
      action: "move-up",
      kind: "pressed",
      origin: "local",
    });
  } finally {
    harness.cleanup();
  }
});

test("local PVP keeps player input commands isolated by player id", () => {
  const harness = createGameHarness({ search: "?localPvp=1" });
  const internals = harness.game as unknown as Record<string, unknown>;

  try {
    (internals.resetRun as (phase: "ready" | "playing" | "paused" | "gameOver") => void)("playing");

    const firstCommand: InputCommand = {
      action: "move-up",
      kind: "pressed",
      source: "keyboard",
      playerId: "p1",
    };
    const secondCommand: InputCommand = {
      action: "boost",
      kind: "pressed",
      source: "keyboard",
      playerId: "p2",
    };

    (internals.handleInput as (command: InputCommand) => void)(firstCommand);
    (internals.handleInput as (command: InputCommand) => void)(secondCommand);
    (internals.applyQueuedInputCommandsForTick as (tick: number) => void)(0);

    const players = internals.players as LocalPvpPlayerProbe[];
    const inputState = internals.inputState as LocalPvpInputStateProbe;

    assert.deepEqual(players[0]?.movement.directionQueue, ["up"]);
    assert.equal(players[0]?.movement.isBoosting, false);
    assert.deepEqual(players[1]?.movement.directionQueue, []);
    assert.equal(players[1]?.movement.isBoosting, true);
    assert.equal(inputState.lastAppliedSequenceByPlayer.p1, 1);
    assert.equal(inputState.lastAppliedSequenceByPlayer.p2, 2);
  } finally {
    harness.cleanup();
  }
});

test("local PVP applies queued player input on the next shared tick", () => {
  const harness = createGameHarness({ search: "?localPvp=1" });
  const internals = harness.game as unknown as Record<string, unknown>;

  try {
    (internals.resetRun as (phase: "ready" | "playing" | "paused" | "gameOver") => void)("playing");

    const beforeInput = (internals.createSnapshot as () => GameSnapshot)();

    assert.equal(beforeInput.players[0]?.direction, "right");

    const command: InputCommand = {
      action: "move-up",
      kind: "pressed",
      source: "keyboard",
      playerId: "p1",
    };

    (internals.handleInput as (command: InputCommand) => void)(command);

    const afterInputBeforeTick = (internals.createSnapshot as () => GameSnapshot)();

    assert.equal(afterInputBeforeTick.players[0]?.direction, "right");

    (internals.advanceLocalPvpTick as () => void)();

    const afterTick = (internals.createSnapshot as () => GameSnapshot)();

    assert.equal(afterTick.match.tick, beforeInput.match.tick + 1);
    assert.equal(afterTick.players[0]?.direction, "up");
  } finally {
    harness.cleanup();
  }
});

test("local PVP simultaneous player deaths resolve the match as a draw", () => {
  const harness = createGameHarness({ search: "?localPvp=1" });
  const internals = harness.game as unknown as Record<string, unknown>;

  try {
    (internals.resetRun as (phase: "ready" | "playing" | "paused" | "gameOver") => void)("playing");

    const players = internals.players as LocalPvpPlayerProbe[];

    players[0]!.snake = [{ column: 3, row: 4 }];
    players[0]!.movement.direction = "right";
    players[0]!.movement.directionQueue = [];
    players[1]!.snake = [{ column: 5, row: 4 }];
    players[1]!.movement.direction = "left";
    players[1]!.movement.directionQueue = [];
    internals.foods = [{ column: 4, row: 4 }];
    (internals.rebuildAllPlayerSnakeOccupancy as () => void)();

    (internals.advanceLocalPvpTick as () => void)();

    const snapshot = (internals.createSnapshot as () => GameSnapshot)();

    assert.equal(snapshot.phase, "gameOver");
    assert.equal(snapshot.match.phase, "gameOver");
    assert.equal(snapshot.match.winnerId, null);
    assert.deepEqual(snapshot.players.map((player) => player.deathReason), ["snake_body", "snake_body"]);
    assert.deepEqual(snapshot.players.map((player) => player.score), [0, 0]);
    assert.equal(snapshot.foods.length, 1);
  } finally {
    harness.cleanup();
  }
});

test("local PVP restart clears stale winner, player deaths, scores, and queued input", () => {
  const harness = createGameHarness({ search: "?localPvp=1" });
  const internals = harness.game as unknown as Record<string, unknown>;

  try {
    (internals.resetRun as (phase: "ready" | "playing" | "paused" | "gameOver") => void)("playing");
    (internals.advanceLocalPvpTick as () => void)();

    const players = internals.players as LocalPvpPlayerProbe[];
    const match = internals.match as { winnerId: string | null; tick: number };
    const inputState = internals.inputState as LocalPvpInputStateProbe;
    internals.audio = {
      unlock(): void {
        // No-op.
      },
      playUiPulse(): void {
        // No-op.
      },
      playRewardPulse(): void {
        // No-op.
      },
      destroy(): void {
        // No-op.
      },
    };

    match.winnerId = "p1";
    players[0]!.progress.score = 50;
    players[0]!.progress.coresEaten = 5;
    players[1]!.lifecycle.phase = "gameOver";
    players[1]!.lifecycle.deathReason = "wall";
    inputState.queue.push({
      playerId: "p2",
      tick: 99,
      action: "boost",
      kind: "pressed",
      origin: "scripted",
      sequence: 99,
    });
    inputState.lastAppliedSequenceByPlayer.p2 = 99;

    const restartCommand: InputCommand = {
      action: "restart",
      kind: "pressed",
      source: "keyboard",
      playerId: "p1",
    };

    (internals.handleInput as (command: InputCommand) => void)(restartCommand);

    const snapshot = (internals.createSnapshot as () => GameSnapshot)();
    const resetInputState = internals.inputState as LocalPvpInputStateProbe;

    assert.equal(snapshot.phase, "playing");
    assert.equal(snapshot.match.mode, "local-pvp");
    assert.equal(snapshot.match.tick, 0);
    assert.equal(snapshot.match.winnerId, null);
    assert.deepEqual(snapshot.players.map((player) => player.deathReason), [null, null]);
    assert.deepEqual(snapshot.players.map((player) => player.score), [0, 0]);
    assert.deepEqual(resetInputState.queue, []);
    assert.deepEqual(resetInputState.lastAppliedSequenceByPlayer, { p1: 0, p2: 0 });
  } finally {
    harness.cleanup();
  }
});

test("local PVP boost lets one player advance before the other player is ready", () => {
  const harness = createGameHarness({ search: "?localPvp=1" });
  const internals = harness.game as unknown as Record<string, unknown>;

  try {
    (internals.resetRun as (phase: "ready" | "playing" | "paused" | "gameOver") => void)("playing");

    const players = internals.players as LocalPvpPlayerProbe[];
    const before = (internals.createSnapshot as () => GameSnapshot)();
    const firstHead = { ...before.players[0]!.snake[0]! };
    const secondHead = { ...before.players[1]!.snake[0]! };

    players[0]!.movement.isBoosting = true;
    players[0]!.movement.stepAccumulator = 230;
    players[1]!.movement.stepAccumulator = 230;

    (internals.advanceLocalPvp as (delta: number) => void)(0);

    const after = (internals.createSnapshot as () => GameSnapshot)();

    assert.equal(after.players[0]?.speedMode, "boost");
    assert.notDeepEqual(after.players[0]?.snake[0], firstHead);
    assert.deepEqual(after.players[1]?.snake[0], secondHead);
    assert.equal(after.match.tick, before.match.tick + 1);
  } finally {
    harness.cleanup();
  }
});

test("local PVP keeps extra solo entities out of the MVP simulation", () => {
  const harness = createGameHarness({ search: "?localPvp=1" });
  const internals = harness.game as unknown as Record<string, unknown>;

  try {
    (internals.resetRun as (phase: "ready" | "playing" | "paused" | "gameOver") => void)("playing");

    const players = internals.players as LocalPvpPlayerProbe[];

    players[0]!.snake = Array.from({ length: 24 }, (_, index) => ({ column: 24 - index, row: 4 }));
    players[0]!.progress.score = 300;
    players[0]!.progress.coresEaten = 30;

    for (let index = 0; index < 8; index += 1) {
      (internals.updateLocalPvpWorld as () => void)();
    }

    assert.equal((internals.starBeasts as unknown[]).length, 0);
    assert.equal((internals.starAttractors as unknown[]).length, 0);
  } finally {
    harness.cleanup();
  }
});
