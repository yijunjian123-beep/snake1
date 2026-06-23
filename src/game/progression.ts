import type { GridCell } from "./types";

export interface GameProgress {
  snakeLength: number;
  coresEaten: number;
  score: number;
  elapsedTime: number;
}

export type FeatureKey =
  | "combo"
  | "blackHole"
  | "starGate"
  | "evolution"
  | "galaxyEvent"
  | "timeRewind"
  | "starBeast"
  | "boss";

export type FeatureFlags = Record<FeatureKey, boolean>;

export interface UnlockCondition {
  snakeLength?: number;
  coresEaten?: number;
  score?: number;
  elapsedTime?: number;
}

export interface UnlockRule {
  anyOf: readonly UnlockCondition[];
}

export interface UnlockConfig {
  featureFlags: FeatureFlags;
  rules: Record<FeatureKey, UnlockRule>;
}

export interface UnlockedFeatures {
  movement: boolean;
  cores: boolean;
  score: boolean;
  sprint: boolean;
  particles: boolean;
  combo: boolean;
  blackHole: boolean;
  starGate: boolean;
  evolution: boolean;
  galaxyEvent: boolean;
  timeRewind: boolean;
  starBeast: boolean;
  boss: boolean;
}

export interface SafeSpawnZone {
  center: GridCell;
  radius: number;
}

export interface SafeSpawnConfig {
  occupiedCells?: readonly GridCell[];
  blockedCells?: readonly GridCell[];
  dangerZones?: readonly SafeSpawnZone[];
  snakeHead?: GridCell | null;
  snakeHeadRadius?: number;
  wallPadding?: number;
  maxAttempts?: number;
  random?: () => number;
}

export const DEFAULT_UNLOCK_CONFIG: UnlockConfig = {
  featureFlags: {
    combo: true,
    blackHole: true,
    starGate: true,
    evolution: true,
    galaxyEvent: true,
    timeRewind: true,
    starBeast: true,
    boss: true
  },
  rules: {
    combo: { anyOf: [{ snakeLength: 5 }, { coresEaten: 4 }] },
    blackHole: { anyOf: [{ snakeLength: 7 }] },
    starGate: { anyOf: [{ snakeLength: 9 }] },
    evolution: { anyOf: [{ coresEaten: 6 }] },
    galaxyEvent: { anyOf: [{ snakeLength: 11 }, { elapsedTime: 45 }] },
    timeRewind: { anyOf: [{ snakeLength: 13 }, { coresEaten: 12 }] },
    starBeast: { anyOf: [{ snakeLength: 16 }, { score: 160 }] },
    boss: { anyOf: [{ snakeLength: 22 }, { score: 260 }] }
  }
};

export const DEFAULT_SAFE_SPAWN_CONFIG: Pick<SafeSpawnConfig, 'snakeHeadRadius' | 'wallPadding' | 'maxAttempts'> = {
  snakeHeadRadius: 1,
  wallPadding: 1,
  maxAttempts: 128
};

export function getUnlockedFeatures(gameState: GameProgress, config: UnlockConfig = DEFAULT_UNLOCK_CONFIG): UnlockedFeatures {
  const unlocked = (key: FeatureKey): boolean => config.featureFlags[key] && isRuleUnlocked(gameState, config.rules[key]);

  return {
    movement: true,
    cores: true,
    score: true,
    sprint: true,
    particles: true,
    combo: unlocked('combo'),
    blackHole: unlocked('blackHole'),
    starGate: unlocked('starGate'),
    evolution: unlocked('evolution'),
    galaxyEvent: unlocked('galaxyEvent'),
    timeRewind: unlocked('timeRewind'),
    starBeast: unlocked('starBeast'),
    boss: unlocked('boss')
  };
}

function isRuleUnlocked(gameState: GameProgress, rule: UnlockRule): boolean {
  return rule.anyOf.some((condition) => meetsCondition(gameState, condition));
}

function meetsCondition(gameState: GameProgress, condition: UnlockCondition): boolean {
  if (condition.snakeLength !== undefined && gameState.snakeLength < condition.snakeLength) return false;
  if (condition.coresEaten !== undefined && gameState.coresEaten < condition.coresEaten) return false;
  if (condition.score !== undefined && gameState.score < condition.score) return false;
  if (condition.elapsedTime !== undefined && gameState.elapsedTime < condition.elapsedTime) return false;
  return true;
}
