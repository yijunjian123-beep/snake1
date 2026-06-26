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
  value: string;
  placeholder: string;
  readOnly: boolean;
  dataset: Record<string, string>;
  style: ReturnType<typeof createStyle>;
  title: string;
  setAttribute(name: string, value: string): void;
  getAttribute(name: string): string | null;
} {
  const attributes = new Map<string, string>();

  return {
    textContent: "",
    hidden: false,
    disabled: false,
    value: "",
    placeholder: "",
    readOnly: false,
    dataset: Object.create(null),
    style: createStyle(),
    title: "",
    setAttribute(name: string, value: string): void {
      attributes.set(name, value);
    },
    getAttribute(name: string): string | null {
      return attributes.get(name) ?? null;
    },
  };
}

function createUi() {
  const entryActions = createFakeElement();
  const pvpRoomPanel = createFakeElement();
  const roomQueueStats = createFakeElement();
  const roomPlayersLabel = createFakeElement();
  const roomCodeField = createFakeElement();
  const readyRoomButton = createFakeElement();
  const cancelMatchmakingButton = createFakeElement();
  const copyRoomCodeButton = createFakeElement();
  const settlementActions = createFakeElement();

  entryActions.hidden = true;
  pvpRoomPanel.hidden = true;
  roomQueueStats.hidden = true;
  roomPlayersLabel.hidden = true;
  roomCodeField.hidden = true;
  readyRoomButton.hidden = true;
  cancelMatchmakingButton.hidden = true;
  copyRoomCodeButton.hidden = true;
  settlementActions.hidden = true;

  return {
    root: createFakeElement(),
    hudStrip: createFakeElement(),
    buildVersionLabel: createFakeElement(),
    pvpConnectionLabel: createFakeElement(),
    startPanel: createFakeElement(),
    panelPrimaryLabel: createFakeElement(),
    panelPrimaryValue: createFakeElement(),
    panelSecondaryLabel: createFakeElement(),
    panelMetaLabel: createFakeElement(),
    entryActions,
    pveButton: createFakeElement(),
    pvpButton: createFakeElement(),
    pvpRoomPanel,
    roomQueueStats,
    queueWaitLabel: createFakeElement(),
    queueOnlineLabel: createFakeElement(),
    queueCountLabel: createFakeElement(),
    roomPlayersLabel,
    roomCodeField,
    roomCodeInput: createFakeElement(),
    createRoomButton: createFakeElement(),
    joinRoomButton: createFakeElement(),
    readyRoomButton,
    cancelMatchmakingButton,
    copyRoomCodeButton,
    roomBackButton: createFakeElement(),
    roomStatusLabel: createFakeElement(),
    settlementActions,
    continueButton: createFakeElement(),
    mainMenuButton: createFakeElement(),
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
    match: {
      mode: "solo",
      phase: "playing",
      tick: 7,
      winnerId: null,
    },
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
  assert.equal(snapshot.match.tick, 7);
  assert.equal(snapshot.players[0]?.id, "p1");
  assert.deepEqual(snapshot.players[0]?.snake, snapshot.snake);
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
    buildVersion: "a1b2c3d4e5",
    pvpConnectionStatus: "connected",
    livesRemaining: 2,
    lastFps: 58,
    lastSimulationMs: 1.25,
    lastRenderMs: 3.5,
    size: createSize(),
    deathReason: "wall",
    reviving: true,
    reviveEndsAt: 6500,
    elapsed: 4000,
    lifeHeartCount: 3,
    match: {
      mode: "solo",
      phase: "reviving",
      tick: 0,
      winnerId: null,
    },
  });

  assert.equal(model.boardTop, "140px");
  assert.equal(model.panelPrimaryValue, "12/100");
  assert.equal(model.panelSecondaryLabel, "撞到墙壁了");
  assert.equal(model.panelMetaLabel, "3 秒后开始");
  assert.deepEqual(model.lifeHeartActiveStates, ["true", "true", "false"]);
  assert.equal(model.stateLabel, "复活中");
  assert.equal(model.fpsLabel, "58 FPS");
  assert.equal(model.perfLabel, "逻辑 1.3ms · 渲染 3.5ms");
  assert.equal(model.sizeLabel, "960 x 540 @2.0");
  assert.equal(model.buildVersionLabel, "build a1b2c3d");
  assert.equal(model.pvpConnectionLabel, "PVP connected");
  assert.equal(model.pvpConnectionState, "connected");
});

test("applyUiSyncModel writes the derived values into the UI cache and elements", () => {
  const ui = createUi();
  const state = createUiSyncState();
  const model = buildUiSyncModel({
    phase: "ready",
    shellView: "main-menu",
    grid: createGrid(),
    progress: {
      snakeLength: 4,
      coresEaten: 0,
      score: 0,
      elapsedTime: 0,
    },
    buildVersion: "dev",
    pvpConnectionStatus: "disconnected",
    livesRemaining: 3,
    lastFps: 0,
    lastSimulationMs: 0,
    lastRenderMs: 0,
    size: createSize(),
    deathReason: null,
    reviving: false,
    reviveEndsAt: 0,
    elapsed: 0,
    lifeHeartCount: 3,
    match: {
      mode: "solo",
      phase: "ready",
      tick: 0,
      winnerId: null,
    },
  });

  applyUiSyncModel(ui as never, state, model);

  assert.equal(ui.root.dataset.phase, "ready");
  assert.equal(ui.root.dataset.shellView, "main-menu");
  assert.equal(ui.root.style.getPropertyValue("--board-top"), "140px");
  assert.equal(ui.buildVersionLabel.textContent, "build dev");
  assert.equal(ui.pvpConnectionLabel.textContent, "PVP disconnected");
  assert.equal(ui.pvpConnectionLabel.dataset.state, "disconnected");
  assert.equal(ui.startPanel.hidden, false);
  assert.equal(ui.entryActions.hidden, false);
  assert.equal(ui.pvpRoomPanel.hidden, true);
  assert.equal(ui.settlementActions.hidden, true);
  assert.equal(ui.startButton.hidden, true);
  assert.equal(ui.panelPrimaryValue.textContent, "NEON SERPENT");
  assert.equal(ui.lifeHearts[2]?.dataset.active, "true");
  assert.equal(ui.stateLabel.textContent, "待机");
  assert.equal(ui.stateLabel.title, "逻辑 0.0ms · 渲染 0.0ms");
  assert.equal(state.startButtonText, "开始游戏");
});

test("buildUiSyncModel exposes local PVP player scores and winner state", () => {
  const model = buildUiSyncModel({
    phase: "gameOver",
    grid: createGrid(),
    progress: {
      snakeLength: 9,
      coresEaten: 3,
      score: 30,
      elapsedTime: 12,
    },
    buildVersion: "sha-abcdef1",
    pvpConnectionStatus: "connected",
    livesRemaining: 0,
    lastFps: 60,
    lastSimulationMs: 0.9,
    lastRenderMs: 2.1,
    size: createSize(),
    deathReason: "snake_body",
    reviving: false,
    reviveEndsAt: 0,
    elapsed: 12000,
    lifeHeartCount: 3,
    match: {
      mode: "local-pvp",
      phase: "gameOver",
      tick: 18,
      winnerId: "p2",
    },
    players: [
      {
        id: "p1",
        label: "P1",
        inputOrigin: "local",
        snakeLength: 7,
        score: 10,
        livesRemaining: 0,
        deathReason: "snake_body",
      },
      {
        id: "p2",
        label: "P2",
        inputOrigin: "scripted",
        snakeLength: 9,
        score: 20,
        livesRemaining: 3,
        deathReason: null,
      },
    ],
  });

  assert.equal(model.panelPrimaryValue, "P1 10/7 · P2 20/9");
  assert.equal(model.panelSecondaryLabel, "P2 获胜");
  assert.equal(model.panelMetaLabel, "P2 获胜。P1：10分 / 长度7 / 撞到蛇身体了；P2：20分 / 长度9 / 存活");
  assert.equal(model.lengthLabel, "P1 10/7 · P2 20/9");
  assert.equal(model.unlockTitleLabel, "LOCAL PVP");
  assert.equal(model.buildVersionLabel, "build sha-abc");
  assert.equal(model.pvpConnectionLabel, "PVP connected");
  assert.equal(model.unlockValueLabel, "P2 获胜");
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
