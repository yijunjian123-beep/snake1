import { advanceFoodWaveRuntime, createFoodWaveSpawnConfig, type FoodSpawnContext } from "./foodSpawn";
import type { SpawnRuntimeState } from "./gameState";
import type { GridCell, GridMetrics, StarBeastEffect, StarCore } from "./types";

export interface FoodWaveSystemInput {
  context: FoodSpawnContext;
  foods: GridCell[];
  state: SpawnRuntimeState;
  currentTimeMs: number;
  random?: () => number;
}

export interface StarCoreSystemInput {
  delta: number;
  currentTime: number;
  grid: GridMetrics;
  snake: readonly GridCell[];
  foods: readonly GridCell[];
  starCores: StarCore[];
  extendSnakeByOne(): void;
  handleCoreCollection(
    currentTime: number,
    amount: number,
    advancesStarAttractorProgress: boolean,
    rewardBurstOrigin: GridCell | null,
  ): void;
  endRun(): void;
}

export interface StarBeastEffectSystemInput {
  currentTime: number;
  starBeastEffects: StarBeastEffect[];
}

export function updateFoodWaveSystem(input: FoodWaveSystemInput): void {
  const result = advanceFoodWaveRuntime({
    context: input.context,
    currentFoodCount: input.foods.length,
    currentTimeMs: input.currentTimeMs,
    nextSpawnAtMs: input.state.foodWaveNextSpawnAt,
    foodWaveBag: input.state.foodWaveBag,
    config: createFoodWaveSpawnConfig(),
    random: input.random,
  });

  if (result.spawnedFoods.length > 0) {
    input.foods.push(...result.spawnedFoods);
  }

  input.state.foodWaveBag = result.nextFoodWaveBag;
  input.state.foodWaveNextSpawnAt = result.nextSpawnAtMs;
}

export function updateStarCoreSystem(input: StarCoreSystemInput): void {
  if (input.starCores.length === 0) {
    return;
  }

  const dt = Math.min(input.delta / 1000, 0.05);
  const dragExponent = input.delta / 16.67;
  const head = input.snake[0];
  const playerCenter = head
    ? {
        x: head.column + 0.5,
        y: head.row + 0.5,
      }
    : null;

  for (let index = input.starCores.length - 1; index >= 0; index -= 1) {
    const core = input.starCores[index];

    if (!core) {
      continue;
    }

    const ageMs = input.currentTime * 1000 - core.spawnTime * 1000;
    const rewardBurstOrigin = core.burstOrigin
      ? (head ? { ...head } : null)
      : { column: Math.floor(core.x), row: Math.floor(core.y) };

    if (ageMs >= core.lifetimeMs) {
      input.starCores.splice(index, 1);
      continue;
    }

    if (playerCenter) {
      const dx = playerCenter.x - core.x;
      const dy = playerCenter.y - core.y;
      const distance = Math.hypot(dx, dy);
      const magnetReady = ageMs >= core.magnetDelayMs;

      if (distance <= 0.36) {
        input.starCores.splice(index, 1);
        input.extendSnakeByOne();
        input.handleCoreCollection(input.currentTime, 1, false, rewardBurstOrigin);

        if (input.foods.length === 0 && input.starCores.length === 0) {
          input.endRun();
          return;
        }

        continue;
      }

      if (magnetReady && distance <= core.magnetRadius) {
        const pull = Math.min(1, 1 - distance / Math.max(0.001, core.magnetRadius));
        const pullStrength = 4.5 + pull * 8;
        core.vx += dx * pullStrength * dt;
        core.vy += dy * pullStrength * dt;
      } else {
        const swirl = 0.18 + Math.sin(input.currentTime * 6.3 + core.id * 0.11) * 0.06;
        core.vx += Math.sin(input.currentTime * 2.4 + core.id * 0.17) * swirl * dt;
        core.vy += Math.cos(input.currentTime * 2.1 + core.id * 0.13) * swirl * dt;
      }
    }

    const drag = ageMs < core.magnetDelayMs ? 0.98 : 0.94;
    const dragFactor = Math.pow(drag, dragExponent);
    core.vx *= dragFactor;
    core.vy *= dragFactor;

    const maxSpeed = ageMs < core.magnetDelayMs ? 0.9 : 2.4;
    const speed = Math.hypot(core.vx, core.vy);

    if (speed > maxSpeed) {
      const scale = maxSpeed / Math.max(0.001, speed);
      core.vx *= scale;
      core.vy *= scale;
    }

    core.x += core.vx * dt;
    core.y += core.vy * dt;
    core.x = Math.max(0.35, Math.min(input.grid.columns - 0.35, core.x));
    core.y = Math.max(0.35, Math.min(input.grid.rows - 0.35, core.y));

    if (playerCenter) {
      const distance = Math.hypot(playerCenter.x - core.x, playerCenter.y - core.y);

      if (distance <= 0.36) {
        input.starCores.splice(index, 1);
        input.handleCoreCollection(input.currentTime, 1, false, rewardBurstOrigin);

        if (input.foods.length === 0 && input.starCores.length === 0) {
          input.endRun();
          return;
        }
      }
    }
  }
}

export function updateStarBeastEffectSystem(input: StarBeastEffectSystemInput): void {
  if (input.starBeastEffects.length === 0) {
    return;
  }

  for (let index = input.starBeastEffects.length - 1; index >= 0; index -= 1) {
    const effect = input.starBeastEffects[index];

    if (!effect) {
      continue;
    }

    if (input.currentTime - effect.createdAt < effect.lifetimeMs / 1000) {
      continue;
    }

    input.starBeastEffects.splice(index, 1);
  }
}
