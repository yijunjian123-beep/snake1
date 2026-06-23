import { findStage0SafeSpawnPosition } from "./spawn";
import type { GameProgress, SafeSpawnZone } from "./progression";
import type { BlackHole, GridCell, GridMetrics } from "./types";

export interface BlackHoleConfig {
  unlockLength: number;
  maxCount: number;
  midScoreThreshold: number;
  midLengthThreshold: number;
  lateScoreThreshold: number;
  lateLengthThreshold: number;
  visualRadiusCells: number;
  hitRadiusCells: number;
  safeSpawnDistance: number;
  wallPadding: number;
  visualAttractionRangeCells: number;
  pulseSpeed: number;
  spawnAttempts: number;
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
  random?: () => number;
}

const NEIGHBOR_DELTAS: readonly GridCell[] = [
  { column: 0, row: -1 },
  { column: 1, row: 0 },
  { column: 0, row: 1 },
  { column: -1, row: 0 },
];

export const BLACK_HOLE_CONFIG: BlackHoleConfig = {
  unlockLength: 7,
  maxCount: 3,
  midScoreThreshold: 80,
  midLengthThreshold: 12,
  lateScoreThreshold: 160,
  lateLengthThreshold: 18,
  visualRadiusCells: 0.62,
  hitRadiusCells: 0.5,
  safeSpawnDistance: 3,
  wallPadding: 2,
  visualAttractionRangeCells: 4.5,
  pulseSpeed: 1.65,
  spawnAttempts: 160,
};

export function getDesiredBlackHoleCount(progress: GameProgress, config: BlackHoleConfig = BLACK_HOLE_CONFIG): number {
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

export function spawnBlackHole(
  context: BlackHoleSpawnContext,
  config: BlackHoleConfig = BLACK_HOLE_CONFIG,
): BlackHole | null {
  const random = context.random ?? Math.random;
  const currentHead = context.snake[0] ?? context.birthCell;
  const baseOccupiedCells = [
    ...context.snake.slice(1),
    ...context.foods,
    ...context.existingBlackHoles.map((blackHole) => blackHole.cell),
    ...(context.futureBlockedCells ?? []),
  ];
  const dangerZones: SafeSpawnZone[] = [
    { center: context.birthCell, radius: config.safeSpawnDistance },
    { center: currentHead, radius: config.safeSpawnDistance },
    ...context.existingBlackHoles.map((blackHole) => ({ center: blackHole.cell, radius: config.safeSpawnDistance })),
    ...(context.futureDangerZones ?? []),
  ];
  const rejectedCells: GridCell[] = [];

  for (let attempt = 0; attempt < config.spawnAttempts; attempt += 1) {
    const candidate = findStage0SafeSpawnPosition(context.grid, {
      occupiedCells: [...baseOccupiedCells, ...rejectedCells],
      snakeHead: currentHead,
      snakeHeadRadius: config.safeSpawnDistance,
      wallPadding: config.wallPadding,
      dangerZones,
      maxAttempts: config.spawnAttempts,
      random,
    });

    if (!candidate) {
      return null;
    }

    if (!isBlackHoleCandidateSafe(candidate, context.grid, context.snake, context.foods, dangerZones, config)) {
      rejectedCells.push(candidate);
      continue;
    }

    return {
      cell: { ...candidate },
      seed: Math.floor(random() * 1_000_000),
      spawnTime: context.currentTime,
    };
  }

  return null;
}

export function isBlackHoleCollision(
  cell: GridCell,
  blackHole: BlackHole,
  grid: GridMetrics,
  config: BlackHoleConfig = BLACK_HOLE_CONFIG,
): boolean {
  const headCenter = cellCenter(grid, cell);
  const holeCenter = cellCenter(grid, blackHole.cell);
  const hitRadius = getBlackHoleHitRadius(grid, config);

  return Math.hypot(headCenter.x - holeCenter.x, headCenter.y - holeCenter.y) <= hitRadius;
}

export function getBlackHoleVisualRadius(grid: GridMetrics, config: BlackHoleConfig = BLACK_HOLE_CONFIG): number {
  return grid.cellSize * config.visualRadiusCells;
}

export function getBlackHoleHitRadius(grid: GridMetrics, config: BlackHoleConfig = BLACK_HOLE_CONFIG): number {
  return grid.cellSize * config.hitRadiusCells;
}

function isBlackHoleCandidateSafe(
  candidate: GridCell,
  grid: GridMetrics,
  snake: readonly GridCell[],
  foods: readonly GridCell[],
  dangerZones: readonly SafeSpawnZone[],
  config: BlackHoleConfig,
): boolean {
  if (isWallUnsafe(candidate, grid, config.wallPadding)) {
    return false;
  }

  if (dangerZones.some((zone) => isInDangerZone(candidate, zone))) {
    return false;
  }

  const blockedCells = buildBlockedSet([...snake.slice(1), candidate]);
  for (const blackHole of dangerZones) {
    blockedCells.add(cellKey(blackHole.center));
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

function cellCenter(grid: GridMetrics, cell: GridCell): { x: number; y: number } {
  return {
    x: grid.offsetX + cell.column * grid.cellSize + grid.cellSize / 2,
    y: grid.offsetY + cell.row * grid.cellSize + grid.cellSize / 2,
  };
}

function cellKey(cell: GridCell): string {
  return `${cell.column}:${cell.row}`;
}
