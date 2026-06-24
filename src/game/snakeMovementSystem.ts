import { DIRECTION_DELTAS } from "./direction";
import type { SnakeAdvanceEvaluation } from "./gameState";
import { cellsMatch, isInsideGrid } from "./gridMath";
import type { Direction, GridCell, GridMetrics, StarAttractor, StarCore } from "./types";

export interface SnakeMovementEvaluationContext {
  grid: GridMetrics;
  snake: readonly GridCell[];
  foods: readonly GridCell[];
  starCores: readonly StarCore[];
  starAttractors: readonly StarAttractor[];
  snakeOccupancy: Uint8Array;
  pendingGrowthSegments: number;
  includeStarAttractors: boolean;
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

export function evaluateSnakeAdvance(
  context: SnakeMovementEvaluationContext,
  direction: Direction,
): SnakeAdvanceEvaluation | null {
  const head = context.snake[0];

  if (!head) {
    return null;
  }

  const delta = DIRECTION_DELTAS[direction];
  const nextHead: GridCell = {
    column: head.column + delta.column,
    row: head.row + delta.row,
  };
  const ateFoodIndex = context.foods.findIndex((food) => cellsMatch(food, nextHead));
  const ateStarCoreIndex = findStarCoreIndex(context.starCores, nextHead);
  const ateStarAttractorIndex = context.includeStarAttractors
    ? findStarAttractorIndex(context.starAttractors, nextHead)
    : -1;
  const growthBeforeMove = context.pendingGrowthSegments;
  const shouldKeepTail = ateFoodIndex !== -1 || ateStarCoreIndex !== -1 || growthBeforeMove > 0;
  const isOutOfBounds = !isInsideGrid(nextHead, context.grid);
  const collidesWithSelf = !isOutOfBounds && collidesWithSnakeBody(context, nextHead, shouldKeepTail);

  return {
    nextHead,
    ateFoodIndex,
    ateStarCoreIndex,
    ateStarAttractorIndex,
    growthBeforeMove,
    shouldKeepTail,
    isOutOfBounds,
    collidesWithSelf,
    canAdvance: !isOutOfBounds && !collidesWithSelf,
  };
}

export function commitSnakeMovement(
  state: SnakeMovementCommitState,
  evaluation: SnakeAdvanceEvaluation,
): SnakeMovementCommitResult {
  const previousTail = state.snake[state.snake.length - 1] ?? null;

  state.snake.unshift(evaluation.nextHead);
  adjustSnakeOccupancy(state, evaluation.nextHead, 1);

  if (!evaluation.shouldKeepTail && previousTail) {
    state.snake.pop();
    adjustSnakeOccupancy(state, previousTail, -1);
  }

  if (evaluation.growthBeforeMove > 0) {
    state.pendingGrowthSegments = Math.max(0, state.pendingGrowthSegments - 1);
  }

  return {
    nextHead: evaluation.nextHead,
    pendingGrowthSegments: state.pendingGrowthSegments,
    pickup: resolveSnakePickup(evaluation),
  };
}

export function canAdvanceDirection(context: SnakeMovementEvaluationContext, direction: Direction): boolean {
  return evaluateSnakeAdvance(context, direction)?.canAdvance ?? false;
}

export function pickAdvanceDirection(
  context: SnakeMovementEvaluationContext,
  primary: Direction,
  fallbacks: readonly Direction[] = [],
): SnakeAdvanceDirectionSelection {
  const primaryBlocked = !canAdvanceDirection(context, primary);
  const candidates = [primary, ...fallbacks.filter((direction) => direction !== primary)];

  for (const direction of candidates) {
    if (canAdvanceDirection(context, direction)) {
      return {
        direction,
        primaryBlocked,
      };
    }
  }

  return {
    direction: primary,
    primaryBlocked,
  };
}

function findStarAttractorIndex(starAttractors: readonly StarAttractor[], cell: GridCell): number {
  return starAttractors.findIndex((attractor) => cellsMatch(attractor.cell, cell));
}

function findStarCoreIndex(starCores: readonly StarCore[], cell: GridCell): number {
  return starCores.findIndex((core) => {
    const coreCell = { column: Math.floor(core.x), row: Math.floor(core.y) };
    const distance = Math.hypot(core.x - (cell.column + 0.5), core.y - (cell.row + 0.5));

    return cellsMatch(coreCell, cell) || distance <= 0.42;
  });
}

function resolveSnakePickup(
  evaluation: SnakeAdvanceEvaluation,
): SnakeMovementCommitResult["pickup"] {
  if (evaluation.ateFoodIndex !== -1) {
    return {
      kind: "food",
      index: evaluation.ateFoodIndex,
    };
  }

  if (evaluation.ateStarCoreIndex !== -1) {
    return {
      kind: "starCore",
      index: evaluation.ateStarCoreIndex,
    };
  }

  if (evaluation.ateStarAttractorIndex !== -1) {
    return {
      kind: "starAttractor",
      index: evaluation.ateStarAttractorIndex,
    };
  }

  return null;
}

function adjustSnakeOccupancy(state: SnakeMovementCommitState, cell: GridCell, delta: number): void {
  const index = cell.row * state.grid.columns + cell.column;
  const nextValue = (state.snakeOccupancy[index] ?? 0) + delta;

  state.snakeOccupancy[index] = Math.max(0, nextValue);
}

function collidesWithSnakeBody(
  context: SnakeMovementEvaluationContext,
  cell: GridCell,
  willGrow: boolean,
): boolean {
  const index = getSnakeCellIndex(context.grid, cell);

  if (index === null) {
    return false;
  }

  const occupancy = context.snakeOccupancy[index] ?? 0;

  if (occupancy <= 0) {
    return false;
  }

  if (!willGrow) {
    const tail = context.snake[context.snake.length - 1];

    if (tail && cellsMatch(tail, cell) && occupancy === 1) {
      return false;
    }
  }

  return true;
}

function getSnakeCellIndex(grid: GridMetrics, cell: GridCell): number | null {
  if (!isInsideGrid(cell, grid)) {
    return null;
  }

  return cell.row * grid.columns + cell.column;
}
