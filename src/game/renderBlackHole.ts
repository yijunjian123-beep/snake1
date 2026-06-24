import {
  getBlackHoleAlertRadiusCells,
  getBlackHoleCoreRadiusCells,
  getBlackHoleFormationProgress,
  getBlackHoleInfluenceRadiusCells,
  getBlackHolePulseSpeed,
  isBlackHoleActive,
} from "./blackHole";
import { cellCenter, clamp, seededUnit } from "./renderCanvasUtils";
import type { BlackHole, Direction, GameSnapshot } from "./types";

const TAU = Math.PI * 2;
const BLACK_HOLE_VISUAL = {
  haloInnerRadiusScale: 0.08,
  haloRadiusPad: 0.18,
  haloPulseScale: 0.05,
  haloBaseAlpha: 0.26,
  haloMidAlpha: 0.2,
  haloOuterAlpha: 0.08,
  abyssMidTintAlpha: 0.99,
  abyssOuterTintAlpha: 0.84,
  abyssEdgeLiftAlpha: 0.24,
  bodyRadiusScale: 0.22,
  bodyPulseScale: 0.02,
  coreNodeRadiusScale: 0.075,
  coreNodeGlowScale: 0.19,
  swirlCount: 2,
  swirlRadiusPad: 0.58,
  swirlRadiusStep: 0.16,
  swirlAlpha: 0.18,
  swirlWidthScale: 0.028,
  particleCount: 2,
  particleRadiusScale: 0.042,
  particleTrailScale: 0.032,
  particleAlpha: 0.42,
  reducedMotionScale: 0.34,
} as const;

export interface RenderBlackHoleOptions {
  glowScale: number;
  reducedMotionPreferred: boolean;
}

export function drawBlackHoles(
  context: CanvasRenderingContext2D,
  snapshot: GameSnapshot,
  time: number,
  options: RenderBlackHoleOptions,
): void {
  if (snapshot.blackHoles.length === 0) {
    return;
  }

  context.save();
  context.globalCompositeOperation = "lighter";

  for (const blackHole of snapshot.blackHoles) {
    drawBlackHole(context, snapshot, blackHole, time, options);
  }

  context.restore();
}

export function drawBlackHoleCue(context: CanvasRenderingContext2D, snapshot: GameSnapshot, time: number): void {
  const cue = snapshot.blackHoleCue;
  const head = snapshot.snake[0];

  if (snapshot.phase !== "playing" || !cue || !head || cue.isEscaping || !cue.pullDirection) {
    return;
  }

  const vectors: Record<Direction, { x: number; y: number }> = {
    up: { x: 0, y: -1 },
    right: { x: 1, y: 0 },
    down: { x: 0, y: 1 },
    left: { x: -1, y: 0 },
  };
  const direction = vectors[cue.pullDirection];
  const center = cellCenter(snapshot.grid, head);
  const strength = cue.chargeThreshold > 0 ? clamp(cue.charge / cue.chargeThreshold, 0, 1) : 0;
  const pulsing = 0.9 + Math.sin(time * 9.5) * 0.1;
  const length = snapshot.grid.cellSize * (0.34 + strength * 0.46 + (cue.isPulling ? 0.12 : 0));
  const width = Math.max(1.4, snapshot.grid.cellSize * (cue.isPulling ? 0.09 : 0.05 + strength * 0.03));
  const alpha = cue.isPulling ? 0.96 : cue.isFirstTick ? 0.28 : 0.18 + strength * 0.52;
  const leftVector = { x: -direction.y, y: direction.x };
  const bandColor = cue.band === "strong" ? "#dbff52" : cue.band === "medium" ? "#ff2bd6" : "#00f5ff";

  context.save();
  context.translate(center.x + direction.x * snapshot.grid.cellSize * 0.06, center.y + direction.y * snapshot.grid.cellSize * 0.06);
  context.globalCompositeOperation = "lighter";
  context.shadowColor = bandColor;
  context.shadowBlur = cue.isPulling ? 18 : 10;
  context.fillStyle = bandColor;
  context.strokeStyle = bandColor;
  context.lineCap = "round";
  context.lineJoin = "round";
  context.globalAlpha = alpha * pulsing;

  context.lineWidth = width;
  context.beginPath();
  context.moveTo(0, 0);
  context.lineTo(direction.x * length, direction.y * length);
  context.stroke();

  const tipX = direction.x * length;
  const tipY = direction.y * length;
  const headLength = width * 1.9;

  context.beginPath();
  context.moveTo(tipX, tipY);
  context.lineTo(
    tipX - direction.x * headLength + leftVector.x * headLength * 0.58,
    tipY - direction.y * headLength + leftVector.y * headLength * 0.58,
  );
  context.lineTo(
    tipX - direction.x * headLength - leftVector.x * headLength * 0.58,
    tipY - direction.y * headLength - leftVector.y * headLength * 0.58,
  );
  context.closePath();
  context.fill();

  context.globalAlpha = alpha * 0.42;
  context.beginPath();
  context.arc(0, 0, width * 0.75, 0, Math.PI * 2);
  context.fill();

  context.restore();
}

function drawBlackHole(
  context: CanvasRenderingContext2D,
  snapshot: GameSnapshot,
  blackHole: BlackHole,
  time: number,
  options: RenderBlackHoleOptions,
): void {
  const { grid } = snapshot;
  const center = cellCenter(grid, blackHole.cell);
  const formation = getBlackHoleFormationProgress(blackHole, time);
  const active = isBlackHoleActive(blackHole, time);
  const pulse = 0.5 + Math.sin(time * getBlackHolePulseSpeed(blackHole) + blackHole.seed * 0.01) * 0.5;
  const preview = active ? 1 : clamp((formation - 0.12) / 0.5, 0, 1);
  const visibility = Math.max(0.18, preview);
  const motionScale = options.reducedMotionPreferred ? BLACK_HOLE_VISUAL.reducedMotionScale : 1;
  const glowScale = options.glowScale * motionScale;
  const alertRadiusCells = getBlackHoleAlertRadiusCells(blackHole);
  const influenceRadiusCells = getBlackHoleInfluenceRadiusCells(blackHole);
  const coreRadiusCells = getBlackHoleCoreRadiusCells(blackHole);
  const outerRadius = grid.cellSize * (alertRadiusCells + BLACK_HOLE_VISUAL.haloRadiusPad + pulse * BLACK_HOLE_VISUAL.haloPulseScale);
  const influenceRadius = grid.cellSize * Math.max(coreRadiusCells + 0.72, influenceRadiusCells + 0.02);
  const coreRadius = grid.cellSize * Math.max(BLACK_HOLE_VISUAL.bodyRadiusScale, coreRadiusCells + 0.24);
  const nodeRadius = grid.cellSize * BLACK_HOLE_VISUAL.coreNodeRadiusScale;
  const swirlBaseRadius = grid.cellSize * Math.max(coreRadiusCells + BLACK_HOLE_VISUAL.swirlRadiusPad, influenceRadiusCells * 0.44);
  const swirlCount = options.reducedMotionPreferred ? 1 : BLACK_HOLE_VISUAL.swirlCount + (blackHole.kind === "small" ? 0 : 1);
  const particleCount = options.reducedMotionPreferred ? 1 : BLACK_HOLE_VISUAL.particleCount;
  const spin = time * (0.78 + seededUnit(blackHole.seed, 13) * 0.34) * motionScale + blackHole.seed * 0.008;

  context.save();
  context.translate(center.x, center.y);

  context.save();
  context.globalCompositeOperation = "lighter";
  context.globalAlpha = visibility * (active ? 0.94 : 0.8);
  context.shadowColor = "#a84eff";
  context.shadowBlur = 16 * glowScale;

  const halo = context.createRadialGradient(0, 0, grid.cellSize * 0.08, 0, 0, outerRadius);
  halo.addColorStop(0, `rgba(255, 43, 214, ${0.26 + pulse * 0.08})`);
  halo.addColorStop(0.32, `rgba(176, 96, 255, ${0.2 + visibility * 0.05})`);
  halo.addColorStop(0.7, `rgba(95, 31, 214, ${0.08 + visibility * 0.03})`);
  halo.addColorStop(1, "rgba(0, 0, 0, 0)");
  context.fillStyle = halo;
  context.beginPath();
  context.arc(0, 0, outerRadius, 0, Math.PI * 2);
  context.fill();
  context.restore();

  context.save();
  context.globalCompositeOperation = "source-over";
  context.globalAlpha = visibility * (active ? 1 : 0.92);
  const abyss = context.createRadialGradient(0, 0, 0, 0, 0, influenceRadius);
  abyss.addColorStop(0, `rgba(0, 0, 0, ${0.995 - preview * 0.03})`);
  abyss.addColorStop(0.5, `rgba(1, 2, 6, ${BLACK_HOLE_VISUAL.abyssMidTintAlpha - preview * 0.02})`);
  abyss.addColorStop(0.84, `rgba(9, 11, 20, ${BLACK_HOLE_VISUAL.abyssOuterTintAlpha - preview * 0.06})`);
  abyss.addColorStop(1, "rgba(0, 0, 0, 0)");
  context.fillStyle = abyss;
  context.beginPath();
  context.arc(0, 0, influenceRadius, 0, Math.PI * 2);
  context.fill();
  context.restore();

  context.save();
  context.globalCompositeOperation = "lighter";
  context.globalAlpha = visibility * (active ? 0.84 : 0.68) * motionScale;
  context.shadowColor = active ? "#00f5ff" : "#a84eff";
  context.shadowBlur = 10 * glowScale;
  context.lineCap = "round";
  context.lineJoin = "round";

  for (let index = 0; index < swirlCount; index += 1) {
    const layer = swirlCount === 1 ? 0 : index / (swirlCount - 1);
    const arcRadius = swirlBaseRadius + index * grid.cellSize * BLACK_HOLE_VISUAL.swirlRadiusStep;
    const arcAngle = spin + index * 1.12 + (seededUnit(blackHole.seed, index + 29) - 0.5) * 0.55;
    const arcScaleX = 1.02 + seededUnit(blackHole.seed, index + 31) * 0.12;
    const arcScaleY = 0.56 + seededUnit(blackHole.seed, index + 37) * 0.1;
    const arcSpan = Math.PI * (0.54 + seededUnit(blackHole.seed, index + 41) * 0.34);

    context.save();
    context.rotate(arcAngle);
    context.scale(arcScaleX, arcScaleY);
    context.globalAlpha = visibility * (BLACK_HOLE_VISUAL.swirlAlpha - layer * 0.04) * motionScale;
    context.strokeStyle = index % 2 === 0 ? "rgba(143, 251, 255, 0.18)" : "rgba(255, 255, 255, 0.16)";
    context.lineWidth = Math.max(0.8, grid.cellSize * BLACK_HOLE_VISUAL.swirlWidthScale * (1 + layer * 0.18)) * glowScale;
    context.beginPath();
    context.arc(0, 0, arcRadius, -arcSpan, -0.1);
    context.stroke();
    context.restore();
  }

  for (let index = 0; index < particleCount; index += 1) {
    const seed = blackHole.seed + index * 97;
    const orbitBias = seededUnit(seed, 23);
    const particleAngle = spin * (1.12 + orbitBias * 0.28) + index * 2.18 + (orbitBias - 0.5) * 0.8;
    const particleRadius = swirlBaseRadius * (0.84 + orbitBias * 0.18);
    const x = Math.cos(particleAngle) * particleRadius;
    const y = Math.sin(particleAngle * 1.08 + orbitBias * 0.55) * particleRadius * 0.58;
    const tailLength = grid.cellSize * BLACK_HOLE_VISUAL.particleTrailScale * (0.7 + orbitBias * 0.8);
    const tailAngle = particleAngle + Math.PI * (0.52 + orbitBias * 0.12);
    const dotRadius = Math.max(0.8, grid.cellSize * (BLACK_HOLE_VISUAL.particleRadiusScale + orbitBias * 0.008));
    const dotColor = index === 0 ? "rgba(255, 255, 255, 0.92)" : "rgba(219, 255, 82, 0.88)";

    context.globalAlpha = visibility * BLACK_HOLE_VISUAL.particleAlpha * (0.84 + orbitBias * 0.16) * motionScale;
    context.shadowColor = index === 0 ? "#00f5ff" : "#dbff52";
    context.shadowBlur = 7 * glowScale;
    context.fillStyle = dotColor;
    context.beginPath();
    context.arc(x, y, dotRadius, 0, TAU);
    context.fill();

    context.globalAlpha = visibility * 0.26 * motionScale;
    context.strokeStyle = "rgba(255, 255, 255, 0.26)";
    context.lineWidth = Math.max(0.8, grid.cellSize * 0.015);
    context.beginPath();
    context.moveTo(x, y);
    context.lineTo(x - Math.cos(tailAngle) * tailLength, y - Math.sin(tailAngle) * tailLength * 0.72);
    context.stroke();
  }

  context.globalCompositeOperation = "source-over";
  context.globalAlpha = visibility * (active ? 1 : 0.95);
  const coreGlow = context.createRadialGradient(0, 0, 0, 0, 0, nodeRadius * BLACK_HOLE_VISUAL.coreNodeGlowScale / BLACK_HOLE_VISUAL.coreNodeRadiusScale);
  coreGlow.addColorStop(0, "rgba(255, 255, 255, 0.92)");
  coreGlow.addColorStop(0.24, "rgba(219, 255, 82, 0.34)");
  coreGlow.addColorStop(0.52, "rgba(0, 245, 255, 0.16)");
  coreGlow.addColorStop(0.78, "rgba(0, 0, 0, 0.26)");
  coreGlow.addColorStop(1, "rgba(0, 0, 0, 0)");
  context.fillStyle = coreGlow;
  context.beginPath();
  context.arc(0, 0, nodeRadius * 2.4, 0, TAU);
  context.fill();

  context.fillStyle = "rgba(1, 2, 6, 0.99)";
  context.beginPath();
  context.arc(0, 0, coreRadius, 0, TAU);
  context.fill();

  context.strokeStyle = active ? "rgba(255, 255, 255, 0.12)" : "rgba(255, 255, 255, 0.08)";
  context.lineWidth = Math.max(1, grid.cellSize * 0.03);
  context.beginPath();
  context.arc(0, 0, coreRadius, 0, TAU);
  context.stroke();

  context.globalCompositeOperation = "lighter";
  context.globalAlpha = visibility * 0.28 * motionScale;
  context.shadowColor = "#ffffff";
  context.shadowBlur = 8 * glowScale;
  context.fillStyle = active ? "rgba(247, 251, 255, 0.92)" : "rgba(219, 255, 82, 0.8)";
  context.beginPath();
  context.arc(-nodeRadius * 0.18, -nodeRadius * 0.16, nodeRadius, 0, TAU);
  context.fill();
  context.restore();

  context.restore();
}
