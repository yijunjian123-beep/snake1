import assert from "node:assert/strict";
import test from "node:test";

import { OPPOSITE_DIRECTIONS } from "../src/game/direction.ts";
import type { Direction, GridCell } from "../src/game/types.ts";
import {
  advancePvpTick,
  createPvpBoardGrid,
  createPvpRuntime,
  getPvpMovementTicksPerStep,
  PVP_INITIAL_DIRECTIONS,
  PVP_OPENING_SAFETY_STEPS,
  PVP_STARTING_LENGTH,
  PVP_TARGET_STEP_MS,
  type PvpRuntimeState,
} from "../src/pvp/shared/pvpGame.ts";

test("online PVP starting lanes do not auto-collide before players can react", () => {
  for (const tickRate of [12, 20, 60]) {
    const runtime = createPvpRuntime({
      seed: 123,
      startTick: 0,
      tickRate,
      inputDelayTicks: 2,
      grid: createPvpBoardGrid(),
    });

    assert.notEqual(runtime.players[0].snake[0]?.row, runtime.players[1].snake[0]?.row);
    assert.notEqual(runtime.players[0].movement.direction, OPPOSITE_DIRECTIONS[runtime.players[1].movement.direction]);

    const occupiedCells = new Set<string>();

    for (const player of runtime.players) {
      const inputState = runtime.inputState.playersById.get(player.id);

      assert.equal(player.snake.length, PVP_STARTING_LENGTH);
      assert.equal(player.movement.direction, PVP_INITIAL_DIRECTIONS[player.id]);
      assert.equal(inputState?.initialDirection, PVP_INITIAL_DIRECTIONS[player.id]);

      for (const cell of player.snake) {
        assert.ok(cell.column >= 0 && cell.column < runtime.grid.columns);
        assert.ok(cell.row >= 0 && cell.row < runtime.grid.rows);

        const key = `${cell.column}:${cell.row}`;
        assert.equal(occupiedCells.has(key), false, `duplicate starting cell ${key}`);
        occupiedCells.add(key);
      }
    }

    for (let index = 0; index < tickRate * 10; index += 1) {
      const result = advancePvpTick(runtime);
      assert.equal(result.gameOver, null, `unexpected gameOver at ${tickRate} Hz on tick ${runtime.match.tick}`);
      assert.equal(runtime.match.phase, "playing");
      assert.equal(runtime.players.every((player) => player.lifecycle.phase === "playing"), true);
    }

    assert.ok(runtime.match.movementStep <= PVP_OPENING_SAFETY_STEPS);
  }
});

test("online PVP movement cadence stays near the target step duration at different tick rates", () => {
  for (const tickRate of [12, 20, 60]) {
    const runtime = createPvpRuntime({
      seed: 123,
      startTick: 0,
      tickRate,
      inputDelayTicks: 2,
      grid: createPvpBoardGrid(),
    });
    const firstHead = runtime.players[0].snake[0];

    assert.ok(firstHead);
    assert.equal(runtime.movementTicksPerStep, getPvpMovementTicksPerStep(tickRate));

    for (let index = 1; index < runtime.movementTicksPerStep; index += 1) {
      const result = advancePvpTick(runtime);

      assert.equal(result.gameOver, null);
      assert.deepEqual(runtime.players[0].snake[0], firstHead);
      assert.equal(runtime.match.movementStep, 0);
    }

    const result = advancePvpTick(runtime);
    const nextHead = runtime.players[0].snake[0];
    const stepMs = runtime.movementTicksPerStep * (1_000 / tickRate);

    assert.equal(result.gameOver, null);
    assert.deepEqual(nextHead, { column: firstHead.column + 1, row: firstHead.row });
    assert.equal(runtime.match.movementStep, 1);
    assert.equal(Math.abs(stepMs - PVP_TARGET_STEP_MS) <= 40, true);
  }
});

test("online PVP collisions settle on movement steps instead of every server tick", () => {
  const runtime = createPvpRuntime({
    seed: 123,
    startTick: 0,
    tickRate: 20,
    inputDelayTicks: 2,
    grid: createPvpBoardGrid(),
  });

  setRuntimePlayer(runtime, "p1", [{ column: 0, row: 2 }], "left");
  setRuntimePlayer(runtime, "p2", [{ column: 10, row: 10 }], "right");

  for (let index = 1; index < runtime.movementTicksPerStep; index += 1) {
    const result = advancePvpTick(runtime);

    assert.equal(result.gameOver, null);
    assert.equal(runtime.match.phase, "playing");
  }

  const result = advancePvpTick(runtime);

  assert.deepEqual(result.gameOver, {
    type: "gameOver",
    winner: "p2",
    reason: "wall",
    finalTick: runtime.movementTicksPerStep,
  });
  assert.equal(runtime.match.phase, "gameOver");
});

function setRuntimePlayer(
  runtime: PvpRuntimeState,
  playerSlot: "p1" | "p2",
  snake: readonly GridCell[],
  direction: Direction,
): void {
  const player = runtime.players.find((candidate) => candidate.id === playerSlot);

  assert.ok(player);
  player.snake = snake.map((cell) => ({ ...cell }));
  player.movement.direction = direction;
  player.movement.directionQueue = [];
  player.movement.pendingGrowthSegments = 0;
  player.lifecycle.phase = "playing";
  player.lifecycle.deathReason = null;
  player.movement.snakeOccupancy = new Uint8Array(runtime.grid.columns * runtime.grid.rows);

  for (const segment of player.snake) {
    player.movement.snakeOccupancy[segment.row * runtime.grid.columns + segment.column] = 1;
  }
}
