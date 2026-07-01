import type { SnakeAdvanceEvaluation } from "./gameState.js";
import type { Direction, GridCell, GridMetrics, StarAttractor, StarCore } from "./types.js";
export interface SnakeMovementEvaluationContext {
    grid: GridMetrics;
    snake: readonly GridCell[];
    foods: readonly GridCell[];
    starCores: readonly StarCore[];
    starAttractors: readonly StarAttractor[];
    snakeOccupancy: Uint8Array;
    pendingGrowthSegments: number;
    includeStarAttractors: boolean;
    extraBlockedCells?: readonly GridCell[];
}
export interface SnakeAdvanceDirectionSelection {
    direction: Direction;
    primaryBlocked: boolean;
}
export type SnakePickupKind = "food" | "starCore" | "starAttractor";
export interface SnakeMovementCommitState {
    grid: GridMetrics;
    snake: GridCell[];
    snakeOccupancy: Uint8Array;
    pendingGrowthSegments: number;
}
export interface SnakeMovementCommitResult {
    nextHead: GridCell;
    pendingGrowthSegments: number;
    pickup: {
        kind: SnakePickupKind;
        index: number;
    } | null;
}
export declare function evaluateSnakeAdvance(context: SnakeMovementEvaluationContext, direction: Direction): SnakeAdvanceEvaluation | null;
export declare function commitSnakeMovement(state: SnakeMovementCommitState, evaluation: SnakeAdvanceEvaluation): SnakeMovementCommitResult;
export declare function canAdvanceDirection(context: SnakeMovementEvaluationContext, direction: Direction): boolean;
export declare function pickAdvanceDirection(context: SnakeMovementEvaluationContext, primary: Direction, fallbacks?: readonly Direction[]): SnakeAdvanceDirectionSelection;
