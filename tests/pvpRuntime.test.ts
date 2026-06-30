import assert from "node:assert/strict";
import test from "node:test";

import { OPPOSITE_DIRECTIONS } from "../src/game/direction.ts";
import { advancePvpTick, createPvpBoardGrid, createPvpRuntime, PVP_INITIAL_DIRECTIONS, PVP_OPENING_SAFETY_TICKS, PVP_STARTING_LENGTH } from "../src/pvp/shared/pvpGame.ts";

test("online PVP starting lanes do not auto-collide before players can react", () => {
  const runtime = createPvpRuntime({
    seed: 123,
    startTick: 0,
    tickRate: 8,
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

  for (let index = 0; index < PVP_OPENING_SAFETY_TICKS; index += 1) {
    const result = advancePvpTick(runtime);
    assert.equal(result.gameOver, null, `unexpected gameOver on tick ${runtime.match.tick}`);
    assert.equal(runtime.match.phase, "playing");
    assert.equal(runtime.players.every((player) => player.lifecycle.phase === "playing"), true);
  }
});
