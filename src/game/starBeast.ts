import { isBlackHoleCollision, getBlackHoleSpawnExclusionRadiusCells } from "./blackHole";
import { findSafeSpawnPosition } from "./spawn";
import type { GameProgress } from "./progression";
import type {
  BlackHole,
  Direction,
  GridCell,
  GridMetrics,
  StarBeast,
  StarBeastDeathCause,
  StarCore,
} from "./types";

export interface StarBeastTier {
  minPlayerLength: number;
  maxPlayerLength: number;
  length: number;
  speedFactor: number;
  aggroRadius: number;
  loseAggroRadius: number;
  maxAlive: number;
}

export interface StarBeastSpawnContext {
  grid: GridMetrics;
  progress: GameProgress;
  snake: readonly GridCell[];
  foods: readonly GridCell[];
  starCoreCells: readonly GridCell[];
  existingBlackHoles: readonly BlackHole[];
  existingStarBeasts: readonly StarBeast[];
  currentTime: number;
  random?: () => number;
}

export interface StarBeastMoveContext {
  grid: GridMetrics;
  playerHead: GridCell | null;
  playerBody: readonly GridCell[];
  blockedCells: readonly GridCell[];
  otherStarBeasts: readonly StarBeast[];
  blackHoles: readonly BlackHole[];
  currentTime: number;
  random?: () => number;
}

export interface StarBeastMoveEvaluation {
  direction: Direction;
  score: number;
}

export interface StarBeastDropContext {
  grid: GridMetrics;
  currentTime: number;
  blackHoles: readonly BlackHole[];
  random?: () => number;
}

export const STAR_BEAST_CONFIG = {
  unlockLength: 10,
  maxAlive: 2,
  maxLength: 24,
  maxDroppedCoresOnMap: 96,
  spawnCheckIntervalMs: 5000,
  spawnGraceTimeMs: 1200,
  respawnCooldownMs: 18000,
  deathFlashMs: 120,
  tiers: [
    {
      minPlayerLength: 10,
      maxPlayerLength: 24,
      length: 8,
      speedFactor: 0.68,
      aggroRadius: 7,
      loseAggroRadius: 11,
      maxAlive: 1,
    },
    {
      minPlayerLength: 25,
      maxPlayerLength: 49,
      length: 12,
      speedFactor: 0.76,
      aggroRadius: 8,
      loseAggroRadius: 12,
      maxAlive: 1,
    },
    {
      minPlayerLength: 50,
      maxPlayerLength: 79,
      length: 16,
      speedFactor: 0.84,
      aggroRadius: 9,
      loseAggroRadius: 13,
      maxAlive: 2,
    },
    {
      minPlayerLength: 80,
      maxPlayerLength: 9999,
      length: 24,
      speedFactor: 0.92,
      aggroRadius: 10,
      loseAggroRadius: 15,
      maxAlive: 2,
    },
  ],
} as const satisfies {
  unlockLength: number;
  maxAlive: number;
  maxLength: number;
  maxDroppedCoresOnMap: number;
  spawnCheckIntervalMs: number;
  spawnGraceTimeMs: number;
  respawnCooldownMs: number;
  deathFlashMs: number;
  tiers: readonly StarBeastTier[];
};

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

function cellKey(cell: GridCell): string {
  return `${cell.column}:${cell.row}`;
}

function cellsMatch(left: GridCell, right: GridCell): boolean {
  return left.column === right.column && left.row === right.row;
}

function isInsideGrid(cell: GridCell, grid: GridMetrics): boolean {
  return cell.column >= 0 && cell.row >= 0 && cell.column < grid.columns && cell.row < grid.rows;
}

function isNear(cell: GridCell, center: GridCell, radius: number): boolean {
  if (radius <= 0) {
    return false;
  }

  return Math.max(Math.abs(cell.column - center.column), Math.abs(cell.row - center.row)) <= radius;
}

function turnLeft(direction: Direction): Direction {
  switch (direction) {
    case "up":
      return "left";
    case "left":
      return "down";
    case "down":
      return "right";
    case "right":
      return "up";
  }
}

function turnRight(direction: Direction): Direction {
  switch (direction) {
    case "up":
      return "right";
    case "right":
      return "down";
    case "down":
      return "left";
    case "left":
      return "up";
  }
}

function getDirectionDelta(direction: Direction): GridCell {
  switch (direction) {
    case "up":
      return { column: 0, row: -1 };
    case "right":
      return { column: 1, row: 0 };
    case "down":
      return { column: 0, row: 1 };
    case "left":
      return { column: -1, row: 0 };
  }
}

function getNextCell(cell: GridCell, direction: Direction): GridCell {
  const delta = getDirectionDelta(direction);

  return {
    column: cell.column + delta.column,
    row: cell.row + delta.row,
  };
}

function shuffleDirections(random: () => number): Direction[] {
  const directions: Direction[] = ["up", "right", "down", "left"];

  for (let index = directions.length - 1; index > 0; index -= 1) {
    const swapIndex = Math.floor(random() * (index + 1));
    const current = directions[index];
    const swap = directions[swapIndex];

    if (current && swap) {
      directions[index] = swap;
      directions[swapIndex] = current;
    }
  }

  return directions;
}

function getBlackHoleDangerZones(blackHoles: readonly BlackHole[]): Array<{ center: GridCell; radius: number }> {
  return blackHoles.map((blackHole) => ({
    center: blackHole.cell,
    radius: getBlackHoleSpawnExclusionRadiusCells(blackHole) + 1,
  }));
}

function isInDangerZone(cell: GridCell, center: GridCell, radius: number): boolean {
  return isNear(cell, center, Math.max(0, Math.floor(radius)));
}

function isCellSafe(
  cell: GridCell,
  grid: GridMetrics,
  occupied: Set<string>,
  dangerZones: ReadonlyArray<{ center: GridCell; radius: number }>,
): boolean {
  if (!isInsideGrid(cell, grid)) {
    return false;
  }

  if (occupied.has(cellKey(cell))) {
    return false;
  }

  return !dangerZones.some((zone) => isInDangerZone(cell, zone.center, zone.radius));
}

function getSpawnBodyCells(head: GridCell, direction: Direction, length: number): GridCell[] {
  const delta = getDirectionDelta(direction);

  return Array.from({ length }, (_, index) => ({
    column: head.column - delta.column * index,
    row: head.row - delta.row * index,
  }));
}

function getTier(progress: GameProgress, config: typeof STAR_BEAST_CONFIG = STAR_BEAST_CONFIG): StarBeastTier | null {
  if (progress.snakeLength < config.unlockLength) {
    return null;
  }

  const tier = config.tiers.find((candidate) => (
    progress.snakeLength >= candidate.minPlayerLength &&
    progress.snakeLength <= candidate.maxPlayerLength
  ));

  return tier ?? config.tiers[config.tiers.length - 1] ?? null;
}

export function getDesiredStarBeastCount(progress: GameProgress, config: typeof STAR_BEAST_CONFIG = STAR_BEAST_CONFIG): number {
  const tier = getTier(progress, config);

  return tier ? Math.min(config.maxAlive, tier.maxAlive) : 0;
}

export function getStarBeastTier(progress: GameProgress, config: typeof STAR_BEAST_CONFIG = STAR_BEAST_CONFIG): StarBeastTier | null {
  return getTier(progress, config);
}

export function spawnStarBeast(context: StarBeastSpawnContext, config: typeof STAR_BEAST_CONFIG = STAR_BEAST_CONFIG): StarBeast | null {
  const random = context.random ?? Math.random;
  const tier = getTier(context.progress, config);

  if (!tier) {
    return null;
  }

  const currentHead = context.snake[0] ?? { column: Math.floor(context.grid.columns / 2), row: Math.floor(context.grid.rows / 2) };
  const occupiedCells = [
    ...context.snake,
    ...context.foods,
    ...context.starCoreCells,
    ...context.existingBlackHoles.map((blackHole) => blackHole.cell),
    ...context.existingStarBeasts.flatMap((beast) => beast.body),
  ];
  const occupied = new Set<string>(occupiedCells.map((cell) => cellKey(cell)));
  const dangerZones = [
    { center: currentHead, radius: Math.max(6, tier.aggroRadius + 2) },
    ...getBlackHoleDangerZones(context.existingBlackHoles),
    ...context.existingStarBeasts.map((beast) => ({
      center: beast.body[0] ?? currentHead,
      radius: Math.max(4, Math.ceil(beast.length * 0.5) + 1),
    })),
  ];
  const rejectedHeads: GridCell[] = [];
  const directionOrder = shuffleDirections(random);

  for (let attempt = 0; attempt < 64; attempt += 1) {
    const candidate = findSafeSpawnPosition(context.grid, {
      occupiedCells: [...occupiedCells, ...rejectedHeads],
      snakeHead: currentHead,
      snakeHeadRadius: Math.max(6, tier.aggroRadius + 2),
      wallPadding: 2,
      dangerZones,
      maxAttempts: 128,
      random,
    });

    if (!candidate) {
      return null;
    }

    for (const direction of directionOrder) {
      const body = getSpawnBodyCells(candidate, direction, tier.length);

      if (
        body.every((cell) => (
          isCellSafe(cell, context.grid, occupied, dangerZones) &&
          !context.starCoreCells.some((starCoreCell) => cellsMatch(starCoreCell, cell))
        ))
      ) {
        return {
          id: Math.floor(random() * 1_000_000),
          alive: true,
          body,
          dir: direction,
          length: tier.length,
          state: "spawning",
          moveTimer: 0,
          aiDecisionCooldown: 0,
          turnCommitTicks: 2,
          spawnGraceTime: config.spawnGraceTimeMs,
          speedFactor: tier.speedFactor,
          aggroRadius: tier.aggroRadius,
          loseAggroRadius: tier.loseAggroRadius,
        };
      }
    }

    rejectedHeads.push(candidate);
  }

  return null;
}

function getPlayerDistanceScore(
  from: GridCell,
  playerHead: GridCell,
  playerBody: readonly GridCell[],
  currentDirection: Direction,
  candidateDirection: Direction,
  state: StarBeast["state"],
): number {
  const currentDistance = Math.abs(from.column - playerHead.column) + Math.abs(from.row - playerHead.row);
  const nextCell = getNextCell(from, candidateDirection);
  const nextDistance = Math.abs(nextCell.column - playerHead.column) + Math.abs(nextCell.row - playerHead.row);
  const closerBonus = state === "chase" ? 16 : 5;
  const fartherPenalty = state === "chase" ? -10 : 4;
  const bodyPenalty = state === "chase" ? -18 : -120;
  let score = 0;

  if (nextDistance < currentDistance) {
    score += closerBonus;
  } else if (nextDistance > currentDistance) {
    score += fartherPenalty;
  }

  if (candidateDirection === currentDirection) {
    score += 8;
  } else if (candidateDirection === turnLeft(currentDirection)) {
    score += 4;
  } else if (candidateDirection === turnRight(currentDirection)) {
    score += 2;
  }

  for (const bodyCell of playerBody) {
    if (cellsMatch(nextCell, bodyCell)) {
      score += bodyPenalty;
      break;
    }

    if (isNear(nextCell, bodyCell, 1)) {
      score += state === "chase" ? -4 : -10;
    }
  }

  if (cellsMatch(nextCell, playerHead)) {
    score += state === "chase" ? 5 : -1;
  }

  return score;
}

function getDangerPenalty(nextCell: GridCell, blackHoles: readonly BlackHole[], currentTime: number, state: StarBeast["state"]): number {
  let penalty = 0;

  for (const blackHole of blackHoles) {
    if (isBlackHoleCollision(nextCell, blackHole, currentTime)) {
      penalty += state === "chase" ? -16 : -120;
      continue;
    }

    if (isNear(nextCell, blackHole.cell, 1)) {
      penalty += state === "chase" ? -5 : -18;
    }
  }

  return penalty;
}

function getHardBlockPenalty(
  nextCell: GridCell,
  grid: GridMetrics,
  beastBody: readonly GridCell[],
  blockedCells: readonly GridCell[],
  otherStarBeasts: readonly StarBeast[],
): number {
  if (!isInsideGrid(nextCell, grid)) {
    return -999;
  }

  if (beastBody.some((cell) => cellsMatch(cell, nextCell))) {
    return -999;
  }

  if (blockedCells.some((cell) => cellsMatch(cell, nextCell))) {
    return -999;
  }

  for (const beast of otherStarBeasts) {
    if (beast.body.some((cell) => cellsMatch(cell, nextCell))) {
      return -999;
    }
  }

  return 0;
}

export function chooseStarBeastDirection(
  beast: StarBeast,
  context: StarBeastMoveContext,
): Direction {
  const head = beast.body[0];

  if (!head || !context.playerHead) {
    return beast.dir;
  }

  const candidates = [beast.dir, turnLeft(beast.dir), turnRight(beast.dir)];
  let bestDirection = beast.dir;
  let bestScore = -Infinity;

  for (const direction of candidates) {
    const nextCell = getNextCell(head, direction);
    let score = 0;

    score += getHardBlockPenalty(nextCell, context.grid, beast.body, context.blockedCells, context.otherStarBeasts);
    score += getPlayerDistanceScore(head, context.playerHead, context.playerBody, beast.dir, direction, beast.state);
    score += getDangerPenalty(nextCell, context.blackHoles, context.currentTime, beast.state);

    if (score > bestScore) {
      bestScore = score;
      bestDirection = direction;
    }
  }

  return bestDirection;
}

export function buildStarBeastDropCores(
  beast: StarBeast,
  cause: StarBeastDeathCause,
  context: StarBeastDropContext,
): StarCore[] {
  const random = context.random ?? Math.random;
  const safeBodyCells = cause === "black_hole"
    ? beast.body.filter((cell) => !context.blackHoles.some((blackHole) => isBlackHoleCollision(cell, blackHole, context.currentTime)))
    : beast.body;
  const sourceCells = safeBodyCells.length > 0 ? safeBodyCells : beast.body.slice(0, 1);
  const burstOrigin = beast.body[0] ? { ...beast.body[0] } : undefined;
  const count = Math.max(1, Math.min(configuredDropCount(beast.length), STAR_BEAST_CONFIG.maxDroppedCoresOnMap));
  const cores: StarCore[] = [];

  for (let index = 0; index < count; index += 1) {
    const baseCell = sourceCells[index % sourceCells.length] ?? sourceCells[0] ?? beast.body[0] ?? { column: 0, row: 0 };
    const angle = random() * Math.PI * 2 + index * 0.47;
    const radius = cause === "player_body"
      ? 0.12 + random() * 0.42
      : 0.08 + random() * 0.28;
    const x = clamp(baseCell.column + 0.5 + Math.cos(angle) * radius, 0.35, context.grid.columns - 0.35);
    const y = clamp(baseCell.row + 0.5 + Math.sin(angle) * radius, 0.35, context.grid.rows - 0.35);

    cores.push({
      id: Math.floor(random() * 1_000_000),
      x,
      y,
      vx: Math.cos(angle) * (0.08 + random() * 0.18),
      vy: Math.sin(angle) * (0.08 + random() * 0.18),
      spawnTime: context.currentTime,
      magnetDelayMs: 250,
      magnetRadius: cause === "player_body" ? 3.5 : 3,
      lifetimeMs: 15000,
      value: 1,
      source: "star_beast",
      burstOrigin,
    });
  }

  return cores;
}

export function countRegularStarCores(cores: readonly Pick<StarCore, "source">[]): number {
  return cores.reduce((total, core) => total + (core.source === "regular" ? 1 : 0), 0);
}

function configuredDropCount(length: number): number {
  return clamp(Math.floor(length), 1, STAR_BEAST_CONFIG.maxLength);
}
