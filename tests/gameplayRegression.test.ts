import assert from "node:assert/strict";
import test from "node:test";

import type { GridCell } from "../src/game/types.ts";
import { createGameHarness } from "./test-support.ts";

function setRunState(internals: Record<string, any>, snake: GridCell[], direction: "up" | "right" | "down" | "left"): void {
  (internals.resetRun as (phase: "ready" | "playing" | "paused" | "gameOver") => void)("playing");
  internals.snake = snake;
  internals.direction = direction;
  internals.directionQueue = [];
  internals.foods = [];
  internals.starBeasts = [];
  internals.starCores = [];
  internals.blackHoles = [];
  internals.blackHoleAlert = null;
  internals.blackHoleCue = null;
  internals.blackHoleRecoveryDirection = null;
  internals.pendingGrowthSegments = 0;
  internals.deathReason = null;
  internals.elapsed = 0;
  (internals.rebuildSnakeOccupancy as () => void)();
}

test("moving into the departing tail cell stays legal", () => {
  const harness = createGameHarness();
  const internals = harness.game as unknown as Record<string, any>;

  try {
    setRunState(internals, [
      { column: 2, row: 1 },
      { column: 2, row: 2 },
      { column: 1, row: 2 },
      { column: 1, row: 1 },
    ], "up");

    (internals.advanceSnakeFromDirection as (direction: "left") => void)("left");

    assert.equal(internals.phase, "playing");
    assert.equal(internals.deathReason, null);
    assert.deepEqual(internals.snake[0], { column: 1, row: 1 });
    assert.equal(internals.snake.length, 4);
  } finally {
    harness.cleanup();
  }
});

test("moving into a live body segment still triggers self-collision", () => {
  const harness = createGameHarness();
  const internals = harness.game as unknown as Record<string, any>;

  try {
    setRunState(internals, [
      { column: 2, row: 2 },
      { column: 3, row: 2 },
      { column: 3, row: 1 },
      { column: 2, row: 1 },
      { column: 1, row: 1 },
    ], "up");

    (internals.advanceSnakeFromDirection as (direction: "right") => void)("right");

    assert.equal(internals.phase, "revivePrompt");
    assert.equal(internals.deathReason, "snake_body");
    assert.equal(internals.livesRemaining, 2);
  } finally {
    harness.cleanup();
  }
});

test("wall grace recovers once when a valid turn arrives before expiry", () => {
  const harness = createGameHarness();
  const internals = harness.game as unknown as Record<string, any>;
  const wallColumn = internals.grid.columns - 1;

  try {
    setRunState(internals, [
      { column: wallColumn, row: 5 },
      { column: wallColumn - 1, row: 5 },
      { column: wallColumn - 2, row: 5 },
      { column: wallColumn - 3, row: 5 },
    ], "right");
    internals.elapsed = 1000;

    (internals.advanceSnakeFromDirection as (direction: "right") => void)("right");

    assert.equal(internals.phase, "playing");
    assert.equal(internals.deathReason, null);
    assert.ok(internals.wallGrace);

    internals.directionQueue = ["up"];
    internals.elapsed = internals.wallGrace.startedAt + 10;
    (internals.updateWallGraceState as () => void)();

    assert.equal(internals.phase, "playing");
    assert.equal(internals.wallGrace, null);
    assert.deepEqual(internals.snake[0], { column: wallColumn, row: 4 });
  } finally {
    harness.cleanup();
  }
});

test("wall grace still expires into wall death without a valid recovery turn", () => {
  const harness = createGameHarness();
  const internals = harness.game as unknown as Record<string, any>;
  const wallColumn = internals.grid.columns - 1;

  try {
    setRunState(internals, [
      { column: wallColumn, row: 5 },
      { column: wallColumn - 1, row: 5 },
      { column: wallColumn - 2, row: 5 },
      { column: wallColumn - 3, row: 5 },
    ], "right");
    internals.elapsed = 2000;

    (internals.advanceSnakeFromDirection as (direction: "right") => void)("right");
    assert.ok(internals.wallGrace);

    internals.elapsed = internals.wallGrace.expiresAt + 1;
    (internals.updateWallGraceState as () => void)();

    assert.equal(internals.phase, "revivePrompt");
    assert.equal(internals.deathReason, "wall");
    assert.equal(internals.livesRemaining, 2);
  } finally {
    harness.cleanup();
  }
});
