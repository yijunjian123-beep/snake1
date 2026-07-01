import type { GridCell, GridMetrics } from "./types.js";
export interface GridRadiusZone {
    center: GridCell;
    radius: number;
}
export declare function cellKey(cell: GridCell): string;
export declare function cellIndex(cell: GridCell, grid: GridMetrics): number;
export declare function getCellIndex(cell: GridCell, grid: GridMetrics): number | null;
export declare function cellsMatch(left: GridCell, right: GridCell): boolean;
export declare function chebyshevDistance(left: GridCell, right: GridCell): number;
export declare function manhattanDistance(left: GridCell, right: GridCell): number;
export declare function isInsideGrid(cell: GridCell, grid: GridMetrics): boolean;
export declare function isWithinChebyshevRadius(cell: GridCell, center: GridCell, radius: number): boolean;
export declare function isCellInsideZone(cell: GridCell, zone: GridRadiusZone): boolean;
