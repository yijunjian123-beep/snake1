import type { GameProgress, SafeSpawnZone } from "./progression.js";
import type { BlackHole, BlackHoleAlert, BlackHoleBand, BlackHoleCue, BlackHoleKind, Direction, GridCell, GridMetrics } from "./types.js";
export interface BlackHoleVariant {
    bodyRadiusCells: number;
    influenceRadiusCells: number;
    foodAvoidRadiusCells: number;
    safeSpawnDistance: number;
    wallPadding: number;
    activationDelayMs: number;
    pulseSpeed: number;
    bandThresholds: {
        strong: number;
        medium?: number;
    };
    chargeThresholds: {
        strong: number;
        medium?: number;
        weak: number;
    };
}
export interface BlackHoleSpawnContext {
    grid: GridMetrics;
    progress: GameProgress;
    snake: readonly GridCell[];
    foods: readonly GridCell[];
    existingBlackHoles: readonly BlackHole[];
    birthCell: GridCell;
    currentTime: number;
    futureBlockedCells?: readonly GridCell[];
    futureDangerZones?: readonly SafeSpawnZone[];
    kind?: BlackHoleKind;
    random?: () => number;
}
export interface BlackHoleGravityState {
    key: string | null;
    charge: number;
}
export interface BlackHoleMovementResolution {
    finalDirection: Direction;
    shouldDie: boolean;
    shouldPlayWarning: boolean;
    shouldPlayPull: boolean;
    shouldPlayFail: boolean;
    nextGravityState: BlackHoleGravityState;
    activeBlackHole: BlackHole | null;
    cue: BlackHoleCue | null;
}
export declare const BLACK_HOLE_CONFIG: {
    readonly unlockLength: 7;
    readonly maxCount: 4;
    readonly midScoreThreshold: 80;
    readonly midLengthThreshold: 12;
    readonly lateScoreThreshold: 160;
    readonly lateLengthThreshold: 18;
    readonly variants: {
        readonly small: {
            readonly bodyRadiusCells: 0;
            readonly influenceRadiusCells: 3;
            readonly foodAvoidRadiusCells: 1;
            readonly safeSpawnDistance: 5;
            readonly wallPadding: 1;
            readonly activationDelayMs: 420;
            readonly pulseSpeed: 1.65;
            readonly bandThresholds: {
                readonly strong: 1;
            };
            readonly chargeThresholds: {
                readonly strong: 1;
                readonly weak: 2;
            };
        };
        readonly medium: {
            readonly bodyRadiusCells: 0;
            readonly influenceRadiusCells: 6;
            readonly foodAvoidRadiusCells: 2;
            readonly safeSpawnDistance: 8;
            readonly wallPadding: 2;
            readonly activationDelayMs: 660;
            readonly pulseSpeed: 1.25;
            readonly bandThresholds: {
                readonly strong: 2;
                readonly medium: 4;
            };
            readonly chargeThresholds: {
                readonly strong: 1;
                readonly medium: 2;
                readonly weak: 3;
            };
        };
        readonly large: {
            readonly bodyRadiusCells: 0;
            readonly influenceRadiusCells: 8;
            readonly foodAvoidRadiusCells: 3;
            readonly safeSpawnDistance: 10;
            readonly wallPadding: 3;
            readonly activationDelayMs: 900;
            readonly pulseSpeed: 0.95;
            readonly bandThresholds: {
                readonly strong: 2;
                readonly medium: 5;
            };
            readonly chargeThresholds: {
                readonly strong: 1;
                readonly medium: 2;
                readonly weak: 3;
            };
        };
    };
};
export declare function getDesiredBlackHoleCount(progress: GameProgress, config?: typeof BLACK_HOLE_CONFIG): number;
export declare function getBlackHoleKindForSpawn(progress: GameProgress, grid: GridMetrics): BlackHoleKind;
export declare function chooseBlackHoleSpawnKind(existingKinds: readonly BlackHoleKind[], desiredCount: number, random?: () => number): BlackHoleKind;
export declare function getBlackHoleVariant(kind: BlackHoleKind): BlackHoleVariant;
export declare function getBlackHoleKey(blackHole: BlackHole): string;
export declare function isBlackHoleActive(blackHole: BlackHole, currentTime: number): boolean;
export declare function getBlackHoleFormationProgress(blackHole: BlackHole, currentTime: number): number;
export declare function getBlackHoleCoreRadiusCells(blackHole: BlackHole): number;
export declare function getBlackHoleInfluenceRadiusCells(blackHole: BlackHole): number;
export declare function getBlackHolePulseSpeed(blackHole: BlackHole): number;
export declare function getBlackHoleAlertRadiusCells(blackHole: BlackHole): number;
export declare function getBlackHoleSpawnExclusionRadiusCells(blackHole: BlackHole): number;
export declare function getBlackHoleFoodAvoidRadiusCells(blackHole: BlackHole): number;
export declare function getBlackHoleChargeThreshold(blackHole: BlackHole, band: Exclude<BlackHoleBand, "core">): number;
export declare function spawnBlackHole(context: BlackHoleSpawnContext, config?: typeof BLACK_HOLE_CONFIG): BlackHole | null;
export declare function isBlackHoleCollision(cell: GridCell, blackHole: BlackHole, currentTime: number): boolean;
export declare function getBlackHoleBandForCell(cell: GridCell, blackHole: BlackHole, currentTime: number): BlackHoleBand | null;
export declare function resolveBlackHoleAlert(head: GridCell, blackHoles: readonly BlackHole[], currentTime: number): BlackHoleAlert | null;
export declare function resolveBlackHoleMovement(head: GridCell, intendedDirection: Direction, previousDirection: Direction, blackHoles: readonly BlackHole[], currentTime: number, previousState: BlackHoleGravityState): BlackHoleMovementResolution;
