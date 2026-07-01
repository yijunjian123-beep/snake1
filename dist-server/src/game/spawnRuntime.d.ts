import { type FoodSpawnContext } from "./foodSpawn.js";
import type { BlackHole, GridCell, GridMetrics, StarAttractor, StarBeast, StarCore } from "./types.js";
export interface BuildFoodSpawnContextInput {
    grid: GridMetrics;
    blackHoles: readonly BlackHole[];
    snake: readonly GridCell[];
    foods: readonly GridCell[];
    starAttractors: readonly StarAttractor[];
    starBeasts: readonly StarBeast[];
    starCores: readonly StarCore[];
    includeStarAttractors: boolean;
    extraBlockedCells?: readonly GridCell[];
}
export interface PlacementValidationInput {
    grid: GridMetrics;
    blackHoles: readonly BlackHole[];
    snake: readonly GridCell[];
    foods: readonly GridCell[];
    starAttractors: readonly StarAttractor[];
    starBeasts: readonly StarBeast[];
    starCores: readonly StarCore[];
    includeStarAttractors: boolean;
}
export interface ReviveBlockedCellsInput {
    blackHoles: readonly BlackHole[];
    snake: readonly GridCell[];
    foods: readonly GridCell[];
    starAttractors: readonly StarAttractor[];
    starBeasts: readonly StarBeast[];
    starCores: readonly StarCore[];
    includeStarAttractors: boolean;
}
export declare function buildFoodSpawnContext(input: BuildFoodSpawnContextInput): FoodSpawnContext;
export declare function getReviveBlockedCells(input: ReviveBlockedCellsInput): GridCell[];
export declare function isCurrentPlacementValid(input: PlacementValidationInput): boolean;
