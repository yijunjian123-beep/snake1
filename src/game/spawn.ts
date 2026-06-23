import type { GridCell, GridMetrics } from "./types";
import type { SafeSpawnConfig, SafeSpawnZone } from "./progression";

interface SpawnCandidateRule {
  ignoreHeadRadius: boolean;
  ignoreWallPadding: boolean;
  ignoreDangerZones: boolean;
}

const DEFAULT_RANDOM = (): number => Math.random();

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
  if (radius <= 0) return false;
  return Math.max(Math.abs(cell.row - center.row), Math.abs(cell.column - center.column)) <= radius;
}

function isInDangerZone(cell: GridCell, zone: SafeSpawnZone): boolean {
  return isNear(cell, zone.center, Math.max(0, Math.floor(zone.radius)));
}

function pickFrom(candidates: readonly GridCell[], random: () => number): GridCell | null {
  if (candidates.length === 0) return null;
  const index = Math.floor(random() * candidates.length);
  return candidates[Math.min(candidates.length - 1, Math.max(0, index))] ?? null;
}

function cellKey(cell: GridCell): string {
  return cell.row + ':' + cell.column;
}
