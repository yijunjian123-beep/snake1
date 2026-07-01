import { isBlackHoleCollision } from "./blackHole.js";
import { cellIndex, cellsMatch, isInsideGrid } from "./gridMath.js";
export function resolveSnakeCollision(context, evaluation, direction) {
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
export function resolveMultiplayerSnakeCollisions(context, evaluations) {
    const results = evaluations.map((entry) => ({
        playerId: entry.playerId,
        collision: resolveSnakeCollision(context, entry.evaluation, entry.direction),
        pickupConflict: false,
    }));
    const committedEvaluations = evaluations.filter((entry, index) => entry.willCommit && results[index]?.collision.kind === "none");
    markBodyCollisions(context.grid, evaluations, committedEvaluations, results);
    markHeadToHeadCollisions(committedEvaluations, results);
    markPickupConflicts(committedEvaluations, results);
    return results;
}
export function cellCollidesWithPlayerBody(context, cell) {
    const head = context.snake[0];
    if (!head || !isInsideGrid(cell, context.grid)) {
        return false;
    }
    const index = cellIndex(cell, context.grid);
    const occupancy = context.snakeOccupancy[index] ?? 0;
    return occupancy > 0 && !cellsMatch(head, cell);
}
function markBodyCollisions(grid, allEvaluations, evaluations, results) {
    const occupiedBodies = new Int16Array(grid.columns * grid.rows);
    for (const entry of allEvaluations) {
        const result = getMultiplayerResult(results, entry.playerId);
        const isCommittedMover = entry.willCommit && result?.collision.kind === "none";
        const firstBlockedSegmentIndex = isCommittedMover ? 1 : 0;
        const tail = entry.snake[entry.snake.length - 1] ?? null;
        for (let segmentIndex = firstBlockedSegmentIndex; segmentIndex < entry.snake.length; segmentIndex += 1) {
            const segment = entry.snake[segmentIndex];
            if (!segment || !isInsideGrid(segment, grid)) {
                continue;
            }
            if (isCommittedMover && !entry.evaluation.shouldKeepTail && tail && cellsMatch(segment, tail)) {
                continue;
            }
            const index = cellIndex(segment, grid);
            occupiedBodies[index] = (occupiedBodies[index] ?? 0) + 1;
        }
    }
    for (const entry of evaluations) {
        const resultIndex = getMultiplayerResultIndex(results, entry.playerId);
        if (resultIndex === -1 || results[resultIndex]?.collision.kind !== "none" || !isInsideGrid(entry.evaluation.nextHead, grid)) {
            continue;
        }
        if ((occupiedBodies[cellIndex(entry.evaluation.nextHead, grid)] ?? 0) > 0) {
            results[resultIndex] = {
                ...results[resultIndex],
                collision: {
                    kind: "death",
                    reason: "snake_body",
                },
            };
        }
    }
}
function markHeadToHeadCollisions(evaluations, results) {
    for (let leftIndex = 0; leftIndex < evaluations.length; leftIndex += 1) {
        const left = evaluations[leftIndex];
        const leftResultIndex = left ? getMultiplayerResultIndex(results, left.playerId) : -1;
        if (!left || leftResultIndex === -1 || results[leftResultIndex]?.collision.kind !== "none") {
            continue;
        }
        for (let rightIndex = leftIndex + 1; rightIndex < evaluations.length; rightIndex += 1) {
            const right = evaluations[rightIndex];
            const rightResultIndex = right ? getMultiplayerResultIndex(results, right.playerId) : -1;
            if (!right || rightResultIndex === -1 || results[rightResultIndex]?.collision.kind !== "none") {
                continue;
            }
            if (!cellsMatch(left.evaluation.nextHead, right.evaluation.nextHead)) {
                continue;
            }
            results[leftResultIndex] = {
                ...results[leftResultIndex],
                collision: {
                    kind: "death",
                    reason: "head_to_head",
                },
            };
            results[rightResultIndex] = {
                ...results[rightResultIndex],
                collision: {
                    kind: "death",
                    reason: "head_to_head",
                },
            };
        }
    }
}
function markPickupConflicts(evaluations, results) {
    for (let leftIndex = 0; leftIndex < evaluations.length; leftIndex += 1) {
        const left = evaluations[leftIndex];
        const leftResultIndex = left ? getMultiplayerResultIndex(results, left.playerId) : -1;
        if (!left || leftResultIndex === -1 || results[leftResultIndex]?.collision.kind !== "none") {
            continue;
        }
        for (let rightIndex = leftIndex + 1; rightIndex < evaluations.length; rightIndex += 1) {
            const right = evaluations[rightIndex];
            const rightResultIndex = right ? getMultiplayerResultIndex(results, right.playerId) : -1;
            if (!right || rightResultIndex === -1 || results[rightResultIndex]?.collision.kind !== "none") {
                continue;
            }
            if (left.evaluation.ateFoodIndex === -1 && left.evaluation.ateStarCoreIndex === -1) {
                continue;
            }
            const sameFood = left.evaluation.ateFoodIndex !== -1 && left.evaluation.ateFoodIndex === right.evaluation.ateFoodIndex;
            const sameCore = left.evaluation.ateStarCoreIndex !== -1 && left.evaluation.ateStarCoreIndex === right.evaluation.ateStarCoreIndex;
            if (!sameFood && !sameCore) {
                continue;
            }
            const leftWins = left.playerId <= right.playerId;
            const loserIndex = leftWins ? rightResultIndex : leftResultIndex;
            results[loserIndex] = {
                ...results[loserIndex],
                pickupConflict: true,
            };
        }
    }
}
function getMultiplayerResult(results, playerId) {
    const resultIndex = getMultiplayerResultIndex(results, playerId);
    return resultIndex === -1 ? null : results[resultIndex] ?? null;
}
function getMultiplayerResultIndex(results, playerId) {
    return results.findIndex((result) => result.playerId === playerId);
}
export function cellCollidesWithStarBeast(cell, starBeasts) {
    return starBeasts.some((beast) => beast.alive && beast.body.some((segment) => cellsMatch(segment, cell)));
}
export function cellCollidesWithBlackHole(cell, blackHoles, currentTime) {
    return blackHoles.some((blackHole) => isBlackHoleCollision(cell, blackHole, currentTime));
}
