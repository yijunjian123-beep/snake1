import { findStage0SafeSpawnPosition } from "./spawn";
import type { GameProgress, SafeSpawnZone } from "./progression";
import type { BlackHole, BlackHoleAlert, BlackHoleBand, BlackHoleCue, BlackHoleKind, Direction, GridCell, GridMetrics } from "./types";

export interface BlackHoleVariant {
  bodyRadiusCells: number;
  influenceRadiusCells: number;
  safeSpawnDistance: number;
  wallPadding: number;
  activationDelayMs: number;
  pulseSpeed: number;
  chargeThresholds: {
    strong: number;
    medium?: number;
    weak: number;
  };
}

export interface BlackHoleSpawnContext {
  grid: GridMetrics;
  progress: GameProgress;
  snake: readonly GridCell[];
  foods: readonly GridCell[];
  existingBlackHoles: readonly BlackHole[];
  birthCell: GridCell;
  currentTime: number;
  futureBlockedCells?: readonly GridCell[];
  futureDangerZones?: readonly SafeSpawnZone[];
  kind?: BlackHoleKind;
  random?: () => number;
}

export interface BlackHoleGravityState {
  key: string | null;
  charge: number;
}

export interface BlackHoleMovementResolution {
  finalDirection: Direction;
  shouldDie: boolean;
  shouldPlayWarning: boolean;
  shouldPlayPull: boolean;
  shouldPlayFail: boolean;
  nextGravityState: BlackHoleGravityState;
  activeBlackHole: BlackHole | null;
  cue: BlackHoleCue | null;
}

interface BlackHoleInfluenceCandidate {
  blackHole: BlackHole;
  key: string;
  band: BlackHoleBand;
  distance: number;
  priority: number;
}

const NEIGHBOR_DELTAS: readonly GridCell[] = [
  { column: 0, row: -1 },
  { column: 1, row: 0 },
  { column: 0, row: 1 },
  { column: -1, row: 0 },
];

const DIRECTION_VECTORS: Record<Direction, { x: number; y: number }> = {
  up: { x: 0, y: -1 },
  right: { x: 1, y: 0 },
  down: { x: 0, y: 1 },
  left: { x: -1, y: 0 },
};

const PERPENDICULAR_PAIRS: Record<Direction, readonly [Direction, Direction]> = {
  up: ["left", "right"],
  right: ["up", "down"],
  down: ["right", "left"],
  left: ["down", "up"],
};

const KIND_PRIORITY: Record<BlackHoleKind, number> = {
  small: 0,
  large: 1,
};

const BAND_PRIORITY: Record<BlackHoleBand, number> = {
  core: 4,
  strong: 3,
  medium: 2,
  weak: 1,
};

export const BLACK_HOLE_CONFIG = {
  unlockLength: 7,
  maxCount: 3,
  midScoreThreshold: 80,
  midLengthThreshold: 12,
  lateScoreThreshold: 160,
  lateLengthThreshold: 18,
  variants: {
    small: {
      bodyRadiusCells: 0,
      influenceRadiusCells: 3,
      safeSpawnDistance: 5,
      wallPadding: 1,
      activationDelayMs: 420,
      pulseSpeed: 1.65,
      chargeThresholds: {
        strong: 1,
        weak: 2,
      },
    },
    large: {
      bodyRadiusCells: 1,
      influenceRadiusCells: 6,
      safeSpawnDistance: 8,
      wallPadding: 2,
      activationDelayMs: 660,
      pulseSpeed: 1.25,
      chargeThresholds: {
        strong: 1,
        medium: 2,
        weak: 3,
      },
    },
  },
} as const satisfies {
  unlockLength: number;
  maxCount: number;
  midScoreThreshold: number;
  midLengthThreshold: number;
  lateScoreThreshold: number;
  lateLengthThreshold: number;
  variants: Record<BlackHoleKind, BlackHoleVariant>;
};

export function getDesiredBlackHoleCount(progress: GameProgress, config: typeof BLACK_HOLE_CONFIG = BLACK_HOLE_CONFIG): number {
  if (progress.snakeLength < config.unlockLength) {
    return 0;
  }

  if (progress.score >= config.lateScoreThreshold || progress.snakeLength >= config.lateLengthThreshold) {
    return config.maxCount;
  }

  if (progress.score >= config.midScoreThreshold || progress.snakeLength >= config.midLengthThreshold) {
    return Math.min(config.maxCount, 2);
  }

  return Math.min(config.maxCount, 1);
}

export function getBlackHoleKindForSpawn(progress: GameProgress, grid: GridMetrics): BlackHoleKind {
  if (grid.columns < 18 || grid.rows < 14) {
    return "small";
  }

  if (progress.score >= BLACK_HOLE_CONFIG.lateScoreThreshold || progress.snakeLength >= BLACK_HOLE_CONFIG.lateLengthThreshold) {
    return "large";
  }

  return "small";
}

export function getBlackHoleVariant(kind: BlackHoleKind): BlackHoleVariant {
  return BLACK_HOLE_CONFIG.variants[kind];
}

export function getBlackHoleKey(blackHole: BlackHole): string {
  return `${blackHole.spawnTime}:${blackHole.cell.column}:${blackHole.cell.row}`;
}

export function isBlackHoleActive(blackHole: BlackHole, currentTime: number): boolean {
  return currentTime >= blackHole.activateAt;
}

export function getBlackHoleFormationProgress(blackHole: BlackHole, currentTime: number): number {
  const duration = Math.max(0.001, blackHole.activateAt - blackHole.spawnTime);
  return clamp((currentTime - blackHole.spawnTime) / duration, 0, 1);
}

export function getBlackHoleCoreRadiusCells(blackHole: BlackHole): number {
  return getBlackHoleVariant(blackHole.kind).bodyRadiusCells;
}

export function getBlackHoleInfluenceRadiusCells(blackHole: BlackHole): number {
  return getBlackHoleVariant(blackHole.kind).influenceRadiusCells;
}

export function getBlackHolePulseSpeed(blackHole: BlackHole): number {
  return getBlackHoleVariant(blackHole.kind).pulseSpeed;
}

export function getBlackHoleAlertRadiusCells(blackHole: BlackHole): number {
  return getBlackHoleInfluenceRadiusCells(blackHole) + 1;
}

export function getBlackHoleSpawnExclusionRadiusCells(blackHole: BlackHole): number {
  return getBlackHoleAlertRadiusCells(blackHole);
}

export function getBlackHoleFoodAvoidRadiusCells(blackHole: BlackHole): number {
  return getBlackHoleCoreRadiusCells(blackHole) + 1;
}

export function getBlackHoleChargeThreshold(blackHole: BlackHole, band: Exclude<BlackHoleBand, "core">): number {
  const thresholds = getBlackHoleVariant(blackHole.kind).chargeThresholds;

  switch (band) {
    case "strong":
      return thresholds.strong;
    case "medium":
      return thresholds.medium ?? thresholds.weak;
    case "weak":
      return thresholds.weak;
  }
}

export function spawnBlackHole(
  context: BlackHoleSpawnContext,
  config: typeof BLACK_HOLE_CONFIG = BLACK_HOLE_CONFIG,
): BlackHole | null {
  const random = context.random ?? Math.random;
  const kind = context.kind ?? getBlackHoleKindForSpawn(context.progress, context.grid);
  const variant = getBlackHoleVariant(kind);
  const currentHead = context.snake[0] ?? context.birthCell;
  const baseOccupiedCells = [
    ...context.snake.slice(1),
    ...context.foods,
    ...context.existingBlackHoles.map((blackHole) => blackHole.cell),
    ...(context.futureBlockedCells ?? []),
  ];
  const dangerZones: SafeSpawnZone[] = [
    { center: context.birthCell, radius: variant.safeSpawnDistance },
    { center: currentHead, radius: variant.safeSpawnDistance },
    ...context.existingBlackHoles.map((blackHole) => ({ center: blackHole.cell, radius: getBlackHoleSpawnExclusionRadiusCells(blackHole) })),
    ...(context.futureDangerZones ?? []),
  ];
  const rejectedCells: GridCell[] = [];

  for (let attempt = 0; attempt < config.maxCount * 64; attempt += 1) {
    const candidate = findStage0SafeSpawnPosition(context.grid, {
      occupiedCells: [...baseOccupiedCells, ...rejectedCells],
      snakeHead: currentHead,
      snakeHeadRadius: variant.safeSpawnDistance,
      wallPadding: variant.wallPadding,
      dangerZones,
      maxAttempts: 128,
      random,
    });

    if (!candidate) {
      return null;
    }

    if (!isBlackHoleCandidateSafe(candidate, context.grid, context.snake, context.foods, dangerZones, variant)) {
      rejectedCells.push(candidate);
      continue;
    }

    return {
      kind,
      cell: { ...candidate },
      seed: Math.floor(random() * 1_000_000),
      spawnTime: context.currentTime,
      activateAt: context.currentTime + variant.activationDelayMs / 1000,
    };
  }

  return null;
}

export function isBlackHoleCollision(cell: GridCell, blackHole: BlackHole, currentTime: number): boolean {
  if (!isBlackHoleActive(blackHole, currentTime)) {
    return false;
  }

  return getBlackHoleBandForCell(cell, blackHole, currentTime) === "core";
}

export function getBlackHoleBandForCell(cell: GridCell, blackHole: BlackHole, currentTime: number): BlackHoleBand | null {
  if (!isBlackHoleActive(blackHole, currentTime)) {
    return null;
  }

  const distance = getChebyshevDistance(cell, blackHole.cell);
  const variant = getBlackHoleVariant(blackHole.kind);

  if (distance <= variant.bodyRadiusCells) {
    return "core";
  }

  if (distance > variant.influenceRadiusCells) {
    return null;
  }

  if (blackHole.kind === "small") {
    return distance <= 1 ? "strong" : "weak";
  }

  if (distance <= 2) {
    return "strong";
  }

  if (distance <= 4) {
    return "medium";
  }

  return "weak";
}

export function resolveBlackHoleAlert(
  head: GridCell,
  blackHoles: readonly BlackHole[],
  currentTime: number,
): BlackHoleAlert | null {
  const dominant = chooseDominantAlert(head, blackHoles, currentTime);

  if (!dominant) {
    return null;
  }

  return {
    blackHole: dominant.blackHole,
    distance: dominant.distance,
  };
}

export function resolveBlackHoleMovement(
  head: GridCell,
  intendedDirection: Direction,
  previousDirection: Direction,
  blackHoles: readonly BlackHole[],
  currentTime: number,
  previousState: BlackHoleGravityState,
): BlackHoleMovementResolution {
  const dominant = chooseDominantInfluence(head, blackHoles, currentTime);

  if (!dominant) {
    return {
      finalDirection: intendedDirection,
      shouldDie: false,
      shouldPlayWarning: false,
      shouldPlayPull: false,
      shouldPlayFail: false,
      nextGravityState: { key: null, charge: 0 },
      activeBlackHole: null,
      cue: null,
    };
  }

  if (dominant.band === "core") {
    return {
      finalDirection: intendedDirection,
      shouldDie: true,
      shouldPlayWarning: false,
      shouldPlayPull: false,
      shouldPlayFail: false,
      nextGravityState: { key: null, charge: 0 },
      activeBlackHole: dominant.blackHole,
      cue: null,
    };
  }

  const isFirstTick = previousState.key !== dominant.key;
  const orientation = getBlackHoleOrientation(head, intendedDirection, dominant.blackHole);
  const pullDirection = orientation.isSideways ? choosePullDirection(head, intendedDirection, dominant.blackHole) : null;
  const chargeThreshold = getBlackHoleChargeThreshold(dominant.blackHole, dominant.band);
  let charge = isFirstTick ? 0 : previousState.charge;
  let finalDirection = intendedDirection;
  let shouldPlayWarning = false;
  let shouldPlayPull = false;
  let shouldPlayFail = false;

  if (isFirstTick) {
    shouldPlayWarning = true;
  } else if (orientation.isEscaping) {
    charge = 0;
  } else if (orientation.isAhead) {
    // Keep the current charge. Moving directly toward the hole should feel dangerous
    // but should not trigger the sideways pull.
  } else {
    charge += 1;

    if (charge >= chargeThreshold && pullDirection) {
      if (pullDirection === OPPOSITE_DIRECTIONS[previousDirection]) {
        shouldPlayFail = true;
      } else {
        finalDirection = pullDirection;
        shouldPlayPull = true;
        charge = 0;
      }
    } else {
      shouldPlayWarning = true;
    }
  }

  const cue: BlackHoleCue = {
    blackHole: dominant.blackHole,
    band: dominant.band,
    distance: dominant.distance,
    charge,
    chargeThreshold,
    pullDirection,
    isFirstTick,
    isPulling: shouldPlayPull,
    isEscaping: orientation.isEscaping,
  };

  return {
    finalDirection,
    shouldDie: false,
    shouldPlayWarning,
    shouldPlayPull,
    shouldPlayFail,
    nextGravityState: {
      key: dominant.key,
      charge,
    },
    activeBlackHole: dominant.blackHole,
    cue,
  };
}

function chooseDominantInfluence(
  head: GridCell,
  blackHoles: readonly BlackHole[],
  currentTime: number,
): BlackHoleInfluenceCandidate | null {
  const candidates: BlackHoleInfluenceCandidate[] = [];

  for (const blackHole of blackHoles) {
    const band = getBlackHoleBandForCell(head, blackHole, currentTime);

    if (!band) {
      continue;
    }

    const distance = getChebyshevDistance(head, blackHole.cell);
    candidates.push({
      blackHole,
      key: getBlackHoleKey(blackHole),
      band,
      distance,
      priority: getBandPriority(band) * 100 + getKindPriority(blackHole.kind) * 10 - distance,
    });
  }

  if (candidates.length === 0) {
    return null;
  }

  candidates.sort((left, right) => {
    if (left.distance !== right.distance) {
      return left.distance - right.distance;
    }

    const bandDelta = getBandPriority(right.band) - getBandPriority(left.band);
    if (bandDelta !== 0) {
      return bandDelta;
    }

    const kindDelta = getKindPriority(right.blackHole.kind) - getKindPriority(left.blackHole.kind);
    if (kindDelta !== 0) {
      return kindDelta;
    }

    return left.blackHole.spawnTime - right.blackHole.spawnTime;
  });

  return candidates[0] ?? null;
}

interface BlackHoleAlertCandidate {
  blackHole: BlackHole;
  distance: number;
}

function chooseDominantAlert(
  head: GridCell,
  blackHoles: readonly BlackHole[],
  currentTime: number,
): BlackHoleAlertCandidate | null {
  const candidates: BlackHoleAlertCandidate[] = [];

  for (const blackHole of blackHoles) {
    if (!isBlackHoleActive(blackHole, currentTime)) {
      continue;
    }

    const influenceRadius = getBlackHoleInfluenceRadiusCells(blackHole);
    const alertRadius = getBlackHoleAlertRadiusCells(blackHole);
    const distance = getChebyshevDistance(head, blackHole.cell);

    if (distance <= influenceRadius || distance > alertRadius) {
      continue;
    }

    candidates.push({
      blackHole,
      distance,
    });
  }

  if (candidates.length === 0) {
    return null;
  }

  candidates.sort((left, right) => {
    if (left.distance !== right.distance) {
      return left.distance - right.distance;
    }

    const kindDelta = getKindPriority(right.blackHole.kind) - getKindPriority(left.blackHole.kind);
    if (kindDelta !== 0) {
      return kindDelta;
    }

    return left.blackHole.spawnTime - right.blackHole.spawnTime;
  });

  return candidates[0] ?? null;
}

function getBlackHoleOrientation(
  head: GridCell,
  intendedDirection: Direction,
  blackHole: BlackHole,
): { forward: number; side: number; isAhead: boolean; isEscaping: boolean; isSideways: boolean } {
  const toHole = {
    x: blackHole.cell.column - head.column,
    y: blackHole.cell.row - head.row,
  };
  const direction = DIRECTION_VECTORS[intendedDirection];
  const [sideDirection] = PERPENDICULAR_PAIRS[intendedDirection];
  const sideVector = DIRECTION_VECTORS[sideDirection];
  const forward = toHole.x * direction.x + toHole.y * direction.y;
  const side = toHole.x * sideVector.x + toHole.y * sideVector.y;
  const absSide = Math.abs(side);

  return {
    forward,
    side,
    isAhead: forward >= absSide,
    isEscaping: -forward >= absSide,
    isSideways: forward < absSide && -forward < absSide,
  };
}

function choosePullDirection(head: GridCell, intendedDirection: Direction, blackHole: BlackHole): Direction | null {
  const toHole = {
    x: blackHole.cell.column - head.column,
    y: blackHole.cell.row - head.row,
  };
  const [leftDirection, rightDirection] = PERPENDICULAR_PAIRS[intendedDirection];
  const candidates: Array<{ direction: Direction; score: number }> = [
    {
      direction: leftDirection,
      score: dot(DIRECTION_VECTORS[leftDirection], toHole),
    },
    {
      direction: rightDirection,
      score: dot(DIRECTION_VECTORS[rightDirection], toHole),
    },
  ];

  candidates.sort((left, right) => right.score - left.score);

  const best = candidates[0];

  if (!best || best.score <= 0) {
    return null;
  }

  return best.direction;
}

function isBlackHoleCandidateSafe(
  candidate: GridCell,
  grid: GridMetrics,
  snake: readonly GridCell[],
  foods: readonly GridCell[],
  dangerZones: readonly SafeSpawnZone[],
  variant: BlackHoleVariant,
): boolean {
  if (isWallUnsafe(candidate, grid, variant.wallPadding)) {
    return false;
  }

  if (dangerZones.some((zone) => isInDangerZone(candidate, zone))) {
    return false;
  }

  const blockedCells = buildBlockedSet([...snake.slice(1), candidate]);
  for (const zone of dangerZones) {
    blockedCells.add(cellKey(zone.center));
  }

  return hasPathToAnyFood(grid, snake[0] ?? candidate, foods, blockedCells);
}

function hasPathToAnyFood(
  grid: GridMetrics,
  start: GridCell,
  foods: readonly GridCell[],
  blockedCells: Set<string>,
): boolean {
  if (foods.length === 0) {
    return true;
  }

  const targetCells = new Set(foods.map((food) => cellKey(food)));
  const visited = new Set<string>();
  const queue: GridCell[] = [{ ...start }];

  visited.add(cellKey(start));

  while (queue.length > 0) {
    const current = queue.shift();

    if (!current) {
      continue;
    }

    if (targetCells.has(cellKey(current))) {
      return true;
    }

    for (const delta of NEIGHBOR_DELTAS) {
      const next = {
        column: current.column + delta.column,
        row: current.row + delta.row,
      };
      const key = cellKey(next);

      if (visited.has(key) || blockedCells.has(key) || !isInsideGrid(next, grid)) {
        continue;
      }

      visited.add(key);
      queue.push(next);
    }
  }

  return false;
}

function buildBlockedSet(cells: readonly GridCell[]): Set<string> {
  const blocked = new Set<string>();

  for (const cell of cells) {
    blocked.add(cellKey(cell));
  }

  return blocked;
}

function isWallUnsafe(cell: GridCell, grid: GridMetrics, padding: number): boolean {
  if (padding <= 0) {
    return false;
  }

  return (
    cell.row < padding ||
    cell.column < padding ||
    cell.row >= grid.rows - padding ||
    cell.column >= grid.columns - padding
  );
}

function isNear(cell: GridCell, center: GridCell, radius: number): boolean {
  if (radius <= 0) {
    return false;
  }

  return Math.max(Math.abs(cell.row - center.row), Math.abs(cell.column - center.column)) <= radius;
}

function isInDangerZone(cell: GridCell, zone: SafeSpawnZone): boolean {
  return isNear(cell, zone.center, Math.max(0, Math.floor(zone.radius)));
}

function isInsideGrid(cell: GridCell, grid: GridMetrics): boolean {
  return cell.column >= 0 && cell.row >= 0 && cell.column < grid.columns && cell.row < grid.rows;
}

function getBandPriority(band: BlackHoleBand): number {
  return BAND_PRIORITY[band];
}

function getKindPriority(kind: BlackHoleKind): number {
  return KIND_PRIORITY[kind];
}

function getChebyshevDistance(left: GridCell, right: GridCell): number {
  return Math.max(Math.abs(left.column - right.column), Math.abs(left.row - right.row));
}

function dot(vector: { x: number; y: number }, target: { x: number; y: number }): number {
  return vector.x * target.x + vector.y * target.y;
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

function cellKey(cell: GridCell): string {
  return `${cell.column}:${cell.row}`;
}

const OPPOSITE_DIRECTIONS: Record<Direction, Direction> = {
  up: "down",
  right: "left",
  down: "up",
  left: "right",
};
