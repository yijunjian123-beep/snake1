import assert from "node:assert/strict";
import test from "node:test";

import { advancePvpTick, createPvpBoardGrid, createPvpRuntime } from "../src/pvp/shared/pvpGame.ts";

test("online PVP starting lanes do not auto-collide before players can react", () => {
  const runtime = createPvpRuntime({
    seed: 123,
    startTick: 0,
    tickRate: 8,
    inputDelayTicks: 2,
    grid: createPvpBoardGrid(),
  });

  assert.notEqual(runtime.players[0].snake[0]?.row, runtime.players[1].snake[0]?.row);
  assert.equal(runtime.players[0].movement.direction, "right");
  assert.equal(runtime.players[1].movement.direction, "left");

  for (let index = 0; index < 10; index += 1) {
    const result = advancePvpTick(runtime);
    assert.equal(result.gameOver, null);
    assert.equal(runtime.match.phase, "playing");
  }
});
