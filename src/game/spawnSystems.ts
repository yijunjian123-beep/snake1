import { chooseBlackHoleSpawnKind, getDesiredBlackHoleCount, spawnBlackHole } from "./blackHole";
import { STAR_ATTRACTOR_CONFIG, rollStarAttractorNeed, spawnStarAttractor } from "./starAttractor";
import { STAR_BEAST_CONFIG, getDesiredStarBeastCount, spawnStarBeast } from "./starBeast";
import type { SpawnRuntimeState } from "./gameState";
import type { GamePhase, GridCell, GridMetrics, BlackHole, Direction, StarAttractor, StarBeast } from "./types";
import type { GameProgress } from "./progression";

export interface StarAttractorSpawnSystemInput {
  enabled: boolean;
  grid: GridMetrics;
  progress: GameProgress;
  snake: readonly GridCell[];
  direction: Direction;
  foods: readonly GridCell[];
  starCoreCells: readonly GridCell[];
  existingBlackHoles: readonly BlackHole[];
  existingStarAttractors: StarAttractor[];
  existingStarBeasts: readonly StarBeast[];
  currentTime: number;
  state: SpawnRuntimeState;
}

export interface BlackHoleSpawnSystemInput {
  grid: GridMetrics;
  progress: GameProgress;
  snake: readonly GridCell[];
  foods: readonly GridCell[];
  birthCell: GridCell;
  currentTime: number;
  existingBlackHoles: BlackHole[];
  futureBlockedCells: readonly GridCell[];
  futureDangerZones: readonly { center: GridCell; radius: number }[];
  random?: () => number;
}

export interface StarBeastSpawnSystemInput {
  phase: GamePhase;
  grid: GridMetrics;
  progress: GameProgress;
  snake: readonly GridCell[];
  foods: readonly GridCell[];
  starCoreCells: readonly GridCell[];
  existingBlackHoles: readonly BlackHole[];
  existingStarBeasts: StarBeast[];
  currentTime: number;
  state: SpawnRuntimeState;
}

export function advanceStarAttractorSpawnSystem(
  input: StarAttractorSpawnSystemInput,
  amount: number,
): boolean {
  if (!input.enabled || amount <= 0) {
    return false;
  }

  if (input.progress.snakeLength < STAR_ATTRACTOR_CONFIG.unlockLength) {
    return false;
  }

  if (input.existingStarAttractors.length > 0 || input.state.starAttractorSpawnPending) {
    return false;
  }

  input.state.starAttractorEatCount = Math.min(input.state.starAttractorNeed, input.state.starAttractorEatCount + amount);

  if (input.state.starAttractorEatCount < input.state.starAttractorNeed) {
    return false;
  }

  if (trySpawnStarAttractor(input)) {
    completeStarAttractorCycle(input.state);
    return true;
  }

  input.state.starAttractorSpawnPending = true;
  return false;
}

export function retryPendingStarAttractorSpawnSystem(input: StarAttractorSpawnSystemInput): boolean {
  if (!input.enabled || !input.state.starAttractorSpawnPending) {
    return false;
  }

  if (input.progress.snakeLength < STAR_ATTRACTOR_CONFIG.unlockLength || input.existingStarAttractors.length > 0) {
    return false;
  }

  if (!trySpawnStarAttractor(input)) {
    return false;
  }

  completeStarAttractorCycle(input.state);
  return true;
}

export function refreshBlackHoleSpawnSystem(input: BlackHoleSpawnSystemInput): void {
  const desiredCount = getDesiredBlackHoleCount(input.progress);
  const random = input.random ?? Math.random;

  while (input.existingBlackHoles.length < desiredCount) {
    const nextKind = chooseBlackHoleSpawnKind(
      input.existingBlackHoles.map((blackHole) => blackHole.kind),
      desiredCount,
      random,
    );

    const nextBlackHole = spawnBlackHole({
      grid: input.grid,
      progress: input.progress,
      snake: input.snake,
      foods: input.foods,
      existingBlackHoles: input.existingBlackHoles,
      birthCell: input.birthCell,
      currentTime: input.currentTime,
      futureBlockedCells: input.futureBlockedCells,
      futureDangerZones: input.futureDangerZones,
      kind: nextKind,
      random,
    });

    if (!nextBlackHole) {
      break;
    }

    input.existingBlackHoles.push(nextBlackHole);
  }
}

export function refreshStarBeastSpawnSystem(input: StarBeastSpawnSystemInput): void {
  if (input.phase !== "playing") {
    return;
  }

  if (input.starCoreCells.length >= STAR_BEAST_CONFIG.maxDroppedCoresOnMap) {
    return;
  }

  if (input.currentTime < input.state.starBeastRespawnLockUntil || input.currentTime < input.state.starBeastNextSpawnCheckAt) {
    return;
  }

  const desiredCount = getDesiredStarBeastCount(input.progress);

  if (desiredCount <= 0) {
    return;
  }

  const aliveCount = input.existingStarBeasts.filter((beast) => beast.alive).length;

  if (aliveCount >= desiredCount) {
    input.state.starBeastNextSpawnCheckAt = input.currentTime + STAR_BEAST_CONFIG.spawnCheckIntervalMs / 1000;
    return;
  }

  const nextStarBeast = spawnStarBeast({
    grid: input.grid,
    progress: input.progress,
    snake: input.snake,
    foods: input.foods,
    starCoreCells: input.starCoreCells,
    existingBlackHoles: input.existingBlackHoles,
    existingStarBeasts: input.existingStarBeasts,
    currentTime: input.currentTime,
  });

  if (nextStarBeast) {
    nextStarBeast.id = input.state.nextStarBeastId++;
    input.existingStarBeasts.push(nextStarBeast);
  }

  input.state.starBeastNextSpawnCheckAt = input.currentTime + STAR_BEAST_CONFIG.spawnCheckIntervalMs / 1000;
}

function trySpawnStarAttractor(input: StarAttractorSpawnSystemInput): boolean {
  if (input.existingStarAttractors.length >= STAR_ATTRACTOR_CONFIG.maxOnBoard) {
    return false;
  }

  const nextStarAttractor = spawnStarAttractor({
    grid: input.grid,
    progress: input.progress,
    snake: input.snake,
    direction: input.direction,
    foods: input.foods,
    starCoreCells: input.starCoreCells,
    existingBlackHoles: input.existingBlackHoles,
    existingStarAttractors: input.existingStarAttractors,
    existingStarBeasts: input.existingStarBeasts,
    currentTime: input.currentTime,
  });

  if (!nextStarAttractor) {
    return false;
  }

  nextStarAttractor.id = input.state.nextStarAttractorId++;
  input.existingStarAttractors.push(nextStarAttractor);
  return true;
}

function completeStarAttractorCycle(state: SpawnRuntimeState): void {
  state.starAttractorEatCount = 0;
  state.starAttractorSpawnPending = false;
  state.starAttractorNeedIndex = (state.starAttractorNeedIndex + 1) % STAR_ATTRACTOR_CONFIG.thresholdRanges.length;
  state.starAttractorNeed = rollStarAttractorNeed(state.starAttractorNeedIndex);
}
