import assert from "node:assert/strict";
import test from "node:test";

import type { GridCell, GridMetrics } from "../src/game/types.ts";
import {
  getDesiredStarAttractorCount,
  rollStarAttractorNeed,
  spawnStarAttractor,
} from "../src/game/starAttractor.ts";
import { getNextLengthUnlockCopy } from "../src/game/progression.ts";
import { createGameHarness, createPrng } from "./test-support.ts";

function makeSnake(length: number, headColumn: number, row: number): GridCell[] {
  return Array.from({ length }, (_, index) => ({
    column: headColumn - index,
    row,
  }));
}

function makeGrid(): GridMetrics {
  return {
    columns: 24,
    rows: 16,
    cellSize: 24,
    offsetX: 0,
    offsetY: 0,
  };
}

test("star attractor unlocks at snake length 10", () => {
  const lockedProgress = {
    snakeLength: 9,
    coresEaten: 0,
    score: 0,
    elapsedTime: 0,
  };
  const unlockedProgress = {
    snakeLength: 10,
    coresEaten: 0,
    score: 0,
    elapsedTime: 0,
  };

  assert.equal(getDesiredStarAttractorCount(lockedProgress), 0);
  assert.equal(getDesiredStarAttractorCount(unlockedProgress), 1);

  const copy = getNextLengthUnlockCopy(lockedProgress);
  assert.equal(copy.title, "长度10解锁");
  assert.equal(copy.value, "星兽");
});

test("star attractor threshold cycle follows the configured bands", () => {
  const picker = (): number => 0;

  assert.equal(rollStarAttractorNeed(0, picker), 6);
  assert.equal(rollStarAttractorNeed(1, picker), 8);
  assert.equal(rollStarAttractorNeed(2, picker), 10);
  assert.equal(rollStarAttractorNeed(3, picker), 10);
  assert.equal(rollStarAttractorNeed(4, picker), 6);
});

test("spawnStarAttractor only appears after unlock and keeps clear of the head lane", () => {
  const grid = makeGrid();
  const progress = {
    snakeLength: 10,
    coresEaten: 0,
    score: 0,
    elapsedTime: 0,
  };
  const beast = spawnStarAttractor({
    grid,
    progress: { ...progress, snakeLength: 9 },
    snake: makeSnake(4, 12, 8),
    direction: "right",
    foods: [],
    starCoreCells: [],
    existingBlackHoles: [],
    existingStarAttractors: [],
    existingStarBeasts: [],
    currentTime: 1,
    random: createPrng(1),
  });

  assert.equal(beast, null);

  const attractor = spawnStarAttractor({
    grid,
    progress,
    snake: makeSnake(10, 12, 8),
    direction: "right",
    foods: [],
    starCoreCells: [],
    existingBlackHoles: [],
    existingStarAttractors: [],
    existingStarBeasts: [],
    currentTime: 1,
    random: createPrng(1),
  });

  assert.ok(attractor);
  assert.equal(attractor?.cell.column === 13 && attractor?.cell.row === 8, false);
  assert.equal(Math.max(Math.abs((attractor?.cell.column ?? 0) - 12), Math.abs((attractor?.cell.row ?? 0) - 8)) >= 4, true);
});

test("star attractor flow stays disabled in the current build", () => {
  const harness = createGameHarness();
  const internals = harness.game as unknown as Record<string, unknown>;

  try {
    (internals.resetRun as (phase: "ready" | "playing" | "paused" | "gameOver") => void)("playing");
    internals.audio = {
      unlock(): void {},
      playUiPulse(): void {},
      playRewardPulse(): void {},
      destroy(): void {},
    };
    internals.snake = makeSnake(10, 6, 5);
    internals.foods = [
      { column: 7, row: 5 },
      { column: 8, row: 5 },
      { column: 9, row: 5 },
    ];
    internals.starAttractors = [];
    internals.starAttractorEffects = [];
    internals.starAttractorEatCount = 4;
    internals.starAttractorNeedIndex = 1;
    internals.starAttractorNeed = 8;
    internals.starAttractorSpawnPending = false;
    internals.starBeasts = [];
    internals.starCores = [];
    internals.blackHoles = [
      {
        kind: "small",
        cell: { column: 20, row: 12 },
        seed: 1,
        spawnTime: 0,
        activateAt: 0,
      },
    ];
    internals.blackHoleAlert = null;
    internals.blackHoleCue = null;
    internals.blackHoleRecoveryDirection = null;
    internals.score = 0;
    internals.coresEaten = 0;
    internals.pendingGrowthSegments = 0;
    internals.playElapsed = 0;

    assert.equal(internals.starAttractorEatCount, 4);
    assert.equal(internals.starAttractorNeedIndex, 1);
    assert.equal(internals.starAttractorNeed, 8);
    assert.equal(internals.starAttractorEffects.length, 0);
    assert.equal(internals.score, 0);
    assert.equal(internals.coresEaten, 0);
    assert.equal(internals.pendingGrowthSegments, 0);
    assert.equal((internals.foods as GridCell[]).length, 3);

    (internals.absorbStarAttractor as (cell: GridCell, currentTime: number) => void)({ column: 6, row: 5 }, 12);

    assert.equal(internals.starAttractorEatCount, 4);
    assert.equal(internals.starAttractorNeedIndex, 1);
    assert.equal(internals.starAttractorNeed, 8);
    assert.equal(internals.starAttractorEffects.length, 0);
    assert.equal(internals.score, 0);
    assert.equal(internals.coresEaten, 0);
    assert.equal(internals.pendingGrowthSegments, 0);
    assert.equal((internals.foods as GridCell[]).length, 3);
  } finally {
    harness.cleanup();
  }
});
