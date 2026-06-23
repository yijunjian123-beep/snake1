import {
  getBlackHoleFormationProgress,
  getBlackHoleVariant,
  isBlackHoleActive,
} from "./blackHole";
import { STAR_BEAST_CONFIG } from "./starBeast";
import type {
  BlackHole,
  CanvasSize,
  Direction,
  FrameInfo,
  GameSnapshot,
  GridCell,
  GridMetrics,
  Renderer,
  SpeedMode,
  StarAttractor,
  StarBeast,
  StarCore,
} from "./types";

interface Star {
  x: number;
  y: number;
  radius: number;
  alpha: number;
  speed: number;
  hue: number;
  layer: number;
  twinkle: number;
}

interface Particle {
  x: number;
  y: number;
  vx: number;
  vy: number;
  radius: number;
  hue: number;
  life: number;
  maxLife: number;
  drag: number;
}

interface TrailSample {
  cells: GridCell[];
  life: number;
  maxLife: number;
}

interface RewardBurst {
  x: number;
  y: number;
  cellSize: number;
  life: number;
  maxLife: number;
  angle: number;
  secondaryAngle: number;
  rayCount: number;
  seed: number;
}

type ShakeMode = "reward" | "impact";

interface ShakeState {
  time: number;
  duration: number;
  intensity: number;
  directionX: number;
  directionY: number;
  mode: ShakeMode;
}

interface RenderState {
  particles: Particle[];
  rewardBursts: RewardBurst[];
  trails: TrailSample[];
  blackHoleAlert: GameSnapshot["blackHoleAlert"];
  blackHoleAlertAlpha: number;
  previousScore: number | null;
  previousPhase: GameSnapshot["phase"] | null;
  previousSnakeHeadKey: string | null;
  previousWallGraceKey: string | null;
  previousStarAttractorEffectCount: number | null;
  previousFoods: GridCell[];
  shake: ShakeState;
}

interface RenderQualityState {
  level: number;
  dprCap: number;
  glowScale: number;
  starStride: number;
  particleCap: number;
  attractionParticleCap: number;
  rewardBurstCap: number;
  trailCap: number;
  ambientAlpha: number;
}

const QUALITY_LEVELS: readonly RenderQualityState[] = [
  { level: 0, dprCap: 2.5, glowScale: 0.95, starStride: 1, particleCap: 180, attractionParticleCap: 56, rewardBurstCap: 4, trailCap: 5, ambientAlpha: 0.92 },
  { level: 1, dprCap: 2, glowScale: 0.85, starStride: 1, particleCap: 150, attractionParticleCap: 40, rewardBurstCap: 4, trailCap: 4, ambientAlpha: 0.88 },
  { level: 2, dprCap: 1.65, glowScale: 0.72, starStride: 2, particleCap: 120, attractionParticleCap: 28, rewardBurstCap: 3, trailCap: 3, ambientAlpha: 0.82 },
  { level: 3, dprCap: 1.25, glowScale: 0.6, starStride: 3, particleCap: 88, attractionParticleCap: 20, rewardBurstCap: 2, trailCap: 2, ambientAlpha: 0.76 },
] as const;

const DEFAULT_QUALITY_LEVEL = 2;

let activeRenderQuality: RenderQualityState = QUALITY_LEVELS[DEFAULT_QUALITY_LEVEL] ?? QUALITY_LEVELS[0]!;

const STAR_COUNT = 132;
const MAX_DPR = 3;
const TRAIL_LIFE_SECONDS = 0.34;
function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

function randomBetween(min: number, max: number): number {
  return min + Math.random() * (max - min);
}

function easeOutCubic(value: number): number {
  const inverted = 1 - clamp(value, 0, 1);

  return 1 - inverted * inverted * inverted;
}

export interface StarCoreBurstState {
  scale: number;
  clump: number;
}

export function getStarCoreBurstState(core: Pick<StarCore, "source" | "spawnTime">, time: number): StarCoreBurstState {
  const ageMs = time * 1000 - core.spawnTime * 1000;

  if (ageMs < 72) {
    const rise = easeOutCubic(clamp(ageMs / 72, 0, 1));

    return {
      scale: lerp(1.03, 1.12, rise),
      clump: (1 - rise) * 0.03,
    };
  }

  if (ageMs < 160) {
    const hang = easeOutCubic(clamp((ageMs - 72) / 88, 0, 1));

    return {
      scale: 1.12,
      clump: (1 - hang) * 0.015,
    };
  }

  const settle = easeOutCubic(clamp((ageMs - 160) / 140, 0, 1));

  return {
    scale: lerp(1.12, 1, settle),
    clump: (1 - settle) * 0.01,
  };
}

function lerp(start: number, end: number, progress: number): number {
  return start + (end - start) * progress;
}

function quadraticBezierPoint(
  start: { x: number; y: number },
  control: { x: number; y: number },
  end: { x: number; y: number },
  progress: number,
): { x: number; y: number } {
  const clamped = clamp(progress, 0, 1);
  const inverse = 1 - clamped;

  return {
    x: inverse * inverse * start.x + 2 * inverse * clamped * control.x + clamped * clamped * end.x,
    y: inverse * inverse * start.y + 2 * inverse * clamped * control.y + clamped * clamped * end.y,
  };
}

function approach(current: number, target: number, rate: number, dt: number): number {
  const step = rate * dt;

  if (current < target) {
    return Math.min(target, current + step);
  }

  return Math.max(target, current - step);
}

function seededUnit(index: number, offset: number): number {
  const value = Math.sin(index * 127.1 + offset * 311.7) * 43758.5453123;
  return value - Math.floor(value);
}

function burstUnit(seed: number, offset: number): number {
  return seededUnit(seed + offset * 19.37, offset);
}

function createStars(): Star[] {
  return Array.from({ length: STAR_COUNT }, (_, index) => {
    const layer = seededUnit(index, 7);

    return {
      x: seededUnit(index, 1),
      y: seededUnit(index, 2),
      radius: 0.45 + seededUnit(index, 3) * (layer > 0.74 ? 2.2 : 1.25),
      alpha: 0.22 + seededUnit(index, 4) * 0.74,
      speed: 0.012 + layer * 0.23,
      hue: 174 + seededUnit(index, 6) * 150,
      layer,
      twinkle: seededUnit(index, 8) * Math.PI * 2,
    };
  });
}

function getCanvasSize(canvas: HTMLCanvasElement, dprCap: number = MAX_DPR): CanvasSize {
  const bounds = canvas.getBoundingClientRect();
  const width = Math.max(1, Math.floor(bounds.width || window.innerWidth));
  const height = Math.max(1, Math.floor(bounds.height || window.innerHeight));
  const dpr = Math.max(1, Math.min(window.devicePixelRatio || 1, dprCap));
  const pixelWidth = Math.max(1, Math.floor(width * dpr));
  const pixelHeight = Math.max(1, Math.floor(height * dpr));

  return { width, height, dpr, pixelWidth, pixelHeight };
}

function createRenderState(): RenderState {
  return {
    particles: [],
    rewardBursts: [],
    trails: [],
    blackHoleAlert: null,
    blackHoleAlertAlpha: 0,
    previousScore: null,
    previousPhase: null,
    previousSnakeHeadKey: null,
    previousWallGraceKey: null,
    previousStarAttractorEffectCount: null,
    previousFoods: [],
    shake: {
      time: 0,
      duration: 0,
      intensity: 0,
      directionX: 0,
      directionY: 0,
      mode: "impact",
    },
  };
}

function cellKey(cell: GridCell | null | undefined): string | null {
  return cell ? `${cell.column}:${cell.row}` : null;
}

function cellsMatch(left: GridCell, right: GridCell): boolean {
  return left.column === right.column && left.row === right.row;
}

function prefersReducedMotion(): boolean {
  return typeof window !== "undefined" && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

function triggerShake(
  state: RenderState,
  intensity: number,
  duration: number,
  mode: ShakeMode,
  directionX = 0,
  directionY = 0,
): void {
  if (state.shake.time > 0 && state.shake.intensity > intensity && state.shake.mode === "impact") {
    return;
  }

  state.shake.time = duration;
  state.shake.duration = duration;
  state.shake.intensity = intensity;
  state.shake.directionX = directionX;
  state.shake.directionY = directionY;
  state.shake.mode = mode;
}

function getShakeOffset(shake: ShakeState, time: number): { x: number; y: number } {
  if (shake.time <= 0 || shake.duration <= 0) {
    return { x: 0, y: 0 };
  }

  const progress = 1 - shake.time / shake.duration;

  if (shake.mode === "reward") {
    const pushProgress = clamp(progress / 0.7, 0, 1);
    const recoilProgress = clamp((progress - 0.7) / 0.3, 0, 1);
    const outward = Math.sin(pushProgress * Math.PI) * (1 - pushProgress * 0.08);
    const recoil = Math.sin(recoilProgress * Math.PI) * 0.17;
    const envelope = outward - recoil;

    return {
      x: shake.directionX * shake.intensity * envelope,
      y: shake.directionY * shake.intensity * envelope,
    };
  }

  const falloff = (1 - progress) * (1 - progress);
  const strength = shake.intensity * falloff;

  return {
    x: Math.sin(time * 82.7) * strength + Math.sin(time * 151.3) * strength * 0.35,
    y: Math.cos(time * 94.1) * strength * 0.72,
  };
}

function spawnBurst(state: RenderState, x: number, y: number, count: number, baseHue: number, power: number): void {
  for (let index = 0; index < count; index += 1) {
    const angle = randomBetween(0, Math.PI * 2);
    const speed = randomBetween(power * 0.32, power);
    const hue = baseHue + randomBetween(-36, 42);
    const maxLife = randomBetween(0.48, 0.86);

    state.particles.push({
      x,
      y,
      vx: Math.cos(angle) * speed,
      vy: Math.sin(angle) * speed,
      radius: randomBetween(1.4, 4.8),
      hue,
      life: maxLife,
      maxLife,
      drag: randomBetween(0.82, 0.92),
    });
  }

  const particleCap = activeRenderQuality.particleCap;

  if (state.particles.length > particleCap) {
    state.particles.splice(0, state.particles.length - particleCap);
  }
}

function spawnRewardBurst(state: RenderState, x: number, y: number, cellSize: number): void {
  state.rewardBursts.push({
    x,
    y,
    cellSize,
    life: 0.36,
    maxLife: 0.36,
    angle: randomBetween(0, Math.PI * 2),
    secondaryAngle: randomBetween(0, Math.PI * 2),
    rayCount: Math.floor(randomBetween(11, 15)),
    seed: randomBetween(0, 1000),
  });

  const rewardBurstCap = activeRenderQuality.rewardBurstCap;

  if (state.rewardBursts.length > rewardBurstCap) {
    state.rewardBursts.splice(0, state.rewardBursts.length - rewardBurstCap);
  }
}

interface SpeedTone {
  label: string;
  panel: string;
  border: string;
  text: string;
  glow: string;
  trail: string;
  head: string;
  body: string;
}

const SPEED_TONES: Record<SpeedMode, SpeedTone> = {
  base: {
    label: "基础",
    panel: "rgba(7, 10, 18, 0.66)",
    border: "rgba(143, 251, 255, 0.34)",
    text: "#f7fbff",
    glow: "#00f5ff",
    trail: "#00f5ff",
    head: "#dbff52",
    body: "#00f5ff",
  },
  accelerate: {
    label: "加速",
    panel: "rgba(6, 16, 22, 0.74)",
    border: "rgba(0, 245, 255, 0.58)",
    text: "#eefeff",
    glow: "#00f5ff",
    trail: "#90fbff",
    head: "#ffffff",
    body: "#34f0ff",
  },
  brake: {
    label: "减速",
    panel: "rgba(18, 6, 8, 0.76)",
    border: "rgba(255, 82, 82, 0.58)",
    text: "#ffecec",
    glow: "#ff4a4a",
    trail: "#ff8b8b",
    head: "#fff5f5",
    body: "#ff4f4f",
  },
  boost: {
    label: "冲刺",
    panel: "rgba(6, 12, 16, 0.78)",
    border: "rgba(255, 255, 255, 0.56)",
    text: "#f7fbff",
    glow: "#ffffff",
    trail: "#dbff52",
    head: "#ffffff",
    body: "#7efcff",
  },
};

function getSpeedTone(mode: SpeedMode): SpeedTone {
  return SPEED_TONES[mode];
}

function getSpeedCueStrength(snapshot: GameSnapshot): number {
  if (!snapshot.speedCue || snapshot.speedCue.mode !== snapshot.speedMode) {
    return 0;
  }

  const fade = Math.max(0, Math.min(1, 1 - snapshot.speedCue.fadeProgress));

  return fade * fade;
}

function getSpeedCueIntroStrength(snapshot: GameSnapshot, time: number): number {
  if (!snapshot.speedCue || snapshot.speedCue.mode !== snapshot.speedMode) {
    return 0;
  }

  const introDurationSeconds = 0.15;
  const progress = clamp((time - snapshot.speedCue.startedAt) / introDurationSeconds, 0, 1);

  return easeOutCubic(progress);
}

function getSnakeBrightnessScale(speedMode: SpeedMode): number {
  return speedMode === "base" ? 0.85 : 1;
}

function scaleAlpha(value: number, scale: number): number {
  return Math.max(0, Math.min(1, value * scale));
}

function scaleLightness(value: number, scale: number): number {
  return Math.max(0, Math.min(100, value * scale));
}

function findRemovedFood(previousFoods: readonly GridCell[], currentFoods: readonly GridCell[]): GridCell | null {
  for (const previousFood of previousFoods) {
    if (!currentFoods.some((currentFood) => cellsMatch(currentFood, previousFood))) {
      return previousFood;
    }
  }

  return previousFoods[0] ?? null;
}

function rewardShakeDirection(grid: GridMetrics, point: { x: number; y: number }): { x: number; y: number } {
  const boardCenterX = grid.offsetX + grid.columns * grid.cellSize * 0.5;
  const boardCenterY = grid.offsetY + grid.rows * grid.cellSize * 0.5;
  const deltaX = point.x - boardCenterX;
  const deltaY = point.y - boardCenterY;
  const distance = Math.hypot(deltaX, deltaY);

  if (distance < 1) {
    return { x: 0, y: -1 };
  }

  return {
    x: deltaX / distance,
    y: deltaY / distance,
  };
}

function updateRenderState(state: RenderState, snapshot: GameSnapshot, delta: number): void {
  const dt = Math.min(delta / 1000, 0.05);
  const head = snapshot.snake[0] ?? null;
  const headKey = cellKey(head);
  const scoreIncreased = state.previousScore !== null && snapshot.score > state.previousScore;
  const starAttractorEffectCount = snapshot.starAttractorEffects.length;
  const previousStarAttractorEffectCount = state.previousStarAttractorEffectCount ?? 0;
  const enteredGameOver = snapshot.phase === "gameOver" && state.previousPhase !== "gameOver";
  const enteredPlaying = snapshot.phase === "playing" && state.previousPhase !== "playing";
  const alertVisible = snapshot.phase === "playing" && snapshot.blackHoleAlert !== null;
  const wallGraceKey = snapshot.wallGrace
    ? `${snapshot.wallGrace.direction}:${snapshot.wallGrace.startedAt}:${snapshot.wallGrace.expiresAt}`
    : null;
  const enteredWallGrace = wallGraceKey !== null && wallGraceKey !== state.previousWallGraceKey;
  const starAttractorStateReset =
    snapshot.phase !== state.previousPhase || starAttractorEffectCount < previousStarAttractorEffectCount;
  const enteredStarAttractorEffect =
    !starAttractorStateReset && starAttractorEffectCount > previousStarAttractorEffectCount;

  if (enteredPlaying && snapshot.blackHoleAlert === null) {
    state.blackHoleAlert = null;
    state.blackHoleAlertAlpha = 0;
  }

  if (snapshot.blackHoleAlert) {
    state.blackHoleAlert = snapshot.blackHoleAlert;
  }

  for (const particle of state.particles) {
    particle.life -= dt;
    particle.x += particle.vx * dt;
    particle.y += particle.vy * dt;
    particle.vx *= Math.pow(particle.drag, delta / 16.67);
    particle.vy *= Math.pow(particle.drag, delta / 16.67);
  }

  state.particles = state.particles.filter((particle) => particle.life > 0);

  for (const rewardBurst of state.rewardBursts) {
    rewardBurst.life -= dt;
  }

  state.rewardBursts = state.rewardBursts.filter((rewardBurst) => rewardBurst.life > 0);

  for (const sample of state.trails) {
    sample.life -= dt;
  }

  state.trails = state.trails.filter((sample) => sample.life > 0);
  state.shake.time = Math.max(0, state.shake.time - dt);
  state.blackHoleAlertAlpha = approach(state.blackHoleAlertAlpha, alertVisible ? 1 : 0, 6, dt);

  if (!alertVisible && state.blackHoleAlertAlpha <= 0.001) {
    state.blackHoleAlert = null;
  }

  if (scoreIncreased) {
    const burstCell = findRemovedFood(state.previousFoods, snapshot.foods) ?? head;

    if (burstCell) {
      const center = cellCenter(snapshot.grid, burstCell);
      const shakeDirection = rewardShakeDirection(snapshot.grid, center);
      const particleCount = Math.max(18, Math.round(36 * activeRenderQuality.glowScale));
      const particlePower = snapshot.grid.cellSize * 12;

      spawnRewardBurst(state, center.x, center.y, snapshot.grid.cellSize);
      spawnBurst(state, center.x, center.y, particleCount, 72, particlePower);

      if (!prefersReducedMotion()) {
        triggerShake(state, 2.05, 0.12, "reward", shakeDirection.x, shakeDirection.y);
      }
    }
  }

  if (enteredGameOver && head) {
    const center = cellCenter(snapshot.grid, head);
    spawnBurst(state, center.x, center.y, Math.max(40, Math.round(84 * activeRenderQuality.glowScale)), 318, snapshot.grid.cellSize * 16);
    triggerShake(state, 7.2, 0.28, "impact");
  }

  if (enteredWallGrace && !prefersReducedMotion()) {
    triggerShake(state, 1.45, 0.1, "impact");
  }

  if (enteredStarAttractorEffect && !scoreIncreased && !prefersReducedMotion()) {
    const effect = snapshot.starAttractorEffects[starAttractorEffectCount - 1];

    if (effect) {
      const center = cellCenter(snapshot.grid, effect.origin);
      const shakeDirection = rewardShakeDirection(snapshot.grid, center);
      const intensity = Math.min(2.1, 1.25 + effect.absorbCount * 0.1);

      triggerShake(state, intensity, 0.12, "reward", shakeDirection.x, shakeDirection.y);
    }
  }

  if (
    snapshot.phase === "playing" &&
    headKey !== null &&
    state.previousSnakeHeadKey !== null &&
    headKey !== state.previousSnakeHeadKey
  ) {
    state.trails.push({
      cells: snapshot.snake.map((segment) => ({ column: segment.column, row: segment.row })),
      life: TRAIL_LIFE_SECONDS,
      maxLife: TRAIL_LIFE_SECONDS,
    });

    const trailCap = activeRenderQuality.trailCap;

    if (state.trails.length > trailCap) {
      state.trails.splice(0, state.trails.length - trailCap);
    }
  }

  state.previousScore = snapshot.score;
  state.previousPhase = snapshot.phase;
  state.previousSnakeHeadKey = headKey;
  state.previousWallGraceKey = wallGraceKey;
  state.previousStarAttractorEffectCount = starAttractorEffectCount;
  state.previousFoods = snapshot.foods.map((food) => ({ ...food }));
}

function drawBackground(context: CanvasRenderingContext2D, size: CanvasSize, time: number): void {
  const pulse = 0.5 + Math.sin(time * 1.35) * 0.5;
  const centerX = size.width * (0.48 + Math.sin(time * 0.12) * 0.04);
  const centerY = size.height * (0.42 + Math.cos(time * 0.1) * 0.04);
  const radius = Math.max(size.width, size.height) * 0.92;
  const space = context.createRadialGradient(centerX, centerY, 0, size.width * 0.5, size.height * 0.54, radius);

  space.addColorStop(0, "#17265f");
  space.addColorStop(0.34, "#090d2b");
  space.addColorStop(0.72, "#030613");
  space.addColorStop(1, "#010208");

  context.fillStyle = space;
  context.fillRect(0, 0, size.width, size.height);

  context.save();
  context.globalCompositeOperation = "lighter";
  context.globalAlpha = 0.22 + pulse * 0.08;

  const cyanWash = context.createLinearGradient(0, 0, size.width, size.height);
  cyanWash.addColorStop(0, "rgba(0, 245, 255, 0.16)");
  cyanWash.addColorStop(0.42, "rgba(0, 245, 255, 0.02)");
  cyanWash.addColorStop(1, "rgba(255, 43, 214, 0.1)");
  context.fillStyle = cyanWash;
  context.fillRect(0, 0, size.width, size.height);

  context.globalAlpha = 0.08;
  context.fillStyle = "#ffffff";
  const scanlineGap = 5;
  const scanOffset = (time * 18) % scanlineGap;

  for (let y = -scanlineGap + scanOffset; y < size.height; y += scanlineGap) {
    context.fillRect(0, y, size.width, 1);
  }

  context.restore();

  const vignette = context.createRadialGradient(
    size.width * 0.5,
    size.height * 0.5,
    Math.min(size.width, size.height) * 0.18,
    size.width * 0.5,
    size.height * 0.5,
    Math.max(size.width, size.height) * 0.78,
  );
  vignette.addColorStop(0, "rgba(0, 0, 0, 0)");
  vignette.addColorStop(1, "rgba(0, 0, 0, 0.62)");
  context.fillStyle = vignette;
  context.fillRect(0, 0, size.width, size.height);
}

function drawStars(context: CanvasRenderingContext2D, size: CanvasSize, stars: readonly Star[], time: number): void {
  context.save();
  context.globalCompositeOperation = "lighter";

  const starStride = Math.max(1, activeRenderQuality.starStride);

  for (let index = 0; index < stars.length; index += 1) {
    if (index % starStride !== 0) {
      continue;
    }

    const star = stars[index];

    if (!star) {
      continue;
    }

    const drift = (time * star.speed) % 1;
    const parallax = 0.35 + star.layer * 0.9;
    const x = (star.x * size.width + Math.sin(time * 0.08 + star.twinkle) * 18 * parallax) % size.width;
    const y = ((star.y + drift) % 1) * size.height;
    const shimmer = 0.58 + Math.sin(time * (2.8 + star.layer * 5.4) + star.twinkle) * 0.42;
    const alpha = clamp(star.alpha * shimmer, 0.05, 0.95);

    context.globalAlpha = alpha;
    context.fillStyle = `hsl(${star.hue} 100% ${70 + star.layer * 16}%)`;
    context.shadowColor = `hsl(${star.hue} 100% 68%)`;
    context.shadowBlur = (star.layer > 0.72 ? 6 : 2) * activeRenderQuality.glowScale;
    context.beginPath();
    context.arc(x < 0 ? x + size.width : x, y, star.radius, 0, Math.PI * 2);
    context.fill();
  }

  context.lineCap = "round";

  const streakCount = Math.max(4, Math.round(8 * activeRenderQuality.ambientAlpha));

  for (let index = 0; index < streakCount; index += 1) {
    const seedX = seededUnit(index, 18);
    const seedY = seededUnit(index, 19);
    const drift = (time * (0.07 + seededUnit(index, 20) * 0.1)) % 1;
    const x = (seedX + drift) % 1 * size.width;
    const y = (seedY + drift * 0.28) % 1 * size.height;
    const length = 24 + seededUnit(index, 21) * 58;

    context.globalAlpha = 0.08 + seededUnit(index, 22) * 0.12;
    context.strokeStyle = "rgba(143, 251, 255, 0.85)";
    context.shadowColor = "#00f5ff";
    context.shadowBlur = 8 * activeRenderQuality.glowScale;
    context.lineWidth = 1.2;
    context.beginPath();
    context.moveTo(x, y);
    context.lineTo(x - length, y - length * 0.28);
    context.stroke();
  }

  context.restore();
}

function drawGrid(context: CanvasRenderingContext2D, size: CanvasSize, time: number): void {
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

function drawCoreGlow(context: CanvasRenderingContext2D, size: CanvasSize, time: number): void {
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
    context.shadowBlur = 16 * activeRenderQuality.glowScale;
    context.lineWidth = 1.2 + index * 0.8;
    context.beginPath();
    context.ellipse(0, 0, ringRadius * (1 + index * 0.16), ringRadius * 0.38, index * 0.72, 0, Math.PI * 2);
    context.stroke();
  }

  context.globalAlpha = 0.72;
  context.fillStyle = "rgba(219, 255, 82, 0.86)";
  context.shadowColor = "#dbff52";
  context.shadowBlur = 24 * activeRenderQuality.glowScale;
  context.beginPath();
  context.arc(0, 0, 4 + pulse * 3, 0, Math.PI * 2);
  context.fill();

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

function cellCenter(grid: GridMetrics, cell: GridCell): { x: number; y: number } {
  return {
    x: grid.offsetX + cell.column * grid.cellSize + grid.cellSize / 2,
    y: grid.offsetY + cell.row * grid.cellSize + grid.cellSize / 2,
  };
}

function drawBoard(context: CanvasRenderingContext2D, snapshot: GameSnapshot, time: number): void {
  const { grid } = snapshot;
  const width = grid.columns * grid.cellSize;
  const height = grid.rows * grid.cellSize;
  const pulse = 0.5 + Math.sin(time * 2.1) * 0.5;

  context.save();
  context.globalCompositeOperation = "source-over";
  context.shadowColor = "rgba(0, 245, 255, 0.54)";
  context.shadowBlur = 30 + pulse * 18;
  context.fillStyle = "rgba(1, 8, 20, 0.7)";
  fillRoundedRect(context, grid.offsetX - 9, grid.offsetY - 9, width + 18, height + 18, 14);

  context.shadowColor = "rgba(255, 43, 214, 0.28)";
  context.shadowBlur = 22;
  context.strokeStyle = "rgba(143, 251, 255, 0.52)";
  context.lineWidth = 1;
  context.strokeRect(grid.offsetX - 0.5, grid.offsetY - 0.5, width + 1, height + 1);

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

function drawFood(context: CanvasRenderingContext2D, snapshot: GameSnapshot, time: number): void {
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
    const pulse = 0.72 + Math.sin(time * 8.4 + index * 1.3) * 0.28;
    const outerRadius = grid.cellSize * (0.34 + pulse * 0.07 + index * 0.02);
    const innerRadius = outerRadius * 0.43;

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
    context.arc(0, 0, outerRadius * 1.72, 0, Math.PI * 2);
    context.fill();

    const starGradient = context.createRadialGradient(-outerRadius * 0.22, -outerRadius * 0.25, 0, 0, 0, outerRadius);
    starGradient.addColorStop(0, "#ffffff");
    starGradient.addColorStop(0.3, index === 0 ? "#dbff52" : "#00f5ff");
    starGradient.addColorStop(1, "#ff2bd6");
    context.fillStyle = starGradient;
    context.shadowBlur = 32;
    context.beginPath();

    for (let point = 0; point < 12; point += 1) {
      const radius = point % 2 === 0 ? outerRadius : innerRadius;
      const angle = -Math.PI / 2 + (point * Math.PI) / 6;
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

function drawStarCores(context: CanvasRenderingContext2D, snapshot: GameSnapshot, time: number): void {
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
    const isStarBeastCore = core.source === "star_beast";
    const spawnProgress = clamp(ageMs / 180, 0, 1);
    const sourceGlowScale = isStarBeastCore ? 1.08 : 1;
    const alpha = spawnProgress * clamp((1 - lifeProgress) * 1.2, 0.25, 1);
    const centerX = grid.offsetX + core.x * grid.cellSize;
    const centerY = grid.offsetY + core.y * grid.cellSize;
    const burstTarget = core.burstOrigin ? cellCenter(grid, core.burstOrigin) : null;
    const renderX = burstTarget ? lerp(centerX, burstTarget.x, burstState.clump) : centerX;
    const renderY = burstTarget ? lerp(centerY, burstTarget.y, burstState.clump) : centerY;
    const pulse = 0.72 + Math.sin(time * 9.2 + index * 1.7 + core.id * 0.01) * 0.28;
    const radius = grid.cellSize * (0.12 + pulse * 0.08);
    const shadowColor = isStarBeastCore ? "#00f5ff" : "#dbff52";
    const accentColor = isStarBeastCore ? "#00f5ff" : "#dbff52";

    context.save();
    context.translate(renderX, renderY);
    context.scale(burstState.scale, burstState.scale);
    context.rotate(time * 2.2 + core.id * 0.017);
    context.globalAlpha = alpha * sourceGlowScale;
    context.shadowColor = shadowColor;
    context.shadowBlur = (14 + pulse * 8) * burstState.scale * sourceGlowScale;

    const halo = context.createRadialGradient(0, 0, 0, 0, 0, grid.cellSize * (0.44 + pulse * 0.14));
    halo.addColorStop(0, "rgba(255, 255, 255, 0.92)");
    halo.addColorStop(0.34, isStarBeastCore ? "rgba(0, 245, 255, 0.34)" : "rgba(219, 255, 82, 0.38)");
    halo.addColorStop(0.64, isStarBeastCore ? "rgba(255, 43, 214, 0.22)" : "rgba(0, 245, 255, 0.18)");
    halo.addColorStop(1, "rgba(0, 0, 0, 0)");
    context.fillStyle = halo;
    context.beginPath();
    context.arc(0, 0, grid.cellSize * (0.42 + pulse * 0.14), 0, Math.PI * 2);
    context.fill();

    const coreGradient = context.createRadialGradient(
      -radius * 0.2,
      -radius * 0.24,
      0,
      0,
      0,
      grid.cellSize * 0.26,
    );
    coreGradient.addColorStop(0, "#ffffff");
    coreGradient.addColorStop(0.28, core.id % 2 === 0 ? accentColor : "#ff2bd6");
    coreGradient.addColorStop(1, "#ff2bd6");
    context.fillStyle = coreGradient;
    context.beginPath();

    for (let point = 0; point < 10; point += 1) {
      const ratio = point % 2 === 0 ? 1 : 0.48;
      const angle = -Math.PI / 2 + (point / 10) * Math.PI * 2;
      const x = Math.cos(angle) * grid.cellSize * ratio * 0.22;
      const y = Math.sin(angle) * grid.cellSize * ratio * 0.22;

      if (point === 0) {
        context.moveTo(x, y);
      } else {
        context.lineTo(x, y);
      }
    }

    context.closePath();
    context.fill();

    context.globalAlpha = alpha * 0.48 * sourceGlowScale;
    context.strokeStyle = isStarBeastCore ? "rgba(255, 255, 255, 0.96)" : "rgba(255, 255, 255, 0.9)";
    context.lineWidth = Math.max(1, grid.cellSize * 0.04);
    context.beginPath();
    context.arc(0, 0, grid.cellSize * 0.18, 0, Math.PI * 2);
    context.stroke();

    context.restore();
  }

  context.restore();
}

function drawStarAttractors(context: CanvasRenderingContext2D, snapshot: GameSnapshot, time: number): void {
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

function drawStarAttractorEffects(context: CanvasRenderingContext2D, snapshot: GameSnapshot, time: number): void {
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

function drawStarBeasts(context: CanvasRenderingContext2D, snapshot: GameSnapshot, time: number): void {
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

function drawStarBeastEffects(context: CanvasRenderingContext2D, snapshot: GameSnapshot, time: number): void {
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

export function drawWallGraceWarning(context: CanvasRenderingContext2D, snapshot: GameSnapshot, time: number): void {
  const grace = snapshot.wallGrace;

  if (snapshot.phase !== "playing" || !grace) {
    return;
  }

  const { grid } = snapshot;
  const width = grid.columns * grid.cellSize;
  const height = grid.rows * grid.cellSize;
  const duration = Math.max(1, grace.expiresAt - grace.startedAt);
  const progress = clamp((time * 1000 - grace.startedAt) / duration, 0, 1);
  const pulse = prefersReducedMotion() ? 1 : 0.68 + Math.sin(time * 24.5) * 0.32;
  const alpha = (1 - progress) * pulse;
  const borderAlpha = Math.min(1, 0.2 + alpha * 0.5);
  const bandSize = Math.max(10, grid.cellSize * 0.82);
  const edgeLine = Math.max(1.5, grid.cellSize * 0.09);
  const left = grid.offsetX;
  const top = grid.offsetY;

  context.save();
  context.globalCompositeOperation = "lighter";
  context.shadowColor = "rgba(255, 82, 82, 0.96)";
  context.shadowBlur = Math.max(12, grid.cellSize * 0.9) * alpha;
  context.strokeStyle = `rgba(255, 82, 82, ${borderAlpha})`;
  context.lineWidth = Math.max(1.6, grid.cellSize * 0.08);
  context.strokeRect(left - 0.5, top - 0.5, width + 1, height + 1);

  context.fillStyle = `rgba(255, 43, 214, ${0.06 + alpha * 0.08})`;
  context.fillRect(left - 8, top - 8, width + 16, height + 16);

  switch (grace.direction) {
    case "up": {
      const gradient = context.createLinearGradient(0, top - bandSize, 0, top + bandSize * 0.3);
      gradient.addColorStop(0, `rgba(255, 43, 214, ${alpha * 0.74})`);
      gradient.addColorStop(0.45, `rgba(255, 82, 82, ${alpha * 0.5})`);
      gradient.addColorStop(1, "rgba(255, 82, 82, 0)");
      context.fillStyle = gradient;
      context.fillRect(left - 2, top - bandSize, width + 4, bandSize);
      context.fillStyle = `rgba(255, 255, 255, ${alpha * 0.22})`;
      context.fillRect(left, top - edgeLine * 0.5, width, edgeLine);
      break;
    }
    case "down": {
      const gradient = context.createLinearGradient(0, top + height + bandSize, 0, top + height - bandSize * 0.3);
      gradient.addColorStop(0, `rgba(255, 43, 214, ${alpha * 0.74})`);
      gradient.addColorStop(0.45, `rgba(255, 82, 82, ${alpha * 0.5})`);
      gradient.addColorStop(1, "rgba(255, 82, 82, 0)");
      context.fillStyle = gradient;
      context.fillRect(left - 2, top + height, width + 4, bandSize);
      context.fillStyle = `rgba(255, 255, 255, ${alpha * 0.22})`;
      context.fillRect(left, top + height - edgeLine * 0.5, width, edgeLine);
      break;
    }
    case "left": {
      const gradient = context.createLinearGradient(left - bandSize, 0, left + bandSize * 0.3, 0);
      gradient.addColorStop(0, `rgba(255, 43, 214, ${alpha * 0.74})`);
      gradient.addColorStop(0.45, `rgba(255, 82, 82, ${alpha * 0.5})`);
      gradient.addColorStop(1, "rgba(255, 82, 82, 0)");
      context.fillStyle = gradient;
      context.fillRect(left - bandSize, top - 2, bandSize, height + 4);
      context.fillStyle = `rgba(255, 255, 255, ${alpha * 0.22})`;
      context.fillRect(left - edgeLine * 0.5, top, edgeLine, height);
      break;
    }
    case "right": {
      const gradient = context.createLinearGradient(left + width + bandSize, 0, left + width - bandSize * 0.3, 0);
      gradient.addColorStop(0, `rgba(255, 43, 214, ${alpha * 0.74})`);
      gradient.addColorStop(0.45, `rgba(255, 82, 82, ${alpha * 0.5})`);
      gradient.addColorStop(1, "rgba(255, 82, 82, 0)");
      context.fillStyle = gradient;
      context.fillRect(left + width, top - 2, bandSize, height + 4);
      context.fillStyle = `rgba(255, 255, 255, ${alpha * 0.22})`;
      context.fillRect(left + width - edgeLine * 0.5, top, edgeLine, height);
      break;
    }
  }

  context.restore();
}

function drawBlackHole(context: CanvasRenderingContext2D, snapshot: GameSnapshot, blackHole: BlackHole, time: number): void {
  const { grid } = snapshot;
  const variant = getBlackHoleVariant(blackHole.kind);
  const center = cellCenter(grid, blackHole.cell);
  const formation = getBlackHoleFormationProgress(blackHole, time);
  const active = isBlackHoleActive(blackHole, time);
  const pulse = 0.5 + Math.sin(time * variant.pulseSpeed + blackHole.seed * 0.01) * 0.5;
  const influenceRadius = variant.influenceRadiusCells;
  const preview = active ? 1 : clamp((formation - 0.16) / 0.46, 0, 1);
  const coreRadiusCells = Math.max(0.42, variant.bodyRadiusCells);
  const coreRadius = grid.cellSize * (0.16 + coreRadiusCells * 0.06);
  const fieldRadius = grid.cellSize * (0.58 + influenceRadius * 0.06);
  const warningRadius = grid.cellSize * (0.78 + (influenceRadius + 1) * 0.06);
  const innerRingRadius = grid.cellSize * (0.34 + coreRadiusCells * 0.08);
  const outerRingRadius = grid.cellSize * (0.58 + influenceRadius * 0.06);
  const fieldAlpha = active ? 0.32 + pulse * 0.08 : preview * 0.22;
  const warningAlpha = active ? 0.16 + pulse * 0.05 : preview * 0.12;

  context.save();
  context.translate(center.x, center.y);

  const fieldGlow = context.createRadialGradient(0, 0, grid.cellSize * 0.05, 0, 0, fieldRadius);
  fieldGlow.addColorStop(0, `rgba(0, 0, 0, ${0.99 - formation * 0.03})`);
  fieldGlow.addColorStop(0.42, `rgba(7, 10, 18, ${0.9 - formation * 0.03})`);
  fieldGlow.addColorStop(0.7, `rgba(18, 10, 28, ${0.22 + fieldAlpha * 0.16})`);
  fieldGlow.addColorStop(1, "rgba(0, 0, 0, 0)");
  context.globalCompositeOperation = "source-over";
  context.globalAlpha = 1;
  context.fillStyle = fieldGlow;
  context.beginPath();
  context.arc(0, 0, fieldRadius, 0, Math.PI * 2);
  context.fill();

  const warningGlow = context.createRadialGradient(0, 0, fieldRadius * 0.72, 0, 0, warningRadius);
  warningGlow.addColorStop(0, "rgba(0, 0, 0, 0)");
  warningGlow.addColorStop(0.6, `rgba(255, 43, 214, ${0.02 + warningAlpha * 0.16})`);
  warningGlow.addColorStop(0.84, `rgba(0, 245, 255, ${0.015 + warningAlpha * 0.08})`);
  warningGlow.addColorStop(1, "rgba(0, 0, 0, 0)");
  context.fillStyle = warningGlow;
  context.beginPath();
  context.arc(0, 0, warningRadius, 0, Math.PI * 2);
  context.fill();

  context.globalCompositeOperation = "lighter";
  context.shadowColor = active ? "#00f5ff" : "#ff2bd6";
  context.shadowBlur = (4 + pulse * 2) * activeRenderQuality.glowScale;
  context.strokeStyle = active ? "rgba(143, 251, 255, 0.16)" : "rgba(255, 43, 214, 0.14)";
  context.lineWidth = Math.max(0.9, grid.cellSize * 0.03);

  context.globalAlpha = active ? 0.86 : preview * 0.56;
  context.beginPath();
  context.arc(0, 0, innerRingRadius, -Math.PI / 3 + pulse * 0.14, Math.PI * 1.03 + pulse * 0.14);
  context.stroke();

  context.globalAlpha = active ? 0.24 + pulse * 0.05 : preview * 0.18;
  context.beginPath();
  context.arc(0, 0, outerRingRadius, Math.PI * 0.28 - pulse * 0.1, Math.PI * 1.38 - pulse * 0.1);
  context.stroke();

  context.globalAlpha = 1;
  context.shadowColor = "#000000";
  context.shadowBlur = 0;
  context.fillStyle = "rgba(1, 2, 6, 0.99)";
  context.beginPath();
  context.arc(0, 0, coreRadius, 0, Math.PI * 2);
  context.fill();

  context.globalAlpha = active ? 0.34 : preview * 0.22;
  context.shadowColor = active ? "#dbff52" : "#ff2bd6";
  context.shadowBlur = 2 * activeRenderQuality.glowScale;
  context.fillStyle = active ? "rgba(143, 251, 255, 0.56)" : "rgba(255, 43, 214, 0.5)";
  context.beginPath();
  context.arc(coreRadius * 0.42, -coreRadius * 0.18, Math.max(1.05, grid.cellSize * 0.034), 0, Math.PI * 2);
  context.fill();

  context.restore();
}

function drawSnakePathGlow(
  context: CanvasRenderingContext2D,
  grid: GridMetrics,
  snake: readonly GridCell[],
  snapshot: GameSnapshot,
  time: number,
  speedMode: SpeedMode,
): void {
  if (snake.length < 2) {
    return;
  }

  const speedTone = getSpeedTone(speedMode);
  const modeIntensity = speedMode === "boost" ? 1.18 : speedMode === "accelerate" ? 1.08 : speedMode === "brake" ? 1.12 : 1;
  const snakeBrightness = getSnakeBrightnessScale(speedMode);
  const cueIntroStrength = getSpeedCueIntroStrength(snapshot, time);
  const cueVisualStrength = getSpeedCueStrength(snapshot) * cueIntroStrength;

  context.save();
  context.globalCompositeOperation = "lighter";
  context.lineCap = "round";
  context.lineJoin = "round";
  const glowScale = activeRenderQuality.glowScale;
  const passCount = activeRenderQuality.level === 0 ? 2 : 1;

  for (let pass = 0; pass < passCount; pass += 1) {
    context.beginPath();

    for (let index = snake.length - 1; index >= 0; index -= 1) {
      const center = cellCenter(grid, snake[index] as GridCell);

      if (index === snake.length - 1) {
        context.moveTo(center.x, center.y);
      } else {
        context.lineTo(center.x, center.y);
      }
    }

    const pulse = 0.65 + Math.sin(time * 4.6) * 0.35;
    const cueBoost = 1 + cueVisualStrength * 0.3;
    context.globalAlpha = (pass === 0 ? 0.32 : 0.82) * cueBoost * snakeBrightness;
    context.shadowColor = pass === 0 ? speedTone.glow : speedTone.trail;
    context.shadowBlur = (pass === 0 ? 18 : 10) * cueBoost * modeIntensity * snakeBrightness * glowScale;
    context.strokeStyle =
      pass === 0
        ? speedMode === "base"
          ? `rgba(0, 245, 255, ${0.34 * snakeBrightness})`
          : speedMode === "brake"
            ? "rgba(255, 74, 74, 0.42)"
            : speedMode === "boost"
              ? "rgba(255, 255, 255, 0.42)"
              : "rgba(0, 245, 255, 0.42)"
        : speedMode === "base"
          ? `rgba(219, 255, 82, ${scaleAlpha(0.22 + pulse * 0.16, snakeBrightness)})`
          : speedMode === "brake"
            ? `rgba(255, 138, 138, ${0.2 + pulse * 0.16})`
            : speedMode === "boost"
              ? `rgba(219, 255, 82, ${0.18 + pulse * 0.18})`
          : `rgba(144, 251, 255, ${0.2 + pulse * 0.16})`;
    context.lineWidth = grid.cellSize * (pass === 0 ? 0.82 : 0.34) * cueBoost * modeIntensity * snakeBrightness;
    context.stroke();
  }

  context.restore();
}

function drawSpeedPulse(context: CanvasRenderingContext2D, snapshot: GameSnapshot, time: number): void {
  const cue = snapshot.speedCue;

  if (snapshot.phase !== "playing" || !cue) {
    return;
  }

  const tone = getSpeedTone(cue.mode);
  const center = cellCenter(snapshot.grid, cue.anchor);
  const cueStrength = getSpeedCueStrength(snapshot);
  const cueIntroStrength = getSpeedCueIntroStrength(snapshot, time);
  const cueVisualStrength = cueStrength * cueIntroStrength;
  const pulse = prefersReducedMotion() ? 1 : 0.92 + Math.sin(time * 10.2 + cue.startedAt * 0.004) * 0.08;
  const radius = snapshot.grid.cellSize * (0.24 + cueVisualStrength * 1.06);

  context.save();
  context.globalCompositeOperation = "lighter";
  context.translate(center.x, center.y);
  context.globalAlpha = cueVisualStrength * pulse;
  context.shadowColor = tone.glow;
  context.shadowBlur = snapshot.grid.cellSize * (0.18 + cueVisualStrength * 1.24) * activeRenderQuality.glowScale;

  const fill = context.createRadialGradient(0, 0, 0, 0, 0, radius * 1.25);
  fill.addColorStop(0, tone.head);
  fill.addColorStop(0.32, tone.glow);
  fill.addColorStop(0.68, tone.body);
  fill.addColorStop(1, "rgba(0, 0, 0, 0)");

  context.fillStyle = fill;
  context.beginPath();
  context.arc(0, 0, radius * 1.12, 0, Math.PI * 2);
  context.fill();

  context.globalAlpha = cueVisualStrength * 0.76;
  context.strokeStyle = tone.border;
  context.lineWidth = Math.max(1, snapshot.grid.cellSize * 0.05);
  context.beginPath();
  context.arc(0, 0, radius * 0.84, 0, Math.PI * 2);
  context.stroke();

  context.restore();
}

function drawHeadCue(
  context: CanvasRenderingContext2D,
  grid: GridMetrics,
  head: GridCell,
  direction: Direction,
): void {
  const center = cellCenter(grid, head);
  const vectors: Record<Direction, { x: number; y: number }> = {
    up: { x: 0, y: -1 },
    right: { x: 1, y: 0 },
    down: { x: 0, y: 1 },
    left: { x: -1, y: 0 },
  };
  const forward = vectors[direction];
  const side = { x: -forward.y, y: forward.x };
  const eyeForward = grid.cellSize * 0.17;
  const eyeSide = grid.cellSize * 0.16;
  const eyeRadius = Math.max(1.7, grid.cellSize * 0.07);
  const highlightX = center.x + forward.x * grid.cellSize * 0.22;
  const highlightY = center.y + forward.y * grid.cellSize * 0.22;

  context.save();
  context.globalCompositeOperation = "lighter";
  context.fillStyle = "rgba(255, 255, 255, 0.72)";
  context.shadowColor = "#ffffff";
  context.shadowBlur = 8;
  context.beginPath();
  context.arc(highlightX, highlightY, grid.cellSize * 0.1, 0, Math.PI * 2);
  context.fill();

  context.globalCompositeOperation = "source-over";
  context.shadowBlur = 0;
  context.fillStyle = "#031015";

  for (const sign of [-1, 1]) {
    context.beginPath();
    context.arc(
      center.x + forward.x * eyeForward + side.x * eyeSide * sign,
      center.y + forward.y * eyeForward + side.y * eyeSide * sign,
      eyeRadius,
      0,
      Math.PI * 2,
    );
    context.fill();
  }

  context.restore();
}

function drawBlackHoleCue(context: CanvasRenderingContext2D, snapshot: GameSnapshot, time: number): void {
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

function drawBlackHoleAlert(
  context: CanvasRenderingContext2D,
  snapshot: GameSnapshot,
  size: CanvasSize,
  time: number,
  blackHoleAlert: GameSnapshot["blackHoleAlert"],
  alertAlpha: number,
): void {
  if (snapshot.phase !== "playing" || !blackHoleAlert || alertAlpha <= 0.01) {
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
  const centerY = Math.max(76, Math.min(size.height * 0.2, grid.offsetY - grid.cellSize * 0.35));
  const bannerX = centerX - bannerWidth * 0.5;
  const bannerY = centerY - bannerHeight * 0.5;
  const pulse = prefersReducedMotion() ? 1 : 0.92 + Math.sin(time * 5.5) * 0.08;
  const alpha = alertAlpha * pulse;

  context.globalAlpha = alpha;
  context.shadowColor = "#ff2bd6";
  context.shadowBlur = (12 + pulse * 6) * activeRenderQuality.glowScale;
  context.fillStyle = "rgba(7, 10, 18, 0.68)";
  fillRoundedRect(context, bannerX, bannerY, bannerWidth, bannerHeight, bannerHeight * 0.5);

  context.strokeStyle = "rgba(255, 43, 214, 0.42)";
  context.lineWidth = 1.5;
  context.beginPath();
  context.roundRect(bannerX + 0.75, bannerY + 0.75, bannerWidth - 1.5, bannerHeight - 1.5, bannerHeight * 0.5);
  context.stroke();

  context.globalAlpha = alpha * 0.92;
  context.fillStyle = "rgba(255, 43, 214, 0.82)";
  fillRoundedRect(context, bannerX + 10, bannerY + 10, 4, Math.max(6, bannerHeight - 20), 2);

  context.fillStyle = "#f7fbff";
  context.shadowColor = "#dbff52";
  context.shadowBlur = (6 + pulse * 4) * activeRenderQuality.glowScale;
  context.font = `800 ${fontSize}px system-ui, sans-serif`;
  context.fillText(message, centerX, centerY);

  context.restore();
}

function drawSnakeTrail(
  context: CanvasRenderingContext2D,
  snapshot: GameSnapshot,
  trails: readonly TrailSample[],
  time: number,
): void {
  const { grid, speedMode } = snapshot;
  const cellGap = Math.max(2, grid.cellSize * 0.12);
  const segmentSize = grid.cellSize - cellGap * 2;
  const speedTone = getSpeedTone(speedMode);
  const tintStrength = speedMode === "base" ? 0 : Math.min(1, Math.abs(snapshot.speedMultiplier - 1) / 0.67);
  const cueStrength = getSpeedCueStrength(snapshot);
  const cueIntroStrength = getSpeedCueIntroStrength(snapshot, time);
  const cueVisualStrength = cueStrength * cueIntroStrength;
  const snakeBrightness = getSnakeBrightnessScale(speedMode);

  context.save();
  context.globalCompositeOperation = "lighter";

  for (const sample of trails) {
    const alpha = clamp(sample.life / sample.maxLife, 0, 1);

    for (let index = sample.cells.length - 1; index >= 0; index -= 1) {
      const segment = sample.cells[index];

      if (!segment) {
        continue;
      }

      const age = sample.cells.length <= 1 ? 1 : 1 - index / (sample.cells.length - 1);
      const x = grid.offsetX + segment.column * grid.cellSize + cellGap;
      const y = grid.offsetY + segment.row * grid.cellSize + cellGap;
      const bodyLightness = speedMode === "base" ? scaleLightness(50 + age * 24, snakeBrightness) : 50 + age * 24;

      context.globalAlpha = alpha * (0.06 + age * 0.18) * (1 + tintStrength * 0.08 + cueVisualStrength * 0.14);
      context.shadowColor = index === 0 ? speedTone.head : speedMode === "base" ? "#00f5ff" : speedTone.trail;
      context.shadowBlur = (18 + tintStrength * 8 + cueVisualStrength * 10) * alpha * snakeBrightness * activeRenderQuality.glowScale;
      context.fillStyle = index === 0
        ? speedTone.head
        : speedMode === "base"
          ? `hsl(${184 + age * 76} 100% ${bodyLightness}%)`
          : speedTone.body;
      fillRoundedRect(context, x, y, segmentSize, segmentSize, index === 0 ? 9 : 7);
    }
  }

  context.restore();
}

function drawSnake(context: CanvasRenderingContext2D, snapshot: GameSnapshot, time: number): void {
  const { direction, grid, phase, snake, speedMode } = snapshot;
  const cellGap = Math.max(2, grid.cellSize * 0.12);
  const segmentSize = grid.cellSize - cellGap * 2;
  const isGameOver = phase === "gameOver";
  const speedTone = getSpeedTone(speedMode);
  const tintStrength = speedMode === "base" ? 0 : Math.min(1, Math.abs(snapshot.speedMultiplier - 1) / 0.67);
  const cueStrength = getSpeedCueStrength(snapshot);
  const cueIntroStrength = getSpeedCueIntroStrength(snapshot, time);
  const cueVisualStrength = cueStrength * cueIntroStrength;
  const snakeBrightness = getSnakeBrightnessScale(speedMode);

  drawSnakePathGlow(context, grid, snake, snapshot, time, speedMode);

  context.save();
  context.globalCompositeOperation = "lighter";
  drawSpeedPulse(context, snapshot, time);
  const glowScale = activeRenderQuality.glowScale;

  for (let index = snake.length - 1; index >= 0; index -= 1) {
    const segment = snake[index];

    if (!segment) {
      continue;
    }

    const isHead = index === 0;
    const age = snake.length <= 1 ? 1 : 1 - index / (snake.length - 1);
    const x = grid.offsetX + segment.column * grid.cellSize + cellGap;
    const y = grid.offsetY + segment.row * grid.cellSize + cellGap;
    const pulse = 0.72 + Math.sin(time * 5.2 + index * 0.55) * 0.28;
    context.globalAlpha = isGameOver ? 0.56 : 0.78 + age * 0.22 + tintStrength * 0.06 + cueVisualStrength * 0.08;
    context.shadowColor = isHead ? speedTone.head : speedMode === "base" ? "#00f5ff" : speedTone.trail;
    context.shadowBlur = isHead
      ? (30 + tintStrength * 8 + cueVisualStrength * 10) * snakeBrightness * glowScale
      : (17 + pulse * 8 + tintStrength * 5 + cueVisualStrength * 4) * snakeBrightness * glowScale;

    if (isHead) {
      const headGradient = context.createRadialGradient(
        x + segmentSize * 0.35,
        y + segmentSize * 0.28,
        0,
        x + segmentSize * 0.5,
        y + segmentSize * 0.5,
        segmentSize * 0.72,
      );
      headGradient.addColorStop(0, "#ffffff");
      headGradient.addColorStop(0.32, speedTone.head);
      headGradient.addColorStop(1, speedMode === "base" ? "#00f5ff" : speedTone.body);
      context.fillStyle = headGradient;
      fillRoundedRect(context, x - 1, y - 1, segmentSize + 2, segmentSize + 2, 9);

      if (speedMode !== "base") {
        context.globalAlpha = isGameOver ? 0.22 : 0.42 + tintStrength * 0.18 + cueVisualStrength * 0.1;
        context.strokeStyle = speedTone.glow;
        context.lineWidth = Math.max(1, grid.cellSize * 0.05);
        context.beginPath();
        context.roundRect(x + 0.5, y + 0.5, segmentSize - 1, segmentSize - 1, 9);
        context.stroke();
      }
    } else {
      context.fillStyle = speedMode === "base"
        ? `hsl(${178 + age * 76} 100% ${scaleLightness(50 + age * 24, snakeBrightness)}%)`
        : speedTone.body;
      fillRoundedRect(context, x, y, segmentSize, segmentSize, 7);

      context.globalAlpha = isGameOver ? 0.24 : 0.34 + age * 0.22 + cueVisualStrength * 0.05;
      context.fillStyle = speedMode === "base" ? `rgba(255, 255, 255, ${scaleAlpha(0.72, snakeBrightness)})` : speedTone.text;
      fillRoundedRect(
        context,
        x + segmentSize * 0.22,
        y + segmentSize * 0.18,
        Math.max(2, segmentSize * 0.28),
        Math.max(2, segmentSize * 0.16),
        5,
      );
    }
  }

  const head = snake[0];

  if (head && !isGameOver) {
    drawHeadCue(context, grid, head, direction);
  }

  if (!isGameOver) {
    drawBlackHoleCue(context, snapshot, time);
  }

  context.restore();
}

function drawRewardBursts(context: CanvasRenderingContext2D, rewardBursts: readonly RewardBurst[]): void {
  if (rewardBursts.length === 0) {
    return;
  }

  context.save();
  context.globalCompositeOperation = "lighter";
  context.lineCap = "round";
  context.lineJoin = "round";
  const glowScale = activeRenderQuality.glowScale;

  for (const rewardBurst of rewardBursts) {
    const progress = clamp(1 - rewardBurst.life / rewardBurst.maxLife, 0, 1);
    const flashProgress = clamp(progress / 0.25, 0, 1);
    const ringProgress = clamp((progress - 0.11) / 0.61, 0, 1);
    const bladeProgress = clamp((progress - 0.17) / 0.83, 0, 1);
    const flashAlpha = Math.pow(1 - flashProgress, 2.1);
    const ringAlpha = Math.sin(ringProgress * Math.PI) * (1 - ringProgress * 0.12);
    const bladeAlpha = Math.pow(1 - bladeProgress, 1.24);

    if (flashAlpha > 0) {
      const flashRadius = rewardBurst.cellSize * (1.18 - flashProgress * 0.34);
      const flash = context.createRadialGradient(
        rewardBurst.x,
        rewardBurst.y,
        0,
        rewardBurst.x,
        rewardBurst.y,
        flashRadius,
      );

      flash.addColorStop(0, `rgba(255, 255, 255, ${0.9 * flashAlpha})`);
      flash.addColorStop(0.24, `rgba(219, 255, 82, ${0.72 * flashAlpha})`);
      flash.addColorStop(0.58, `rgba(0, 245, 255, ${0.28 * flashAlpha})`);
      flash.addColorStop(1, "rgba(0, 245, 255, 0)");

      context.globalAlpha = 1;
      context.fillStyle = flash;
      context.shadowColor = "#dbff52";
      context.shadowBlur = 34 * flashAlpha * glowScale;
      context.beginPath();
      context.arc(rewardBurst.x, rewardBurst.y, flashRadius * 1.22, 0, Math.PI * 2);
      context.fill();

      const starOuter = rewardBurst.cellSize * (0.96 - flashProgress * 0.18);
      const starInner = starOuter * 0.38;
      const starRotation = rewardBurst.angle + progress * 1.25;

      context.globalAlpha = 0.92 * flashAlpha;
      context.fillStyle = "#ffffff";
      context.shadowColor = "#ffffff";
      context.shadowBlur = 20 * flashAlpha * glowScale;
      context.beginPath();

      for (let point = 0; point < 16; point += 1) {
        const radius = point % 2 === 0 ? starOuter : starInner;
        const angle = starRotation + (point / 16) * Math.PI * 2;
        const x = rewardBurst.x + Math.cos(angle) * radius;
        const y = rewardBurst.y + Math.sin(angle) * radius;

        if (point === 0) {
          context.moveTo(x, y);
        } else {
          context.lineTo(x, y);
        }
      }

      context.closePath();
      context.fill();
    }

    if (ringAlpha > 0) {
      const easedRing = easeOutCubic(ringProgress);
      const mainRadius = rewardBurst.cellSize * (0.85 + easedRing * 4.35);
      const cyanRadius = mainRadius * (0.93 + ringProgress * 0.04);
      const magentaRadius = mainRadius * (1.06 + ringProgress * 0.03);

      context.setLineDash([]);
      context.globalAlpha = 0.68 * ringAlpha;
      context.strokeStyle = "rgba(219, 255, 82, 0.92)";
      context.shadowColor = "#dbff52";
      context.shadowBlur = 24 * ringAlpha * glowScale;
      context.lineWidth = Math.max(1.25, rewardBurst.cellSize * (0.085 - ringProgress * 0.036));
      context.beginPath();
      context.arc(rewardBurst.x, rewardBurst.y, mainRadius, 0, Math.PI * 2);
      context.stroke();

      context.globalAlpha = 0.38 * ringAlpha;
      context.strokeStyle = "rgba(0, 245, 255, 0.88)";
      context.shadowColor = "#00f5ff";
      context.shadowBlur = 20 * ringAlpha * glowScale;
      context.lineWidth = Math.max(1, rewardBurst.cellSize * 0.042);
      context.beginPath();
      context.arc(
        rewardBurst.x,
        rewardBurst.y,
        cyanRadius,
        rewardBurst.secondaryAngle + ringProgress * 0.9,
        rewardBurst.secondaryAngle + Math.PI * 1.62 + ringProgress * 0.9,
      );
      context.stroke();

      context.globalAlpha = 0.3 * ringAlpha;
      context.strokeStyle = "rgba(255, 43, 214, 0.8)";
      context.shadowColor = "#ff2bd6";
      context.shadowBlur = 18 * ringAlpha * glowScale;
      context.beginPath();
      context.arc(
        rewardBurst.x,
        rewardBurst.y,
        magentaRadius,
        rewardBurst.secondaryAngle + Math.PI * 0.78 - ringProgress * 0.55,
        rewardBurst.secondaryAngle + Math.PI * 1.98 - ringProgress * 0.55,
      );
      context.stroke();
    }

    if (progress >= 0.17) {
      for (let index = 0; index < rewardBurst.rayCount; index += 1) {
        const lengthUnit = burstUnit(rewardBurst.seed, index + 1);
        const alphaUnit = burstUnit(rewardBurst.seed, index + 31);
        const angleJitter = (burstUnit(rewardBurst.seed, index + 61) - 0.5) * 0.28;
        const angle =
          rewardBurst.angle +
          (index / rewardBurst.rayCount) * Math.PI * 2 +
          angleJitter +
          bladeProgress * 0.08;
        const inner = rewardBurst.cellSize * (0.78 + bladeProgress * 0.58);
        const outer = rewardBurst.cellSize * (2.05 + bladeProgress * (2.25 + lengthUnit * 1.45));
        const startX = rewardBurst.x + Math.cos(angle) * inner;
        const startY = rewardBurst.y + Math.sin(angle) * inner;
        const endX = rewardBurst.x + Math.cos(angle) * outer;
        const endY = rewardBurst.y + Math.sin(angle) * outer;
        const rayAlpha = bladeAlpha * (0.24 + alphaUnit * 0.48);
        const rayHue = index % 5 === 0 ? "#ff2bd6" : index % 2 === 0 ? "#dbff52" : "#00f5ff";
        const rayGradient = context.createLinearGradient(startX, startY, endX, endY);

        rayGradient.addColorStop(0, "rgba(255, 255, 255, 0)");
        rayGradient.addColorStop(0.28, rayHue);
        rayGradient.addColorStop(1, "rgba(255, 255, 255, 0)");

        context.globalAlpha = rayAlpha;
        context.strokeStyle = rayGradient;
        context.shadowColor = rayHue;
        context.shadowBlur = 18 * rayAlpha * glowScale;
        context.lineWidth = Math.max(1, rewardBurst.cellSize * (0.036 + lengthUnit * 0.036) * (1 - bladeProgress * 0.34));
        context.beginPath();
        context.moveTo(startX, startY);
        context.lineTo(endX, endY);
        context.stroke();
      }
    }

    context.setLineDash([]);
  }

  context.restore();
}

function drawParticles(context: CanvasRenderingContext2D, particles: readonly Particle[]): void {
  context.save();
  context.globalCompositeOperation = "lighter";

  for (const particle of particles) {
    const progress = clamp(particle.life / particle.maxLife, 0, 1);
    const radius = particle.radius * (0.62 + progress * 0.86);

    context.globalAlpha = progress;
    context.fillStyle = `hsl(${particle.hue} 100% ${58 + progress * 24}%)`;
    context.shadowColor = `hsl(${particle.hue} 100% 66%)`;
    context.shadowBlur = 18 * progress * activeRenderQuality.glowScale;
    context.beginPath();
    context.arc(particle.x, particle.y, radius, 0, Math.PI * 2);
    context.fill();

    context.globalAlpha = progress * 0.22;
    context.strokeStyle = `hsl(${particle.hue} 100% 72%)`;
    context.lineWidth = 1;
    context.beginPath();
    context.moveTo(particle.x, particle.y);
    context.lineTo(particle.x - particle.vx * 0.028, particle.y - particle.vy * 0.028);
    context.stroke();
  }

  context.restore();
}

function drawStateOverlay(context: CanvasRenderingContext2D, snapshot: GameSnapshot, time: number): void {
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
  context.shadowBlur = (phase === "paused" ? 18 : 28 + pulse * 10) * activeRenderQuality.glowScale;
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

function drawBlackHoles(context: CanvasRenderingContext2D, snapshot: GameSnapshot, time: number): void {
  if (snapshot.blackHoles.length === 0) {
    return;
  }

  context.save();
  context.globalCompositeOperation = "lighter";

  for (const blackHole of snapshot.blackHoles) {
    drawBlackHole(context, snapshot, blackHole, time);
  }

  context.restore();
}

export function createRenderer(canvas: HTMLCanvasElement): Renderer {
  const context = canvas.getContext("2d", { alpha: false });

  if (!context) {
    throw new Error("Canvas 2D context is not available.");
  }

  const stars = createStars();
  const state = createRenderState();
  const backgroundLayer = document.createElement("canvas");
  const backgroundLayerContext = backgroundLayer.getContext("2d", { alpha: false });
  const boardLayer = document.createElement("canvas");
  const boardLayerContext = boardLayer.getContext("2d", { alpha: false });

  if (!backgroundLayerContext || !boardLayerContext) {
    throw new Error("Canvas 2D context is not available.");
  }

  activeRenderQuality = QUALITY_LEVELS[DEFAULT_QUALITY_LEVEL] ?? QUALITY_LEVELS[0]!;
  let qualityLevel = DEFAULT_QUALITY_LEVEL;
  let size = getCanvasSize(canvas, activeRenderQuality.dprCap);
  let layoutDirty = true;
  let staticLayersDirty = true;
  let cachedGridKey = "";
  let qualityElapsedMs = 0;
  let smoothedFrameMs = 16.67;
  let slowFrameScore = 0;
  let fastFrameScore = 0;
  let lastQualityChangeAt = Number.NEGATIVE_INFINITY;

  const getGridKey = (grid: GridMetrics): string => (
    `${grid.columns}:${grid.rows}:${grid.cellSize}:${grid.offsetX}:${grid.offsetY}`
  );

  const syncBackingStores = (): void => {
    size = getCanvasSize(canvas, activeRenderQuality.dprCap);

    if (canvas.width !== size.pixelWidth) {
      canvas.width = size.pixelWidth;
    }

    if (canvas.height !== size.pixelHeight) {
      canvas.height = size.pixelHeight;
    }

    if (backgroundLayer.width !== size.pixelWidth) {
      backgroundLayer.width = size.pixelWidth;
    }

    if (backgroundLayer.height !== size.pixelHeight) {
      backgroundLayer.height = size.pixelHeight;
    }

    if (boardLayer.width !== size.pixelWidth) {
      boardLayer.width = size.pixelWidth;
    }

    if (boardLayer.height !== size.pixelHeight) {
      boardLayer.height = size.pixelHeight;
    }

    context.setTransform(size.dpr, 0, 0, size.dpr, 0, 0);
    backgroundLayerContext.setTransform(size.dpr, 0, 0, size.dpr, 0, 0);
    boardLayerContext.setTransform(size.dpr, 0, 0, size.dpr, 0, 0);
  };

  const rebuildBackgroundLayer = (): void => {
    backgroundLayerContext.clearRect(0, 0, size.width, size.height);
    drawBackground(backgroundLayerContext, size, 0);
  };

  const rebuildBoardLayer = (grid: GridMetrics): void => {
    boardLayerContext.clearRect(0, 0, size.width, size.height);
    drawGrid(boardLayerContext, size, 0);
    drawBoard(boardLayerContext, createStaticSceneSnapshot(grid), 0);
    cachedGridKey = getGridKey(grid);
  };

  const resize = (): CanvasSize => {
    syncBackingStores();
    staticLayersDirty = true;
    layoutDirty = false;
    return size;
  };

  const ensureStaticLayers = (grid: GridMetrics): void => {
    const gridKey = getGridKey(grid);

    if (staticLayersDirty || cachedGridKey !== gridKey) {
      rebuildBackgroundLayer();
      rebuildBoardLayer(grid);
      staticLayersDirty = false;
    }
  };

  const applyQualityLevel = (nextLevel: number): void => {
    const boundedLevel = Math.max(0, Math.min(QUALITY_LEVELS.length - 1, Math.floor(nextLevel)));

    if (boundedLevel === qualityLevel) {
      return;
    }

    qualityLevel = boundedLevel;
    activeRenderQuality = QUALITY_LEVELS[qualityLevel] ?? QUALITY_LEVELS[0]!;
    layoutDirty = true;
    staticLayersDirty = true;
  };

  const updateRenderQuality = (delta: number): void => {
    if (!Number.isFinite(delta) || delta <= 0) {
      return;
    }

    const sample = Math.min(80, delta);
    qualityElapsedMs += delta;
    smoothedFrameMs = smoothedFrameMs * 0.92 + sample * 0.08;

    const isSlowFrame = smoothedFrameMs > 20.5 || sample > 34;
    const isFastFrame = smoothedFrameMs < 15.25 && sample < 18;

    slowFrameScore = Math.max(0, slowFrameScore + (isSlowFrame ? 1.4 : -0.3));
    fastFrameScore = Math.max(0, fastFrameScore + (isFastFrame ? 1 : -0.18));

    if (qualityElapsedMs - lastQualityChangeAt < 1500) {
      return;
    }

    if (slowFrameScore >= 18 && qualityLevel < QUALITY_LEVELS.length - 1) {
      applyQualityLevel(qualityLevel + 1);
      lastQualityChangeAt = qualityElapsedMs;
      slowFrameScore = 0;
      fastFrameScore = 0;
      return;
    }

    if (fastFrameScore >= 150 && qualityLevel > 0) {
      applyQualityLevel(qualityLevel - 1);
      lastQualityChangeAt = qualityElapsedMs;
      slowFrameScore = 0;
      fastFrameScore = 0;
    }
  };

  resize();

  return {
    resize,

    recordFrameTime(delta: number): void {
      updateRenderQuality(delta);
    },

    render(frame: FrameInfo): void {
      if (layoutDirty) {
        resize();
      }

      const time = frame.elapsed / 1000;
      const grid = frame.snapshot.grid;

      ensureStaticLayers(grid);
      updateRenderState(state, frame.snapshot, frame.delta);

      context.setTransform(size.dpr, 0, 0, size.dpr, 0, 0);
      context.clearRect(0, 0, size.width, size.height);

      context.drawImage(backgroundLayer, 0, 0, size.width, size.height);
      drawAmbientPulse(context, size, time);
      drawStars(context, size, stars, time);
      drawCoreGlow(context, size, time);
      context.drawImage(boardLayer, 0, 0, size.width, size.height);

      const shakeOffset = getShakeOffset(state.shake, time);

      context.save();
      context.translate(shakeOffset.x, shakeOffset.y);
      drawWallGraceWarning(context, frame.snapshot, time);
      drawBlackHoles(context, frame.snapshot, time);
      drawSnakeTrail(context, frame.snapshot, state.trails, time);
      context.restore();

      drawRewardBursts(context, state.rewardBursts);

      context.save();
      context.translate(shakeOffset.x, shakeOffset.y);
      drawFood(context, frame.snapshot, time);
      drawStarCores(context, frame.snapshot, time);
      drawStarAttractors(context, frame.snapshot, time);
      drawStarBeasts(context, frame.snapshot, time);
      drawSnake(context, frame.snapshot, time);
      context.restore();

      context.save();
      context.translate(shakeOffset.x, shakeOffset.y);
      drawStarBeastEffects(context, frame.snapshot, time);
      drawStarAttractorEffects(context, frame.snapshot, time);
      context.restore();

      drawBlackHoleAlert(context, frame.snapshot, size, time, state.blackHoleAlert, state.blackHoleAlertAlpha);

      context.save();
      context.translate(shakeOffset.x, shakeOffset.y);
      drawStateOverlay(context, frame.snapshot, time);
      context.restore();

      drawParticles(context, state.particles);
    },

    getSize(): CanvasSize {
      return size;
    },

    destroy(): void {
      context.setTransform(1, 0, 0, 1, 0, 0);
      context.clearRect(0, 0, canvas.width, canvas.height);
      state.particles.length = 0;
      state.rewardBursts.length = 0;
      state.trails.length = 0;
      backgroundLayer.width = 0;
      backgroundLayer.height = 0;
      boardLayer.width = 0;
      boardLayer.height = 0;
    },
  };
}

function createStaticSceneSnapshot(grid: GridMetrics): GameSnapshot {
  return {
    phase: "ready",
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
    score: 0,
    highScore: 0,
    direction: "right",
    speedMode: "base",
    speedMultiplier: 1,
    speedCue: null,
    wallGrace: null,
  };
}

function drawAmbientPulse(context: CanvasRenderingContext2D, size: CanvasSize, time: number): void {
  const pulse = 0.5 + Math.sin(time * 1.32) * 0.5;
  const centerX = size.width * (0.5 + Math.sin(time * 0.09) * 0.03);
  const centerY = size.height * (0.42 + Math.cos(time * 0.08) * 0.025);
  const radius = Math.max(size.width, size.height) * (0.82 + pulse * 0.08);

  context.save();
  context.globalCompositeOperation = "lighter";
  context.globalAlpha = (0.06 + pulse * 0.035) * activeRenderQuality.ambientAlpha;

  const wash = context.createRadialGradient(centerX, centerY, 0, size.width * 0.5, size.height * 0.48, radius);
  wash.addColorStop(0, "rgba(0, 245, 255, 0.16)");
  wash.addColorStop(0.4, "rgba(0, 245, 255, 0.03)");
  wash.addColorStop(1, "rgba(255, 43, 214, 0)");
  context.fillStyle = wash;
  context.fillRect(0, 0, size.width, size.height);

  context.restore();
}
