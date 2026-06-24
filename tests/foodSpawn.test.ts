import assert from "node:assert/strict";
import test from "node:test";

import {
  advanceFoodWaveRuntime,
  FOOD_SPAWN_CONFIG,
  createFoodSpawnContext,
  createFoodWaveBag,
  createFoodWaveSpawnConfig,
  getFoodSpawnCandidates,
  isBlockedByBlackHoleFoodZone,
  spawnClusterFoods,
  spawnFoodWave,
} from "../src/game/foodSpawn.ts";
import type { BlackHole, GridCell, GridMetrics } from "../src/game/types.ts";

function createGrid(): GridMetrics {
  return {
    columns: 12,
    rows: 8,
    cellSize: 24,
    offsetX: 0,
    offsetY: 0,
  };
}

function cell(column: number, row: number): GridCell {
  return { column, row };
}

function makeBlackHole(overrides: Partial<BlackHole> = {}): BlackHole {
  return {
    kind: "small",
    cell: cell(6, 4),
    seed: 1,
    spawnTime: 0,
    activateAt: 0,
    ...overrides,
  };
}

test("createFoodSpawnContext gathers occupied cells from all participating entities", () => {
  const context = createFoodSpawnContext({
    grid: createGrid(),
    blackHoles: [makeBlackHole()],
    snake: [cell(1, 1), cell(0, 1)],
    foods: [cell(3, 3)],
    starAttractorCells: [cell(4, 4)],
    starBeastCells: [cell(5, 5)],
    starCoreCells: [cell(2, 6)],
    extraBlockedCells: [cell(8, 2)],
  });

  assert.equal(context.occupiedCells.length, 8);
  assert.deepEqual(context.blackHoles[0]?.cell, { column: 6, row: 4 });
  assert.ok(context.occupiedCells.some((entry) => entry.column === 6 && entry.row === 4));
});

test("createFoodWaveBag uses the configured single and cluster counts", () => {
  const bag = createFoodWaveBag(() => 0.5);
  const singles = bag.filter((entry) => entry === "single").length;
  const clusters = bag.filter((entry) => entry === "cluster").length;

  assert.equal(bag.length, FOOD_SPAWN_CONFIG.waveBagSingleCount + FOOD_SPAWN_CONFIG.waveBagClusterCount);
  assert.equal(singles, FOOD_SPAWN_CONFIG.waveBagSingleCount);
  assert.equal(clusters, FOOD_SPAWN_CONFIG.waveBagClusterCount);
});

test("food spawn candidates exclude occupied cells and black-hole food zones", () => {
  const context = createFoodSpawnContext({
    grid: createGrid(),
    blackHoles: [makeBlackHole()],
    snake: [cell(1, 1)],
    foods: [cell(2, 2)],
  });

  const candidates = getFoodSpawnCandidates(context);

  assert.ok(!candidates.some((entry) => entry.column === 1 && entry.row === 1));
  assert.ok(!candidates.some((entry) => entry.column === 2 && entry.row === 2));
  assert.ok(!candidates.some((entry) => entry.column === 6 && entry.row === 4));
});

test("spawnFoodWave falls back to a cluster near the black-hole boundary when the bag requests cluster", () => {
  const context = createFoodSpawnContext({
    grid: createGrid(),
    blackHoles: [makeBlackHole()],
    snake: [cell(0, 0)],
    foods: [],
  });

  const result = spawnFoodWave({
    context,
    currentFoodCount: 0,
    foodWaveBag: ["cluster"],
    config: createFoodWaveSpawnConfig(),
    random: () => 0,
  });

  assert.ok(result.spawnedFoods.length >= 1);
  assert.equal(result.nextFoodWaveBag.length, 0);
  assert.ok(
    result.spawnedFoods.every((entry) => !isBlockedByBlackHoleFoodZone(entry, context.blackHoles)),
  );
});

test("spawnClusterFoods respects maxCount and returns cells nearest the chosen anchor first", () => {
  const context = createFoodSpawnContext({
    grid: createGrid(),
    blackHoles: [makeBlackHole({ cell: cell(9, 4) })],
    snake: [cell(0, 0)],
    foods: [],
  });

  const foods = spawnClusterFoods(context, 3, FOOD_SPAWN_CONFIG.clusterRadius, () => 0);

  assert.equal(foods.length, 3);
  const anchor = foods[0];
  assert.ok(anchor);
  assert.ok(
    foods.every((entry) => Math.max(Math.abs(entry.column - anchor!.column), Math.abs(entry.row - anchor!.row)) <= FOOD_SPAWN_CONFIG.clusterRadius),
  );
});

test("advanceFoodWaveRuntime advances the spawn clock even when the board is already capped", () => {
  const context = createFoodSpawnContext({
    grid: createGrid(),
    blackHoles: [makeBlackHole()],
    snake: [cell(0, 0)],
    foods: [],
  });

  const result = advanceFoodWaveRuntime({
    context,
    currentFoodCount: FOOD_SPAWN_CONFIG.normalCap,
    currentTimeMs: FOOD_SPAWN_CONFIG.waveIntervalMs * 3 + 1,
    nextSpawnAtMs: FOOD_SPAWN_CONFIG.waveIntervalMs,
    foodWaveBag: ["single", "cluster"],
    config: createFoodWaveSpawnConfig(),
    random: () => 0,
  });

  assert.equal(result.spawnedFoods.length, 0);
  assert.deepEqual(result.nextFoodWaveBag, ["single", "cluster"]);
  assert.equal(result.nextSpawnAtMs, FOOD_SPAWN_CONFIG.waveIntervalMs * 4);
});
