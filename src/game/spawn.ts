import { CARDINAL_DIRECTIONS, stepCell } from "./direction.js";
import { cellKey, isCellInsideZone, isInsideGrid, isWithinChebyshevRadius } from "./gridMath.js";
import type { Direction, GridCell, GridMetrics } from "./types.js";
import type { SafeSpawnConfig, SafeSpawnZone } from "./progression.js";

interface SpawnCandidateRule {
  ignoreHeadRadius: boolean;
  ignoreWallPadding: boolean;
  ignoreDangerZones: boolean;
}

export interface ReviveSpawnPlacement {
  cells: GridCell[];
  direction: Direction;
}

export interface ReviveSpawnConfig {
  occupiedCells?: readonly GridCell[];
  blockedCells?: readonly GridCell[];
  dangerZones?: readonly SafeSpawnZone[];
  wallPadding?: number;
  length: number;
  random?: () => number;
}

const DEFAULT_RANDOM = (): number => Math.random();
const REVIVE_FORWARD_CLEAR_DISTANCE = 12;

export function findSafeSpawnPosition(grid: GridMetrics, config: SafeSpawnConfig = {}): GridCell | null {
  const occupied = new Set<string>();
  const occupiedCells = [...(config.occupiedCells ?? []), ...(config.blockedCells ?? [])];
  occupiedCells.forEach((cell) => occupied.add(cellKey(cell)));
  const head = config.snakeHead ?? null;
  const headRadius = Math.max(0, Math.floor(config.snakeHeadRadius ?? 1));
  const wallPadding = Math.max(0, Math.floor(config.wallPadding ?? 0));
  const dangerZones = config.dangerZones ?? [];
  const random = config.random ?? DEFAULT_RANDOM;
  const maxAttempts = Math.max(1, Math.floor(config.maxAttempts ?? 1));

  const candidateRules: SpawnCandidateRule[] = [
    { ignoreHeadRadius: false, ignoreWallPadding: false, ignoreDangerZones: false },
    { ignoreHeadRadius: true, ignoreWallPadding: false, ignoreDangerZones: false },
    { ignoreHeadRadius: true, ignoreWallPadding: true, ignoreDangerZones: false },
    { ignoreHeadRadius: true, ignoreWallPadding: true, ignoreDangerZones: true }
  ];

  for (const rule of candidateRules) {
    const candidate = pickCandidate(grid, occupied, head, headRadius, wallPadding, dangerZones, rule, maxAttempts, random);
    if (candidate) return candidate;
  }

  const fallback: GridCell[] = [];
  for (let row = 0; row < grid.rows; row += 1) {
    for (let column = 0; column < grid.columns; column += 1) {
      const cell = { row, column };
      if (!occupied.has(cellKey(cell))) fallback.push(cell);
    }
  }

  return pickFrom(fallback, random);
}

export function findStage0SafeSpawnPosition(grid: GridMetrics, config: SafeSpawnConfig = {}): GridCell | null {
  const occupied = new Set<string>();
  const occupiedCells = [...(config.occupiedCells ?? []), ...(config.blockedCells ?? [])];
  occupiedCells.forEach((cell) => occupied.add(cellKey(cell)));
  const head = config.snakeHead ?? null;
  const headRadius = Math.max(0, Math.floor(config.snakeHeadRadius ?? 1));
  const wallPadding = Math.max(0, Math.floor(config.wallPadding ?? 0));
  const dangerZones = config.dangerZones ?? [];
  const random = config.random ?? DEFAULT_RANDOM;
  const maxAttempts = Math.max(1, Math.floor(config.maxAttempts ?? 1));

  return pickCandidate(grid, occupied, head, headRadius, wallPadding, dangerZones, {
    ignoreHeadRadius: false,
    ignoreWallPadding: false,
    ignoreDangerZones: false,
  }, maxAttempts, random);
}

export function findReviveSpawnPlacement(
  grid: GridMetrics,
  config: ReviveSpawnConfig,
): ReviveSpawnPlacement | null {
  const length = Math.max(1, Math.floor(config.length));
  const wallPadding = Math.max(0, Math.floor(config.wallPadding ?? 1));
  const blocked = new Set<string>();
  const dangerZones = config.dangerZones ?? [];
  const random = config.random ?? DEFAULT_RANDOM;
  const centerColumn = (grid.columns - 1) / 2;
  const centerRow = (grid.rows - 1) / 2;

  for (const cell of [...(config.occupiedCells ?? []), ...(config.blockedCells ?? [])]) {
    blocked.add(cellKey(cell));
  }

  const headCandidates: Array<{ cell: GridCell; radius: number; score: number }> = [];

  for (let row = 0; row < grid.rows; row += 1) {
    for (let column = 0; column < grid.columns; column += 1) {
      const cell = { column, row };

      if (!isPlacementCellSafe(cell, grid, blocked, dangerZones, wallPadding)) {
        continue;
      }

      headCandidates.push({
        cell,
        radius: Math.max(Math.abs(cell.column - centerColumn), Math.abs(cell.row - centerRow)),
        score: scoreReviveHeadCandidate(cell, grid, blocked, dangerZones, wallPadding) + random() * 0.001,
      });
    }
  }

  if (headCandidates.length === 0) {
    return null;
  }

  headCandidates.sort((left, right) => (
    left.radius - right.radius ||
    right.score - left.score ||
    left.cell.row - right.cell.row ||
    left.cell.column - right.cell.column
  ));

  for (const headCandidate of headCandidates) {
    const head = headCandidate.cell;
    const directionCandidates = CARDINAL_DIRECTIONS
      .map((direction) => {
        const forwardCells = getReviveForwardCells(
          head,
          direction,
          grid,
          blocked,
          dangerZones,
          wallPadding,
        );

        if (!forwardCells) {
          return null;
        }

        const front = forwardCells[0] ?? stepCell(head, direction);
        const score = scoreReviveDirection(direction, head, grid, blocked, dangerZones, wallPadding);

        return {
          direction,
          front,
          forwardCells,
          score: score + random() * 0.001,
        };
      })
      .filter((candidate): candidate is {
        direction: Direction;
        front: GridCell;
        forwardCells: GridCell[];
        score: number;
      } => candidate !== null && Number.isFinite(candidate.score))
      .sort((left, right) => (
        right.score - left.score ||
        left.front.row - right.front.row ||
        left.front.column - right.front.column
      ));

    for (const directionCandidate of directionCandidates) {
      const { direction, front, forwardCells } = directionCandidate;

      const visited = new Set<string>(blocked);
      visited.add(cellKey(head));
      for (const forwardCell of forwardCells) {
        visited.add(cellKey(forwardCell));
      }

      const body: GridCell[] = [];

      if (buildReviveBodyPath(
        grid,
        head,
        body,
        visited,
        length - 1,
        dangerZones,
        wallPadding,
        front,
        random,
      )) {
        return { cells: [head, ...body], direction };
      }
    }
  }

  return null;
}

function pickCandidate(
  grid: GridMetrics,
  occupied: Set<string>,
  head: GridCell | null,
  headRadius: number,
  wallPadding: number,
  dangerZones: readonly SafeSpawnZone[],
  rule: SpawnCandidateRule,
  maxAttempts: number,
  random: () => number
): GridCell | null {
  const candidates: GridCell[] = [];

  for (let row = 0; row < grid.rows; row += 1) {
    for (let col = 0; col < grid.columns; col += 1) {
      const cell = { row, column: col };
      if (occupied.has(cellKey(cell))) continue;
      if (!rule.ignoreWallPadding && isWallDanger(cell, grid, wallPadding)) continue;
      if (!rule.ignoreHeadRadius && head && isNear(cell, head, headRadius)) continue;
      if (!rule.ignoreDangerZones && dangerZones.some((zone) => isInDangerZone(cell, zone))) continue;
      candidates.push(cell);
    }
  }

  if (candidates.length === 0) return null;

  for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
    const index = Math.floor(random() * candidates.length);
    const candidate = candidates[index];
    if (candidate) return candidate;
  }

  return null;
}

function isWallDanger(cell: GridCell, grid: GridMetrics, padding: number): boolean {
  if (padding <= 0) return false;
  return (
    cell.row < padding ||
    cell.column < padding ||
    cell.row >= grid.rows - padding ||
    cell.column >= grid.columns - padding
  );
}

function isNear(cell: GridCell, center: GridCell, radius: number): boolean {
  return isWithinChebyshevRadius(cell, center, radius);
}

function isInDangerZone(cell: GridCell, zone: SafeSpawnZone): boolean {
  return isCellInsideZone(cell, zone);
}

function buildReviveBodyPath(
  grid: GridMetrics,
  current: GridCell,
  path: GridCell[],
  visited: Set<string>,
  remainingSegments: number,
  dangerZones: readonly SafeSpawnZone[],
  wallPadding: number,
  frontCell: GridCell,
  random: () => number,
): boolean {
  if (remainingSegments <= 0) {
    return true;
  }

  const candidates = CARDINAL_DIRECTIONS
    .map((direction) => {
      const cell = stepCell(current, direction);

      if (!isPlacementCellSafe(cell, grid, visited, dangerZones, wallPadding)) {
        return null;
      }

      return {
        direction,
        cell,
        score: scoreRevivePathCell(cell, grid, visited, dangerZones, wallPadding, frontCell) + random() * 0.001,
      };
    })
    .filter((candidate): candidate is { direction: Direction; cell: GridCell; score: number } => candidate !== null)
    .sort((left, right) => (
      right.score - left.score ||
      left.cell.row - right.cell.row ||
      left.cell.column - right.cell.column
    ));

  for (const candidate of candidates) {
    path.push(candidate.cell);
    visited.add(cellKey(candidate.cell));

    if (buildReviveBodyPath(
      grid,
      candidate.cell,
      path,
      visited,
      remainingSegments - 1,
      dangerZones,
      wallPadding,
      frontCell,
      random,
    )) {
      return true;
    }

    path.pop();
    visited.delete(cellKey(candidate.cell));
  }

  return false;
}

function isPlacementCellSafe(
  cell: GridCell,
  grid: GridMetrics,
  blocked: Set<string>,
  dangerZones: readonly SafeSpawnZone[],
  wallPadding: number,
): boolean {
  if (!isInsideGrid(cell, grid)) {
    return false;
  }

  if (blocked.has(cellKey(cell))) {
    return false;
  }

  if (isWallDanger(cell, grid, wallPadding)) {
    return false;
  }

  return !dangerZones.some((zone) => isInDangerZone(cell, zone));
}

function scoreReviveHeadCandidate(
  cell: GridCell,
  grid: GridMetrics,
  blocked: Set<string>,
  dangerZones: readonly SafeSpawnZone[],
  wallPadding: number,
): number {
  const centerColumn = (grid.columns - 1) / 2;
  const centerRow = (grid.rows - 1) / 2;
  const centerDistance = Math.hypot(cell.column - centerColumn, cell.row - centerRow);
  const wallDistance = Math.min(cell.column, cell.row, grid.columns - 1 - cell.column, grid.rows - 1 - cell.row);
  const openNeighbors = getOpenNeighborCount(cell, grid, blocked, dangerZones, wallPadding);
  const dangerDistance = dangerZones.length > 0
    ? dangerZones.reduce((closest, zone) => {
      const distance = Math.max(Math.abs(cell.column - zone.center.column), Math.abs(cell.row - zone.center.row)) - Math.max(0, Math.floor(zone.radius));
      return Math.min(closest, distance);
    }, Number.POSITIVE_INFINITY)
    : 0;

  return wallDistance * 6 + openNeighbors * 4 + Math.max(0, dangerDistance) * 8 - centerDistance;
}

function scoreReviveDirection(
  direction: Direction,
  head: GridCell,
  grid: GridMetrics,
  blocked: Set<string>,
  dangerZones: readonly SafeSpawnZone[],
  wallPadding: number,
): number {
  const front = stepCell(head, direction);

  if (!isPlacementCellSafe(front, grid, blocked, dangerZones, wallPadding)) {
    return Number.NEGATIVE_INFINITY;
  }

  const scoutBlocked = new Set<string>(blocked);
  scoutBlocked.add(cellKey(head));

  const wallDistance = Math.min(
    front.column,
    front.row,
    grid.columns - 1 - front.column,
    grid.rows - 1 - front.row,
  );
  const openNeighbors = getOpenNeighborCount(front, grid, scoutBlocked, dangerZones, wallPadding);
  const centerColumn = (grid.columns - 1) / 2;
  const centerRow = (grid.rows - 1) / 2;
  const centerDistance = Math.hypot(front.column - centerColumn, front.row - centerRow);

  let score = wallDistance * 5 + openNeighbors * 6 - centerDistance;

  const headWallDistance = Math.min(
    head.column,
    head.row,
    grid.columns - 1 - head.column,
    grid.rows - 1 - head.row,
  );

  score += headWallDistance * 0.5;

  return score;
}

function getReviveForwardCells(
  head: GridCell,
  direction: Direction,
  grid: GridMetrics,
  blocked: Set<string>,
  dangerZones: readonly SafeSpawnZone[],
  wallPadding: number,
): GridCell[] | null {
  const cells: GridCell[] = [];
  let current = head;

  for (let step = 0; step < REVIVE_FORWARD_CLEAR_DISTANCE; step += 1) {
    current = stepCell(current, direction);

    if (!isPlacementCellSafe(current, grid, blocked, dangerZones, wallPadding)) {
      return null;
    }

    cells.push(current);
  }

  return cells;
}

function scoreRevivePathCell(
  cell: GridCell,
  grid: GridMetrics,
  visited: Set<string>,
  dangerZones: readonly SafeSpawnZone[],
  wallPadding: number,
  frontCell: GridCell,
): number {
  const wallDistance = Math.min(cell.column, cell.row, grid.columns - 1 - cell.column, grid.rows - 1 - cell.row);
  const openNeighbors = getOpenNeighborCount(cell, grid, visited, dangerZones, wallPadding);
  const frontDistance = Math.abs(cell.column - frontCell.column) + Math.abs(cell.row - frontCell.row);
  return wallDistance * 2 + openNeighbors * 5 + frontDistance;
}

function getOpenNeighborCount(
  cell: GridCell,
  grid: GridMetrics,
  blocked: Set<string>,
  dangerZones: readonly SafeSpawnZone[],
  wallPadding: number,
): number {
  let count = 0;

  for (const direction of CARDINAL_DIRECTIONS) {
    const next = stepCell(cell, direction);

    if (!isPlacementCellSafe(next, grid, blocked, dangerZones, wallPadding)) {
      continue;
    }

    count += 1;
  }

  return count;
}

function pickFrom(candidates: readonly GridCell[], random: () => number): GridCell | null {
  if (candidates.length === 0) return null;
  const index = Math.floor(random() * candidates.length);
  return candidates[Math.min(candidates.length - 1, Math.max(0, index))] ?? null;
}
