import type { Direction, GridCell, GridMetrics } from "./types.js";
import type { SafeSpawnConfig, SafeSpawnZone } from "./progression.js";
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
export declare function findSafeSpawnPosition(grid: GridMetrics, config?: SafeSpawnConfig): GridCell | null;
export declare function findStage0SafeSpawnPosition(grid: GridMetrics, config?: SafeSpawnConfig): GridCell | null;
export declare function findReviveSpawnPlacement(grid: GridMetrics, config: ReviveSpawnConfig): ReviveSpawnPlacement | null;
