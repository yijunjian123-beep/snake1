import { getBlackHoleSpawnExclusionRadiusCells } from "./blackHole";
import { getDirectionDelta } from "./direction";
import { cellKey, chebyshevDistance } from "./gridMath";
import { findSafeSpawnPosition } from "./spawn";
import type { GameProgress, SafeSpawnZone } from "./progression";
import type { BlackHole, Direction, GridCell, GridMetrics, StarAttractor, StarBeast } from "./types";

export const STAR_ATTRACTOR_CONFIG = {
  unlockLength: 10,
  maxOnBoard: 1,
  spawnAttempts: 96,
  minHeadDistance: 4,
  maxHeadDistanceRatio: 0.7,
  wallPadding: 1,
  minBlackHoleDistance: 2,
  thresholdRanges: [
    [6, 8],
    [8, 12],
    [10, 15],
    [10, 15],
  ],
} as const;

export interface StarAttractorSpawnContext {
  grid: GridMetrics;
  progress: GameProgress;
  snake: readonly GridCell[];
  direction: Direction;
  foods: readonly GridCell[];
  starCoreCells: readonly GridCell[];
  existingBlackHoles: readonly BlackHole[];
  existingStarAttractors: readonly StarAttractor[];
  existingStarBeasts: readonly StarBeast[];
  currentTime: number;
  random?: () => number;
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

function isDirectFrontCell(candidate: GridCell, head: GridCell, direction: Direction): boolean {
  const delta = getDirectionDelta(direction);

  return candidate.column === head.column + delta.column && candidate.row === head.row + delta.row;
}

function getBlackHoleDangerZones(blackHoles: readonly BlackHole[]): SafeSpawnZone[] {
  return blackHoles.map((blackHole) => ({
    center: blackHole.cell,
    radius: Math.max(STAR_ATTRACTOR_CONFIG.minBlackHoleDistance, getBlackHoleSpawnExclusionRadiusCells(blackHole)),
  }));
}

function getStarBeastDangerZones(starBeasts: readonly StarBeast[]): SafeSpawnZone[] {
  return starBeasts.map((beast) => ({
    center: beast.body[0] ?? beast.body[Math.max(0, Math.floor(beast.body.length / 2))] ?? { column: 0, row: 0 },
    radius: Math.max(4, Math.ceil(beast.length * 0.45)),
  }));
}

function isCandidateValid(
  candidate: GridCell,
  grid: GridMetrics,
  head: GridCell,
  direction: Direction,
): boolean {
  const distance = chebyshevDistance(candidate, head);
  const maxDistance = clamp(
    Math.floor(Math.max(grid.columns, grid.rows) * STAR_ATTRACTOR_CONFIG.maxHeadDistanceRatio),
    STAR_ATTRACTOR_CONFIG.minHeadDistance,
    Math.max(grid.columns, grid.rows),
  );

  if (distance < STAR_ATTRACTOR_CONFIG.minHeadDistance || distance > maxDistance) {
    return false;
  }

  return !isDirectFrontCell(candidate, head, direction);
}

export function getDesiredStarAttractorCount(
  progress: GameProgress,
  config: typeof STAR_ATTRACTOR_CONFIG = STAR_ATTRACTOR_CONFIG,
): number {
  return progress.snakeLength >= config.unlockLength ? config.maxOnBoard : 0;
}

export function rollStarAttractorNeed(cycleIndex: number, random: () => number = Math.random): number {
  const range = STAR_ATTRACTOR_CONFIG.thresholdRanges[cycleIndex % STAR_ATTRACTOR_CONFIG.thresholdRanges.length] ?? STAR_ATTRACTOR_CONFIG.thresholdRanges[0];

  if (!range) {
    return 6;
  }

  const [min, max] = range;
  const span = Math.max(0, max - min);

  return min + Math.floor(clamp(random(), 0, 0.999999999) * (span + 1));
}

export function spawnStarAttractor(context: StarAttractorSpawnContext): StarAttractor | null {
  const random = context.random ?? Math.random;
  const desiredCount = getDesiredStarAttractorCount(context.progress);

  if (desiredCount <= 0 || context.existingStarAttractors.length >= STAR_ATTRACTOR_CONFIG.maxOnBoard) {
    return null;
  }

  const currentHead = context.snake[0] ?? {
    column: Math.floor(context.grid.columns / 2),
    row: Math.floor(context.grid.rows / 2),
  };
  const occupiedCells = [
    ...context.snake,
    ...context.foods,
    ...context.starCoreCells,
    ...context.existingBlackHoles.map((blackHole) => blackHole.cell),
    ...context.existingStarAttractors.map((attractor) => attractor.cell),
    ...context.existingStarBeasts.flatMap((beast) => beast.body),
  ];
  const occupied = occupiedCells.map((cell) => cellKey(cell));
  const dangerZones = [
    { center: currentHead, radius: STAR_ATTRACTOR_CONFIG.minHeadDistance },
    ...getBlackHoleDangerZones(context.existingBlackHoles),
    ...getStarBeastDangerZones(context.existingStarBeasts),
  ];
  const rejectedCells: GridCell[] = [];

  for (let attempt = 0; attempt < STAR_ATTRACTOR_CONFIG.spawnAttempts; attempt += 1) {
    const candidate = findSafeSpawnPosition(context.grid, {
      occupiedCells: [
        ...context.snake,
        ...context.foods,
        ...context.starCoreCells,
        ...context.existingBlackHoles.map((blackHole) => blackHole.cell),
        ...context.existingStarAttractors.map((attractor) => attractor.cell),
        ...context.existingStarBeasts.flatMap((beast) => beast.body),
        ...rejectedCells,
      ],
      snakeHead: currentHead,
      snakeHeadRadius: STAR_ATTRACTOR_CONFIG.minHeadDistance,
      wallPadding: STAR_ATTRACTOR_CONFIG.wallPadding,
      dangerZones,
      maxAttempts: 128,
      random,
    });

    if (!candidate) {
      return null;
    }

    if (!isCandidateValid(candidate, context.grid, currentHead, context.direction)) {
      rejectedCells.push(candidate);
      continue;
    }

    const key = cellKey(candidate);

    if (occupied.includes(key)) {
      rejectedCells.push(candidate);
      continue;
    }

    return {
      id: Math.floor(random() * 1_000_000),
      cell: { ...candidate },
      spawnTime: context.currentTime,
      seed: Math.floor(random() * 1_000_000),
    };
  }

  return null;
}
