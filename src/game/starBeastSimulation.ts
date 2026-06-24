import { isBlackHoleCollision } from "./blackHole";
import { DIRECTION_DELTAS } from "./direction";
import type { SpawnRuntimeState } from "./gameState";
import { cellsMatch } from "./gridMath";
import { getStarCoreCells } from "./spawnSelectors";
import {
  buildStarBeastDropCores,
  chooseStarBeastDirection,
  STAR_BEAST_CONFIG,
  type StarBeastMoveContext,
} from "./starBeast";
import type {
  BlackHole,
  DeathReason,
  Direction,
  GamePhase,
  GridCell,
  GridMetrics,
  StarBeast,
  StarBeastDeathCause,
  StarBeastEffect,
  StarCore,
} from "./types";

export interface StarBeastSimulationInput {
  grid: GridMetrics;
  snake: readonly GridCell[];
  playerDirection: Direction;
  foods: readonly GridCell[];
  blackHoles: readonly BlackHole[];
  starBeasts: StarBeast[];
  starCores: StarCore[];
  starBeastEffects: StarBeastEffect[];
  spawnState: SpawnRuntimeState;
  birthCell: GridCell;
  stepMs: number;
  currentTime: number;
  blackHoleCollisionTime: number;
  baseStepMs: number;
  getPhase(): GamePhase;
  isOutOfBounds(cell: GridCell): boolean;
  collidesWithPlayerBody(cell: GridCell): boolean;
  handlePlayerDeath(reason: DeathReason): void;
  random?: () => number;
}

export function updateStarBeastSimulation(input: StarBeastSimulationInput): void {
  if (input.getPhase() !== "playing" || input.starBeasts.length === 0) {
    return;
  }

  const playerHead = input.snake[0];

  if (!playerHead) {
    return;
  }

  const playerBody = input.snake.slice(1);
  const blockedCells = [...input.foods];
  const beastsToUpdate = [...input.starBeasts];

  for (const beast of beastsToUpdate) {
    if (input.getPhase() !== "playing") {
      return;
    }

    if (!beast.alive || !input.starBeasts.some((candidate) => candidate.id === beast.id)) {
      continue;
    }

    advanceStarBeast(input, beast, playerHead, playerBody, blockedCells);
  }
}

function advanceStarBeast(
  input: StarBeastSimulationInput,
  beast: StarBeast,
  playerHead: GridCell,
  playerBody: readonly GridCell[],
  blockedCells: readonly GridCell[],
): void {
  if (!beast.alive || beast.body.length === 0) {
    return;
  }

  let visibleStarCoreCells = getStarCoreCells(input.starCores);

  if (beast.state === "spawning") {
    beast.spawnGraceTime = Math.max(0, beast.spawnGraceTime - input.stepMs);

    if (beast.spawnGraceTime > 0) {
      return;
    }

    beast.state = "patrol";
    beast.aiDecisionCooldown = 0;
  }

  primeStarBeastBehavior(beast, input.currentTime, input.random ?? Math.random);

  beast.moveTimer += input.stepMs;
  const moveInterval = Math.max(90, input.baseStepMs / Math.max(0.55, beast.speedFactor));

  while (beast.moveTimer >= moveInterval && beast.alive && input.getPhase() === "playing") {
    const otherBeasts = input.starBeasts.filter((candidate) => candidate.id !== beast.id && candidate.alive);
    beast.state = getStarBeastState(playerHead, beast);
    const moveContext: StarBeastMoveContext = {
      grid: input.grid,
      playerHead,
      playerDirection: input.playerDirection,
      playerBody,
      blockedCells,
      starCoreCells: visibleStarCoreCells,
      otherStarBeasts: otherBeasts,
      blackHoles: input.blackHoles,
      currentTime: input.currentTime,
      random: input.random,
    };

    if (beast.aiDecisionCooldown > 0) {
      beast.aiDecisionCooldown -= 1;
    } else {
      beast.dir = chooseStarBeastDirection(beast, moveContext);
      beast.aiDecisionCooldown = beast.turnCommitTicks;
    }

    const head = beast.body[0];

    if (!head) {
      killStarBeast(input, beast, "black_hole");
      return;
    }

    const delta = DIRECTION_DELTAS[beast.dir];
    const nextHead: GridCell = {
      column: head.column + delta.column,
      row: head.row + delta.row,
    };

    if (input.isOutOfBounds(nextHead)) {
      beast.aiDecisionCooldown = 0;
      beast.moveTimer = Math.max(0, beast.moveTimer - moveInterval);
      continue;
    }

    if (input.collidesWithPlayerBody(nextHead)) {
      killStarBeast(input, beast, "player_body");
      return;
    }

    if (collidesWithBlackHole(nextHead, input.blackHoles, input.blackHoleCollisionTime)) {
      killStarBeast(input, beast, "black_hole");
      return;
    }

    if (cellsMatch(nextHead, playerHead)) {
      input.handlePlayerDeath("star_beast");
      return;
    }

    if (blockedCells.some((cell) => cellsMatch(cell, nextHead))) {
      beast.aiDecisionCooldown = 0;
      break;
    }

    if (otherBeasts.some((other) => other.body.some((segment) => cellsMatch(segment, nextHead)))) {
      beast.aiDecisionCooldown = 0;
      break;
    }

    let growth = 0;
    const ateStarCoreIndex = findStarCoreIndex(input.starCores, nextHead);

    if (ateStarCoreIndex !== -1) {
      consumeStarCore(input.starCores, beast, ateStarCoreIndex, input.currentTime, input.random ?? Math.random);
      growth += 1;
      visibleStarCoreCells = getStarCoreCells(input.starCores);
    }

    beast.coreScanStepCount += 1;

    if (beast.coreScanStepCount >= 2) {
      beast.coreScanStepCount = 0;

      const nearbyStarCoreIndex = findStarCoreIndex(input.starCores, head, 1);

      if (nearbyStarCoreIndex !== -1) {
        consumeStarCore(input.starCores, beast, nearbyStarCoreIndex, input.currentTime, input.random ?? Math.random);
        growth += 1;
        visibleStarCoreCells = getStarCoreCells(input.starCores);
      }
    }

    const nextLength = Math.min(STAR_BEAST_CONFIG.maxLength, beast.length + growth);

    beast.body = [nextHead, ...beast.body];

    while (beast.body.length > nextLength) {
      beast.body.pop();
    }

    beast.length = nextLength;
    beast.moveTimer = Math.max(0, beast.moveTimer - moveInterval);
    beast.aiDecisionCooldown = Math.max(0, beast.aiDecisionCooldown - 1);
    beast.state = getStarBeastState(playerHead, beast);
  }
}

function primeStarBeastBehavior(beast: StarBeast, currentTime: number, random: () => number): void {
  if (currentTime >= beast.nextCoreHuntAt && currentTime >= beast.coreHuntUntil) {
    beast.coreHuntUntil = currentTime + rollDuration(
      STAR_BEAST_CONFIG.coreHuntWindowRangeMs[0],
      STAR_BEAST_CONFIG.coreHuntWindowRangeMs[1],
      random,
    ) / 1000;
    beast.nextCoreHuntAt = currentTime + rollDuration(
      STAR_BEAST_CONFIG.coreHuntCooldownRangeMs[0],
      STAR_BEAST_CONFIG.coreHuntCooldownRangeMs[1],
      random,
    ) / 1000;
  }

  if (currentTime >= beast.nextAttackAt && currentTime >= beast.attackUntil) {
    beast.attackUntil = currentTime + rollDuration(
      STAR_BEAST_CONFIG.attackWindowRangeMs[0],
      STAR_BEAST_CONFIG.attackWindowRangeMs[1],
      random,
    ) / 1000;
    beast.nextAttackAt = currentTime + rollDuration(
      STAR_BEAST_CONFIG.attackCooldownRangeMs[0],
      STAR_BEAST_CONFIG.attackCooldownRangeMs[1],
      random,
    ) / 1000;
  }
}

function consumeStarCore(
  starCores: StarCore[],
  beast: StarBeast,
  starCoreIndex: number,
  currentTime: number,
  random: () => number,
): void {
  starCores.splice(starCoreIndex, 1);
  beast.coreHuntUntil = currentTime;
  beast.nextCoreHuntAt = currentTime + rollDuration(
    STAR_BEAST_CONFIG.coreHuntCooldownRangeMs[0],
    STAR_BEAST_CONFIG.coreHuntCooldownRangeMs[1],
    random,
  ) / 1000;
  beast.aiDecisionCooldown = 0;
}

function findStarCoreIndex(starCores: readonly StarCore[], cell: GridCell, radius = 0): number {
  return starCores.findIndex((core) => {
    const coreCell = { column: Math.floor(core.x), row: Math.floor(core.y) };

    if (radius > 0) {
      return Math.abs(coreCell.column - cell.column) <= radius && Math.abs(coreCell.row - cell.row) <= radius;
    }

    const distance = Math.hypot(core.x - (cell.column + 0.5), core.y - (cell.row + 0.5));

    return cellsMatch(coreCell, cell) || distance <= 0.42;
  });
}

function killStarBeast(
  input: StarBeastSimulationInput,
  beast: StarBeast,
  cause: StarBeastDeathCause,
): void {
  if (!beast.alive) {
    return;
  }

  beast.alive = false;
  beast.state = "dead";

  const beastIndex = input.starBeasts.findIndex((candidate) => candidate.id === beast.id);

  if (beastIndex !== -1) {
    input.starBeasts.splice(beastIndex, 1);
  }

  const availableSlots = STAR_BEAST_CONFIG.maxDroppedCoresOnMap - input.starCores.length;

  if (availableSlots > 0) {
    const drops = buildStarBeastDropCores(beast, cause, {
      grid: input.grid,
      currentTime: input.currentTime,
      blackHoles: input.blackHoles,
      random: input.random,
    });

    for (const drop of drops.slice(0, availableSlots)) {
      drop.id = input.spawnState.nextStarCoreId++;
      input.starCores.push(drop);
    }
  }

  const flashCell = beast.body[0] ? { ...beast.body[0] } : { ...input.birthCell };
  const effectId = input.spawnState.nextStarBeastEffectId++;
  input.starBeastEffects.push({
    id: effectId,
    cell: flashCell,
    createdAt: input.currentTime,
    lifetimeMs: STAR_BEAST_CONFIG.deathFlashMs,
    seed: beast.id * 97 + input.spawnState.nextStarBeastEffectId,
    length: beast.length,
    cause,
  });

  const nextSpawnAllowedAt = input.currentTime + STAR_BEAST_CONFIG.respawnCooldownMs / 1000;
  input.spawnState.starBeastRespawnLockUntil = Math.max(input.spawnState.starBeastRespawnLockUntil, nextSpawnAllowedAt);
  input.spawnState.starBeastNextSpawnCheckAt = Math.max(
    input.spawnState.starBeastNextSpawnCheckAt,
    input.spawnState.starBeastRespawnLockUntil,
  );
}

function getStarBeastState(playerHead: GridCell, beast: StarBeast): StarBeast["state"] {
  const head = beast.body[0];

  if (!head) {
    return "patrol";
  }

  const distance = Math.abs(head.column - playerHead.column) + Math.abs(head.row - playerHead.row);

  if (distance <= beast.aggroRadius) {
    return "chase";
  }

  if (distance >= beast.loseAggroRadius) {
    return "patrol";
  }

  return beast.state === "chase" ? "chase" : "patrol";
}

function collidesWithBlackHole(cell: GridCell, blackHoles: readonly BlackHole[], currentTime: number): boolean {
  return blackHoles.some((blackHole) => isBlackHoleCollision(cell, blackHole, currentTime));
}

function rollDuration(min: number, max: number, random: () => number): number {
  return min + random() * (max - min);
}
