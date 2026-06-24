import { type RenderQualityState } from "./renderQuality";
import type { GameSnapshot, GridCell, GridMetrics } from "./types";

export interface Particle {
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

export interface TrailSample {
  cells: GridCell[];
  life: number;
  maxLife: number;
}

export interface RewardBurst {
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

export interface ShakeState {
  time: number;
  duration: number;
  intensity: number;
  directionX: number;
  directionY: number;
  mode: ShakeMode;
}

export interface RenderState {
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

const TRAIL_LIFE_SECONDS = 0.34;

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

function cellKey(cell: GridCell | null | undefined): string | null {
  return cell ? `${cell.column}:${cell.row}` : null;
}

function cellsMatch(left: GridCell, right: GridCell): boolean {
  return left.column === right.column && left.row === right.row;
}

export function createRenderState(): RenderState {
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

function compactArrayInPlace<T>(items: T[], isAlive: (item: T) => boolean): void {
  let writeIndex = 0;

  for (let index = 0; index < items.length; index += 1) {
    const item = items[index];

    if (!item || !isAlive(item)) {
      continue;
    }

    items[writeIndex] = item;
    writeIndex += 1;
  }

  items.length = writeIndex;
}

function syncGridCellArray(target: GridCell[], source: readonly GridCell[]): void {
  const sourceLength = source.length;

  for (let index = 0; index < sourceLength; index += 1) {
    const sourceCell = source[index];

    if (!sourceCell) {
      continue;
    }

    const targetCell = target[index];

    if (targetCell) {
      targetCell.column = sourceCell.column;
      targetCell.row = sourceCell.row;
    } else {
      target.push({
        column: sourceCell.column,
        row: sourceCell.row,
      });
    }
  }

  target.length = sourceLength;
}

function haveGridCellsChanged(previous: readonly GridCell[], next: readonly GridCell[]): boolean {
  if (previous.length !== next.length) {
    return true;
  }

  for (let index = 0; index < next.length; index += 1) {
    const previousCell = previous[index];
    const nextCell = next[index];

    if (!previousCell || !nextCell || !cellsMatch(previousCell, nextCell)) {
      return true;
    }
  }

  return false;
}

function createTrailCells(snake: readonly GridCell[]): GridCell[] {
  const cells = new Array<GridCell>(snake.length);

  for (let index = 0; index < snake.length; index += 1) {
    const segment = snake[index];

    cells[index] = {
      column: segment?.column ?? 0,
      row: segment?.row ?? 0,
    };
  }

  return cells;
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

export function getShakeOffset(shake: ShakeState, time: number): { x: number; y: number } {
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

function randomBetween(min: number, max: number): number {
  return min + Math.random() * (max - min);
}

function spawnBurst(state: RenderState, quality: RenderQualityState, x: number, y: number, count: number, baseHue: number, power: number): void {
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

  const particleCap = quality.particleCap;

  if (state.particles.length > particleCap) {
    state.particles.splice(0, state.particles.length - particleCap);
  }
}

function spawnRewardBurst(state: RenderState, quality: RenderQualityState, x: number, y: number, cellSize: number): void {
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

  const rewardBurstCap = quality.rewardBurstCap;

  if (state.rewardBursts.length > rewardBurstCap) {
    state.rewardBursts.splice(0, state.rewardBursts.length - rewardBurstCap);
  }
}

function findRemovedFood(previousFoods: readonly GridCell[], currentFoods: readonly GridCell[]): GridCell | null {
  for (const previousFood of previousFoods) {
    if (!currentFoods.some((currentFood) => cellsMatch(currentFood, previousFood))) {
      return previousFood;
    }
  }

  return previousFoods[0] ?? null;
}

export function resolveRewardBurstOrigin(
  snapshot: Pick<GameSnapshot, "rewardBurstOrigin" | "foods">,
  previousFoods: readonly GridCell[],
  head: GridCell | null,
): GridCell | null {
  return snapshot.rewardBurstOrigin ?? findRemovedFood(previousFoods, snapshot.foods) ?? head;
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

function approach(current: number, target: number, rate: number, dt: number): number {
  const delta = target - current;
  const step = delta * clamp(rate * dt, 0, 1);

  return current + step;
}

export function cellCenter(grid: GridMetrics, cell: GridCell): { x: number; y: number } {
  return {
    x: grid.offsetX + cell.column * grid.cellSize + grid.cellSize / 2,
    y: grid.offsetY + cell.row * grid.cellSize + grid.cellSize / 2,
  };
}

export function updateRenderState(
  state: RenderState,
  snapshot: GameSnapshot,
  delta: number,
  quality: RenderQualityState,
  reducedMotion: boolean,
): void {
  const dt = Math.min(delta / 1000, 0.05);
  const dragExponent = delta / 16.67;
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
    particle.vx *= Math.pow(particle.drag, dragExponent);
    particle.vy *= Math.pow(particle.drag, dragExponent);
  }

  compactArrayInPlace(state.particles, (particle) => particle.life > 0);

  for (const rewardBurst of state.rewardBursts) {
    rewardBurst.life -= dt;
  }

  compactArrayInPlace(state.rewardBursts, (rewardBurst) => rewardBurst.life > 0);

  for (const sample of state.trails) {
    sample.life -= dt;
  }

  compactArrayInPlace(state.trails, (sample) => sample.life > 0);
  state.shake.time = Math.max(0, state.shake.time - dt);
  state.blackHoleAlertAlpha = approach(state.blackHoleAlertAlpha, alertVisible ? 1 : 0, 6, dt);

  if (!alertVisible && state.blackHoleAlertAlpha <= 0.001) {
    state.blackHoleAlert = null;
  }

  if (scoreIncreased) {
    const burstCell = resolveRewardBurstOrigin(snapshot, state.previousFoods, head);

    if (burstCell) {
      const center = cellCenter(snapshot.grid, burstCell);
      const shakeDirection = rewardShakeDirection(snapshot.grid, center);
      const particleCount = Math.max(18, Math.round(36 * quality.glowScale));
      const particlePower = snapshot.grid.cellSize * 12;

      spawnRewardBurst(state, quality, center.x, center.y, snapshot.grid.cellSize);
      spawnBurst(state, quality, center.x, center.y, particleCount, 72, particlePower);

      if (!reducedMotion) {
        triggerShake(state, 2.05, 0.12, "reward", shakeDirection.x, shakeDirection.y);
      }
    }
  }

  if (enteredGameOver && head) {
    const center = cellCenter(snapshot.grid, head);
    spawnBurst(state, quality, center.x, center.y, Math.max(40, Math.round(84 * quality.glowScale)), 318, snapshot.grid.cellSize * 16);
    triggerShake(state, 7.2, 0.28, "impact");
  }

  if (enteredWallGrace && !reducedMotion) {
    triggerShake(state, 1.45, 0.1, "impact");
  }

  if (enteredStarAttractorEffect && !scoreIncreased && !reducedMotion) {
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
    const trailCap = quality.trailCap;

    if (state.trails.length >= trailCap && trailCap > 0) {
      const recycledTrail = state.trails.shift();

      if (recycledTrail) {
        syncGridCellArray(recycledTrail.cells, snapshot.snake);
        recycledTrail.life = TRAIL_LIFE_SECONDS;
        recycledTrail.maxLife = TRAIL_LIFE_SECONDS;
        state.trails.push(recycledTrail);
      }
    } else if (trailCap > 0) {
      state.trails.push({
        cells: createTrailCells(snapshot.snake),
        life: TRAIL_LIFE_SECONDS,
        maxLife: TRAIL_LIFE_SECONDS,
      });
    }
  }

  state.previousScore = snapshot.score;
  state.previousPhase = snapshot.phase;
  state.previousSnakeHeadKey = headKey;
  state.previousWallGraceKey = wallGraceKey;
  state.previousStarAttractorEffectCount = starAttractorEffectCount;

  if (haveGridCellsChanged(state.previousFoods, snapshot.foods)) {
    syncGridCellArray(state.previousFoods, snapshot.foods);
  }
}
