import assert from "node:assert/strict";
import test from "node:test";

import {
  BLACK_HOLE_CONFIG,
  chooseBlackHoleSpawnKind,
  getBlackHoleBandForCell,
  getBlackHoleCoreRadiusCells,
  getBlackHoleFoodAvoidRadiusCells,
  getBlackHoleInfluenceRadiusCells,
  getBlackHoleKindForSpawn,
  getDesiredBlackHoleCount,
} from "../src/game/blackHole.ts";
import type { BlackHole, BlackHoleKind, GridMetrics } from "../src/game/types.ts";
import { createPrng } from "./test-support.ts";

function makeGrid(): GridMetrics {
  return {
    columns: 24,
    rows: 16,
    cellSize: 24,
    offsetX: 0,
    offsetY: 0,
  };
}

function makeBlackHole(kind: BlackHoleKind, column = 12, row = 8): BlackHole {
  return {
    kind,
    cell: { column, row },
    seed: 7,
    spawnTime: 0,
    activateAt: 0,
  };
}

function makeProgress(snakeLength: number, score = 0): { snakeLength: number; coresEaten: number; score: number; elapsedTime: number } {
  return {
    snakeLength,
    coresEaten: 0,
    score,
    elapsedTime: 0,
  };
}

test("black hole config exposes three sizes and a max of four", () => {
  assert.equal(BLACK_HOLE_CONFIG.maxCount, 4);
  assert.equal(getBlackHoleCoreRadiusCells(makeBlackHole("small")), 0);
  assert.equal(getBlackHoleCoreRadiusCells(makeBlackHole("medium")), 0);
  assert.equal(getBlackHoleCoreRadiusCells(makeBlackHole("large")), 0);
  assert.equal(getBlackHoleInfluenceRadiusCells(makeBlackHole("small")), 3);
  assert.equal(getBlackHoleInfluenceRadiusCells(makeBlackHole("medium")), 6);
  assert.equal(getBlackHoleInfluenceRadiusCells(makeBlackHole("large")), 8);
  assert.equal(getBlackHoleFoodAvoidRadiusCells(makeBlackHole("small")), 1);
  assert.equal(getBlackHoleFoodAvoidRadiusCells(makeBlackHole("medium")), 2);
  assert.equal(getBlackHoleFoodAvoidRadiusCells(makeBlackHole("large")), 3);
});

test("black hole progression unlocks the larger kinds in sequence", () => {
  const grid = makeGrid();

  assert.equal(getDesiredBlackHoleCount(makeProgress(6)), 0);
  assert.equal(getBlackHoleKindForSpawn(makeProgress(7), grid), "small");
  assert.equal(getDesiredBlackHoleCount(makeProgress(10)), 1);
  assert.equal(getBlackHoleKindForSpawn(makeProgress(12, 80), grid), "medium");
  assert.equal(getDesiredBlackHoleCount(makeProgress(12, 80)), 2);
  assert.equal(getBlackHoleKindForSpawn(makeProgress(18, 160), grid), "large");
  assert.equal(getDesiredBlackHoleCount(makeProgress(18, 160)), 4);
});

test("late-stage spawning keeps one small and one large while the remaining slots stay random", () => {
  const seeded = createPrng(7);

  const earlyKinds: BlackHoleKind[] = [];
  const first = chooseBlackHoleSpawnKind(earlyKinds, 2, seeded);
  earlyKinds.push(first);
  const second = chooseBlackHoleSpawnKind(earlyKinds, 2, seeded);
  earlyKinds.push(second);

  assert.equal(first, "small");
  assert.equal(second, "medium");

  const lateKinds: BlackHoleKind[] = [];
  const lateFirst = chooseBlackHoleSpawnKind(lateKinds, 4, seeded);
  lateKinds.push(lateFirst);
  const lateSecond = chooseBlackHoleSpawnKind(lateKinds, 4, seeded);
  lateKinds.push(lateSecond);
  const lateThird = chooseBlackHoleSpawnKind(lateKinds, 4, () => 0.05);
  const lateFourth = chooseBlackHoleSpawnKind([...lateKinds, lateThird], 4, () => 0.95);

  assert.equal(lateFirst, "small");
  assert.equal(lateSecond, "large");
  assert.equal(lateThird, "small");
  assert.equal(lateFourth, "medium");
});

test("large black holes still collide on a 1x1 core but stretch the outer bands", () => {
  const large = makeBlackHole("large");
  const head = large.cell;

  assert.equal(getBlackHoleBandForCell(head, large, 1), "core");
  assert.equal(getBlackHoleBandForCell({ column: head.column + 2, row: head.row }, large, 1), "strong");
  assert.equal(getBlackHoleBandForCell({ column: head.column + 5, row: head.row }, large, 1), "medium");
  assert.equal(getBlackHoleBandForCell({ column: head.column + 8, row: head.row }, large, 1), "weak");
  assert.equal(getBlackHoleBandForCell({ column: head.column + 9, row: head.row }, large, 1), null);
});
