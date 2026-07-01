import { type FoodWaveKind } from "./gameState.js";
import type { BlackHole, GridCell, GridMetrics } from "./types.js";
export declare const FOOD_SPAWN_CONFIG: {
    readonly normalCap: 10;
    readonly waveIntervalMs: 5000;
    readonly waveBagSingleCount: 17;
    readonly waveBagClusterCount: 3;
    readonly clusterMinCount: 3;
    readonly clusterMaxCount: 5;
    readonly clusterRadius: 2;
};
export interface FoodSpawnContext {
    grid: GridMetrics;
    occupiedCells: readonly GridCell[];
    blackHoles: readonly BlackHole[];
}
export interface FoodSpawnEntityCellsInput {
    grid: GridMetrics;
    blackHoles: readonly BlackHole[];
    snake: readonly GridCell[];
    foods: readonly GridCell[];
    starAttractorCells?: readonly GridCell[];
    starBeastCells?: readonly GridCell[];
    starCoreCells?: readonly GridCell[];
    extraBlockedCells?: readonly GridCell[];
}
export interface FoodWaveSpawnConfig {
    normalCap: number;
    waveBagSingleCount: number;
    waveBagClusterCount: number;
    clusterMinCount: number;
    clusterMaxCount: number;
    clusterRadius: number;
}
export interface FoodWaveSpawnInput {
    context: FoodSpawnContext;
    currentFoodCount: number;
    foodWaveBag: readonly FoodWaveKind[];
    config: FoodWaveSpawnConfig;
    random?: () => number;
}
export interface FoodWaveSpawnResult {
    spawnedFoods: GridCell[];
    nextFoodWaveBag: FoodWaveKind[];
}
export interface FoodWaveRuntimeInput {
    context: FoodSpawnContext;
    currentFoodCount: number;
    currentTimeMs: number;
    nextSpawnAtMs: number;
    foodWaveBag: readonly FoodWaveKind[];
    config: FoodWaveSpawnConfig;
    random?: () => number;
}
export interface FoodWaveRuntimeResult {
    spawnedFoods: GridCell[];
    nextFoodWaveBag: FoodWaveKind[];
    nextSpawnAtMs: number;
}
export declare function createFoodSpawnContext(input: FoodSpawnEntityCellsInput): FoodSpawnContext;
export declare function createFoodWaveSpawnConfig(overrides?: Partial<FoodWaveSpawnConfig>): FoodWaveSpawnConfig;
export declare function createFoodWaveBag(random?: () => number): FoodWaveKind[];
export declare function spawnFoodCell(context: FoodSpawnContext, random?: () => number): GridCell | null;
export declare function spawnFoodWave(input: FoodWaveSpawnInput): FoodWaveSpawnResult;
export declare function advanceFoodWaveRuntime(input: FoodWaveRuntimeInput): FoodWaveRuntimeResult;
export declare function getFoodSpawnCandidates(context: FoodSpawnContext): GridCell[];
export declare function spawnClusterFoods(context: FoodSpawnContext, maxCount: number, clusterRadius: number, random?: () => number): GridCell[];
export declare function isBlockedByBlackHoleFoodZone(cell: GridCell, blackHoles: readonly BlackHole[]): boolean;
