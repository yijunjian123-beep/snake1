import assert from "node:assert/strict";
import test from "node:test";

import {
  buildFoodSpawnContext,
  getReviveBlockedCells,
  isCurrentPlacementValid,
} from "../src/game/spawnRuntime.ts";
import type {
  BlackHole,
  GridCell,
  GridMetrics,
  StarAttractor,
  StarBeast,
  StarCore,
} from "../src/game/types.ts";

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

function blackHole(overrides: Partial<BlackHole> = {}): BlackHole {
  return {
    kind: "small",
    cell: cell(8, 3),
    seed: 1,
    spawnTime: 0,
    activateAt: 0,
    ...overrides,
  };
}

function starAttractor(overrides: Partial<StarAttractor> = {}): StarAttractor {
  return {
    id: 1,
    cell: cell(7, 4),
    spawnTime: 0,
    seed: 2,
    ...overrides,
  };
}

function starBeast(overrides: Partial<StarBeast> = {}): StarBeast {
  return {
    id: 2,
    alive: true,
    body: [cell(5, 5), cell(4, 5)],
    dir: "right",
    length: 2,
    state: "patrol",
    moveTimer: 0,
    aiDecisionCooldown: 0,
    turnCommitTicks: 0,
    spawnGraceTime: 0,
    coreScanStepCount: 0,
    nextCoreHuntAt: 0,
    coreHuntUntil: 0,
    nextAttackAt: 0,
    attackUntil: 0,
    speedFactor: 1,
    aggroRadius: 1,
    loseAggroRadius: 2,
    ...overrides,
  };
}

function starCore(overrides: Partial<StarCore> = {}): StarCore {
  return {
    id: 3,
    x: 6.5,
    y: 2.5,
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

test("spawn runtime builds shared food and revive blocked cells from current entities", () => {
  const snake = [cell(2, 2), cell(1, 2)];
  const foods = [cell(3, 3)];
  const blackHoles = [blackHole()];
  const starAttractors = [starAttractor()];
  const starBeasts = [starBeast()];
  const starCores = [starCore()];
  const extraBlockedCells = [cell(9, 1)];

  const foodContext = buildFoodSpawnContext({
    grid: grid(),
    blackHoles,
    snake,
    foods,
    starAttractors,
    starBeasts,
    starCores,
    includeStarAttractors: true,
    extraBlockedCells,
  });

  assert.deepEqual(
    foodContext.occupiedCells,
    [
      ...snake,
      ...foods,
      starAttractors[0]!.cell,
      ...starBeasts[0]!.body,
      cell(6, 2),
      blackHoles[0]!.cell,
      ...extraBlockedCells,
    ],
  );

  assert.deepEqual(
    getReviveBlockedCells({
      blackHoles,
      snake,
      foods,
      starAttractors,
      starBeasts,
      starCores,
      includeStarAttractors: false,
    }),
    [
      ...snake,
      ...foods,
      ...starBeasts[0]!.body,
      cell(6, 2),
      blackHoles[0]!.cell,
    ],
  );
});

test("spawn runtime placement validation rejects overlapped and invalid entities", () => {
  const base = {
    grid: grid(),
    blackHoles: [blackHole()],
    snake: [cell(2, 2), cell(1, 2)],
    foods: [cell(3, 3)],
    starAttractors: [starAttractor()],
    starBeasts: [starBeast()],
    starCores: [starCore()],
    includeStarAttractors: true,
  };

  assert.equal(isCurrentPlacementValid(base), true);
  assert.equal(isCurrentPlacementValid({ ...base, foods: [cell(2, 2)] }), false);
  assert.equal(isCurrentPlacementValid({ ...base, starCores: [starCore({ x: 3.5, y: 3.5 })] }), false);
  assert.equal(isCurrentPlacementValid({ ...base, blackHoles: [blackHole(), blackHole()] }), false);
  assert.equal(isCurrentPlacementValid({ ...base, starBeasts: [starBeast({ body: [cell(3, 3)] })] }), false);
  assert.equal(isCurrentPlacementValid({ ...base, snake: [cell(12, 2)] }), false);
});
