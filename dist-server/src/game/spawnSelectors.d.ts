import type { SafeSpawnZone } from "./progression.js";
import type { GridCell, StarAttractor, StarBeast, StarCore } from "./types.js";
export interface BlackHoleSpawnBlockedCellsInput {
    starBeasts: readonly StarBeast[];
    starAttractors: readonly StarAttractor[];
    starCores: readonly StarCore[];
    includeStarAttractors: boolean;
    extraBlockedCells?: readonly GridCell[];
}
export interface BlackHoleSpawnDangerZonesInput {
    starBeasts: readonly StarBeast[];
    birthCell: GridCell;
}
export declare function getStarCoreCells(starCores: readonly StarCore[]): GridCell[];
export declare function getStarAttractorCells(starAttractors: readonly StarAttractor[], enabled: boolean): GridCell[];
export declare function getStarBeastCells(starBeasts: readonly StarBeast[]): GridCell[];
export declare function getBlackHoleSpawnBlockedCells(input: BlackHoleSpawnBlockedCellsInput): GridCell[];
export declare function getBlackHoleSpawnDangerZones(input: BlackHoleSpawnDangerZonesInput): SafeSpawnZone[];
