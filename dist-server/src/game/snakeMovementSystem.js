import { DIRECTION_DELTAS } from "./direction.js";
import { cellIndex, cellsMatch, getCellIndex, isInsideGrid } from "./gridMath.js";
export function evaluateSnakeAdvance(context, direction) {
    const head = context.snake[0];
    if (!head) {
        return null;
    }
    const delta = DIRECTION_DELTAS[direction];
    const nextHead = {
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
    const collidesWithSelf = !isOutOfBounds && (collidesWithSnakeBody(context, nextHead, shouldKeepTail)
        || collidesWithExtraBlockedCell(context, nextHead));
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
function collidesWithExtraBlockedCell(context, cell) {
    return context.extraBlockedCells?.some((blockedCell) => cellsMatch(blockedCell, cell)) ?? false;
}
export function commitSnakeMovement(state, evaluation) {
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
export function canAdvanceDirection(context, direction) {
    return evaluateSnakeAdvance(context, direction)?.canAdvance ?? false;
}
export function pickAdvanceDirection(context, primary, fallbacks = []) {
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
function findStarAttractorIndex(starAttractors, cell) {
    return starAttractors.findIndex((attractor) => cellsMatch(attractor.cell, cell));
}
function findStarCoreIndex(starCores, cell) {
    return starCores.findIndex((core) => {
        const coreCell = { column: Math.floor(core.x), row: Math.floor(core.y) };
        const distance = Math.hypot(core.x - (cell.column + 0.5), core.y - (cell.row + 0.5));
        return cellsMatch(coreCell, cell) || distance <= 0.42;
    });
}
function resolveSnakePickup(evaluation) {
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
function adjustSnakeOccupancy(state, cell, delta) {
    const index = cellIndex(cell, state.grid);
    const nextValue = (state.snakeOccupancy[index] ?? 0) + delta;
    state.snakeOccupancy[index] = Math.max(0, nextValue);
}
function collidesWithSnakeBody(context, cell, willGrow) {
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
function getSnakeCellIndex(grid, cell) {
    return getCellIndex(cell, grid);
}
