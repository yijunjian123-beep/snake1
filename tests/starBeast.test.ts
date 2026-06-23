import assert from "node:assert/strict";
import test from "node:test";

import type { GridCell, GridMetrics, StarBeast, StarCore } from "../src/game/types.ts";
import {
  countRegularStarCores,
  buildStarBeastDropCores,
  getDesiredStarBeastCount,
  getStarBeastTier,
  spawnStarBeast,
} from "../src/game/starBeast.ts";
import { getNextLengthUnlockCopy } from "../src/game/progression.ts";
import { getStarCoreBurstState } from "../src/game/render.ts";
import { createGameHarness, createPrng } from "./test-support.ts";

function makeSnake(length: number, headColumn: number, row: number): GridCell[] {
  return Array.from({ length }, (_, index) => ({
    column: headColumn - index,
    row,
  }));
}

test("star beast unlocks at snake length 10", () => {
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

  assert.equal(getDesiredStarBeastCount(lockedProgress), 0);
  assert.equal(getStarBeastTier(lockedProgress), null);
  assert.equal(getDesiredStarBeastCount(unlockedProgress), 1);
  assert.equal(getStarBeastTier(unlockedProgress)?.length, 8);
});

test("spawnStarBeast only appears after unlock and uses the first tier", () => {
  const grid: GridMetrics = {
    columns: 24,
    rows: 16,
    cellSize: 24,
    offsetX: 0,
    offsetY: 0,
  };
  const progress = {
    snakeLength: 10,
    coresEaten: 0,
    score: 0,
    elapsedTime: 0,
  };

  assert.equal(
    spawnStarBeast({
      grid,
      progress: { ...progress, snakeLength: 9 },
      snake: makeSnake(4, 10, 8),
      foods: [],
      starCoreCells: [],
      existingBlackHoles: [],
      existingStarBeasts: [],
      currentTime: 1,
      random: createPrng(1),
    }),
    null,
  );

  const beast = spawnStarBeast({
    grid,
    progress,
    snake: makeSnake(10, 12, 8),
    foods: [],
    starCoreCells: [],
    existingBlackHoles: [],
    existingStarBeasts: [],
    currentTime: 1,
    random: createPrng(1),
  });

  assert.ok(beast);
  assert.equal(beast?.alive, true);
  assert.equal(beast?.state, "spawning");
  assert.equal(beast?.length, 8);
  assert.equal(beast?.body.length, 8);
});

test("star beast death drops one core per segment up to the cap", () => {
  const beast: StarBeast = {
    id: 1,
    alive: true,
    body: Array.from({ length: 30 }, (_, index) => ({
      column: 15 - index,
      row: 7,
    })),
    dir: "right",
    length: 30,
    state: "patrol",
    moveTimer: 0,
    aiDecisionCooldown: 0,
    turnCommitTicks: 2,
    spawnGraceTime: 0,
    speedFactor: 0.68,
    aggroRadius: 7,
    loseAggroRadius: 11,
  };

  const cores = buildStarBeastDropCores(beast, "player_body", {
    grid: {
      columns: 28,
      rows: 18,
      cellSize: 24,
      offsetX: 0,
      offsetY: 0,
    },
    currentTime: 12,
    blackHoles: [],
    random: createPrng(2),
  });

  assert.equal(cores.length, 24);
  assert.ok(cores.every((core) => core.source === "star_beast"));
  assert.ok(
    cores.every(
      (core) => core.burstOrigin?.column === beast.body[0]?.column && core.burstOrigin?.row === beast.body[0]?.row,
    ),
  );
  assert.ok(cores.every((core) => core.value === 1));
  assert.equal(countRegularStarCores(cores), 0);
});

test("star core burst animation is shared across sources", () => {
  const beastCore: StarCore = {
    id: 99,
    x: 8.5,
    y: 6.5,
    vx: 0,
    vy: 0,
    spawnTime: 12,
    magnetDelayMs: 250,
    magnetRadius: 3,
    lifetimeMs: 15000,
    value: 1,
    source: "star_beast",
    burstOrigin: { column: 8, row: 6 },
  };
  const regularCore: StarCore = { ...beastCore, source: "regular" };

  const beastEarly = getStarCoreBurstState(beastCore, 12.02);
  const regularEarly = getStarCoreBurstState(regularCore, 12.02);
  const beastPeak = getStarCoreBurstState(beastCore, 12.1);
  const beastSettle = getStarCoreBurstState(beastCore, 12.28);

  assert.deepEqual(beastEarly, regularEarly);
  assert.ok(beastEarly.scale > 1);
  assert.ok(beastPeak.scale > beastEarly.scale);
  assert.ok(Math.abs(beastSettle.scale - 1) < 0.02);
  assert.ok(beastEarly.clump > beastSettle.clump);
});

test("moving onto a star core grows only once", () => {
  const harness = createGameHarness();
  const internals = harness.game as unknown as Record<string, unknown>;

  try {
    (internals.resetRun as (phase: "ready" | "playing" | "paused" | "gameOver") => void)("playing");

    internals.snake = [
      { column: 5, row: 5 },
      { column: 4, row: 5 },
      { column: 3, row: 5 },
      { column: 2, row: 5 },
    ];
    internals.foods = [];
    internals.starBeasts = [];
    internals.starCores = [
      {
        id: 1,
        x: 6.5,
        y: 5.5,
        vx: 0,
        vy: 0,
        spawnTime: 0,
        magnetDelayMs: 0,
        magnetRadius: 0,
        lifetimeMs: 1000,
        value: 1,
        source: "star_beast",
      },
    ];
    internals.blackHoles = [];
    internals.blackHoleAlert = null;
    internals.blackHoleCue = null;
    internals.blackHoleRecoveryDirection = null;
    internals.direction = "right";
    internals.directionQueue = [];
    internals.score = 0;
    internals.coresEaten = 0;
    internals.playElapsed = 0;
    internals.isBoosting = false;
    internals.wallGrace = null;
    internals.starBeastRespawnLockUntil = 0;
    internals.starBeastNextSpawnCheckAt = 0;

    const beforeLength = (internals.snake as GridCell[]).length;

    (internals.advanceSnake as (stepMs: number) => void)(180);

    assert.equal((internals.snake as GridCell[]).length, beforeLength + 1);
    assert.equal(internals.coresEaten, 1);
    assert.equal(internals.score, 10);
    assert.equal(internals.phase, "playing");
  } finally {
    harness.cleanup();
  }
});

test("length unlock preview shows the next length-gated feature", () => {
  const copy = getNextLengthUnlockCopy({
    snakeLength: 9,
    coresEaten: 0,
    score: 0,
    elapsedTime: 0,
  });

  assert.equal(copy.title, "长度10解锁");
  assert.equal(copy.value, "星兽");
});

test("length unlock preview falls back to the finale teaser once the ladder ends", () => {
  const copy = getNextLengthUnlockCopy({
    snakeLength: 10,
    coresEaten: 0,
    score: 0,
    elapsedTime: 0,
  });

  assert.equal(copy.title, "BOSS战和联机模式");
  assert.equal(copy.value, "敬请期待");
});
