import type { SpawnRuntimeState } from "./gameState";
import type { GridCell, StarAttractorEffect } from "./types";

export interface StarAttractorAbsorbSystemInput {
  enabled: boolean;
  attractorCell: GridCell;
  currentTime: number;
  foods: GridCell[];
  snakeHead: GridCell | null;
  birthCell: GridCell;
  starAttractorEffects: StarAttractorEffect[];
  spawnState: SpawnRuntimeState;
}

export interface StarAttractorAbsorbSystemResult {
  absorbedCells: GridCell[];
  absorbCount: number;
  pendingGrowthDelta: number;
  effect: StarAttractorEffect | null;
}

export function absorbStarAttractorSystem(
  input: StarAttractorAbsorbSystemInput,
): StarAttractorAbsorbSystemResult | null {
  if (!input.enabled) {
    return null;
  }

  const absorbedCells = input.foods.map((food) => ({ ...food }));
  const absorbCount = absorbedCells.length;

  input.foods.length = 0;

  const effectId = input.spawnState.nextStarAttractorEffectId++;
  const effect: StarAttractorEffect = {
    id: effectId,
    origin: { ...input.attractorCell },
    target: input.snakeHead ? { ...input.snakeHead } : { ...input.birthCell },
    absorbedCells,
    absorbCount,
    createdAt: input.currentTime,
    lifetimeMs: getStarAttractorAbsorbLifetimeMs(absorbCount),
    seed: input.spawnState.nextStarAttractorEffectId * 113 + absorbCount * 17,
  };

  input.starAttractorEffects.push(effect);

  return {
    absorbedCells,
    absorbCount,
    pendingGrowthDelta: absorbCount,
    effect,
  };
}

export function getStarAttractorAbsorbLifetimeMs(absorbCount: number): number {
  return absorbCount >= 12 ? 860 : absorbCount >= 8 ? 740 : 620;
}
