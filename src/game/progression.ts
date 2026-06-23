import type { GridCell } from "./types";

export interface GameProgress {
  snakeLength: number;
  coresEaten: number;
  score: number;
  elapsedTime: number;
}

export type FeatureKey =
  | "blackHole"
  | "starGate"
  | "evolution"
  | "galaxyEvent"
  | "timeRewind"
  | "starAttractor"
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
  blackHole: boolean;
  starGate: boolean;
  evolution: boolean;
  galaxyEvent: boolean;
  timeRewind: boolean;
  starAttractor: boolean;
  boss: boolean;
}

export interface LengthUnlockCopy {
  title: string;
  value: string;
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
    blackHole: true,
    starGate: true,
    evolution: true,
    galaxyEvent: true,
    timeRewind: true,
    starAttractor: false,
    boss: true
  },
  rules: {
    blackHole: { anyOf: [{ snakeLength: 7 }] },
    starGate: { anyOf: [{ snakeLength: 9 }] },
    evolution: { anyOf: [{ coresEaten: 6 }] },
    galaxyEvent: { anyOf: [{ snakeLength: 11 }, { elapsedTime: 45 }] },
    timeRewind: { anyOf: [{ snakeLength: 13 }, { coresEaten: 12 }] },
    starAttractor: { anyOf: [{ snakeLength: 10 }] },
    boss: { anyOf: [{ snakeLength: 22 }, { score: 260 }] }
  }
};

export const DEFAULT_SAFE_SPAWN_CONFIG: Pick<SafeSpawnConfig, 'snakeHeadRadius' | 'wallPadding' | 'maxAttempts'> = {
  snakeHeadRadius: 1,
  wallPadding: 1,
  maxAttempts: 128
};

interface LengthUnlockEntry {
  threshold: number;
  title: string;
  value: string;
}

const LENGTH_UNLOCK_SEQUENCE: readonly LengthUnlockEntry[] = [
  { threshold: 7, title: "长度7解锁", value: "黑洞" },
  { threshold: 10, title: "长度10解锁", value: "星兽" },
];

const FINAL_LENGTH_UNLOCK_COPY: LengthUnlockCopy = {
  title: "BOSS战和联机模式",
  value: "敬请期待",
};

export function getUnlockedFeatures(gameState: GameProgress, config: UnlockConfig = DEFAULT_UNLOCK_CONFIG): UnlockedFeatures {
  const unlocked = (key: FeatureKey): boolean => config.featureFlags[key] && isRuleUnlocked(gameState, config.rules[key]);

  return {
    movement: true,
    cores: true,
    score: true,
    sprint: true,
    particles: true,
    blackHole: unlocked('blackHole'),
    starGate: unlocked('starGate'),
    evolution: unlocked('evolution'),
    galaxyEvent: unlocked('galaxyEvent'),
    timeRewind: unlocked('timeRewind'),
    starAttractor: unlocked('starAttractor'),
    boss: unlocked('boss')
  };
}

export function getNextLengthUnlockCopy(gameState: GameProgress, config: UnlockConfig = DEFAULT_UNLOCK_CONFIG): LengthUnlockCopy {
  void config;

  const candidate = findNextLengthUnlock(gameState);

  if (!candidate) {
    return FINAL_LENGTH_UNLOCK_COPY;
  }

  return candidate;
}

function findNextLengthUnlock(gameState: GameProgress): LengthUnlockCopy | null {
  for (const candidate of LENGTH_UNLOCK_SEQUENCE) {
    if (gameState.snakeLength < candidate.threshold) {
      return {
        title: candidate.title,
        value: candidate.value,
      };
    }
  }

  return null;
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
