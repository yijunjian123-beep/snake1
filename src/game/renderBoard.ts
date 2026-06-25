import { fillRoundedRect } from "./renderCanvasUtils";
import type { RenderQualityState } from "./renderQuality";
import type { CanvasSize, GameSnapshot, GridMetrics } from "./types";

const TAU = Math.PI * 2;

export function drawGrid(context: CanvasRenderingContext2D, size: CanvasSize, time: number): void {
  const spacing = Math.max(34, Math.min(62, size.width / 17));
  const horizon = size.height * 0.62;
  const breathing = 0.86 + Math.sin(time * 0.45) * 0.14;
  const microDrift = Math.sin(time * 0.35) * 1.4;

  context.save();
  context.lineCap = "round";
  context.globalCompositeOperation = "lighter";

  for (let pass = 0; pass < 2; pass += 1) {
    context.lineWidth = pass === 0 ? 3.5 : 1;
    context.shadowBlur = (pass === 0 ? 18 : 7) * breathing;
    context.shadowColor = pass === 0 ? "#00f5ff" : "#ff2bd6";
    context.strokeStyle = pass === 0 ? "rgba(0, 245, 255, 0.16)" : "rgba(143, 251, 255, 0.46)";

    for (let x = -spacing * 2; x <= size.width + spacing * 2; x += spacing) {
      const lowerX = (x - size.width * 0.5) * 2.55 + size.width * 0.5 + microDrift;
      context.globalAlpha = (pass === 0 ? 0.34 : 0.48) * breathing;
      context.beginPath();
      context.moveTo(x + microDrift * 0.18, horizon);
      context.lineTo(lowerX, size.height);
      context.stroke();
    }

    for (let y = horizon; y <= size.height + spacing; y += spacing) {
      const perspective = (y - horizon) / Math.max(1, size.height - horizon);
      const lineY = y + microDrift * perspective;
      context.globalAlpha = ((pass === 0 ? 0.12 : 0.22) + perspective * (pass === 0 ? 0.2 : 0.34)) * breathing;
      context.beginPath();
      context.moveTo(0, lineY);
      context.lineTo(size.width, lineY);
      context.stroke();
    }
  }

  context.restore();
}

export function drawCoreGlow(
  context: CanvasRenderingContext2D,
  size: CanvasSize,
  time: number,
  quality: RenderQualityState,
): void {
  const centerX = size.width * 0.5;
  const centerY = size.height * 0.48;
  const pulse = 0.5 + Math.sin(time * 2.3) * 0.5;
  const ringRadius = Math.min(size.width, size.height) * (0.14 + pulse * 0.016);

  context.save();
  context.translate(centerX, centerY);
  context.rotate(time * 0.38);
  context.globalCompositeOperation = "lighter";

  for (let index = 0; index < 4; index += 1) {
    context.globalAlpha = 0.22 + index * 0.08;
    context.strokeStyle = index % 2 === 0 ? "rgba(0, 245, 255, 0.62)" : "rgba(255, 43, 214, 0.56)";
    context.shadowColor = index % 2 === 0 ? "#00f5ff" : "#ff2bd6";
    context.shadowBlur = 16 * quality.glowScale;
    context.lineWidth = 1.2 + index * 0.8;
    context.beginPath();
    context.ellipse(0, 0, ringRadius * (1 + index * 0.16), ringRadius * 0.38, index * 0.72, 0, Math.PI * 2);
    context.stroke();
  }

  context.globalAlpha = 0.72;
  context.fillStyle = "rgba(219, 255, 82, 0.86)";
  context.shadowColor = "#dbff52";
  context.shadowBlur = 24 * quality.glowScale;
  context.beginPath();
  context.arc(0, 0, 4 + pulse * 3, 0, Math.PI * 2);
  context.fill();

  context.globalAlpha = 0.18 + pulse * 0.08;
  context.shadowBlur = 12 * quality.glowScale;
  context.strokeStyle = "rgba(255, 255, 255, 0.42)";
  context.lineWidth = 0.9;
  context.beginPath();
  context.ellipse(0, 0, ringRadius * 0.72, ringRadius * 0.24, -0.46, 0, TAU);
  context.stroke();

  context.globalAlpha = 0.32 + pulse * 0.1;
  for (let index = 0; index < 6; index += 1) {
    const orbitAngle = time * (0.58 + index * 0.05) + index * (TAU / 6);
    const orbitX = Math.cos(orbitAngle) * ringRadius * (1.02 + (index % 2) * 0.08);
    const orbitY = Math.sin(orbitAngle) * ringRadius * 0.3;

    context.fillStyle = index % 2 === 0 ? "#dbff52" : "#ffffff";
    context.beginPath();
    context.arc(orbitX, orbitY, 1.1 + index * 0.08, 0, TAU);
    context.fill();
  }

  context.restore();
}

export function drawBoard(
  context: CanvasRenderingContext2D,
  snapshot: GameSnapshot,
  time: number,
  quality: RenderQualityState,
): void {
  const { grid } = snapshot;
  const width = grid.columns * grid.cellSize;
  const height = grid.rows * grid.cellSize;
  const pulse = 0.5 + Math.sin(time * 2.1) * 0.5;
  const frameX = grid.offsetX - 9;
  const frameY = grid.offsetY - 9;
  const frameWidth = width + 18;
  const frameHeight = height + 18;
  const cornerLength = Math.max(10, Math.min(24, grid.cellSize * 0.92));

  context.save();
  context.globalCompositeOperation = "source-over";
  context.shadowColor = "rgba(0, 245, 255, 0.54)";
  context.shadowBlur = 30 + pulse * 18;
  context.fillStyle = "rgba(1, 8, 20, 0.72)";
  fillRoundedRect(context, frameX, frameY, frameWidth, frameHeight, 14);

  context.shadowBlur = 0;
  context.globalAlpha = 0.72;
  const sheen = context.createLinearGradient(frameX, frameY, frameX + frameWidth, frameY + frameHeight);
  sheen.addColorStop(0, "rgba(255, 255, 255, 0.08)");
  sheen.addColorStop(0.36, "rgba(0, 245, 255, 0.02)");
  sheen.addColorStop(0.76, "rgba(255, 43, 214, 0.03)");
  sheen.addColorStop(1, "rgba(0, 0, 0, 0.08)");
  context.fillStyle = sheen;
  fillRoundedRect(context, frameX, frameY, frameWidth, frameHeight, 14);

  context.shadowColor = "rgba(255, 43, 214, 0.28)";
  context.shadowBlur = 22;
  context.strokeStyle = "rgba(143, 251, 255, 0.62)";
  context.lineWidth = 1.1;
  context.strokeRect(grid.offsetX - 0.5, grid.offsetY - 0.5, width + 1, height + 1);

  context.shadowBlur = 0;
  context.globalAlpha = 0.26;
  context.strokeStyle = "rgba(255, 255, 255, 0.16)";
  context.lineWidth = 1;
  context.strokeRect(frameX + 4.5, frameY + 4.5, frameWidth - 9, frameHeight - 9);

  context.globalAlpha = 0.8;
  context.shadowColor = "#00f5ff";
  context.shadowBlur = 14 * quality.glowScale;
  context.strokeStyle = "rgba(0, 245, 255, 0.7)";
  context.lineWidth = Math.max(1.2, grid.cellSize * 0.05);

  const corners: Array<[number, number, number, number]> = [
    [frameX + 2, frameY + 2, 1, 1],
    [frameX + frameWidth - 2, frameY + 2, -1, 1],
    [frameX + 2, frameY + frameHeight - 2, 1, -1],
    [frameX + frameWidth - 2, frameY + frameHeight - 2, -1, -1],
  ];

  for (const [cornerX, cornerY, dirX, dirY] of corners) {
    context.beginPath();
    context.moveTo(cornerX, cornerY + dirY * cornerLength * 0.46);
    context.lineTo(cornerX, cornerY);
    context.lineTo(cornerX + dirX * cornerLength * 0.46, cornerY);
    context.stroke();
  }

  context.shadowBlur = 0;
  context.globalAlpha = 0.22;
  context.strokeStyle = "rgba(0, 245, 255, 0.34)";

  for (let column = 1; column < grid.columns; column += 1) {
    const x = grid.offsetX + column * grid.cellSize;
    context.beginPath();
    context.moveTo(x, grid.offsetY);
    context.lineTo(x, grid.offsetY + height);
    context.stroke();
  }

  for (let row = 1; row < grid.rows; row += 1) {
    const y = grid.offsetY + row * grid.cellSize;
    context.beginPath();
    context.moveTo(grid.offsetX, y);
    context.lineTo(grid.offsetX + width, y);
    context.stroke();
  }

  context.restore();
}

export function createStaticSceneSnapshot(grid: GridMetrics): GameSnapshot {
  return {
    phase: "ready",
    match: {
      mode: "solo",
      phase: "ready",
      tick: 0,
      winnerId: null,
    },
    players: [{
      id: "p1",
      label: "P1",
      inputOrigin: "local",
      snake: [],
      direction: "right",
      score: 0,
      highScore: 0,
      livesRemaining: 3,
      deathReason: null,
      speedMode: "base",
      speedMultiplier: 1,
      speedCue: null,
      wallGrace: null,
      reviveCountdownSeconds: 0,
    }],
    grid,
    snake: [],
    foods: [],
    starAttractors: [],
    starAttractorEffects: [],
    starBeasts: [],
    starCores: [],
    starBeastEffects: [],
    blackHoles: [],
    blackHoleAlert: null,
    blackHoleCue: null,
    rewardBurstOrigin: null,
    score: 0,
    highScore: 0,
    livesRemaining: 3,
    deathReason: null,
    direction: "right",
    speedMode: "base",
    speedMultiplier: 1,
    speedCue: null,
    wallGrace: null,
    reviveCountdownSeconds: 0,
  };
}
