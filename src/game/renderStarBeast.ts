import { cellCenter, clamp, fillRoundedRect } from "./renderCanvasUtils";
import { STAR_BEAST_CONFIG } from "./starBeast";
import type { GameSnapshot, StarBeast } from "./types";

export function drawStarBeasts(context: CanvasRenderingContext2D, snapshot: GameSnapshot, time: number): void {
  const { starBeasts } = snapshot;

  if (starBeasts.length === 0) {
    return;
  }

  context.save();
  context.globalCompositeOperation = "lighter";

  for (const beast of starBeasts) {
    drawStarBeast(context, snapshot, beast, time);
  }

  context.restore();
}

export function drawStarBeastEffects(context: CanvasRenderingContext2D, snapshot: GameSnapshot, time: number): void {
  const { starBeastEffects, grid } = snapshot;

  if (starBeastEffects.length === 0) {
    return;
  }

  context.save();
  context.globalCompositeOperation = "lighter";
  context.lineCap = "round";
  context.lineJoin = "round";

  for (const effect of starBeastEffects) {
    const age = time - effect.createdAt;
    const duration = Math.max(0.001, effect.lifetimeMs / 1000);
    const progress = clamp(age / duration, 0, 1);
    const alpha = Math.pow(1 - progress, 2);
    const center = cellCenter(grid, effect.cell);
    const pulse = 0.92 + Math.sin(time * 12 + effect.seed * 0.01) * 0.08;
    const radius = grid.cellSize * (0.36 + progress * (1.22 + effect.length * 0.028));
    const rayCount = Math.max(8, Math.min(16, effect.length));
    const flashColor = effect.cause === "black_hole" ? "#00f5ff" : "#ff2bd6";

    context.save();
    context.translate(center.x, center.y);
    context.globalAlpha = alpha * pulse;
    context.shadowColor = flashColor;
    context.shadowBlur = 16 + progress * 16;

    const flash = context.createRadialGradient(0, 0, 0, 0, 0, radius * 1.2);
    flash.addColorStop(0, "rgba(255, 255, 255, 0.92)");
    flash.addColorStop(0.24, `${flashColor}cc`);
    flash.addColorStop(0.58, `${flashColor}44`);
    flash.addColorStop(1, "rgba(0, 0, 0, 0)");
    context.fillStyle = flash;
    context.beginPath();
    context.arc(0, 0, radius * 1.15, 0, Math.PI * 2);
    context.fill();

    context.strokeStyle = `${flashColor}aa`;
    context.lineWidth = Math.max(1, grid.cellSize * 0.045);

    for (let index = 0; index < rayCount; index += 1) {
      const angle = (index / rayCount) * Math.PI * 2 + effect.seed * 0.007 + progress * 0.34;
      const inner = grid.cellSize * (0.22 + progress * 0.12);
      const outer = radius * (1.08 + (index % 3) * 0.08);

      context.beginPath();
      context.moveTo(Math.cos(angle) * inner, Math.sin(angle) * inner);
      context.lineTo(Math.cos(angle) * outer, Math.sin(angle) * outer);
      context.stroke();
    }

    context.restore();
  }

  context.restore();
}

function drawStarBeast(context: CanvasRenderingContext2D, snapshot: GameSnapshot, beast: StarBeast, time: number): void {
  const { grid } = snapshot;
  const head = beast.body[0];

  if (!head) {
    return;
  }

  const cells = beast.body;
  const spawnProgress = beast.state === "spawning"
    ? clamp(1 - beast.spawnGraceTime / Math.max(1, STAR_BEAST_CONFIG.spawnGraceTimeMs), 0, 1)
    : 1;
  const stateBoost = beast.state === "chase" ? 1.2 : beast.state === "patrol" ? 0.95 : 0.76;
  const breath = 0.84 + Math.sin(time * 4.8 + beast.id * 0.33) * 0.16;
  const alpha = stateBoost * breath * (0.58 + spawnProgress * 0.42);
  const headCenter = cellCenter(grid, head);
  const glowColor = beast.state === "chase" ? "#ff2bd6" : "#00f5ff";
  const coreColor = beast.state === "chase" ? "#ffffff" : "#dbff52";
  const cellGap = Math.max(1.5, grid.cellSize * 0.1);
  const segmentSize = grid.cellSize - cellGap * 2;
  const pathWidth = grid.cellSize * (0.72 + spawnProgress * 0.18);

  context.save();
  context.globalCompositeOperation = "lighter";
  context.lineCap = "round";
  context.lineJoin = "round";

  if (cells.length > 1) {
    context.beginPath();

    for (let index = cells.length - 1; index >= 0; index -= 1) {
      const segment = cells[index];

      if (!segment) {
        continue;
      }

      const point = cellCenter(grid, segment);

      if (index === cells.length - 1) {
        context.moveTo(point.x, point.y);
      } else {
        context.lineTo(point.x, point.y);
      }
    }

    context.globalAlpha = alpha * 0.42;
    context.shadowColor = glowColor;
    context.shadowBlur = 16 + spawnProgress * 12;
    context.strokeStyle = beast.state === "chase"
      ? "rgba(255, 43, 214, 0.48)"
      : "rgba(0, 245, 255, 0.42)";
    context.lineWidth = pathWidth;
    context.stroke();
  }

  for (let index = cells.length - 1; index >= 0; index -= 1) {
    const segment = cells[index];

    if (!segment) {
      continue;
    }

    const point = cellCenter(grid, segment);
    const age = cells.length <= 1 ? 1 : 1 - index / (cells.length - 1);
    const pulse = 0.78 + Math.sin(time * 5.6 + beast.id * 0.17 + index * 0.42) * 0.22;
    const segmentAlpha = alpha * (0.62 + age * 0.28) * pulse;
    const isHead = index === 0;

    context.globalAlpha = segmentAlpha;
    context.shadowColor = isHead ? glowColor : coreColor;
    context.shadowBlur = (isHead ? 20 : 12) + spawnProgress * 8;

    if (isHead) {
      const headGradient = context.createRadialGradient(
        point.x - segmentSize * 0.16,
        point.y - segmentSize * 0.18,
        0,
        point.x,
        point.y,
        segmentSize * 0.76,
      );
      headGradient.addColorStop(0, "#ffffff");
      headGradient.addColorStop(0.3, coreColor);
      headGradient.addColorStop(0.72, glowColor);
      headGradient.addColorStop(1, "rgba(4, 7, 18, 1)");
      context.fillStyle = headGradient;
      fillRoundedRect(context, point.x - segmentSize * 0.56, point.y - segmentSize * 0.56, segmentSize * 1.12, segmentSize * 1.12, 10);

      const direction = (() => {
        switch (beast.dir) {
          case "up":
            return { x: 0, y: -1 };
          case "right":
            return { x: 1, y: 0 };
          case "down":
            return { x: 0, y: 1 };
          case "left":
            return { x: -1, y: 0 };
        }
      })();
      const side = { x: -direction.y, y: direction.x };
      const eyeOffsetForward = grid.cellSize * 0.16;
      const eyeOffsetSide = grid.cellSize * 0.14;
      const eyeRadius = Math.max(1.6, grid.cellSize * 0.06);

      context.globalAlpha = segmentAlpha * 0.95;
      context.fillStyle = "#031015";

      for (const sign of [-1, 1]) {
        context.beginPath();
        context.arc(
          point.x + direction.x * eyeOffsetForward + side.x * eyeOffsetSide * sign,
          point.y + direction.y * eyeOffsetForward + side.y * eyeOffsetSide * sign,
          eyeRadius,
          0,
          Math.PI * 2,
        );
        context.fill();
      }
    } else {
      const bodyGradient = context.createRadialGradient(
        point.x - grid.cellSize * 0.1,
        point.y - grid.cellSize * 0.12,
        0,
        point.x,
        point.y,
        segmentSize * 0.7,
      );
      bodyGradient.addColorStop(0, "rgba(255, 255, 255, 0.66)");
      bodyGradient.addColorStop(0.32, beast.state === "chase" ? "rgba(255, 43, 214, 0.86)" : "rgba(0, 245, 255, 0.8)");
      bodyGradient.addColorStop(1, "rgba(18, 8, 34, 1)");
      context.fillStyle = bodyGradient;
      fillRoundedRect(context, point.x - segmentSize * 0.5, point.y - segmentSize * 0.5, segmentSize, segmentSize, 7);
    }
  }

  if (beast.state === "spawning") {
    context.globalAlpha = alpha * 0.32;
    context.strokeStyle = glowColor;
    context.lineWidth = Math.max(1, grid.cellSize * 0.05);
    context.beginPath();
    context.arc(headCenter.x, headCenter.y, grid.cellSize * (0.62 + spawnProgress * 0.3), 0, Math.PI * 2);
    context.stroke();
  }

  context.restore();
}
