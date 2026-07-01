import { clamp } from "./renderCanvasUtils";
import type { CanvasSize, GameSnapshot } from "./types";

export interface OverlayPassOptions {
  glowScale: number;
  reducedMotionPreferred: boolean;
  shakeOffset: { x: number; y: number };
  blackHoleAlert: GameSnapshot["blackHoleAlert"];
  blackHoleAlertAlpha: number;
}

export function drawOverlayPass(
  context: CanvasRenderingContext2D,
  snapshot: GameSnapshot,
  size: CanvasSize,
  time: number,
  options: OverlayPassOptions,
): void {
  drawBlackHoleAlert(context, snapshot, size, time, options);

  context.save();
  context.translate(options.shakeOffset.x, options.shakeOffset.y);
  drawStateOverlay(context, snapshot, time, options.glowScale);
  drawReviveCountdown(context, snapshot, time, options.glowScale);
  context.restore();
}

function drawBlackHoleAlert(
  context: CanvasRenderingContext2D,
  snapshot: GameSnapshot,
  size: CanvasSize,
  time: number,
  options: OverlayPassOptions,
): void {
  const { blackHoleAlert, blackHoleAlertAlpha, glowScale, reducedMotionPreferred } = options;

  if (snapshot.phase !== "playing" || !blackHoleAlert || blackHoleAlertAlpha <= 0.01) {
    return;
  }

  const message = "危险！进入黑洞影响范围！";
  const { grid } = snapshot;
  let fontSize = Math.max(15, Math.min(24, grid.cellSize * 0.9));
  const horizontalPadding = Math.max(18, grid.cellSize * 0.75);
  const verticalPadding = Math.max(10, grid.cellSize * 0.34);
  const maxWidth = Math.max(1, size.width - 32);

  context.save();
  context.globalCompositeOperation = "lighter";
  context.textAlign = "center";
  context.textBaseline = "middle";

  context.font = `800 ${fontSize}px system-ui, sans-serif`;
  let textWidth = context.measureText(message).width;
  const availableTextWidth = Math.max(1, maxWidth - horizontalPadding * 2);

  if (textWidth > availableTextWidth) {
    fontSize = Math.max(13, Math.floor(fontSize * (availableTextWidth / Math.max(1, textWidth))));
    context.font = `800 ${fontSize}px system-ui, sans-serif`;
    textWidth = context.measureText(message).width;
  }

  const bannerWidth = Math.min(maxWidth, textWidth + horizontalPadding * 2);
  const bannerHeight = fontSize + verticalPadding * 2;
  const centerX = size.width * 0.5;
  const lifeBarClearance = Math.max(36, grid.cellSize * 1.1);
  const preferredCenterY = grid.offsetY + lifeBarClearance + bannerHeight * 0.5;
  const minCenterY = bannerHeight * 0.5 + 10;
  const maxCenterY = Math.min(size.height - bannerHeight * 0.5 - 10, grid.offsetY + grid.cellSize * 2.25);
  const centerY = clamp(preferredCenterY, minCenterY, Math.max(minCenterY, maxCenterY));
  const bannerX = centerX - bannerWidth * 0.5;
  const bannerY = centerY - bannerHeight * 0.5;
  const pulse = reducedMotionPreferred ? 1 : 0.92 + Math.sin(time * 5.5) * 0.08;
  const alpha = blackHoleAlertAlpha * pulse;

  context.globalAlpha = alpha;
  context.shadowColor = "#ff2bd6";
  context.shadowBlur = (12 + pulse * 6) * glowScale;
  context.fillStyle = "rgba(7, 10, 18, 0.72)";
  fillRoundedRect(context, bannerX, bannerY, bannerWidth, bannerHeight, bannerHeight * 0.5);

  const sheen = context.createLinearGradient(bannerX, bannerY, bannerX + bannerWidth, bannerY + bannerHeight);
  sheen.addColorStop(0, "rgba(255, 255, 255, 0.08)");
  sheen.addColorStop(0.45, "rgba(0, 245, 255, 0.03)");
  sheen.addColorStop(1, "rgba(255, 43, 214, 0.04)");
  context.fillStyle = sheen;
  fillRoundedRect(context, bannerX, bannerY, bannerWidth, bannerHeight, bannerHeight * 0.5);

  context.strokeStyle = "rgba(255, 43, 214, 0.48)";
  context.lineWidth = 1.4;
  context.beginPath();
  context.roundRect(bannerX + 0.75, bannerY + 0.75, bannerWidth - 1.5, bannerHeight - 1.5, bannerHeight * 0.5);
  context.stroke();

  context.globalAlpha = alpha * 0.92;
  context.fillStyle = "rgba(255, 43, 214, 0.82)";
  fillRoundedRect(context, bannerX + 10, bannerY + 10, 4, Math.max(6, bannerHeight - 20), 2);

  context.fillStyle = "#f7fbff";
  context.shadowColor = "#dbff52";
  context.shadowBlur = (6 + pulse * 4) * glowScale;
  context.font = `800 ${fontSize}px system-ui, sans-serif`;
  context.fillText(message, centerX, centerY);

  context.restore();
}

function drawStateOverlay(
  context: CanvasRenderingContext2D,
  snapshot: GameSnapshot,
  time: number,
  glowScale: number,
): void {
  if (snapshot.phase !== "paused" && snapshot.phase !== "gameOver") {
    return;
  }

  const { grid, phase } = snapshot;
  const width = grid.columns * grid.cellSize;
  const height = grid.rows * grid.cellSize;
  const pulse = 0.5 + Math.sin(time * 5) * 0.5;

  context.save();
  context.fillStyle = phase === "paused" ? "rgba(3, 4, 10, 0.52)" : "rgba(3, 4, 10, 0.38)";
  fillRoundedRect(context, grid.offsetX, grid.offsetY, width, height, 8);

  context.globalCompositeOperation = "lighter";
  context.strokeStyle = phase === "paused" ? "rgba(219, 255, 82, 0.46)" : "rgba(255, 43, 214, 0.58)";
  context.shadowColor = phase === "paused" ? "#dbff52" : "#ff2bd6";
  context.shadowBlur = (phase === "paused" ? 18 : 28 + pulse * 10) * glowScale;
  context.lineWidth = 2;
  context.strokeRect(grid.offsetX + 8, grid.offsetY + 8, width - 16, height - 16);

  context.fillStyle = phase === "paused" ? "#dbff52" : "#ff2bd6";
  context.font = `800 ${Math.max(24, Math.min(46, width / 8.6))}px system-ui, sans-serif`;
  context.textAlign = "center";
  context.textBaseline = "middle";
  context.fillText(phase === "paused" ? "PAUSED" : "SYSTEM RUPTURE", grid.offsetX + width / 2, grid.offsetY + height / 2);

  if (phase === "gameOver") {
    context.globalAlpha = 0.82;
    context.font = `700 ${Math.max(13, Math.min(18, width / 28))}px system-ui, sans-serif`;
    context.fillStyle = "#f7fbff";
    context.shadowBlur = 12;
    context.fillText("PRESS R OR RESTART", grid.offsetX + width / 2, grid.offsetY + height / 2 + Math.max(34, width / 13));
  }

  context.restore();
}

function drawReviveCountdown(
  context: CanvasRenderingContext2D,
  snapshot: GameSnapshot,
  time: number,
  glowScale: number,
): void {
  if (snapshot.phase !== "reviving") {
    return;
  }

  const { grid } = snapshot;
  const countdown = Math.max(1, snapshot.reviveCountdownSeconds);
  const width = grid.columns * grid.cellSize;
  const height = grid.rows * grid.cellSize;
  const centerX = grid.offsetX + width / 2;
  const centerY = grid.offsetY + height / 2;
  const radius = Math.max(42, Math.min(width, height) * 0.16);
  const pulse = 0.5 + Math.sin(time * 7.2) * 0.5;

  context.save();
  context.globalCompositeOperation = "lighter";
  context.textAlign = "center";
  context.textBaseline = "middle";

  context.fillStyle = "rgba(3, 4, 10, 0.14)";
  context.beginPath();
  context.arc(centerX, centerY, radius * 1.7, 0, Math.PI * 2);
  context.fill();

  context.strokeStyle = "rgba(0, 245, 255, 0.5)";
  context.shadowColor = "#00f5ff";
  context.shadowBlur = (18 + pulse * 10) * glowScale;
  context.lineWidth = Math.max(2, grid.cellSize * 0.08);
  context.beginPath();
  context.arc(centerX, centerY, radius * 1.7, 0, Math.PI * 2);
  context.stroke();

  context.fillStyle = "#f7fbff";
  context.shadowColor = "#ff2bd6";
  context.shadowBlur = (28 + pulse * 8) * glowScale;
  context.font = `900 ${Math.max(28, Math.min(108, radius * 1.82))}px system-ui, sans-serif`;
  context.fillText(String(countdown), centerX, centerY - radius * 0.08);

  context.fillStyle = "#dbff52";
  context.shadowColor = "#dbff52";
  context.shadowBlur = (12 + pulse * 6) * glowScale;
  context.font = `800 ${Math.max(11, Math.min(22, radius * 0.26))}px system-ui, sans-serif`;
  context.fillText("复活中", centerX, centerY + radius * 0.88);

  context.restore();
}

function fillRoundedRect(
  context: CanvasRenderingContext2D,
  x: number,
  y: number,
  width: number,
  height: number,
  radius: number,
): void {
  const cornerRadius = Math.min(radius, width / 2, height / 2);

  context.beginPath();
  context.moveTo(x + cornerRadius, y);
  context.lineTo(x + width - cornerRadius, y);
  context.quadraticCurveTo(x + width, y, x + width, y + cornerRadius);
  context.lineTo(x + width, y + height - cornerRadius);
  context.quadraticCurveTo(x + width, y + height, x + width - cornerRadius, y + height);
  context.lineTo(x + cornerRadius, y + height);
  context.quadraticCurveTo(x, y + height, x, y + height - cornerRadius);
  context.lineTo(x, y + cornerRadius);
  context.quadraticCurveTo(x, y, x + cornerRadius, y);
  context.closePath();
  context.fill();
}
