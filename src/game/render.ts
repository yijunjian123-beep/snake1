import {
  getBlackHoleFormationProgress,
  getBlackHoleInfluenceRadiusCells,
  getBlackHoleVariant,
  isBlackHoleActive,
} from "./blackHole";
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
  blackHoleAttractionParticles: Particle[];
  trails: TrailSample[];
  blackHoleAlert: GameSnapshot["blackHoleAlert"];
  blackHoleAlertAlpha: number;
  previousScore: number | null;
  previousPhase: GameSnapshot["phase"] | null;
  previousSnakeHeadKey: string | null;
  previousFoods: GridCell[];
  shake: ShakeState;
}

const STAR_COUNT = 190;
const MAX_DPR = 3;
const MAX_PARTICLES = 260;
const MAX_BLACK_HOLE_ATTRACTION_PARTICLES = 64;
const MAX_REWARD_BURSTS = 5;
const MAX_TRAIL_SAMPLES = 6;
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

function getCanvasSize(canvas: HTMLCanvasElement): CanvasSize {
  const bounds = canvas.getBoundingClientRect();
  const width = Math.max(1, Math.floor(bounds.width || window.innerWidth));
  const height = Math.max(1, Math.floor(bounds.height || window.innerHeight));
  const dpr = Math.max(1, Math.min(window.devicePixelRatio || 1, MAX_DPR));
  const pixelWidth = Math.max(1, Math.floor(width * dpr));
  const pixelHeight = Math.max(1, Math.floor(height * dpr));

  return { width, height, dpr, pixelWidth, pixelHeight };
}

function createRenderState(): RenderState {
  return {
    particles: [],
    rewardBursts: [],
    blackHoleAttractionParticles: [],
    trails: [],
    blackHoleAlert: null,
    blackHoleAlertAlpha: 0,
    previousScore: null,
    previousPhase: null,
    previousSnakeHeadKey: null,
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

  if (state.particles.length > MAX_PARTICLES) {
    state.particles.splice(0, state.particles.length - MAX_PARTICLES);
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
    rayCount: Math.floor(randomBetween(14, 19)),
    seed: randomBetween(0, 1000),
  });

  if (state.rewardBursts.length > MAX_REWARD_BURSTS) {
    state.rewardBursts.splice(0, state.rewardBursts.length - MAX_REWARD_BURSTS);
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

function getBlackHoleAttractionRange(grid: GridMetrics, blackHole: BlackHole): number {
  return grid.cellSize * (getBlackHoleInfluenceRadiusCells(blackHole) + 0.5);
}

function spawnBlackHoleAttractionParticles(
  state: RenderState,
  blackHole: BlackHole,
  grid: GridMetrics,
  time: number,
  intensity: number,
): void {
  const center = cellCenter(grid, blackHole.cell);
  const radius = getBlackHoleAttractionRange(grid, blackHole);
  const count = Math.max(1, Math.round(2 + intensity * 4));

  for (let index = 0; index < count; index += 1) {
    const angle = time * (0.8 + intensity * 0.42) + blackHole.seed * 0.0017 + index * 1.91;
    const distance = radius * (0.32 + seededUnit(blackHole.seed + index, 71) * 0.68);

    state.blackHoleAttractionParticles.push({
      x: center.x + Math.cos(angle) * distance,
      y: center.y + Math.sin(angle) * distance * 0.76,
      vx: Math.cos(angle + Math.PI * 0.5) * 2,
      vy: Math.sin(angle + Math.PI * 0.5) * 2,
      radius: 0.9 + intensity * 1.2,
      hue: 214 + seededUnit(blackHole.seed + index, 73) * 54,
      life: 0.42,
      maxLife: 0.42,
      drag: 0.92,
    });
  }

  if (state.blackHoleAttractionParticles.length > MAX_BLACK_HOLE_ATTRACTION_PARTICLES) {
    state.blackHoleAttractionParticles.splice(
      0,
      state.blackHoleAttractionParticles.length - MAX_BLACK_HOLE_ATTRACTION_PARTICLES,
    );
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

function updateRenderState(state: RenderState, snapshot: GameSnapshot, delta: number, time: number): void {
  const dt = Math.min(delta / 1000, 0.05);
  const head = snapshot.snake[0] ?? null;
  const headKey = cellKey(head);
  const headCenter = head ? cellCenter(snapshot.grid, head) : null;
  const scoreIncreased = state.previousScore !== null && snapshot.score > state.previousScore;
  const enteredGameOver = snapshot.phase === "gameOver" && state.previousPhase !== "gameOver";
  const enteredPlaying = snapshot.phase === "playing" && state.previousPhase !== "playing";
  const alertVisible = snapshot.phase === "playing" && snapshot.blackHoleAlert !== null;

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
  for (const particle of state.blackHoleAttractionParticles) {
    particle.life -= dt;
    particle.x += particle.vx * dt;
    particle.y += particle.vy * dt;
    particle.vx *= Math.pow(particle.drag, delta / 16.67);
    particle.vy *= Math.pow(particle.drag, delta / 16.67);
  }

  state.blackHoleAttractionParticles = state.blackHoleAttractionParticles.filter((particle) => particle.life > 0);
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
      const particleCount = 52;
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
    spawnBurst(state, center.x, center.y, 112, 318, snapshot.grid.cellSize * 16);
    triggerShake(state, 7.2, 0.28, "impact");
  }

  if (snapshot.blackHoles.length > 0 && headCenter) {
    for (const blackHole of snapshot.blackHoles) {
      if (!isBlackHoleActive(blackHole, time)) {
        continue;
      }

      const holeCenter = cellCenter(snapshot.grid, blackHole.cell);
      const distance = Math.hypot(headCenter.x - holeCenter.x, headCenter.y - holeCenter.y);
      const attractionRange = getBlackHoleAttractionRange(snapshot.grid, blackHole);

      if (distance <= attractionRange * 1.18) {
        spawnBlackHoleAttractionParticles(
          state,
          blackHole,
          snapshot.grid,
          time,
          Math.max(0.2, 1 - distance / attractionRange),
        );
      }
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

    if (state.trails.length > MAX_TRAIL_SAMPLES) {
      state.trails.splice(0, state.trails.length - MAX_TRAIL_SAMPLES);
    }
  }

  state.previousScore = snapshot.score;
  state.previousPhase = snapshot.phase;
  state.previousSnakeHeadKey = headKey;
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

  for (const star of stars) {
    const drift = (time * star.speed) % 1;
    const parallax = 0.35 + star.layer * 0.9;
    const x = (star.x * size.width + Math.sin(time * 0.08 + star.twinkle) * 18 * parallax) % size.width;
    const y = ((star.y + drift) % 1) * size.height;
    const shimmer = 0.58 + Math.sin(time * (2.8 + star.layer * 5.4) + star.twinkle) * 0.42;
    const alpha = clamp(star.alpha * shimmer, 0.05, 0.95);

    context.globalAlpha = alpha;
    context.fillStyle = `hsl(${star.hue} 100% ${70 + star.layer * 16}%)`;
    context.shadowColor = `hsl(${star.hue} 100% 68%)`;
    context.shadowBlur = star.layer > 0.72 ? 8 : 3;
    context.beginPath();
    context.arc(x < 0 ? x + size.width : x, y, star.radius, 0, Math.PI * 2);
    context.fill();
  }

  context.lineCap = "round";

  for (let index = 0; index < 12; index += 1) {
    const seedX = seededUnit(index, 18);
    const seedY = seededUnit(index, 19);
    const drift = (time * (0.07 + seededUnit(index, 20) * 0.1)) % 1;
    const x = (seedX + drift) % 1 * size.width;
    const y = (seedY + drift * 0.28) % 1 * size.height;
    const length = 24 + seededUnit(index, 21) * 58;

    context.globalAlpha = 0.08 + seededUnit(index, 22) * 0.12;
    context.strokeStyle = "rgba(143, 251, 255, 0.85)";
    context.shadowColor = "#00f5ff";
    context.shadowBlur = 12;
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
    context.shadowBlur = 16;
    context.lineWidth = 1.2 + index * 0.8;
    context.beginPath();
    context.ellipse(0, 0, ringRadius * (1 + index * 0.16), ringRadius * 0.38, index * 0.72, 0, Math.PI * 2);
    context.stroke();
  }

  context.globalAlpha = 0.72;
  context.fillStyle = "rgba(219, 255, 82, 0.86)";
  context.shadowColor = "#dbff52";
  context.shadowBlur = 24;
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

function drawBlackHole(context: CanvasRenderingContext2D, snapshot: GameSnapshot, blackHole: BlackHole, time: number): void {
  const { grid } = snapshot;
  const variant = getBlackHoleVariant(blackHole.kind);
  const center = cellCenter(grid, blackHole.cell);
  const formation = getBlackHoleFormationProgress(blackHole, time);
  const active = isBlackHoleActive(blackHole, time);
  const pulse = 0.5 + Math.sin(time * variant.pulseSpeed + blackHole.seed * 0.01) * 0.5;
  const influenceRadius = variant.influenceRadiusCells;
  const alertRadius = influenceRadius + 1;
  const coreRadius = variant.bodyRadiusCells;
  const preview = active ? 1 : clamp((formation - 0.16) / 0.46, 0, 1);
  const fieldBandRadius = Math.max(1, influenceRadius - coreRadius);
  const alertAlpha = active ? 0.13 + pulse * 0.08 : preview * 0.14;
  const alertBoxSize = (alertRadius * 2 + 1) * grid.cellSize;
  const swirlAngle = time * (1.12 + variant.pulseSpeed * 0.24) + blackHole.spawnTime * 0.2;
  const ringAlpha = active ? 0.28 + pulse * 0.18 : preview * 0.26;
  const coreAlpha = active ? 0.96 - pulse * 0.04 : Math.max(0.32, preview * 0.68);
  const outerGlow = context.createRadialGradient(center.x, center.y, grid.cellSize * 0.05, center.x, center.y, alertBoxSize * 0.56);

  outerGlow.addColorStop(0, `rgba(0, 0, 0, ${0.99 - formation * 0.03})`);
  outerGlow.addColorStop(0.28, `rgba(8, 10, 20, ${0.95 - formation * 0.02})`);
  outerGlow.addColorStop(0.52, `rgba(22, 12, 42, ${0.7 + pulse * 0.04})`);
  outerGlow.addColorStop(0.72, `rgba(255, 43, 214, ${0.04 + ringAlpha * 0.12})`);
  outerGlow.addColorStop(0.86, `rgba(0, 245, 255, ${0.03 + alertAlpha * 0.14})`);
  outerGlow.addColorStop(1, "rgba(0, 0, 0, 0)");

  context.save();
  context.globalCompositeOperation = "source-over";
  context.globalAlpha = active ? 0.96 : preview * 0.78;
  context.fillStyle = outerGlow;
  context.fillRect(center.x - alertBoxSize / 2, center.y - alertBoxSize / 2, alertBoxSize, alertBoxSize);

  context.save();
  context.globalCompositeOperation = "lighter";
  context.lineCap = "round";
  context.lineJoin = "round";
  context.setLineDash([]);

  for (let row = -alertRadius; row <= alertRadius; row += 1) {
    for (let column = -alertRadius; column <= alertRadius; column += 1) {
      const distance = Math.max(Math.abs(column), Math.abs(row));
      if (distance > alertRadius) {
        continue;
      }

      const x = grid.offsetX + (blackHole.cell.column + column) * grid.cellSize;
      const y = grid.offsetY + (blackHole.cell.row + row) * grid.cellSize;
      const tileSize = grid.cellSize;

      if (distance > influenceRadius) {
        const warningStrength = Math.max(0.06, 1 - (distance - influenceRadius) * 0.85);
        const warningAlpha = (active ? alertAlpha : preview * 0.1) * warningStrength;

        if (warningAlpha <= 0.01) {
          continue;
        }

        context.globalAlpha = warningAlpha;
        context.shadowColor = "#ff2bd6";
        context.shadowBlur = 6 + pulse * 4;
        context.fillStyle = "rgba(7, 10, 18, 0.1)";
        context.fillRect(x, y, tileSize, tileSize);

        if (warningStrength > 0.5) {
          context.globalAlpha = warningAlpha * 0.6;
          context.shadowBlur = 0;
          context.fillStyle = "rgba(7, 10, 18, 0.08)";
          context.fillRect(x, y, tileSize, tileSize);
        }

        continue;
      }

      const isCore = distance <= coreRadius;
      const fieldStrength = 1 - Math.max(0, distance - coreRadius) / fieldBandRadius;
      const hazardBand = distance <= coreRadius + 1;
      const bandAlpha = isCore
        ? coreAlpha
        : (hazardBand ? 0.38 + pulse * 0.18 : ringAlpha * (0.42 + fieldStrength * 0.56));
      const bandPulse = hazardBand ? 1 : 0.82 + Math.sin(swirlAngle * 1.6 + column * 0.34 - row * 0.21) * 0.12;

      if (isCore) {
        context.globalAlpha = bandAlpha;
        context.shadowColor = "#000000";
        context.shadowBlur = 0;
        context.fillStyle = "rgba(1, 2, 6, 0.985)";
        context.fillRect(x, y, tileSize, tileSize);
        continue;
      }

      context.globalAlpha = bandAlpha * bandPulse;
      context.shadowColor = hazardBand ? "#ff2bd6" : "#00f5ff";
      context.shadowBlur = hazardBand ? 16 + pulse * 8 : 7 + pulse * 4;
      context.fillStyle = hazardBand
        ? `rgba(20, 8, 32, ${0.72 + fieldStrength * 0.12})`
        : `rgba(8, 12, 24, ${0.26 + fieldStrength * 0.16})`;
      context.fillRect(x, y, tileSize, tileSize);
    }
  }

  context.setLineDash([]);
  context.globalAlpha = active ? 0.34 : preview * 0.22;
  context.shadowColor = active ? "#00f5ff" : "#ff2bd6";
  context.shadowBlur = active ? 10 + pulse * 6 : 7 + preview * 4;
  context.strokeStyle = active ? "rgba(143, 251, 255, 0.26)" : "rgba(255, 43, 214, 0.18)";
  context.lineWidth = Math.max(1, grid.cellSize * 0.05);

  context.save();
  context.translate(center.x, center.y);
  context.globalCompositeOperation = "lighter";
  context.shadowColor = "#ff2bd6";
  context.shadowBlur = 10 + pulse * 5;
  context.lineCap = "round";
  context.strokeStyle = active ? "rgba(255, 43, 214, 0.48)" : "rgba(255, 43, 214, 0.28)";
  context.lineWidth = Math.max(1.1, grid.cellSize * 0.05);

  const innerRimRadius = grid.cellSize * (coreRadius === 0 ? 0.46 : 1.2 + coreRadius * 0.1);
  const outerRimRadius = grid.cellSize * (coreRadius === 0 ? 0.76 : 1.42 + coreRadius * 0.14);

  context.globalAlpha = active ? 0.9 : preview * 0.6;
  context.beginPath();
  context.arc(0, 0, innerRimRadius, 0, Math.PI * 2);
  context.stroke();

  for (let index = 0; index < 2; index += 1) {
    const arcRadius = outerRimRadius + index * grid.cellSize * 0.16;
    const arcAngle = swirlAngle * (1 + index * 0.14) + index * 1.2;
    context.globalAlpha = active ? 0.24 - index * 0.05 : 0.16 - index * 0.03;
    context.beginPath();
    context.arc(0, 0, arcRadius, arcAngle, arcAngle + Math.PI * (0.56 + index * 0.08));
    context.stroke();
  }

  context.restore();
  context.restore();
}

function drawSnakePathGlow(
  context: CanvasRenderingContext2D,
  grid: GridMetrics,
  snake: readonly GridCell[],
  time: number,
  speedMode: SpeedMode,
  cueStrength: number,
): void {
  if (snake.length < 2) {
    return;
  }

  const speedTone = getSpeedTone(speedMode);
  const modeIntensity = speedMode === "boost" ? 1.18 : speedMode === "accelerate" ? 1.08 : speedMode === "brake" ? 1.12 : 1;

  context.save();
  context.globalCompositeOperation = "lighter";
  context.lineCap = "round";
  context.lineJoin = "round";

  for (let pass = 0; pass < 2; pass += 1) {
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
    const cueBoost = 1 + cueStrength * 0.3;
    context.globalAlpha = (pass === 0 ? 0.32 : 0.82) * cueBoost;
    context.shadowColor = pass === 0 ? speedTone.glow : speedTone.trail;
    context.shadowBlur = (pass === 0 ? 26 : 16) * cueBoost * modeIntensity;
    context.strokeStyle =
      pass === 0
        ? speedMode === "base"
          ? "rgba(0, 245, 255, 0.34)"
          : speedMode === "brake"
            ? "rgba(255, 74, 74, 0.42)"
            : speedMode === "boost"
              ? "rgba(255, 255, 255, 0.42)"
              : "rgba(0, 245, 255, 0.42)"
        : speedMode === "base"
          ? `rgba(219, 255, 82, ${0.22 + pulse * 0.16})`
          : speedMode === "brake"
            ? `rgba(255, 138, 138, ${0.2 + pulse * 0.16})`
            : speedMode === "boost"
              ? `rgba(219, 255, 82, ${0.18 + pulse * 0.18})`
              : `rgba(144, 251, 255, ${0.2 + pulse * 0.16})`;
    context.lineWidth = grid.cellSize * (pass === 0 ? 0.95 : 0.42) * cueBoost * modeIntensity;
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
  const pulse = prefersReducedMotion() ? 1 : 0.92 + Math.sin(time * 10.2 + cue.startedAt * 0.004) * 0.08;
  const radius = snapshot.grid.cellSize * (0.38 + cueStrength * 0.92);

  context.save();
  context.globalCompositeOperation = "lighter";
  context.translate(center.x, center.y);
  context.globalAlpha = cueStrength * pulse;
  context.shadowColor = tone.glow;
  context.shadowBlur = snapshot.grid.cellSize * (0.9 + cueStrength * 1.4);

  const fill = context.createRadialGradient(0, 0, 0, 0, 0, radius * 1.25);
  fill.addColorStop(0, tone.head);
  fill.addColorStop(0.32, tone.glow);
  fill.addColorStop(0.68, tone.body);
  fill.addColorStop(1, "rgba(0, 0, 0, 0)");

  context.fillStyle = fill;
  context.beginPath();
  context.arc(0, 0, radius * 1.12, 0, Math.PI * 2);
  context.fill();

  context.globalAlpha = cueStrength * 0.76;
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
  context.shadowBlur = 12 + pulse * 6;
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
  context.shadowBlur = 6 + pulse * 4;
  context.font = `800 ${fontSize}px system-ui, sans-serif`;
  context.fillText(message, centerX, centerY);

  context.restore();
}

function drawSnakeTrail(context: CanvasRenderingContext2D, snapshot: GameSnapshot, trails: readonly TrailSample[]): void {
  const { grid, speedMode } = snapshot;
  const cellGap = Math.max(2, grid.cellSize * 0.12);
  const segmentSize = grid.cellSize - cellGap * 2;
  const speedTone = getSpeedTone(speedMode);
  const tintStrength = speedMode === "base" ? 0 : Math.min(1, Math.abs(snapshot.speedMultiplier - 1) / 0.67);
  const cueStrength = getSpeedCueStrength(snapshot);

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

      context.globalAlpha = alpha * (0.06 + age * 0.18) * (1 + tintStrength * 0.08 + cueStrength * 0.14);
      context.shadowColor = index === 0 ? speedTone.head : speedMode === "base" ? "#00f5ff" : speedTone.trail;
      context.shadowBlur = (18 + tintStrength * 8 + cueStrength * 10) * alpha;
      context.fillStyle = index === 0 ? speedTone.head : speedMode === "base" ? `hsl(${184 + age * 76} 100% 58%)` : speedTone.body;
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

  drawSnakePathGlow(context, grid, snake, time, speedMode, cueStrength);

  context.save();
  context.globalCompositeOperation = "lighter";
  drawSpeedPulse(context, snapshot, time);

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

    context.globalAlpha = isGameOver ? 0.56 : 0.78 + age * 0.22 + tintStrength * 0.06 + cueStrength * 0.08;
    context.shadowColor = isHead ? speedTone.head : speedMode === "base" ? "#00f5ff" : speedTone.trail;
    context.shadowBlur = isHead
      ? 30 + tintStrength * 8 + cueStrength * 10
      : 17 + pulse * 8 + tintStrength * 5 + cueStrength * 4;

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
        context.globalAlpha = isGameOver ? 0.22 : 0.42 + tintStrength * 0.18 + cueStrength * 0.1;
        context.strokeStyle = speedTone.glow;
        context.lineWidth = Math.max(1, grid.cellSize * 0.05);
        context.beginPath();
        context.roundRect(x + 0.5, y + 0.5, segmentSize - 1, segmentSize - 1, 9);
        context.stroke();
      }
    } else {
      context.fillStyle = speedMode === "base" ? `hsl(${178 + age * 76} 100% ${50 + age * 24}%)` : speedTone.body;
      fillRoundedRect(context, x, y, segmentSize, segmentSize, 7);

      context.globalAlpha = isGameOver ? 0.24 : 0.34 + age * 0.22 + cueStrength * 0.05;
      context.fillStyle = speedMode === "base" ? "rgba(255, 255, 255, 0.72)" : speedTone.text;
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
      context.shadowBlur = 34 * flashAlpha;
      context.beginPath();
      context.arc(rewardBurst.x, rewardBurst.y, flashRadius * 1.22, 0, Math.PI * 2);
      context.fill();

      const starOuter = rewardBurst.cellSize * (0.96 - flashProgress * 0.18);
      const starInner = starOuter * 0.38;
      const starRotation = rewardBurst.angle + progress * 1.25;

      context.globalAlpha = 0.92 * flashAlpha;
      context.fillStyle = "#ffffff";
      context.shadowColor = "#ffffff";
      context.shadowBlur = 20 * flashAlpha;
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
      context.shadowBlur = 24 * ringAlpha;
      context.lineWidth = Math.max(1.25, rewardBurst.cellSize * (0.085 - ringProgress * 0.036));
      context.beginPath();
      context.arc(rewardBurst.x, rewardBurst.y, mainRadius, 0, Math.PI * 2);
      context.stroke();

      context.globalAlpha = 0.38 * ringAlpha;
      context.strokeStyle = "rgba(0, 245, 255, 0.88)";
      context.shadowColor = "#00f5ff";
      context.shadowBlur = 20 * ringAlpha;
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
      context.shadowBlur = 18 * ringAlpha;
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
        context.shadowBlur = 18 * rayAlpha;
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
    context.shadowBlur = 18 * progress;
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

function drawBlackHoleAttractionParticles(
  context: CanvasRenderingContext2D,
  particles: readonly Particle[],
): void {
  if (particles.length === 0) {
    return;
  }

  context.save();
  context.globalCompositeOperation = "lighter";

  for (const particle of particles) {
    const progress = clamp(particle.life / particle.maxLife, 0, 1);
    const radius = particle.radius * (0.7 + progress * 0.5);

    context.globalAlpha = progress * 0.45;
    context.fillStyle = `hsl(${particle.hue} 100% ${52 + progress * 18}%)`;
    context.shadowColor = `hsl(${particle.hue} 100% 62%)`;
    context.shadowBlur = 10 * progress;
    context.beginPath();
    context.arc(particle.x, particle.y, radius, 0, Math.PI * 2);
    context.fill();
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
  context.shadowBlur = phase === "paused" ? 18 : 28 + pulse * 10;
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
  let size = getCanvasSize(canvas);

  const resize = (): CanvasSize => {
    size = getCanvasSize(canvas);

    if (canvas.width !== size.pixelWidth) {
      canvas.width = size.pixelWidth;
    }

    if (canvas.height !== size.pixelHeight) {
      canvas.height = size.pixelHeight;
    }

    context.setTransform(size.dpr, 0, 0, size.dpr, 0, 0);
    return size;
  };

  resize();

  return {
    resize,

    render(frame: FrameInfo): void {
      const time = frame.elapsed / 1000;

      updateRenderState(state, frame.snapshot, frame.delta, time);

      context.setTransform(size.dpr, 0, 0, size.dpr, 0, 0);
      context.clearRect(0, 0, size.width, size.height);

      drawBackground(context, size, time);
      drawStars(context, size, stars, time);
      drawCoreGlow(context, size, time);
      drawGrid(context, size, time);

      const shakeOffset = getShakeOffset(state.shake, time);

      context.save();
      context.translate(shakeOffset.x, shakeOffset.y);
      drawBoard(context, frame.snapshot, time);
      drawBlackHoles(context, frame.snapshot, time);
      drawSnakeTrail(context, frame.snapshot, state.trails);
      drawBlackHoleAttractionParticles(context, state.blackHoleAttractionParticles);
      context.restore();

      drawRewardBursts(context, state.rewardBursts);

      context.save();
      context.translate(shakeOffset.x, shakeOffset.y);
      drawFood(context, frame.snapshot, time);
      drawSnake(context, frame.snapshot, time);
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
      state.blackHoleAttractionParticles.length = 0;
      state.trails.length = 0;
    },
  };
}
