import assert from "node:assert/strict";
import test from "node:test";

import { createSpawnState } from "../src/game/stateFactory.ts";
import {
  absorbStarAttractorSystem,
  getStarAttractorAbsorbLifetimeMs,
} from "../src/game/starAttractorSystem.ts";
import type { GridCell, StarAttractorEffect } from "../src/game/types.ts";

test("star attractor absorb system stays inert when disabled", () => {
  const foods: GridCell[] = [{ column: 1, row: 1 }];
  const effects: StarAttractorEffect[] = [];
  const state = createSpawnState();
  const result = absorbStarAttractorSystem({
    enabled: false,
    attractorCell: { column: 3, row: 3 },
    currentTime: 12,
    foods,
    snakeHead: { column: 2, row: 2 },
    birthCell: { column: 0, row: 0 },
    starAttractorEffects: effects,
    spawnState: state,
  });

  assert.equal(result, null);
  assert.deepEqual(foods, [{ column: 1, row: 1 }]);
  assert.equal(effects.length, 0);
  assert.equal(state.nextStarAttractorEffectId, 1);
});

test("star attractor absorb system clears foods and appends a cloned effect", () => {
  const foods: GridCell[] = [
    { column: 1, row: 1 },
    { column: 2, row: 1 },
  ];
  const effects: StarAttractorEffect[] = [];
  const state = createSpawnState();
  const result = absorbStarAttractorSystem({
    enabled: true,
    attractorCell: { column: 3, row: 3 },
    currentTime: 12,
    foods,
    snakeHead: { column: 2, row: 2 },
    birthCell: { column: 0, row: 0 },
    starAttractorEffects: effects,
    spawnState: state,
  });

  assert.equal(result?.absorbCount, 2);
  assert.equal(result?.pendingGrowthDelta, 2);
  assert.deepEqual(foods, []);
  assert.equal(effects.length, 1);
  assert.deepEqual(effects[0]?.origin, { column: 3, row: 3 });
  assert.deepEqual(effects[0]?.target, { column: 2, row: 2 });
  assert.deepEqual(effects[0]?.absorbedCells, [
    { column: 1, row: 1 },
    { column: 2, row: 1 },
  ]);
  assert.equal(state.nextStarAttractorEffectId, 2);

  foods.push({ column: 7, row: 7 });
  assert.deepEqual(effects[0]?.absorbedCells, [
    { column: 1, row: 1 },
    { column: 2, row: 1 },
  ]);
});

test("star attractor absorb lifetime keeps existing visual thresholds", () => {
  assert.equal(getStarAttractorAbsorbLifetimeMs(0), 620);
  assert.equal(getStarAttractorAbsorbLifetimeMs(7), 620);
  assert.equal(getStarAttractorAbsorbLifetimeMs(8), 740);
  assert.equal(getStarAttractorAbsorbLifetimeMs(12), 860);
});
