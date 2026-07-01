import type { GridCell } from "./types.js";
export interface GameProgress {
    snakeLength: number;
    coresEaten: number;
    score: number;
    elapsedTime: number;
}
export type FeatureKey = "blackHole" | "starGate" | "evolution" | "galaxyEvent" | "timeRewind" | "starAttractor" | "boss";
export type FeatureFlags = Record<FeatureKey, boolean>;
export interface UnlockCondition {
    snakeLength?: number;
    coresEaten?: number;
    score?: number;
    elapsedTime?: number;
}
export interface UnlockRule {
    anyOf: readonly UnlockCondition[];
}
export interface UnlockConfig {
    featureFlags: FeatureFlags;
    rules: Record<FeatureKey, UnlockRule>;
}
export interface UnlockedFeatures {
    movement: boolean;
    cores: boolean;
    score: boolean;
    sprint: boolean;
    particles: boolean;
    blackHole: boolean;
    starGate: boolean;
    evolution: boolean;
    galaxyEvent: boolean;
    timeRewind: boolean;
    starAttractor: boolean;
    boss: boolean;
}
export interface LengthUnlockCopy {
    title: string;
    value: string;
}
export interface SafeSpawnZone {
    center: GridCell;
    radius: number;
}
export interface SafeSpawnConfig {
    occupiedCells?: readonly GridCell[];
    blockedCells?: readonly GridCell[];
    dangerZones?: readonly SafeSpawnZone[];
    snakeHead?: GridCell | null;
    snakeHeadRadius?: number;
    wallPadding?: number;
    maxAttempts?: number;
    random?: () => number;
}
export declare const DEFAULT_UNLOCK_CONFIG: UnlockConfig;
export declare const DEFAULT_SAFE_SPAWN_CONFIG: Pick<SafeSpawnConfig, 'snakeHeadRadius' | 'wallPadding' | 'maxAttempts'>;
export declare function getUnlockedFeatures(gameState: GameProgress, config?: UnlockConfig): UnlockedFeatures;
export declare function getNextLengthUnlockCopy(gameState: GameProgress, config?: UnlockConfig): LengthUnlockCopy;
