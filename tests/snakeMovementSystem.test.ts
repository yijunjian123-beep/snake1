import assert from "node:assert/strict";
import test from "node:test";

import {
  commitSnakeMovement,
  evaluateSnakeAdvance,
  pickAdvanceDirection,
  type SnakeMovementCommitState,
  type SnakeMovementEvaluationContext,
} from "../src/game/snakeMovementSystem.ts";
import type { GridCell, GridMetrics, StarAttractor, StarCore } from "../src/game/types.ts";

const grid: GridMetrics = {
  columns: 8,
  rows: 8,
  cellSize: 16,
  offsetX: 0,
  offsetY: 0,
};

function buildOccupancy(snake: readonly GridCell[]): Uint8Array {
  const occupancy = new Uint8Array(grid.columns * grid.rows);

  for (const cell of snake) {
    occupancy[cell.row * grid.columns + cell.column] += 1;
  }

  return occupancy;
}

function makeContext(overrides: Partial<SnakeMovementEvaluationContext> = {}): SnakeMovementEvaluationContext {
  const snake = overrides.snake ?? [
    { column: 2, row: 1 },
    { column: 2, row: 2 },
    { column: 1, row: 2 },
    { column: 1, row: 1 },
  ];

  return {
    grid,
    snake,
    foods: [],
    starCores: [],
    starAttractors: [],
    snakeOccupancy: buildOccupancy(snake),
    pendingGrowthSegments: 0,
    includeStarAttractors: false,
    ...overrides,
  };
}

function makeCommitState(snake: GridCell[], pendingGrowthSegments = 0): SnakeMovementCommitState {
  return {
    grid,
    snake: snake.map((cell) => ({ ...cell })),
    snakeOccupancy: buildOccupancy(snake),
    pendingGrowthSegments,
  };
}

test("snake movement evaluation allows stepping into the departing tail when not growing", () => {
  const evaluation = evaluateSnakeAdvance(makeContext(), "left");

  assert.equal(evaluation?.canAdvance, true);
  assert.equal(evaluation?.collidesWithSelf, false);
  assert.deepEqual(evaluation?.nextHead, { column: 1, row: 1 });
  assert.equal(evaluation?.shouldKeepTail, false);
});

test("snake movement evaluation blocks the tail cell when growth keeps the tail", () => {
  const context = makeContext({
    pendingGrowthSegments: 1,
  });
  const evaluation = evaluateSnakeAdvance(context, "left");

  assert.equal(evaluation?.canAdvance, false);
  assert.equal(evaluation?.collidesWithSelf, true);
  assert.equal(evaluation?.shouldKeepTail, true);
});

test("snake movement evaluation detects food, star core, and star attractor pickups", () => {
  const foods: GridCell[] = [{ column: 3, row: 1 }];
  const starCores: StarCore[] = [{
    id: 1,
    x: 2.5,
    y: 0.5,
    vx: 0,
    vy: 0,
    spawnTime: 0,
    magnetDelayMs: 0,
    magnetRadius: 0,
    lifetimeMs: 1000,
    value: 1,
    source: "regular",
  }];
  const starAttractors: StarAttractor[] = [{
    id: 1,
    cell: { column: 1, row: 1 },
    spawnTime: 0,
    seed: 1,
  }];

  assert.equal(evaluateSnakeAdvance(makeContext({ foods }), "right")?.ateFoodIndex, 0);
  assert.equal(evaluateSnakeAdvance(makeContext({ starCores }), "up")?.ateStarCoreIndex, 0);
  assert.equal(evaluateSnakeAdvance(makeContext({ starAttractors, includeStarAttractors: true }), "left")?.ateStarAttractorIndex, 0);
  assert.equal(evaluateSnakeAdvance(makeContext({ starAttractors, includeStarAttractors: false }), "left")?.ateStarAttractorIndex, -1);
});

test("advance direction picker falls back to a legal recovery direction", () => {
  const snake = [
    { column: 0, row: 2 },
    { column: 1, row: 2 },
    { column: 1, row: 3 },
  ];
  const context = makeContext({
    snake,
    snakeOccupancy: buildOccupancy(snake),
  });

  assert.deepEqual(pickAdvanceDirection(context, "left", ["up"]), {
    direction: "up",
    primaryBlocked: true,
  });
});

test("snake movement commit updates body, occupancy, growth, and pickup result", () => {
  const snake = [
    { column: 2, row: 1 },
    { column: 2, row: 2 },
    { column: 1, row: 2 },
    { column: 1, row: 1 },
  ];
  const context = makeContext({
    snake,
    foods: [{ column: 3, row: 1 }],
  });
  const evaluation = evaluateSnakeAdvance(context, "right");

  assert.ok(evaluation);

  const state = makeCommitState(snake);
  const result = commitSnakeMovement(state, evaluation);

  assert.deepEqual(result, {
    nextHead: { column: 3, row: 1 },
    pendingGrowthSegments: 0,
    pickup: {
      kind: "food",
      index: 0,
    },
  });
  assert.deepEqual(state.snake, [
    { column: 3, row: 1 },
    { column: 2, row: 1 },
    { column: 2, row: 2 },
    { column: 1, row: 2 },
    { column: 1, row: 1 },
  ]);
  assert.equal(state.snakeOccupancy[1 * grid.columns + 3], 1);
  assert.equal(state.snakeOccupancy[1 * grid.columns + 1], 1);
});

test("snake movement commit releases the tail unless growth keeps it", () => {
  const snake = [
    { column: 2, row: 1 },
    { column: 2, row: 2 },
    { column: 1, row: 2 },
    { column: 1, row: 1 },
  ];
  const moveEvaluation = evaluateSnakeAdvance(makeContext({ snake }), "right");
  const growthEvaluation = evaluateSnakeAdvance(makeContext({ snake, pendingGrowthSegments: 1 }), "right");

  assert.ok(moveEvaluation);
  assert.ok(growthEvaluation);

  const moveState = makeCommitState(snake);
  const growthState = makeCommitState(snake, 1);

  commitSnakeMovement(moveState, moveEvaluation);
  commitSnakeMovement(growthState, growthEvaluation);

  assert.equal(moveState.snake.length, 4);
  assert.equal(moveState.snakeOccupancy[1 * grid.columns + 1], 0);
  assert.equal(moveState.pendingGrowthSegments, 0);

  assert.equal(growthState.snake.length, 5);
  assert.equal(growthState.snakeOccupancy[1 * grid.columns + 1], 1);
  assert.equal(growthState.pendingGrowthSegments, 0);
});
