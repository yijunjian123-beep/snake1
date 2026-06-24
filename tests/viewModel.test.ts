import assert from "node:assert/strict";
import test from "node:test";

import type { CanvasSize, GridCell, GridMetrics } from "../src/game/types.ts";
import {
  applyTickerUiModel,
  applyUiSyncModel,
  buildGameSnapshot,
  buildTickerUiModel,
  buildUiSyncModel,
  createUiSyncState,
} from "../src/game/viewModel.ts";

function createGrid(): GridMetrics {
  return {
    columns: 24,
    rows: 16,
    cellSize: 24,
    offsetX: 12,
    offsetY: 140,
  };
}

function createSize(): CanvasSize {
  return {
    width: 960,
    height: 540,
    dpr: 2,
    pixelWidth: 1920,
    pixelHeight: 1080,
  };
}

function createCell(column: number, row: number): GridCell {
  return { column, row };
}

function createStyle(): { opacity: string; setProperty(name: string, value: string): void; getPropertyValue(name: string): string } {
  const values = new Map<string, string>();

  return {
    opacity: "",
    setProperty(name: string, value: string): void {
      values.set(name, value);
    },
    getPropertyValue(name: string): string {
      return values.get(name) ?? "";
    },
  };
}

function createFakeElement(): {
  textContent: string;
  hidden: boolean;
  disabled: boolean;
  dataset: Record<string, string>;
  style: ReturnType<typeof createStyle>;
  setAttribute(name: string, value: string): void;
  getAttribute(name: string): string | null;
} {
  const attributes = new Map<string, string>();

  return {
    textContent: "",
    hidden: false,
    disabled: false,
    dataset: Object.create(null),
    style: createStyle(),
    setAttribute(name: string, value: string): void {
      attributes.set(name, value);
    },
    getAttribute(name: string): string | null {
      return attributes.get(name) ?? null;
    },
  };
}

function createUi() {
  return {
    root: createFakeElement(),
    hudStrip: createFakeElement(),
    startPanel: createFakeElement(),
    panelPrimaryLabel: createFakeElement(),
    panelPrimaryValue: createFakeElement(),
    panelSecondaryLabel: createFakeElement(),
    panelMetaLabel: createFakeElement(),
    lifeHearts: [createFakeElement(), createFakeElement(), createFakeElement()],
    lengthLabel: createFakeElement(),
    unlockTitleLabel: createFakeElement(),
    unlockValueLabel: createFakeElement(),
    tickerCurrentLabel: createFakeElement(),
    tickerNextLabel: createFakeElement(),
    stateLabel: createFakeElement(),
    fpsLabel: createFakeElement(),
    sizeLabel: createFakeElement(),
    startButton: createFakeElement(),
    pauseButton: createFakeElement(),
    touchControls: {
      container: createFakeElement(),
      joystick: createFakeElement(),
      joystickKnob: createFakeElement(),
      joystickLine: createFakeElement(),
      boostButton: createFakeElement(),
    },
  };
}

test("buildGameSnapshot keeps star attractors gated and clones reward burst origin", () => {
  const rewardBurstOrigin = createCell(9, 7);
  const snapshot = buildGameSnapshot({
    phase: "playing",
    grid: createGrid(),
    snake: [createCell(10, 8), createCell(9, 8)],
    foods: [createCell(6, 6)],
    starAttractors: [{ id: 1, cell: createCell(4, 4), spawnTime: 10, seed: 2 }],
    starAttractorEffects: [],
    starBeasts: [],
    starCores: [],
    starBeastEffects: [],
    blackHoles: [],
    blackHoleAlert: null,
    blackHoleCue: null,
    rewardBurstOrigin,
    score: 20,
    highScore: 50,
    livesRemaining: 2,
    deathReason: null,
    direction: "right",
    speedMode: "accelerate",
    speedMultiplier: 2.6,
    speedCue: {
      mode: "accelerate",
      anchor: createCell(10, 8),
      startedAt: 100,
    },
    reviving: false,
    reviveEndsAt: 0,
    elapsed: 400,
    wallGrace: null,
    includeStarAttractor: false,
  });

  assert.deepEqual(snapshot.starAttractors, []);
  assert.equal(snapshot.speedCue?.fadeProgress, 0.2);
  assert.notEqual(snapshot.rewardBurstOrigin, rewardBurstOrigin);
  assert.deepEqual(snapshot.rewardBurstOrigin, rewardBurstOrigin);
});

test("buildUiSyncModel returns the expected revive prompt and HUD values", () => {
  const model = buildUiSyncModel({
    phase: "reviving",
    grid: createGrid(),
    progress: {
      snakeLength: 12,
      coresEaten: 8,
      score: 120,
      elapsedTime: 18,
    },
    livesRemaining: 2,
    lastFps: 58,
    size: createSize(),
    deathReason: "wall",
    reviving: true,
    reviveEndsAt: 6500,
    elapsed: 4000,
    lifeHeartCount: 3,
  });

  assert.equal(model.boardTop, "140px");
  assert.equal(model.panelPrimaryValue, "12/100");
  assert.equal(model.panelSecondaryLabel, "撞到墙壁了");
  assert.equal(model.panelMetaLabel, "3 秒后开始");
  assert.deepEqual(model.lifeHeartActiveStates, ["true", "true", "false"]);
  assert.equal(model.stateLabel, "复活中");
  assert.equal(model.fpsLabel, "58 FPS");
  assert.equal(model.sizeLabel, "960 x 540 @2.0");
});

test("applyUiSyncModel writes the derived values into the UI cache and elements", () => {
  const ui = createUi();
  const state = createUiSyncState();
  const model = buildUiSyncModel({
    phase: "ready",
    grid: createGrid(),
    progress: {
      snakeLength: 4,
      coresEaten: 0,
      score: 0,
      elapsedTime: 0,
    },
    livesRemaining: 3,
    lastFps: 0,
    size: createSize(),
    deathReason: null,
    reviving: false,
    reviveEndsAt: 0,
    elapsed: 0,
    lifeHeartCount: 3,
  });

  applyUiSyncModel(ui as never, state, model);

  assert.equal(ui.root.dataset.phase, "ready");
  assert.equal(ui.root.style.getPropertyValue("--board-top"), "140px");
  assert.equal(ui.startPanel.hidden, false);
  assert.equal(ui.startButton.textContent, "开始游戏");
  assert.equal(ui.startButton.getAttribute("aria-label"), "开始游戏");
  assert.equal(ui.panelPrimaryValue.textContent, "NEON SERPENT");
  assert.equal(ui.lifeHearts[2]?.dataset.active, "true");
  assert.equal(ui.stateLabel.textContent, "待机");
  assert.equal(state.startButtonText, "开始游戏");
});

test("buildTickerUiModel and applyTickerUiModel produce crossfade text and opacity", () => {
  const ui = createUi();
  const state = createUiSyncState();
  const model = buildTickerUiModel({ elapsed: 10000 - 360 });

  applyTickerUiModel(ui as never, state, model);

  assert.equal(ui.tickerCurrentLabel.textContent, "长按Shift减速，长按方向键加速");
  assert.equal(ui.tickerNextLabel.textContent, "注意，黑洞会把你吸入深渊");
  assert.equal(ui.tickerCurrentLabel.style.opacity, "0.500");
  assert.equal(ui.tickerNextLabel.style.opacity, "0.500");
});
