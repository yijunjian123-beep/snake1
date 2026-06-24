import assert from "node:assert/strict";
import test from "node:test";

import { createFoodSpawnContext, FOOD_SPAWN_CONFIG } from "../src/game/foodSpawn.ts";
import { createSpawnState } from "../src/game/stateFactory.ts";
import {
  updateFoodWaveSystem,
  updateStarBeastEffectSystem,
  updateStarCoreSystem,
} from "../src/game/transientSystems.ts";
import type { GridCell, GridMetrics, StarBeastEffect, StarCore } from "../src/game/types.ts";

function grid(): GridMetrics {
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

function starCore(overrides: Partial<StarCore> = {}): StarCore {
  return {
    id: 1,
    x: 3.5,
    y: 3.5,
    vx: 0,
    vy: 0,
    spawnTime: 0,
    magnetDelayMs: 0,
    magnetRadius: 0,
    lifetimeMs: 1000,
    value: 1,
    source: "regular",
    ...overrides,
  };
}

test("food wave system appends spawned foods and advances spawn runtime state", () => {
  const foods: GridCell[] = [];
  const state = createSpawnState();
  state.foodWaveBag = ["single"];
  state.foodWaveNextSpawnAt = FOOD_SPAWN_CONFIG.waveIntervalMs;

  updateFoodWaveSystem({
    context: createFoodSpawnContext({
      grid: grid(),
      blackHoles: [],
      snake: [cell(1, 1)],
      foods,
    }),
    foods,
    state,
    currentTimeMs: FOOD_SPAWN_CONFIG.waveIntervalMs,
    random: () => 0,
  });

  assert.equal(foods.length, 1);
  assert.deepEqual(state.foodWaveBag, []);
  assert.equal(state.foodWaveNextSpawnAt, FOOD_SPAWN_CONFIG.waveIntervalMs * 2);
});

test("star core system handles pickup, growth callback, score callback, and end-run guard", () => {
  const cores = [starCore({ x: 2.5, y: 2.5 })];
  const calls: string[] = [];

  updateStarCoreSystem({
    delta: 16,
    currentTime: 0.1,
    grid: grid(),
    snake: [cell(2, 2), cell(1, 2)],
    foods: [],
    starCores: cores,
    extendSnakeByOne: () => {
      calls.push("extend");
    },
    handleCoreCollection: (_currentTime, amount, advancesStarAttractorProgress, rewardBurstOrigin) => {
      calls.push(`collect:${amount}:${String(advancesStarAttractorProgress)}:${rewardBurstOrigin?.column},${rewardBurstOrigin?.row}`);
    },
    endRun: () => {
      calls.push("end");
    },
  });

  assert.deepEqual(cores, []);
  assert.deepEqual(calls, ["extend", "collect:1:false:2,2", "end"]);
});

test("star core system expires old cores and clamps moving cores inside the grid", () => {
  const cores = [
    starCore({ id: 1, lifetimeMs: 50, spawnTime: 0 }),
    starCore({ id: 2, x: 11.9, y: 7.9, vx: 100, vy: 100, lifetimeMs: 1000, spawnTime: 0 }),
  ];

  updateStarCoreSystem({
    delta: 100,
    currentTime: 0.1,
    grid: grid(),
    snake: [],
    foods: [cell(0, 0)],
    starCores: cores,
    extendSnakeByOne: () => {
      throw new Error("Should not collect without a player head.");
    },
    handleCoreCollection: () => {
      throw new Error("Should not collect without a player head.");
    },
    endRun: () => {
      throw new Error("Should not end while food remains.");
    },
  });

  assert.equal(cores.length, 1);
  assert.equal(cores[0]?.id, 2);
  assert.equal(cores[0]?.x, 11.65);
  assert.equal(cores[0]?.y, 7.65);
});

test("star beast effect system compacts expired effects in place", () => {
  const effects: StarBeastEffect[] = [
    { id: 1, cell: cell(1, 1), createdAt: 0, lifetimeMs: 100, seed: 1, length: 3, cause: "black_hole" },
    { id: 2, cell: cell(2, 2), createdAt: 0.1, lifetimeMs: 1000, seed: 2, length: 3, cause: "player_body" },
  ];
  const originalReference = effects;

  updateStarBeastEffectSystem({
    currentTime: 0.2,
    starBeastEffects: effects,
  });

  assert.equal(effects, originalReference);
  assert.deepEqual(effects.map((effect) => effect.id), [2]);
});
