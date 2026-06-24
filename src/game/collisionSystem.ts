import { isBlackHoleCollision } from "./blackHole";
import type { SnakeAdvanceEvaluation } from "./gameState";
import { cellsMatch, isInsideGrid } from "./gridMath";
import type { BlackHole, DeathReason, Direction, GridCell, GridMetrics, StarBeast } from "./types";

export type SnakeCollisionResolution =
  | { kind: "none" }
  | { kind: "wall"; direction: Direction }
  | { kind: "death"; reason: DeathReason };

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

export function resolveSnakeCollision(
  context: SnakeCollisionContext,
  evaluation: SnakeAdvanceEvaluation,
  direction: Direction,
): SnakeCollisionResolution {
  if (evaluation.isOutOfBounds) {
    return {
      kind: "wall",
      direction,
    };
  }

  if (evaluation.collidesWithSelf) {
    return {
      kind: "death",
      reason: "snake_body",
    };
  }

  if (cellCollidesWithBlackHole(evaluation.nextHead, context.blackHoles, context.currentTime)) {
    return {
      kind: "death",
      reason: "black_hole",
    };
  }

  if (cellCollidesWithStarBeast(evaluation.nextHead, context.starBeasts)) {
    return {
      kind: "death",
      reason: "star_beast",
    };
  }

  return { kind: "none" };
}

export function cellCollidesWithPlayerBody(context: PlayerBodyCollisionContext, cell: GridCell): boolean {
  const head = context.snake[0];

  if (!head || !isInsideGrid(cell, context.grid)) {
    return false;
  }

  const index = cell.row * context.grid.columns + cell.column;
  const occupancy = context.snakeOccupancy[index] ?? 0;

  return occupancy > 0 && !cellsMatch(head, cell);
}

export function cellCollidesWithStarBeast(cell: GridCell, starBeasts: readonly StarBeast[]): boolean {
  return starBeasts.some((beast) => beast.alive && beast.body.some((segment) => cellsMatch(segment, cell)));
}

export function cellCollidesWithBlackHole(
  cell: GridCell,
  blackHoles: readonly BlackHole[],
  currentTime: number,
): boolean {
  return blackHoles.some((blackHole) => isBlackHoleCollision(cell, blackHole, currentTime));
}
