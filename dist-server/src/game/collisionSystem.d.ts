import type { SnakeAdvanceEvaluation } from "./gameState.js";
import type { BlackHole, DeathReason, Direction, GridCell, GridMetrics, PlayerId, StarBeast } from "./types.js";
export type SnakeCollisionResolution = {
    kind: "none";
} | {
    kind: "wall";
    direction: Direction;
} | {
    kind: "death";
    reason: DeathReason;
};
export interface SnakeCollisionContext {
    blackHoles: readonly BlackHole[];
    starBeasts: readonly StarBeast[];
    currentTime: number;
}
export interface PlayerBodyCollisionContext {
    grid: GridMetrics;
    snake: readonly GridCell[];
    snakeOccupancy: Uint8Array;
}
export interface MultiplayerSnakeEvaluation {
    playerId: PlayerId;
    direction: Direction;
    evaluation: SnakeAdvanceEvaluation;
    snake: readonly GridCell[];
    willCommit: boolean;
}
export interface MultiplayerSnakeCollisionContext extends SnakeCollisionContext {
    grid: GridMetrics;
}
export interface MultiplayerSnakeCollisionResult {
    playerId: PlayerId;
    collision: SnakeCollisionResolution;
    pickupConflict: boolean;
}
export declare function resolveSnakeCollision(context: SnakeCollisionContext, evaluation: SnakeAdvanceEvaluation, direction: Direction): SnakeCollisionResolution;
export declare function resolveMultiplayerSnakeCollisions(context: MultiplayerSnakeCollisionContext, evaluations: readonly MultiplayerSnakeEvaluation[]): MultiplayerSnakeCollisionResult[];
export declare function cellCollidesWithPlayerBody(context: PlayerBodyCollisionContext, cell: GridCell): boolean;
export declare function cellCollidesWithStarBeast(cell: GridCell, starBeasts: readonly StarBeast[]): boolean;
export declare function cellCollidesWithBlackHole(cell: GridCell, blackHoles: readonly BlackHole[], currentTime: number): boolean;
