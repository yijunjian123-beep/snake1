import { cellCenter, clamp, easeOutCubic, lerp } from "./renderCanvasUtils";
import type { GameSnapshot, StarCore } from "./types";

export interface StarCoreBurstState {
  scale: number;
  alpha: number;
  clump: number;
}

export interface CoreGlyphMetrics {
  pulse: number;
  outerRadius: number;
  innerRadius: number;
  haloRadius: number;
  pointCount: number;
  pointInnerRatio: number;
}

export function getStarCoreBurstState(core: Pick<StarCore, "source" | "spawnTime">, time: number): StarCoreBurstState {
  const ageMs = time * 1000 - core.spawnTime * 1000;

  if (ageMs < 72) {
    const rise = easeOutCubic(clamp(ageMs / 72, 0, 1));

    return {
      scale: lerp(1.03, 1.12, rise),
      alpha: lerp(0.94, 1, rise),
      clump: (1 - rise) * 0.03,
    };
  }

  if (ageMs < 160) {
    const hang = easeOutCubic(clamp((ageMs - 72) / 88, 0, 1));

    return {
      scale: 1.12,
      alpha: 1,
      clump: (1 - hang) * 0.015,
    };
  }

  const settle = easeOutCubic(clamp((ageMs - 160) / 140, 0, 1));

  return {
    scale: lerp(1.12, 1, settle),
    alpha: lerp(1, 0.96, settle),
    clump: (1 - settle) * 0.01,
  };
}

export function getCoreGlyphMetrics(
  source: StarCore["source"],
  index: number,
  time: number,
  cellSize: number,
): CoreGlyphMetrics {
  void source;

  const pulse = 0.72 + Math.sin(time * 8.4 + index * 1.3) * 0.28;
  const outerRadius = cellSize * (0.34 + pulse * 0.07 + index * 0.02);
  const innerRadius = outerRadius * 0.43;

  return {
    pulse,
    outerRadius,
    innerRadius,
    haloRadius: outerRadius * 1.72,
    pointCount: 12,
    pointInnerRatio: 0.43,
  };
}

export function drawFood(context: CanvasRenderingContext2D, snapshot: GameSnapshot, time: number): void {
  const { foods, grid } = snapshot;

  if (foods.length === 0) {
    return;
  }

  context.save();
  context.globalCompositeOperation = "lighter";

  for (let index = 0; index < foods.length; index += 1) {
    const food = foods[index];
    if (!food) {
      continue;
    }
    const center = cellCenter(grid, food);
    const glyphMetrics = getCoreGlyphMetrics("regular", index, time, grid.cellSize);
    const { pulse, outerRadius, innerRadius, haloRadius, pointCount } = glyphMetrics;

    context.save();
    context.translate(center.x, center.y);
    context.rotate(time * 1.35 + index * 0.7);

    context.globalAlpha = 0.38 + pulse * 0.24;
    context.strokeStyle = index === 0 ? "rgba(219, 255, 82, 0.78)" : "rgba(0, 245, 255, 0.62)";
    context.shadowColor = index === 0 ? "#dbff52" : "#ff2bd6";
    context.shadowBlur = 24;
    context.lineWidth = 1.2;

    for (let ring = 0; ring < 3; ring += 1) {
      context.beginPath();
      context.ellipse(0, 0, outerRadius * (1.2 + ring * 0.38), outerRadius * (0.46 + ring * 0.12), ring * 0.72, 0, Math.PI * 2);
      context.stroke();
    }

    context.globalAlpha = 1;
    context.fillStyle = index === 0 ? "rgba(219, 255, 82, 0.24)" : "rgba(0, 245, 255, 0.18)";
    context.beginPath();
    context.arc(0, 0, haloRadius, 0, Math.PI * 2);
    context.fill();

    const starGradient = context.createRadialGradient(-outerRadius * 0.22, -outerRadius * 0.25, 0, 0, 0, outerRadius);
    starGradient.addColorStop(0, "#ffffff");
    starGradient.addColorStop(0.3, index === 0 ? "#dbff52" : "#00f5ff");
    starGradient.addColorStop(1, "#ff2bd6");
    context.fillStyle = starGradient;
    context.shadowBlur = 32;
    context.beginPath();

    for (let point = 0; point < pointCount; point += 1) {
      const radius = point % 2 === 0 ? outerRadius : innerRadius;
      const angle = -Math.PI / 2 + (point * Math.PI * 2) / pointCount;
      const x = Math.cos(angle) * radius;
      const y = Math.sin(angle) * radius;

      if (point === 0) {
        context.moveTo(x, y);
      } else {
        context.lineTo(x, y);
      }
    }

    context.closePath();
    context.fill();
    context.restore();
  }

  context.restore();
}

export function drawStarCores(context: CanvasRenderingContext2D, snapshot: GameSnapshot, time: number): void {
  const { starCores, grid } = snapshot;

  if (starCores.length === 0) {
    return;
  }

  context.save();
  context.globalCompositeOperation = "lighter";

  for (let index = 0; index < starCores.length; index += 1) {
    const core = starCores[index];

    if (!core) {
      continue;
    }

    const ageMs = time * 1000 - core.spawnTime * 1000;
    const lifeProgress = clamp(ageMs / Math.max(1, core.lifetimeMs), 0, 1);
    const burstState = getStarCoreBurstState(core, time);
    const spawnProgress = clamp(ageMs / 180, 0, 1);
    const alpha = spawnProgress * clamp((1 - lifeProgress) * 1.2, 0.25, 1) * burstState.alpha;
    const centerX = grid.offsetX + core.x * grid.cellSize;
    const centerY = grid.offsetY + core.y * grid.cellSize;
    const burstTightness = 1 - burstState.clump * 0.18;
    const glyphMetrics = getCoreGlyphMetrics(core.source, index, time, grid.cellSize);
    const { pulse, outerRadius: baseOuterRadius, innerRadius: baseInnerRadius, haloRadius: baseHaloRadius, pointCount } = glyphMetrics;
    const outerRadius = baseOuterRadius * burstTightness;
    const innerRadius = baseInnerRadius * burstTightness;
    const haloRadius = baseHaloRadius * burstTightness;
    const shadowColor = "#dbff52";
    const accentColor = "#dbff52";

    context.save();
    context.translate(centerX, centerY);
    context.scale(burstState.scale, burstState.scale);
    context.rotate(time * 2.2 + core.id * 0.017);
    context.globalAlpha = alpha;
    context.shadowColor = shadowColor;
    context.shadowBlur = (14 + pulse * 8) * burstState.scale;

    const halo = context.createRadialGradient(0, 0, 0, 0, 0, haloRadius);
    halo.addColorStop(0, "rgba(255, 255, 255, 0.92)");
    halo.addColorStop(0.34, "rgba(219, 255, 82, 0.38)");
    halo.addColorStop(0.64, "rgba(0, 245, 255, 0.18)");
    halo.addColorStop(1, "rgba(0, 0, 0, 0)");
    context.fillStyle = halo;
    context.beginPath();
    context.arc(0, 0, haloRadius, 0, Math.PI * 2);
    context.fill();

    const coreGradient = context.createRadialGradient(
      -outerRadius * 0.22,
      -outerRadius * 0.25,
      0,
      0,
      0,
      outerRadius,
    );
    coreGradient.addColorStop(0, "#ffffff");
    coreGradient.addColorStop(0.28, core.id % 2 === 0 ? accentColor : "#ff2bd6");
    coreGradient.addColorStop(1, "#ff2bd6");
    context.fillStyle = coreGradient;
    context.beginPath();

    for (let point = 0; point < pointCount; point += 1) {
      const radius = point % 2 === 0 ? outerRadius : innerRadius;
      const angle = -Math.PI / 2 + (point * Math.PI * 2) / pointCount;
      const x = Math.cos(angle) * radius;
      const y = Math.sin(angle) * radius;

      if (point === 0) {
        context.moveTo(x, y);
      } else {
        context.lineTo(x, y);
      }
    }

    context.closePath();
    context.fill();

    context.globalAlpha = alpha * 0.48;
    context.strokeStyle = "rgba(255, 255, 255, 0.9)";
    context.lineWidth = Math.max(1, grid.cellSize * 0.04);
    context.beginPath();
    context.arc(0, 0, outerRadius * 0.52, 0, Math.PI * 2);
    context.stroke();

    context.restore();
  }

  context.restore();
}
