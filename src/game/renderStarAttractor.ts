import {
  cellCenter,
  clamp,
  easeOutCubic,
  lerp,
  quadraticBezierPoint,
  seededUnit,
} from "./renderCanvasUtils";
import type { GameSnapshot, GridMetrics, StarAttractor } from "./types";

export function drawStarAttractors(context: CanvasRenderingContext2D, snapshot: GameSnapshot, time: number): void {
  const { starAttractors, grid } = snapshot;

  if (starAttractors.length === 0) {
    return;
  }

  context.save();
  context.globalCompositeOperation = "lighter";

  for (const attractor of starAttractors) {
    drawStarAttractor(context, grid, attractor, time);
  }

  context.restore();
}

export function drawStarAttractorEffects(context: CanvasRenderingContext2D, snapshot: GameSnapshot, time: number): void {
  const { starAttractorEffects, grid } = snapshot;

  if (starAttractorEffects.length === 0) {
    return;
  }

  context.save();
  context.globalCompositeOperation = "lighter";
  context.lineCap = "round";
  context.lineJoin = "round";

  for (const effect of starAttractorEffects) {
    const duration = Math.max(0.001, effect.lifetimeMs / 1000);
    const age = time - effect.createdAt;
    const progress = clamp(age / duration, 0, 1);
    const fade = Math.pow(1 - progress, 2.2);
    const origin = cellCenter(grid, effect.origin);
    const target = cellCenter(grid, effect.target);
    const sourceCells = effect.absorbedCells.length > 0 ? effect.absorbedCells : [effect.origin];
    const originRadius = grid.cellSize * (0.26 + effect.absorbCount * 0.016);
    const targetRadius = grid.cellSize * (0.18 + effect.absorbCount * 0.009);

    context.save();
    context.translate(origin.x, origin.y);
    context.globalAlpha = fade * 0.92;
    context.shadowColor = "#00f5ff";
    context.shadowBlur = 24 + effect.absorbCount * 1.4;

    const originGlow = context.createRadialGradient(0, 0, 0, 0, 0, originRadius * 2.1);
    originGlow.addColorStop(0, "rgba(255, 255, 255, 0.96)");
    originGlow.addColorStop(0.22, "rgba(0, 245, 255, 0.5)");
    originGlow.addColorStop(0.56, "rgba(219, 255, 82, 0.18)");
    originGlow.addColorStop(1, "rgba(0, 0, 0, 0)");
    context.fillStyle = originGlow;
    context.beginPath();
    context.arc(0, 0, originRadius * (0.82 + Math.sin(time * 8.4 + effect.seed * 0.01) * 0.1), 0, Math.PI * 2);
    context.fill();
    context.restore();

    context.save();
    context.translate(target.x, target.y);
    context.globalAlpha = fade * (0.44 + progress * 0.18);
    context.shadowColor = "#dbff52";
    context.shadowBlur = 18;

    const targetGlow = context.createRadialGradient(0, 0, 0, 0, 0, targetRadius * 2.2);
    targetGlow.addColorStop(0, "rgba(255, 255, 255, 0.92)");
    targetGlow.addColorStop(0.32, "rgba(219, 255, 82, 0.34)");
    targetGlow.addColorStop(1, "rgba(0, 0, 0, 0)");
    context.fillStyle = targetGlow;
    context.beginPath();
    context.arc(0, 0, targetRadius, 0, Math.PI * 2);
    context.fill();
    context.restore();

    for (let index = 0; index < sourceCells.length; index += 1) {
      const sourceCell = sourceCells[index];
      if (!sourceCell) {
        continue;
      }

      const source = cellCenter(grid, sourceCell);
      const delay = sourceCells.length <= 1 ? 0 : (index / sourceCells.length) * 0.18;
      const localProgress = clamp((progress - delay) / Math.max(0.001, 1 - delay * 0.82), 0, 1);

      if (localProgress <= 0) {
        continue;
      }

      const arcStrength = 0.14 + seededUnit(effect.seed + index, 41) * 0.16;
      const control = {
        x: lerp(source.x, target.x, 0.52) + (target.y - source.y) * arcStrength,
        y: lerp(source.y, target.y, 0.52) - (target.x - source.x) * arcStrength,
      };
      const trailPoint = quadraticBezierPoint(source, control, target, easeOutCubic(localProgress));
      const trailAlpha = fade * (0.28 + (1 - localProgress) * 0.38);

      context.save();
      context.globalAlpha = trailAlpha;
      context.strokeStyle = index % 2 === 0 ? "rgba(0, 245, 255, 0.76)" : "rgba(219, 255, 82, 0.72)";
      context.lineWidth = Math.max(1, grid.cellSize * (0.03 + effect.absorbCount * 0.003));
      context.shadowColor = index % 2 === 0 ? "#00f5ff" : "#dbff52";
      context.shadowBlur = 10;
      context.beginPath();
      context.moveTo(source.x, source.y);
      context.quadraticCurveTo(control.x, control.y, target.x, target.y);
      context.stroke();

      context.globalAlpha = Math.min(1, trailAlpha + 0.28);
      context.fillStyle = index % 2 === 0 ? "#ffffff" : "#dbff52";
      context.beginPath();
      context.arc(
        trailPoint.x,
        trailPoint.y,
        Math.max(1.2, grid.cellSize * (0.05 + effect.absorbCount * 0.002)),
        0,
        Math.PI * 2,
      );
      context.fill();
      context.restore();
    }
  }

  context.restore();
}

function drawStarAttractor(
  context: CanvasRenderingContext2D,
  grid: GridMetrics,
  attractor: StarAttractor,
  time: number,
): void {
  const center = cellCenter(grid, attractor.cell);
  const spin = time * (1.45 + seededUnit(attractor.seed, 19) * 0.34) + attractor.seed * 0.004;
  const pulse = 0.72 + Math.sin(time * 4.6 + attractor.seed * 0.01) * 0.28;
  const coreRadius = grid.cellSize * (0.16 + pulse * 0.05);
  const ringRadius = grid.cellSize * (0.34 + pulse * 0.08);
  const haloRadius = grid.cellSize * (0.56 + pulse * 0.12);

  context.save();
  context.translate(center.x, center.y);
  context.rotate(spin);
  context.globalAlpha = 0.96;
  context.shadowColor = "#00f5ff";
  context.shadowBlur = 18 + pulse * 12;

  const halo = context.createRadialGradient(0, 0, 0, 0, 0, haloRadius);
  halo.addColorStop(0, "rgba(255, 255, 255, 0.95)");
  halo.addColorStop(0.2, "rgba(219, 255, 82, 0.36)");
  halo.addColorStop(0.46, "rgba(0, 245, 255, 0.34)");
  halo.addColorStop(0.76, "rgba(0, 245, 255, 0.08)");
  halo.addColorStop(1, "rgba(0, 0, 0, 0)");
  context.fillStyle = halo;
  context.beginPath();
  context.arc(0, 0, haloRadius, 0, Math.PI * 2);
  context.fill();

  context.lineWidth = Math.max(1, grid.cellSize * 0.04);
  context.strokeStyle = "rgba(240, 253, 255, 0.68)";

  for (let ring = 0; ring < 3; ring += 1) {
    const ringProgress = ring / 2.8;
    const radiusX = ringRadius * (1.02 + ringProgress * 0.32);
    const radiusY = ringRadius * (0.48 + ringProgress * 0.1);

    context.beginPath();
    context.ellipse(0, 0, radiusX, radiusY, ring * 0.56 + spin * 0.22, 0, Math.PI * 2);
    context.stroke();
  }

  const glyph = context.createRadialGradient(-coreRadius * 0.2, -coreRadius * 0.25, 0, 0, 0, grid.cellSize * 0.24);
  glyph.addColorStop(0, "#ffffff");
  glyph.addColorStop(0.35, "#dbff52");
  glyph.addColorStop(0.72, "#00f5ff");
  glyph.addColorStop(1, "#ff2bd6");
  context.fillStyle = glyph;
  context.beginPath();

  for (let point = 0; point < 10; point += 1) {
    const ratio = point % 2 === 0 ? 1 : 0.44;
    const angle = -Math.PI / 2 + (point / 10) * Math.PI * 2;
    const x = Math.cos(angle) * grid.cellSize * ratio * 0.2;
    const y = Math.sin(angle) * grid.cellSize * ratio * 0.2;

    if (point === 0) {
      context.moveTo(x, y);
    } else {
      context.lineTo(x, y);
    }
  }

  context.closePath();
  context.fill();

  context.globalAlpha = 0.74;
  context.shadowBlur = 10;
  context.fillStyle = "rgba(255, 255, 255, 0.9)";
  context.beginPath();
  context.arc(0, 0, coreRadius * 0.95, 0, Math.PI * 2);
  context.fill();

  const orbitCount = 3;

  for (let index = 0; index < orbitCount; index += 1) {
    const orbitAngle = spin * (1.1 + index * 0.16) + (index / orbitCount) * Math.PI * 2;
    const orbitRadiusX = ringRadius * (0.9 + index * 0.14);
    const orbitRadiusY = ringRadius * (0.28 + index * 0.05);
    const orbitX = Math.cos(orbitAngle) * orbitRadiusX;
    const orbitY = Math.sin(orbitAngle) * orbitRadiusY;

    context.globalAlpha = 0.52 + index * 0.08;
    context.fillStyle = index === 1 ? "#dbff52" : "#ffffff";
    context.beginPath();
    context.arc(orbitX, orbitY, Math.max(1.2, grid.cellSize * 0.05), 0, Math.PI * 2);
    context.fill();
  }

  context.restore();
}
