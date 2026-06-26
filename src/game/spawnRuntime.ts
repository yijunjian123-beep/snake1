import { createFoodSpawnContext, type FoodSpawnContext } from "./foodSpawn.js";
import { getStarAttractorCells, getStarBeastCells, getStarCoreCells } from "./spawnSelectors.js";
import { cellKey, cellsMatch } from "./gridMath.js";
import type { BlackHole, GridCell, GridMetrics, StarAttractor, StarBeast, StarCore } from "./types.js";

export interface BuildFoodSpawnContextInput {
  grid: GridMetrics;
  blackHoles: readonly BlackHole[];
  snake: readonly GridCell[];
  foods: readonly GridCell[];
  starAttractors: readonly StarAttractor[];
  starBeasts: readonly StarBeast[];
  starCores: readonly StarCore[];
  includeStarAttractors: boolean;
  extraBlockedCells?: readonly GridCell[];
}

export interface PlacementValidationInput {
  grid: GridMetrics;
  blackHoles: readonly BlackHole[];
  snake: readonly GridCell[];
  foods: readonly GridCell[];
  starAttractors: readonly StarAttractor[];
  starBeasts: readonly StarBeast[];
  starCores: readonly StarCore[];
  includeStarAttractors: boolean;
}

export interface ReviveBlockedCellsInput {
  blackHoles: readonly BlackHole[];
  snake: readonly GridCell[];
  foods: readonly GridCell[];
  starAttractors: readonly StarAttractor[];
  starBeasts: readonly StarBeast[];
  starCores: readonly StarCore[];
  includeStarAttractors: boolean;
}

export function buildFoodSpawnContext(input: BuildFoodSpawnContextInput): FoodSpawnContext {
  return createFoodSpawnContext({
    grid: input.grid,
    blackHoles: input.blackHoles,
    snake: input.snake,
    foods: input.foods,
    starAttractorCells: getStarAttractorCells(input.starAttractors, input.includeStarAttractors),
    starBeastCells: getStarBeastCells(input.starBeasts),
    starCoreCells: getStarCoreCells(input.starCores),
    extraBlockedCells: input.extraBlockedCells,
  });
}

export function getReviveBlockedCells(input: ReviveBlockedCellsInput): GridCell[] {
  return [
    ...input.snake,
    ...input.foods,
    ...getStarAttractorCells(input.starAttractors, input.includeStarAttractors),
    ...getStarBeastCells(input.starBeasts),
    ...getStarCoreCells(input.starCores),
    ...input.blackHoles.map((blackHole) => blackHole.cell),
  ];
}

export function isCurrentPlacementValid(input: PlacementValidationInput): boolean {
  const snakeIsValid = input.snake.every((segment) => !isOutOfBounds(segment, input.grid));
  const occupiedBlackHoleCells = new Set<string>();
  const occupiedStarBeastCells = new Set<string>();
  const occupiedStarCoreCells = new Set<string>();
  const starAttractorCells = getStarAttractorCells(input.starAttractors, input.includeStarAttractors);

  const foodsAreValid = input.foods.every((food) => {
    if (isOutOfBounds(food, input.grid) || input.snake.some((segment) => cellsMatch(segment, food))) {
      return false;
    }

    if (starAttractorCells.some((attractorCell) => cellsMatch(attractorCell, food))) {
      return false;
    }

    if (input.starBeasts.some((beast) => beast.body.some((segment) => cellsMatch(segment, food)))) {
      return false;
    }

    if (input.starCores.some((core) => cellsMatch(getStarCoreCell(core), food))) {
      return false;
    }

    return !input.blackHoles.some((blackHole) => cellsMatch(blackHole.cell, food));
  });

  const blackHolesAreValid = input.blackHoles.every((blackHole) => {
    if (isOutOfBounds(blackHole.cell, input.grid)) {
      return false;
    }

    const key = cellKey(blackHole.cell);

    if (occupiedBlackHoleCells.has(key)) {
      return false;
    }

    occupiedBlackHoleCells.add(key);

    if (input.snake.some((segment) => cellsMatch(segment, blackHole.cell))) {
      return false;
    }

    if (input.foods.some((food) => cellsMatch(food, blackHole.cell))) {
      return false;
    }

    if (starAttractorCells.some((attractorCell) => cellsMatch(attractorCell, blackHole.cell))) {
      return false;
    }

    return true;
  });

  const starBeastsAreValid = input.starBeasts.every((beast) => {
    if (!beast.alive || beast.body.length === 0) {
      return false;
    }

    return beast.body.every((segment) => {
      if (isOutOfBounds(segment, input.grid)) {
        return false;
      }

      const key = cellKey(segment);

      if (occupiedStarBeastCells.has(key)) {
        return false;
      }

      occupiedStarBeastCells.add(key);

      if (input.snake.some((snakeCell) => cellsMatch(snakeCell, segment))) {
        return false;
      }

      if (input.foods.some((food) => cellsMatch(food, segment))) {
        return false;
      }

      if (starAttractorCells.some((attractorCell) => cellsMatch(attractorCell, segment))) {
        return false;
      }

      if (input.starCores.some((core) => cellsMatch(getStarCoreCell(core), segment))) {
        return false;
      }

      if (input.blackHoles.some((blackHole) => cellsMatch(blackHole.cell, segment))) {
        return false;
      }

      return true;
    });
  });

  const starCoresAreValid = input.starCores.every((core) => {
    if (!Number.isFinite(core.x) || !Number.isFinite(core.y)) {
      return false;
    }

    if (core.x < 0.35 || core.y < 0.35 || core.x > input.grid.columns - 0.35 || core.y > input.grid.rows - 0.35) {
      return false;
    }

    const coreCell = getStarCoreCell(core);
    const key = cellKey(coreCell);

    if (occupiedStarCoreCells.has(key)) {
      return false;
    }

    occupiedStarCoreCells.add(key);

    if (input.snake.some((segment) => cellsMatch(segment, coreCell))) {
      return false;
    }

    if (input.foods.some((food) => cellsMatch(food, coreCell))) {
      return false;
    }

    if (starAttractorCells.some((attractorCell) => cellsMatch(attractorCell, coreCell))) {
      return false;
    }

    return !input.blackHoles.some((blackHole) => cellsMatch(blackHole.cell, coreCell));
  });

  return snakeIsValid && foodsAreValid && blackHolesAreValid && starBeastsAreValid && starCoresAreValid;
}

function getStarCoreCell(core: StarCore): GridCell {
  return {
    column: Math.floor(core.x),
    row: Math.floor(core.y),
  };
}

function isOutOfBounds(cell: GridCell, grid: GridMetrics): boolean {
  return cell.column < 0 || cell.row < 0 || cell.column >= grid.columns || cell.row >= grid.rows;
}
