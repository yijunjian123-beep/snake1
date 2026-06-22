const HIGH_SCORE_KEY = "neon-serpent.high-score";

export function readHighScore(): number {
  try {
    const rawValue = window.localStorage.getItem(HIGH_SCORE_KEY);
    const value = rawValue === null ? 0 : Number.parseInt(rawValue, 10);

    return Number.isFinite(value) && value > 0 ? value : 0;
  } catch {
    return 0;
  }
}

export function writeHighScore(score: number): void {
  if (!Number.isFinite(score) || score < 0) {
    return;
  }

  try {
    window.localStorage.setItem(HIGH_SCORE_KEY, Math.floor(score).toString());
  } catch {
    // Storage can be unavailable in private or embedded browser contexts.
  }
}

