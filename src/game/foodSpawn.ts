import { getBlackHoleFoodAvoidRadiusCells } from "./blackHole.js";
import { type FoodWaveKind } from "./gameState.js";
import { cellKey, chebyshevDistance } from "./gridMath.js";
import { DEFAULT_SAFE_SPAWN_CONFIG } from "./progression.js";
import { findSafeSpawnPosition } from "./spawn.js";
import type { BlackHole, GridCell, GridMetrics } from "./types.js";

export const FOOD_SPAWN_CONFIG = {
  normalCap: 10,
  waveIntervalMs: 5000,
  waveBagSingleCount: 17,
  waveBagClusterCount: 3,
  clusterMinCount: 3,
  clusterMaxCount: 5,
  clusterRadius: 2,
} as const;

interface WeightedGridCell {
  cell: GridCell;
  weight: number;
}

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

export function createFoodSpawnContext(input: FoodSpawnEntityCellsInput): FoodSpawnContext {
  return {
    grid: input.grid,
    occupiedCells: [
      ...input.snake,
      ...input.foods,
      ...(input.starAttractorCells ?? []),
      ...(input.starBeastCells ?? []),
      ...(input.starCoreCells ?? []),
      ...input.blackHoles.map((blackHole) => blackHole.cell),
      ...(input.extraBlockedCells ?? []),
    ],
    blackHoles: input.blackHoles,
  };
}

export function createFoodWaveSpawnConfig(
  overrides: Partial<FoodWaveSpawnConfig> = {},
): FoodWaveSpawnConfig {
  return {
    normalCap: overrides.normalCap ?? FOOD_SPAWN_CONFIG.normalCap,
    waveBagSingleCount: overrides.waveBagSingleCount ?? FOOD_SPAWN_CONFIG.waveBagSingleCount,
    waveBagClusterCount: overrides.waveBagClusterCount ?? FOOD_SPAWN_CONFIG.waveBagClusterCount,
    clusterMinCount: overrides.clusterMinCount ?? FOOD_SPAWN_CONFIG.clusterMinCount,
    clusterMaxCount: overrides.clusterMaxCount ?? FOOD_SPAWN_CONFIG.clusterMaxCount,
    clusterRadius: overrides.clusterRadius ?? FOOD_SPAWN_CONFIG.clusterRadius,
  };
}

export function createFoodWaveBag(random: () => number = Math.random): FoodWaveKind[] {
  const bag: FoodWaveKind[] = [
    ...Array.from({ length: FOOD_SPAWN_CONFIG.waveBagSingleCount }, () => "single" as const),
    ...Array.from({ length: FOOD_SPAWN_CONFIG.waveBagClusterCount }, () => "cluster" as const),
  ];

  return shuffleArray(bag, random);
}

export function spawnFoodCell(context: FoodSpawnContext, random: () => number = Math.random): GridCell | null {
  return findSafeSpawnPosition(context.grid, {
    ...DEFAULT_SAFE_SPAWN_CONFIG,
    wallPadding: 0,
    snakeHeadRadius: 0,
    occupiedCells: context.occupiedCells,
    dangerZones: context.blackHoles.map((blackHole) => ({
      center: blackHole.cell,
      radius: getBlackHoleFoodAvoidRadiusCells(blackHole),
    })),
    random,
  });
}

export function spawnFoodWave(input: FoodWaveSpawnInput): FoodWaveSpawnResult {
  if (input.currentFoodCount >= input.config.normalCap) {
    return {
      spawnedFoods: [],
      nextFoodWaveBag: [...input.foodWaveBag],
    };
  }

  const random = input.random ?? Math.random;
  const preparedBag = input.foodWaveBag.length > 0
    ? [...input.foodWaveBag]
    : createFoodWaveBag(random);
  const waveKind = preparedBag[preparedBag.length - 1] ?? "single";

  if (waveKind === "single") {
    const singleFood = spawnFoodCell(input.context, random);

    if (!singleFood) {
      return {
        spawnedFoods: [],
        nextFoodWaveBag: preparedBag,
      };
    }

    preparedBag.pop();

    return {
      spawnedFoods: [singleFood],
      nextFoodWaveBag: preparedBag,
    };
  }

  const availableSlots = input.config.normalCap - input.currentFoodCount;
  const targetCount = Math.min(
    availableSlots,
    input.config.clusterMinCount
      + Math.floor(random() * (input.config.clusterMaxCount - input.config.clusterMinCount + 1)),
  );
  const clusterFoods = spawnClusterFoods(input.context, targetCount, input.config.clusterRadius, random);

  if (clusterFoods.length > 0) {
    preparedBag.pop();

    return {
      spawnedFoods: clusterFoods,
      nextFoodWaveBag: preparedBag,
    };
  }

  const fallbackFood = spawnFoodCell(input.context, random);

  if (!fallbackFood) {
    return {
      spawnedFoods: [],
      nextFoodWaveBag: preparedBag,
    };
  }

  preparedBag.pop();

  return {
    spawnedFoods: [fallbackFood],
    nextFoodWaveBag: preparedBag,
  };
}

export function advanceFoodWaveRuntime(input: FoodWaveRuntimeInput): FoodWaveRuntimeResult {
  let nextSpawnAtMs = input.nextSpawnAtMs;
  let currentFoodCount = input.currentFoodCount;
  let nextFoodWaveBag = [...input.foodWaveBag];
  const spawnedFoods: GridCell[] = [];
  const random = input.random ?? Math.random;

  while (input.currentTimeMs >= nextSpawnAtMs) {
    if (currentFoodCount < input.config.normalCap) {
      const result = spawnFoodWave({
        context: input.context,
        currentFoodCount,
        foodWaveBag: nextFoodWaveBag,
        config: input.config,
        random,
      });

      nextFoodWaveBag = result.nextFoodWaveBag;

      if (result.spawnedFoods.length > 0) {
        spawnedFoods.push(...result.spawnedFoods);
        currentFoodCount += result.spawnedFoods.length;
      }
    }

    nextSpawnAtMs += FOOD_SPAWN_CONFIG.waveIntervalMs;
  }

  return {
    spawnedFoods,
    nextFoodWaveBag,
    nextSpawnAtMs,
  };
}

export function getFoodSpawnCandidates(context: FoodSpawnContext): GridCell[] {
  const occupied = new Set<string>(context.occupiedCells.map((cell) => cellKey(cell)));
  const candidates: GridCell[] = [];

  for (let row = 0; row < context.grid.rows; row += 1) {
    for (let column = 0; column < context.grid.columns; column += 1) {
      const cell = { column, row };

      if (occupied.has(cellKey(cell))) {
        continue;
      }

      if (isBlockedByBlackHoleFoodZone(cell, context.blackHoles)) {
        continue;
      }

      candidates.push(cell);
    }
  }

  return candidates;
}

export function spawnClusterFoods(
  context: FoodSpawnContext,
  maxCount: number,
  clusterRadius: number,
  random: () => number = Math.random,
): GridCell[] {
  if (maxCount <= 0) {
    return [];
  }

  const candidates = getFoodSpawnCandidates(context);

  if (candidates.length === 0) {
    return [];
  }

  const candidateKeys = new Set(candidates.map((cell) => cellKey(cell)));
  const weightedAnchors = candidates
    .map((cell) => ({
      cell,
      weight: getFoodClusterAnchorWeight(cell, candidateKeys, context.blackHoles, context.grid, clusterRadius),
    }))
    .filter((candidate) => candidate.weight > 0);
  const anchor = pickWeightedGridCell(weightedAnchors, random);

  if (!anchor) {
    return [];
  }

  return getClusterFoodsAroundAnchor(anchor, candidateKeys, context.grid, clusterRadius).slice(0, maxCount);
}

export function isBlockedByBlackHoleFoodZone(cell: GridCell, blackHoles: readonly BlackHole[]): boolean {
  return blackHoles.some((blackHole) => chebyshevDistance(cell, blackHole.cell) <= getBlackHoleFoodAvoidRadiusCells(blackHole));
}

function getFoodClusterAnchorWeight(
  cell: GridCell,
  candidateKeys: Set<string>,
  blackHoles: readonly BlackHole[],
  grid: GridMetrics,
  clusterRadius: number,
): number {
  const capacity = getFoodClusterCapacity(cell, candidateKeys, grid, clusterRadius);
  let proximityBonus = 1;

  for (const blackHole of blackHoles) {
    const forbiddenRadius = getBlackHoleFoodAvoidRadiusCells(blackHole);
    const distance = chebyshevDistance(cell, blackHole.cell);

    if (distance <= forbiddenRadius) {
      continue;
    }

    const gap = distance - forbiddenRadius;

    if (gap <= 1) {
      proximityBonus = Math.max(proximityBonus, 9);
    } else if (gap === 2) {
      proximityBonus = Math.max(proximityBonus, 6);
    } else if (gap === 3) {
      proximityBonus = Math.max(proximityBonus, 4);
    } else if (gap === 4) {
      proximityBonus = Math.max(proximityBonus, 2);
    }
  }

  return Math.max(1, capacity) * proximityBonus;
}

function getFoodClusterCapacity(
  center: GridCell,
  candidateKeys: Set<string>,
  grid: GridMetrics,
  clusterRadius: number,
): number {
  let capacity = 0;

  for (let row = center.row - clusterRadius; row <= center.row + clusterRadius; row += 1) {
    for (let column = center.column - clusterRadius; column <= center.column + clusterRadius; column += 1) {
      if (column < 0 || row < 0 || column >= grid.columns || row >= grid.rows) {
        continue;
      }

      const cell = { column, row };

      if (!candidateKeys.has(cellKey(cell))) {
        continue;
      }

      capacity += 1;
    }
  }

  return capacity;
}

function getClusterFoodsAroundAnchor(
  anchor: GridCell,
  candidateKeys: Set<string>,
  grid: GridMetrics,
  clusterRadius: number,
): GridCell[] {
  const scored: Array<{ cell: GridCell; distance: number; manhattan: number }> = [];

  for (let row = anchor.row - clusterRadius; row <= anchor.row + clusterRadius; row += 1) {
    for (let column = anchor.column - clusterRadius; column <= anchor.column + clusterRadius; column += 1) {
      if (column < 0 || row < 0 || column >= grid.columns || row >= grid.rows) {
        continue;
      }

      const cell = { column, row };

      if (!candidateKeys.has(cellKey(cell))) {
        continue;
      }

      const dx = Math.abs(column - anchor.column);
      const dy = Math.abs(row - anchor.row);

      scored.push({
        cell,
        distance: Math.max(dx, dy),
        manhattan: dx + dy,
      });
    }
  }

  scored.sort((left, right) => (
    left.distance - right.distance ||
    left.manhattan - right.manhattan ||
    left.cell.row - right.cell.row ||
    left.cell.column - right.cell.column
  ));

  return scored.map((entry) => entry.cell);
}

function shuffleArray<T>(items: T[], random: () => number): T[] {
  for (let index = items.length - 1; index > 0; index -= 1) {
    const swapIndex = Math.floor(random() * (index + 1));
    const current = items[index];
    const swap = items[swapIndex];

    if (current !== undefined && swap !== undefined) {
      items[index] = swap;
      items[swapIndex] = current;
    }
  }

  return items;
}

function pickWeightedGridCell(
  cells: readonly WeightedGridCell[],
  random: () => number,
): GridCell | null {
  let totalWeight = 0;

  for (const candidate of cells) {
    totalWeight += Math.max(0, candidate.weight);
  }

  if (totalWeight <= 0) {
    return null;
  }

  let remaining = random() * totalWeight;

  for (const candidate of cells) {
    remaining -= Math.max(0, candidate.weight);

    if (remaining <= 0) {
      return candidate.cell;
    }
  }

  return cells[cells.length - 1]?.cell ?? null;
}
