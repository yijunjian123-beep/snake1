import assert from "node:assert/strict";
import test from "node:test";

import {
  cellCollidesWithPlayerBody,
  resolveMultiplayerSnakeCollisions,
  resolveSnakeCollision,
  type MultiplayerSnakeEvaluation,
  type PlayerBodyCollisionContext,
  type SnakeCollisionContext,
} from "../src/game/collisionSystem.ts";
import type { SnakeAdvanceEvaluation } from "../src/game/gameState.ts";
import type { GridCell, GridMetrics, StarBeast } from "../src/game/types.ts";

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

function makeEvaluation(overrides: Partial<SnakeAdvanceEvaluation> = {}): SnakeAdvanceEvaluation {
  return {
    nextHead: { column: 2, row: 2 },
    ateFoodIndex: -1,
    ateStarCoreIndex: -1,
    ateStarAttractorIndex: -1,
    growthBeforeMove: 0,
    shouldKeepTail: false,
    isOutOfBounds: false,
    collidesWithSelf: false,
    canAdvance: true,
    ...overrides,
  };
}

function makeCollisionContext(overrides: Partial<SnakeCollisionContext> = {}): SnakeCollisionContext {
  return {
    blackHoles: [],
    starBeasts: [],
    currentTime: 0,
    ...overrides,
  };
}

test("snake collision resolution keeps wall grace distinct from death reasons", () => {
  assert.deepEqual(resolveSnakeCollision(makeCollisionContext(), makeEvaluation({ isOutOfBounds: true }), "right"), {
    kind: "wall",
    direction: "right",
  });

  assert.deepEqual(resolveSnakeCollision(makeCollisionContext(), makeEvaluation({ collidesWithSelf: true }), "up"), {
    kind: "death",
    reason: "snake_body",
  });
});

test("snake collision resolution detects star beast bodies", () => {
  const starBeast: StarBeast = {
    id: 1,
    alive: true,
    body: [{ column: 2, row: 2 }],
    dir: "left",
    length: 1,
    state: "chase",
    moveTimer: 0,
    aiDecisionCooldown: 0,
    turnCommitTicks: 1,
    spawnGraceTime: 0,
    coreScanStepCount: 0,
    nextCoreHuntAt: 0,
    coreHuntUntil: 0,
    nextAttackAt: 0,
    attackUntil: 0,
    speedFactor: 1,
    aggroRadius: 4,
    loseAggroRadius: 6,
  };

  assert.deepEqual(resolveSnakeCollision(makeCollisionContext({ starBeasts: [starBeast] }), makeEvaluation(), "left"), {
    kind: "death",
    reason: "star_beast",
  });

  starBeast.alive = false;
  assert.deepEqual(resolveSnakeCollision(makeCollisionContext({ starBeasts: [starBeast] }), makeEvaluation(), "left"), {
    kind: "none",
  });
});

test("player body collision ignores the current head but catches occupied body cells", () => {
  const snake = [
    { column: 2, row: 2 },
    { column: 3, row: 2 },
  ];
  const context: PlayerBodyCollisionContext = {
    grid,
    snake,
    snakeOccupancy: buildOccupancy(snake),
  };

  assert.equal(cellCollidesWithPlayerBody(context, { column: 2, row: 2 }), false);
  assert.equal(cellCollidesWithPlayerBody(context, { column: 3, row: 2 }), true);
  assert.equal(cellCollidesWithPlayerBody(context, { column: -1, row: 2 }), false);
});

test("multiplayer collision resolution detects opponent body collisions", () => {
  const evaluations: MultiplayerSnakeEvaluation[] = [
    {
      playerId: "p1",
      direction: "right",
      evaluation: makeEvaluation({
        nextHead: { column: 4, row: 2 },
      }),
      snake: [
        { column: 3, row: 2 },
        { column: 2, row: 2 },
      ],
      willCommit: true,
    },
    {
      playerId: "p2",
      direction: "left",
      evaluation: makeEvaluation({
        nextHead: { column: 5, row: 3 },
      }),
      snake: [
        { column: 5, row: 3 },
        { column: 4, row: 2 },
        { column: 4, row: 3 },
      ],
      willCommit: true,
    },
  ];

  const results = resolveMultiplayerSnakeCollisions({
    ...makeCollisionContext(),
    grid,
  }, evaluations);

  assert.deepEqual(results[0]?.collision, {
    kind: "death",
    reason: "snake_body",
  });
  assert.deepEqual(results[1]?.collision, { kind: "none" });
});

test("multiplayer collision resolution blocks moving into a stationary opponent head", () => {
  const evaluations: MultiplayerSnakeEvaluation[] = [
    {
      playerId: "p1",
      direction: "right",
      evaluation: makeEvaluation({
        nextHead: { column: 4, row: 2 },
      }),
      snake: [
        { column: 3, row: 2 },
        { column: 2, row: 2 },
      ],
      willCommit: true,
    },
    {
      playerId: "p2",
      direction: "left",
      evaluation: makeEvaluation({
        nextHead: { column: 3, row: 2 },
      }),
      snake: [
        { column: 4, row: 2 },
        { column: 5, row: 2 },
      ],
      willCommit: false,
    },
  ];

  const results = resolveMultiplayerSnakeCollisions({
    ...makeCollisionContext(),
    grid,
  }, evaluations);

  assert.deepEqual(results[0]?.collision, {
    kind: "death",
    reason: "snake_body",
  });
  assert.deepEqual(results[1]?.collision, { kind: "none" });
});

test("multiplayer collision resolution detects head-to-head collisions", () => {
  const evaluations: MultiplayerSnakeEvaluation[] = [
    {
      playerId: "p1",
      direction: "right",
      evaluation: makeEvaluation({
        nextHead: { column: 3, row: 2 },
      }),
      snake: [{ column: 2, row: 2 }],
      willCommit: true,
    },
    {
      playerId: "p2",
      direction: "left",
      evaluation: makeEvaluation({
        nextHead: { column: 3, row: 2 },
      }),
      snake: [{ column: 4, row: 2 }],
      willCommit: true,
    },
  ];

  const results = resolveMultiplayerSnakeCollisions({
    ...makeCollisionContext(),
    grid,
  }, evaluations);

  assert.deepEqual(results.map((result) => result.collision), [
    {
      kind: "death",
      reason: "head_to_head",
    },
    {
      kind: "death",
      reason: "head_to_head",
    },
  ]);
});

test("multiplayer pickup conflict marks one winner without killing either player", () => {
  const evaluations: MultiplayerSnakeEvaluation[] = [
    {
      playerId: "p1",
      direction: "right",
      evaluation: makeEvaluation({
        nextHead: { column: 3, row: 2 },
        ateFoodIndex: 0,
      }),
      snake: [{ column: 2, row: 2 }],
      willCommit: true,
    },
    {
      playerId: "p2",
      direction: "left",
      evaluation: makeEvaluation({
        nextHead: { column: 3, row: 3 },
        ateFoodIndex: 0,
      }),
      snake: [{ column: 4, row: 3 }],
      willCommit: true,
    },
  ];

  const results = resolveMultiplayerSnakeCollisions({
    ...makeCollisionContext(),
    grid,
  }, evaluations);

  assert.deepEqual(results.map((result) => result.collision), [{ kind: "none" }, { kind: "none" }]);
  assert.deepEqual(results.map((result) => result.pickupConflict), [false, true]);
});
