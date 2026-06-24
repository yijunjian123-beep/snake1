import type { GamePhase } from "./types";

export interface TransientSimulationContext {
  getPhase(): GamePhase;
  updateStarCores(delta: number, currentTime: number): void;
  updateFoodWaves(currentTimeMs: number): void;
  updateStarBeastEffects(currentTime: number): void;
  updateStarBeasts(delta: number): void;
  refreshStarBeasts(): void;
}

export function runTransientSimulation(
  context: TransientSimulationContext,
  delta: number,
  playElapsed: number,
): void {
  if (context.getPhase() !== "playing") {
    return;
  }

  const currentTime = playElapsed / 1000;

  context.updateStarCores(delta, currentTime);
  if (context.getPhase() !== "playing") {
    return;
  }

  context.updateFoodWaves(playElapsed);
  if (context.getPhase() !== "playing") {
    return;
  }

  context.updateStarBeastEffects(currentTime);
  context.updateStarBeasts(delta);
  context.refreshStarBeasts();
}
