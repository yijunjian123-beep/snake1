import type { GridCell, GridMetrics } from "./types.js";

export interface GridRadiusZone {
  center: GridCell;
  radius: number;
}

export function cellKey(cell: GridCell): string {
  return `${cell.column}:${cell.row}`;
}

export function cellIndex(cell: GridCell, grid: GridMetrics): number {
  return cell.row * grid.columns + cell.column;
}

export function getCellIndex(cell: GridCell, grid: GridMetrics): number | null {
  if (!isInsideGrid(cell, grid)) {
    return null;
  }

  return cellIndex(cell, grid);
}

export function cellsMatch(left: GridCell, right: GridCell): boolean {
  return left.column === right.column && left.row === right.row;
}

export function chebyshevDistance(left: GridCell, right: GridCell): number {
  return Math.max(Math.abs(left.column - right.column), Math.abs(left.row - right.row));
}

export function manhattanDistance(left: GridCell, right: GridCell): number {
  return Math.abs(left.column - right.column) + Math.abs(left.row - right.row);
}

export function isInsideGrid(cell: GridCell, grid: GridMetrics): boolean {
  return cell.column >= 0 && cell.row >= 0 && cell.column < grid.columns && cell.row < grid.rows;
}

export function isWithinChebyshevRadius(cell: GridCell, center: GridCell, radius: number): boolean {
  if (radius <= 0) {
    return false;
  }

  return chebyshevDistance(cell, center) <= radius;
}

export function isCellInsideZone(cell: GridCell, zone: GridRadiusZone): boolean {
  return isWithinChebyshevRadius(cell, zone.center, Math.max(0, Math.floor(zone.radius)));
}
