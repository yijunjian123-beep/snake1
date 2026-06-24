import assert from "node:assert/strict";
import test from "node:test";

import type { GridCell, GridMetrics, StarBeast, StarCore } from "../src/game/types.ts";
import {
  countRegularStarCores,
  buildStarBeastDropCores,
  STAR_BEAST_CONFIG,
  getDesiredStarBeastCount,
  getStarBeastTier,
  chooseStarBeastDirection,
  spawnStarBeast,
} from "../src/game/starBeast.ts";
import { getNextLengthUnlockCopy } from "../src/game/progression.ts";
import { getCoreGlyphMetrics, getStarCoreBurstState } from "../src/game/render.ts";
import { resolveRewardBurstOrigin } from "../src/game/renderState.ts";
import { createGameHarness, createPrng } from "./test-support.ts";

function makeSnake(length: number, headColumn: number, row: number): GridCell[] {
  return Array.from({ length }, (_, index) => ({
    column: headColumn - index,
    row,
  }));
}

function makeStarBeast(overrides: Partial<StarBeast> = {}): StarBeast {
  const body = overrides.body ?? makeSnake(8, 15, 7);

  return {
    id: 1,
    alive: true,
    body,
    dir: "right",
    length: overrides.length ?? body.length,
    state: "patrol",
    moveTimer: 0,
    aiDecisionCooldown: 0,
    turnCommitTicks: 2,
    spawnGraceTime: 0,
    coreScanStepCount: 0,
    nextCoreHuntAt: 0,
    coreHuntUntil: 0,
    nextAttackAt: 0,
    attackUntil: 0,
    speedFactor: 0.68,
    aggroRadius: 7,
    loseAggroRadius: 11,
    ...overrides,
  };
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
  assert.equal(getStarBeastTier(unlockedProgress)?.length, 12);
  assert.equal(STAR_BEAST_CONFIG.spawnCheckIntervalMs, 3333);
  assert.equal(STAR_BEAST_CONFIG.respawnCooldownMs, 12000);
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
  assert.equal(beast?.length, 12);
  assert.equal(beast?.body.length, 12);
});

test("star beast death drops one core per segment up to the cap", () => {
  const beast = makeStarBeast({
    body: Array.from({ length: 30 }, (_, index) => ({
      column: 15 - index,
      row: 7,
    })),
    length: 30,
  });

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
  assert.ok(cores.every((core) => core.source === "regular"));
  assert.ok(
    cores.every(
      (core) => core.burstOrigin?.column === beast.body[0]?.column && core.burstOrigin?.row === beast.body[0]?.row,
    ),
  );
  assert.ok(cores.every((core) => core.value === 1));
  assert.equal(countRegularStarCores(cores), cores.length);
});

test("star beast prefers a nearby black hole and star core when those windows open", () => {
  const grid: GridMetrics = {
    columns: 24,
    rows: 16,
    cellSize: 24,
    offsetX: 0,
    offsetY: 0,
  };
  const beast = makeStarBeast({
    body: makeSnake(8, 10, 0),
    dir: "up",
    state: "patrol",
    nextCoreHuntAt: 0,
    coreHuntUntil: 10,
    nextAttackAt: 100,
    attackUntil: 0,
  });

  const hungryDirection = chooseStarBeastDirection(beast, {
    grid,
    playerHead: { column: 10, row: 8 },
    playerDirection: "up",
    playerBody: [],
    blockedCells: [],
    starCoreCells: [{ column: 11, row: 0 }],
    otherStarBeasts: [],
    blackHoles: [],
    currentTime: 1,
  });

  const blackHoleDirection = chooseStarBeastDirection(beast, {
    grid,
    playerHead: { column: 10, row: 8 },
    playerDirection: "up",
    playerBody: [],
    blockedCells: [],
    starCoreCells: [],
    otherStarBeasts: [],
    blackHoles: [
      {
        kind: "small",
        cell: { column: 11, row: 0 },
        seed: 9,
        spawnTime: 0,
        activateAt: 0,
      },
    ],
    currentTime: 1,
  });

  assert.equal(hungryDirection, "right");
  assert.equal(blackHoleDirection, "right");
});

test("star beast leans into a black hole even when the player is ahead", () => {
  const grid: GridMetrics = {
    columns: 24,
    rows: 16,
    cellSize: 24,
    offsetX: 0,
    offsetY: 0,
  };
  const beast = makeStarBeast({
    body: makeSnake(3, 10, 5),
    dir: "up",
    state: "patrol",
    nextCoreHuntAt: 100,
    coreHuntUntil: 0,
    nextAttackAt: 100,
    attackUntil: 0,
    speedFactor: 0.74,
    aggroRadius: 8,
    loseAggroRadius: 12,
  });

  const direction = chooseStarBeastDirection(beast, {
    grid,
    playerHead: { column: 10, row: 2 },
    playerDirection: "up",
    playerBody: [],
    blockedCells: [],
    starCoreCells: [],
    otherStarBeasts: [],
    blackHoles: [
      {
        kind: "small",
        cell: { column: 11, row: 5 },
        seed: 9,
        spawnTime: 0,
        activateAt: 0,
      },
    ],
    currentTime: 1,
  });

  assert.equal(direction, "right");
});

test("star beast prefers a nearby black hole over the player line", () => {
  const grid: GridMetrics = {
    columns: 24,
    rows: 16,
    cellSize: 24,
    offsetX: 0,
    offsetY: 0,
  };
  const beast = makeStarBeast({
    body: makeSnake(3, 4, 2),
    dir: "up",
    state: "patrol",
    nextCoreHuntAt: 100,
    coreHuntUntil: 0,
    nextAttackAt: 100,
    attackUntil: 0,
    speedFactor: 0.76,
    aggroRadius: 9,
    loseAggroRadius: 14,
  });

  const noBlackHole = chooseStarBeastDirection(beast, {
    grid,
    playerHead: { column: 4, row: 0 },
    playerDirection: "up",
    playerBody: [],
    blockedCells: [],
    starCoreCells: [],
    otherStarBeasts: [],
    blackHoles: [],
    currentTime: 1,
  });

  const withBlackHole = chooseStarBeastDirection(beast, {
    grid,
    playerHead: { column: 4, row: 0 },
    playerDirection: "up",
    playerBody: [],
    blockedCells: [],
    starCoreCells: [],
    otherStarBeasts: [],
    blackHoles: [
      {
        kind: "small",
        cell: { column: 5, row: 2 },
        seed: 1,
        spawnTime: 0,
        activateAt: 0,
      },
    ],
    currentTime: 1,
  });

  assert.equal(noBlackHole, "up");
  assert.equal(withBlackHole, "right");
});

test("star beast attack window follows the player's next move more closely", () => {
  const grid: GridMetrics = {
    columns: 24,
    rows: 16,
    cellSize: 24,
    offsetX: 0,
    offsetY: 0,
  };
  const beast = makeStarBeast({
    body: makeSnake(3, 4, 2),
    dir: "up",
    state: "chase",
    nextCoreHuntAt: 100,
    coreHuntUntil: 0,
    nextAttackAt: 0,
    attackUntil: 10,
    speedFactor: 0.74,
    aggroRadius: 9,
    loseAggroRadius: 14,
  });
  const context = {
    grid,
    playerHead: { column: 4, row: 0 },
    playerDirection: "right" as const,
    playerBody: [] as GridCell[],
    blockedCells: [] as GridCell[],
    starCoreCells: [] as GridCell[],
    otherStarBeasts: [] as StarBeast[],
    blackHoles: [],
    currentTime: 1,
  };

  const attackDirection = chooseStarBeastDirection(beast, context);
  const passiveDirection = chooseStarBeastDirection({ ...beast, attackUntil: 0 }, context);

  assert.equal(attackDirection, "right");
  assert.equal(passiveDirection, "up");
});

test("star beast can eat a star core and grow without depending on player speed state", () => {
  const hungrySetup = (isBoosting: boolean) => {
    const harness = createGameHarness();
    const internals = harness.game as unknown as Record<string, unknown>;

    (internals.resetRun as (phase: "ready" | "playing" | "paused" | "gameOver") => void)("playing");
    internals.snake = makeSnake(6, 3, 3);
    internals.foods = [];
    internals.starBeasts = [
      makeStarBeast({
        body: makeSnake(8, 5, 5),
        dir: "right",
        nextCoreHuntAt: 100,
        coreHuntUntil: 10,
        nextAttackAt: 100,
        attackUntil: 0,
      }),
    ];
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
        burstOrigin: { column: 6, row: 5 },
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
    internals.isBoosting = isBoosting;
    internals.wallGrace = null;
    internals.starBeastRespawnLockUntil = 0;
    internals.starBeastNextSpawnCheckAt = 0;

    return { harness, internals };
  };

  const slowRun = hungrySetup(false);
  const fastRun = hungrySetup(true);

  try {
    (slowRun.internals.updateStarBeasts as (delta: number) => void)(600);
    (fastRun.internals.updateStarBeasts as (delta: number) => void)(600);

    const slowBeast = slowRun.internals.starBeasts[0] as StarBeast | undefined;
    const fastBeast = fastRun.internals.starBeasts[0] as StarBeast | undefined;

    assert.equal(slowRun.internals.starCores.length, 0);
    assert.equal(fastRun.internals.starCores.length, 0);
    assert.equal(slowBeast?.body.length, 9);
    assert.equal(fastBeast?.body.length, 9);
    assert.deepEqual(slowBeast?.body[0], fastBeast?.body[0]);
  } finally {
    fastRun.harness.cleanup();
    slowRun.harness.cleanup();
  }
});

test("star beast scans a 3x3 area around its head every two moves", () => {
  const harness = createGameHarness();
  const internals = harness.game as unknown as Record<string, unknown>;

  try {
    (internals.resetRun as (phase: "ready" | "playing" | "paused" | "gameOver") => void)("playing");
    internals.snake = makeSnake(6, 3, 3);
    internals.foods = [];
    internals.starBeasts = [
      makeStarBeast({
        body: makeSnake(8, 5, 5),
        dir: "right",
        aiDecisionCooldown: 5,
        coreScanStepCount: 1,
        nextCoreHuntAt: 100,
        coreHuntUntil: 0,
        nextAttackAt: 100,
        attackUntil: 0,
      }),
    ];
    internals.starCores = [
      {
        id: 1,
        x: 4.5,
        y: 5.5,
        vx: 0,
        vy: 0,
        spawnTime: 0,
        magnetDelayMs: 0,
        magnetRadius: 0,
        lifetimeMs: 1000,
        value: 1,
        source: "star_beast",
        burstOrigin: { column: 10, row: 10 },
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

    (internals.updateStarBeasts as (delta: number) => void)(600);

    const beast = internals.starBeasts[0] as StarBeast | undefined;

    assert.deepEqual(beast?.body[0], { column: 6, row: 5 });
    assert.equal(internals.starCores.length, 0);
    assert.equal(beast?.body.length, 9);
    assert.equal(beast?.coreScanStepCount, 0);
  } finally {
    harness.cleanup();
  }
});

test("player enters reviving state when moving into a star beast", () => {
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
    internals.starBeasts = [
      makeStarBeast({
        body: makeSnake(8, 6, 5),
        dir: "left",
      }),
    ];
    internals.starCores = [];
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

    (internals.advanceSnake as (stepMs: number) => void)(180);

    assert.equal(internals.phase, "revivePrompt");
  } finally {
    harness.cleanup();
  }
});

test("star core burst state is shared across sources", () => {
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
  const regularPeak = getStarCoreBurstState(regularCore, 12.1);
  const beastSettle = getStarCoreBurstState(beastCore, 12.24);
  const regularSettle = getStarCoreBurstState(regularCore, 12.24);

  assert.deepEqual(beastEarly, regularEarly);
  assert.deepEqual(beastPeak, regularPeak);
  assert.deepEqual(beastSettle, regularSettle);
});

test("shared core glyph metrics stay identical for regular and beast sources", () => {
  const regularMetrics = getCoreGlyphMetrics("regular", 2, 12.34, 24);
  const beastMetrics = getCoreGlyphMetrics("star_beast", 2, 12.34, 24);

  assert.deepEqual(regularMetrics, beastMetrics);
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
    assert.deepEqual(internals.rewardBurstOrigin, { column: 6, row: 5 });
    assert.equal(internals.phase, "playing");
  } finally {
    harness.cleanup();
  }
});

test("reward burst origin prefers the explicit source over removed-food fallback", () => {
  const explicitOrigin = { column: 8, row: 6 };
  const fallbackFood = { column: 1, row: 1 };

  const resolved = resolveRewardBurstOrigin(
    { rewardBurstOrigin: explicitOrigin, foods: [fallbackFood] },
    [fallbackFood, { column: 2, row: 2 }],
    { column: 5, row: 5 },
  );

  assert.deepEqual(resolved, explicitOrigin);
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
