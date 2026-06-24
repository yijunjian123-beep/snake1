import type { RunLifecycleState } from "./gameState";
import type { DeathReason } from "./types";

export const DEFAULT_REVIVE_COUNTDOWN_MS = 3000;

export type PlayerDeathTransition = "ignored" | "revivePrompt" | "gameOver";
export type ReviveCountdownTransition = "ignored" | "waiting" | "completed";

export function resolvePlayerDeathTransition(
  lifecycle: RunLifecycleState,
  reason: DeathReason,
): PlayerDeathTransition {
  if (lifecycle.phase === "gameOver") {
    return "ignored";
  }

  lifecycle.deathReason = reason;

  if (lifecycle.livesRemaining > 1) {
    lifecycle.livesRemaining -= 1;
    enterRevivePromptState(lifecycle);
    return "revivePrompt";
  }

  lifecycle.livesRemaining = 0;
  enterGameOverState(lifecycle, reason);
  return "gameOver";
}

export function enterRevivePromptState(lifecycle: RunLifecycleState): void {
  lifecycle.phase = "revivePrompt";
  lifecycle.reviving = false;
  lifecycle.reviveEndsAt = 0;
}

export function canConfirmRevive(lifecycle: RunLifecycleState): boolean {
  return lifecycle.phase === "revivePrompt" && lifecycle.livesRemaining > 0;
}

export function startReviveCountdown(
  lifecycle: RunLifecycleState,
  elapsed: number,
  countdownMs = DEFAULT_REVIVE_COUNTDOWN_MS,
): boolean {
  if (!canConfirmRevive(lifecycle)) {
    return false;
  }

  lifecycle.phase = "reviving";
  lifecycle.reviving = true;
  lifecycle.reviveEndsAt = elapsed + countdownMs;
  return true;
}

export function resolveReviveCountdown(
  lifecycle: RunLifecycleState,
  elapsed: number,
): ReviveCountdownTransition {
  if (!lifecycle.reviving || lifecycle.phase !== "reviving") {
    return "ignored";
  }

  if (elapsed < lifecycle.reviveEndsAt) {
    return "waiting";
  }

  lifecycle.reviving = false;
  lifecycle.reviveEndsAt = 0;
  lifecycle.phase = "playing";
  return "completed";
}

export function enterGameOverState(lifecycle: RunLifecycleState, reason: DeathReason | null = null): void {
  lifecycle.phase = "gameOver";
  lifecycle.reviving = false;
  lifecycle.reviveEndsAt = 0;
  lifecycle.deathReason = reason;
}
