import assert from "node:assert/strict";
import test from "node:test";

import {
  canConfirmRevive,
  enterGameOverState,
  resolvePlayerDeathTransition,
  resolveReviveCountdown,
  startReviveCountdown,
} from "../src/game/reviveSystem.ts";
import { createLifecycleState } from "../src/game/stateFactory.ts";

test("player death spends one life and enters revive prompt before final life", () => {
  const lifecycle = createLifecycleState("playing");

  const transition = resolvePlayerDeathTransition(lifecycle, "snake_body");

  assert.equal(transition, "revivePrompt");
  assert.equal(lifecycle.phase, "revivePrompt");
  assert.equal(lifecycle.livesRemaining, 2);
  assert.equal(lifecycle.deathReason, "snake_body");
  assert.equal(lifecycle.reviving, false);
  assert.equal(lifecycle.reviveEndsAt, 0);
});

test("player death on final life enters game over state", () => {
  const lifecycle = createLifecycleState("playing");
  lifecycle.livesRemaining = 1;

  const transition = resolvePlayerDeathTransition(lifecycle, "black_hole");

  assert.equal(transition, "gameOver");
  assert.equal(lifecycle.phase, "gameOver");
  assert.equal(lifecycle.livesRemaining, 0);
  assert.equal(lifecycle.deathReason, "black_hole");
  assert.equal(lifecycle.reviving, false);
});

test("revive confirmation starts and completes a countdown", () => {
  const lifecycle = createLifecycleState("revivePrompt");
  lifecycle.livesRemaining = 2;

  assert.equal(canConfirmRevive(lifecycle), true);
  assert.equal(startReviveCountdown(lifecycle, 1200, 3000), true);
  assert.equal(lifecycle.phase, "reviving");
  assert.equal(lifecycle.reviving, true);
  assert.equal(lifecycle.reviveEndsAt, 4200);

  assert.equal(resolveReviveCountdown(lifecycle, 4199), "waiting");
  assert.equal(lifecycle.phase, "reviving");

  assert.equal(resolveReviveCountdown(lifecycle, 4200), "completed");
  assert.equal(lifecycle.phase, "playing");
  assert.equal(lifecycle.reviving, false);
  assert.equal(lifecycle.reviveEndsAt, 0);
});

test("revive and game-over transitions ignore invalid phases without side effects", () => {
  const lifecycle = createLifecycleState("playing");

  assert.equal(canConfirmRevive(lifecycle), false);
  assert.equal(startReviveCountdown(lifecycle, 10), false);
  assert.equal(resolveReviveCountdown(lifecycle, 10), "ignored");
  assert.equal(lifecycle.phase, "playing");

  enterGameOverState(lifecycle, "wall");
  assert.equal(resolvePlayerDeathTransition(lifecycle, "snake_body"), "ignored");
  assert.equal(lifecycle.phase, "gameOver");
  assert.equal(lifecycle.deathReason, "wall");
});
