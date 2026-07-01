export const DEFAULT_UNLOCK_CONFIG = {
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
export const DEFAULT_SAFE_SPAWN_CONFIG = {
    snakeHeadRadius: 1,
    wallPadding: 1,
    maxAttempts: 128
};
const LENGTH_UNLOCK_SEQUENCE = [
    { threshold: 7, title: "长度7解锁", value: "黑洞" },
    { threshold: 10, title: "长度10解锁", value: "星兽" },
];
const FINAL_LENGTH_UNLOCK_COPY = {
    title: "BOSS战和联机模式",
    value: "敬请期待",
};
export function getUnlockedFeatures(gameState, config = DEFAULT_UNLOCK_CONFIG) {
    const unlocked = (key) => config.featureFlags[key] && isRuleUnlocked(gameState, config.rules[key]);
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
export function getNextLengthUnlockCopy(gameState, config = DEFAULT_UNLOCK_CONFIG) {
    void config;
    const candidate = findNextLengthUnlock(gameState);
    if (!candidate) {
        return FINAL_LENGTH_UNLOCK_COPY;
    }
    return candidate;
}
function findNextLengthUnlock(gameState) {
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
function isRuleUnlocked(gameState, rule) {
    return rule.anyOf.some((condition) => meetsCondition(gameState, condition));
}
function meetsCondition(gameState, condition) {
    if (condition.snakeLength !== undefined && gameState.snakeLength < condition.snakeLength)
        return false;
    if (condition.coresEaten !== undefined && gameState.coresEaten < condition.coresEaten)
        return false;
    if (condition.score !== undefined && gameState.score < condition.score)
        return false;
    if (condition.elapsedTime !== undefined && gameState.elapsedTime < condition.elapsedTime)
        return false;
    return true;
}
