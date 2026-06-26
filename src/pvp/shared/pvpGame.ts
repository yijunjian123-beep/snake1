import { createPrng } from "../../game/random.js";
import { buildFoodSpawnContext } from "../../game/spawnRuntime.js";
import { spawnFoodCell } from "../../game/foodSpawn.js";
import { commitSnakeMovement, evaluateSnakeAdvance, pickAdvanceDirection } from "../../game/snakeMovementSystem.js";
import { resolveMultiplayerSnakeCollisions } from "../../game/collisionSystem.js";
import { OPPOSITE_DIRECTIONS } from "../../game/direction.js";
import type {
  DeathReason,
  Direction,
  GamePhase,
  GridCell,
  GridMetrics,
  MatchMode,
  StarCore,
} from "../../game/types.js";
import type {
  GameOverReason,
  PvpAliveMap,
  PvpGridCell,
  PvpStateHash,
  PvpWinner,
  PlayerSlot,
  RoomPhase,
  ServerGameOverMessage,
} from "../net/protocol.js";

export const PVP_BOARD_COLUMNS = 28;
export const PVP_BOARD_ROWS = 18;
export const PVP_STARTING_LENGTH = 4;
export const PVP_TARGET_FOOD_COUNT = 3;
export const PVP_MIN_INPUT_INTERVAL_MS = 25;
export const PVP_MAX_DIRECTION_QUEUE_LENGTH = 2;
export const PVP_INITIAL_DIRECTIONS: Readonly<Record<PlayerSlot, Direction>> = {
  p1: "right",
  p2: "left",
};

export interface PvpPlayerInputRecord {
  readonly seq: number;
  readonly tick: number;
  readonly direction: Direction;
}

export interface PvpPlayerInputState {
  readonly seenSequences: Set<number>;
  readonly initialDirection: Direction;
  lastDirection: Direction;
  lastInputAt: number;
  lastTick: number;
  lastProcessedTick: number;
  lastAppliedSequence: number;
  recentInputs: PvpPlayerInputRecord[];
}

export interface PvpInputState {
  playersById: Map<PlayerSlot, PvpPlayerInputState>;
}

export interface PvpPlayerRuntime {
  readonly id: PlayerSlot;
  snake: GridCell[];
  movement: {
    direction: Direction;
    directionQueue: Direction[];
    snakeOccupancy: Uint8Array;
    pendingGrowthSegments: number;
  };
  progress: {
    score: number;
    coresEaten: number;
  };
  lifecycle: {
    phase: GamePhase;
    deathReason: DeathReason | null;
  };
}

export interface PvpRuntimeMatch {
  mode: MatchMode;
  phase: GamePhase;
  tick: number;
  winnerId: PlayerSlot | null;
}

export interface PvpRuntimeState {
  grid: GridMetrics;
  match: PvpRuntimeMatch;
  players: [PvpPlayerRuntime, PvpPlayerRuntime];
  foods: GridCell[];
  starCores: StarCore[];
  random: () => number;
  inputState: PvpInputState;
}

export interface PvpRuntimeConfig {
  readonly seed: number;
  readonly startTick: number;
  readonly tickRate: number;
  readonly inputDelayTicks: number;
  readonly grid: GridMetrics;
  readonly mode?: MatchMode;
}

export interface PvpAdvanceResult {
  readonly snapshot: PvpGameSnapshot;
  readonly gameOver: ServerGameOverMessage | null;
}

export interface PvpGameSnapshot {
  readonly phase: RoomPhase;
  readonly tick: number;
  readonly stateHash: PvpStateHash;
  readonly snakeHeads: Readonly<Record<PlayerSlot, PvpGridCell | null>>;
  readonly alive: PvpAliveMap;
}

export function createPvpBoardGrid(cellSize = 1, offsetX = 0, offsetY = 0): GridMetrics {
  return {
    columns: PVP_BOARD_COLUMNS,
    rows: PVP_BOARD_ROWS,
    cellSize,
    offsetX,
    offsetY,
  };
}

export function createPvpRuntime(config: PvpRuntimeConfig): PvpRuntimeState {
  const random = createPrng(config.seed);
  const players = createPvpPlayers(config.grid);
  const runtime: PvpRuntimeState = {
    grid: config.grid,
    match: {
      mode: config.mode ?? "online-pvp",
      phase: "playing",
      tick: config.startTick,
      winnerId: null,
    },
    players,
    foods: [],
    starCores: [],
    random,
    inputState: createPvpInputState(),
  };

  runtime.foods = createPvpFoods(runtime);
  return runtime;
}

export function createPvpPlayers(grid: GridMetrics = createPvpBoardGrid()): [PvpPlayerRuntime, PvpPlayerRuntime] {
  const firstHead = getPvpStartingHead(grid.columns, grid.rows, "p1");
  const secondHead = getPvpStartingHead(grid.columns, grid.rows, "p2");
  return [
    createPvpPlayer(grid, "p1", firstHead, "right"),
    createPvpPlayer(grid, "p2", secondHead, "left"),
  ];
}

export function createPvpInputState(): PvpInputState {
  const playersById = new Map<PlayerSlot, PvpPlayerInputState>();

  for (const playerId of ["p1", "p2"] as const) {
    playersById.set(playerId, createPvpPlayerInputState(playerId));
  }

  return {
    playersById,
  };
}

export function createPvpPlayerInputState(playerId: PlayerSlot): PvpPlayerInputState {
  return {
    seenSequences: new Set<number>(),
    initialDirection: PVP_INITIAL_DIRECTIONS[playerId],
    lastDirection: PVP_INITIAL_DIRECTIONS[playerId],
    lastInputAt: 0,
    lastTick: -1,
    lastProcessedTick: -1,
    lastAppliedSequence: 0,
    recentInputs: [],
  };
}

export function recordPvpInput(
  inputState: PvpInputState,
  playerId: PlayerSlot,
  seq: number,
  tick: number,
  direction: Direction,
  inputDelayTicks: number,
  now: number = Date.now(),
): boolean {
  const playerInputState = getPvpPlayerInputState(inputState, playerId);

  if (playerInputState.seenSequences.has(seq)) {
    return false;
  }

  if (now - playerInputState.lastInputAt < PVP_MIN_INPUT_INTERVAL_MS) {
    return false;
  }

  if (isStalePvpInput(tick, playerInputState.lastTick, inputDelayTicks)) {
    return false;
  }

  const previousInput = findPreviousPvpInput(playerInputState.recentInputs, tick, seq);
  const previousDirection = previousInput?.direction ?? playerInputState.initialDirection;

  if (direction === OPPOSITE_DIRECTIONS[previousDirection]) {
    return false;
  }

  playerInputState.seenSequences.add(seq);
  playerInputState.lastInputAt = now;
  playerInputState.lastTick = Math.max(playerInputState.lastTick, tick);
  playerInputState.lastDirection = direction;
  insertPvpInputRecord(playerInputState.recentInputs, {
    seq,
    tick,
    direction,
  });

  return true;
}

export function applyPvpInputsForTick(runtime: PvpRuntimeState, tick: number): void {
  for (const player of runtime.players) {
    const playerInputState = getPvpPlayerInputState(runtime.inputState, player.id);
    let lastAppliedSequence = playerInputState.lastAppliedSequence;

    for (const input of playerInputState.recentInputs) {
      if (input.tick > tick || input.seq <= lastAppliedSequence) {
        continue;
      }

      queuePvpDirection(player, input.direction);
      lastAppliedSequence = Math.max(lastAppliedSequence, input.seq);
    }

    playerInputState.lastAppliedSequence = lastAppliedSequence;
    playerInputState.lastProcessedTick = tick;
    playerInputState.recentInputs = playerInputState.recentInputs.filter((input) => input.tick > tick);
  }
}

export function queuePvpDirection(player: PvpPlayerRuntime, direction: Direction): boolean {
  const lastQueuedDirection = player.movement.directionQueue.at(-1) ?? player.movement.direction;

  if (
    direction === lastQueuedDirection
    || direction === OPPOSITE_DIRECTIONS[lastQueuedDirection]
    || player.movement.directionQueue.length >= PVP_MAX_DIRECTION_QUEUE_LENGTH
  ) {
    return false;
  }

  player.movement.directionQueue.push(direction);
  return true;
}

export function advancePvpTick(runtime: PvpRuntimeState): PvpAdvanceResult {
  if (runtime.match.phase === "gameOver") {
    return {
      snapshot: createPvpSnapshot(runtime),
      gameOver: null,
    };
  }

  runtime.match.tick += 1;
  applyPvpInputsForTick(runtime, runtime.match.tick);

  const evaluations: Array<{
    readonly playerId: PlayerSlot;
    readonly direction: Direction;
    readonly evaluation: NonNullable<ReturnType<typeof evaluateSnakeAdvance>>;
    readonly player: PvpPlayerRuntime;
  }> = [];

  for (const player of runtime.players) {
    if (player.lifecycle.phase !== "playing") {
      continue;
    }

    const intendedDirection = player.movement.directionQueue.shift() ?? player.movement.direction;
    const context = buildPvpMovementContext(runtime, player, false);
    const selection = pickAdvanceDirection(context, intendedDirection, [player.movement.direction]);
    const evaluation = evaluateSnakeAdvance(context, selection.direction);

    if (!evaluation) {
      finishPvpPlayer(player, "unknown");
      continue;
    }

    evaluations.push({
      playerId: player.id,
      direction: selection.direction,
      evaluation: evaluation as NonNullable<ReturnType<typeof evaluateSnakeAdvance>>,
      player,
    });
  }

  const collisions = resolveMultiplayerSnakeCollisions({
    grid: runtime.grid,
    blackHoles: [],
    starBeasts: [],
    currentTime: 0,
  }, evaluations.map((entry) => ({
    playerId: entry.playerId,
    direction: entry.direction,
    evaluation: entry.evaluation!,
    snake: entry.player.snake,
    willCommit: entry.player.lifecycle.phase === "playing",
  })));

  for (const entry of evaluations) {
    const result = collisions.find((candidate) => candidate.playerId === entry.playerId);

    if (!result || entry.player.lifecycle.phase !== "playing") {
      continue;
    }

    if (result.collision.kind !== "none") {
      finishPvpPlayer(entry.player, result.collision.kind === "wall" ? "wall" : result.collision.reason);
      continue;
    }

    entry.player.movement.direction = entry.direction;
    const moveResult = commitSnakeMovement(
      {
        grid: runtime.grid,
        snake: entry.player.snake,
        snakeOccupancy: entry.player.movement.snakeOccupancy,
        pendingGrowthSegments: entry.player.movement.pendingGrowthSegments,
      },
      entry.evaluation!,
    );

    entry.player.movement.pendingGrowthSegments = moveResult.pendingGrowthSegments;

    if (!result.pickupConflict && moveResult.pickup?.kind === "food") {
      runtime.foods.splice(moveResult.pickup.index, 1);
      entry.player.progress.coresEaten += 1;
      entry.player.progress.score += 10;
    }
  }

  refillPvpFoods(runtime);

  const outcome = resolvePvpOutcome(runtime);

  if (outcome !== null) {
    runtime.match.phase = "gameOver";
    runtime.match.winnerId = outcome.winner === "draw" ? null : outcome.winner;
  }

  return {
    snapshot: createPvpSnapshot(runtime),
    gameOver: outcome === null ? null : {
      type: "gameOver",
      winner: outcome.winner,
      reason: outcome.reason,
      finalTick: runtime.match.tick,
    },
  };
}

export function createPvpSnapshot(runtime: PvpRuntimeState): PvpGameSnapshot {
  const alive = {
    p1: runtime.players[0].lifecycle.phase === "playing",
    p2: runtime.players[1].lifecycle.phase === "playing",
  } satisfies PvpAliveMap;
  const snakeHeads = {
    p1: toPvpGridCell(runtime.players[0].snake[0] ?? null),
    p2: toPvpGridCell(runtime.players[1].snake[0] ?? null),
  };

  return {
    phase: runtime.match.phase === "gameOver" ? "finished" : "playing",
    tick: runtime.match.tick,
    stateHash: hashPvpSnapshot({
      tick: runtime.match.tick,
      phase: runtime.match.phase === "gameOver" ? "finished" : "playing",
      winnerId: runtime.match.winnerId,
      players: runtime.players,
      foods: runtime.foods,
    }),
    snakeHeads,
    alive,
  };
}

export function hashPvpSnapshot(input: {
  readonly tick: number;
  readonly phase: RoomPhase;
  readonly winnerId: PlayerSlot | null;
  readonly players: readonly PvpPlayerRuntime[];
  readonly foods: readonly GridCell[];
}): PvpStateHash {
  const parts: string[] = [
    `tick:${input.tick}`,
    `phase:${input.phase}`,
    `winner:${input.winnerId ?? "null"}`,
  ];

  for (const player of input.players) {
    parts.push(
      `${player.id}:${player.lifecycle.phase}:${player.lifecycle.deathReason ?? "null"}:${player.progress.score}:${player.progress.coresEaten}:${player.movement.direction}`,
      player.snake.map((cell) => `${cell.column},${cell.row}`).join("|"),
    );
  }

  parts.push(
    "foods",
    input.foods.map((cell) => `${cell.column},${cell.row}`).join("|"),
  );

  return `pvp:${hashText(parts.join(";"))}`;
}

export function getPvpOutcome(runtime: PvpRuntimeState): {
  readonly winner: PvpWinner;
  readonly reason: GameOverReason;
} | null {
  return resolvePvpOutcome(runtime);
}

export function createPvpGridSummary(runtime: PvpRuntimeState): Readonly<{
  readonly columns: number;
  readonly rows: number;
  readonly cellSize: number;
}> {
  return {
    columns: runtime.grid.columns,
    rows: runtime.grid.rows,
    cellSize: runtime.grid.cellSize,
  };
}

function createPvpPlayer(grid: GridMetrics, id: PlayerSlot, head: GridCell, direction: Direction): PvpPlayerRuntime {
  const snake = createStartingSnake(head, direction);
  const player: PvpPlayerRuntime = {
    id,
    snake,
    movement: {
      direction,
      directionQueue: [],
      snakeOccupancy: new Uint8Array(grid.columns * grid.rows),
      pendingGrowthSegments: 0,
    },
    progress: {
      score: 0,
      coresEaten: 0,
    },
    lifecycle: {
      phase: "playing",
      deathReason: null,
    },
  };

  rebuildPlayerSnakeOccupancy(player, grid);
  return player;
}

function createPvpFoods(runtime: PvpRuntimeState): GridCell[] {
  const foods: GridCell[] = [];

  while (foods.length < PVP_TARGET_FOOD_COUNT) {
    const candidate = spawnFoodCell(
      buildFoodSpawnContext({
        grid: runtime.grid,
        blackHoles: [],
        snake: runtime.players.flatMap((player) => player.snake),
        foods,
        starAttractors: [],
        starBeasts: [],
        starCores: runtime.starCores,
        includeStarAttractors: false,
      }),
      runtime.random,
    );

    if (!candidate) {
      break;
    }

    foods.push(candidate);
  }

  return foods;
}

function refillPvpFoods(runtime: PvpRuntimeState): void {
  while (runtime.foods.length < PVP_TARGET_FOOD_COUNT) {
    const candidate = spawnFoodCell(
      buildFoodSpawnContext({
        grid: runtime.grid,
        blackHoles: [],
        snake: runtime.players.flatMap((player) => player.snake),
        foods: runtime.foods,
        starAttractors: [],
        starBeasts: [],
        starCores: runtime.starCores,
        includeStarAttractors: false,
      }),
      runtime.random,
    );

    if (!candidate) {
      break;
    }

    runtime.foods.push(candidate);
  }
}

function buildPvpMovementContext(runtime: PvpRuntimeState, player: PvpPlayerRuntime, includeOpponentBodies: boolean) {
  const opponentBodies = includeOpponentBodies
    ? runtime.players
      .filter((candidate) => candidate.id !== player.id && candidate.lifecycle.phase === "playing")
      .flatMap((candidate) => candidate.snake)
    : undefined;

  return {
    grid: runtime.grid,
    snake: player.snake,
    foods: runtime.foods,
    starCores: runtime.starCores,
    starAttractors: [],
    snakeOccupancy: player.movement.snakeOccupancy,
    pendingGrowthSegments: player.movement.pendingGrowthSegments,
    includeStarAttractors: false,
    extraBlockedCells: opponentBodies,
  };
}

function resolvePvpOutcome(runtime: PvpRuntimeState): {
  readonly winner: PvpWinner;
  readonly reason: GameOverReason;
} | null {
  const alivePlayers = runtime.players.filter((player) => player.lifecycle.phase === "playing");

  if (alivePlayers.length > 1) {
    return null;
  }

  if (alivePlayers.length === 0) {
    return {
      winner: "draw",
      reason: "draw",
    };
  }

  return {
    winner: alivePlayers[0]?.id ?? null,
    reason: runtime.players.find((player) => player.lifecycle.phase === "gameOver")?.lifecycle.deathReason ?? "unknown",
  };
}

function finishPvpPlayer(player: PvpPlayerRuntime, reason: DeathReason): void {
  player.lifecycle.phase = "gameOver";
  player.lifecycle.deathReason = reason;
  player.movement.directionQueue.length = 0;
}

function getPvpPlayerInputState(inputState: PvpInputState, playerId: PlayerSlot): PvpPlayerInputState {
  const existing = inputState.playersById.get(playerId);

  if (existing) {
    return existing;
  }

  const created = createPvpPlayerInputState(playerId);
  inputState.playersById.set(playerId, created);
  return created;
}

function getPvpStartingHead(columns: number, rows: number, playerId: PlayerSlot): GridCell {
  const isFirst = playerId === "p1";
  return {
    column: isFirst ? Math.max(PVP_STARTING_LENGTH, Math.floor(columns * 0.32)) : Math.min(columns - PVP_STARTING_LENGTH - 1, Math.ceil(columns * 0.68)),
    row: Math.floor(rows / 2),
  };
}

function createStartingSnake(head: GridCell, direction: Direction): GridCell[] {
  const delta = direction === "right"
    ? { column: -1, row: 0 }
    : direction === "left"
      ? { column: 1, row: 0 }
      : direction === "down"
        ? { column: 0, row: -1 }
        : { column: 0, row: 1 };

  return Array.from({ length: PVP_STARTING_LENGTH }, (_, index) => ({
    column: head.column + delta.column * index,
    row: head.row + delta.row * index,
  }));
}

function rebuildPlayerSnakeOccupancy(player: PvpPlayerRuntime, grid: GridMetrics): void {
  const cellCount = grid.columns * grid.rows;

  if (player.movement.snakeOccupancy.length !== cellCount) {
    player.movement.snakeOccupancy = new Uint8Array(cellCount);
  } else {
    player.movement.snakeOccupancy.fill(0);
  }

  for (const segment of player.snake) {
    const index = segment.row * grid.columns + segment.column;
    player.movement.snakeOccupancy[index] = 1;
  }
}

function insertPvpInputRecord(inputs: PvpPlayerInputRecord[], record: PvpPlayerInputRecord): void {
  const insertionIndex = inputs.findIndex((existing) => (
    existing.tick > record.tick
    || (existing.tick === record.tick && existing.seq > record.seq)
  ));

  if (insertionIndex === -1) {
    inputs.push(record);
    return;
  }

  inputs.splice(insertionIndex, 0, record);
}

function findPreviousPvpInput(
  inputs: readonly PvpPlayerInputRecord[],
  tick: number,
  seq: number,
): PvpPlayerInputRecord | undefined {
  let previous: PvpPlayerInputRecord | undefined;

  for (const input of inputs) {
    if (input.tick > tick || (input.tick === tick && input.seq >= seq)) {
      break;
    }

    previous = input;
  }

  return previous;
}

function isStalePvpInput(messageTick: number, lastTick: number, inputDelayTicks: number): boolean {
  return lastTick >= 0 && messageTick + inputDelayTicks < lastTick;
}

function toPvpGridCell(cell: GridCell | null): PvpGridCell | null {
  if (cell === null) {
    return null;
  }

  return {
    column: cell.column,
    row: cell.row,
  };
}

function hashText(input: string): string {
  let hashA = 0x811c9dc5;
  let hashB = 0x27d4eb2d;

  for (let index = 0; index < input.length; index += 1) {
    const code = input.charCodeAt(index);
    hashA ^= code;
    hashA = Math.imul(hashA, 0x01000193);
    hashB ^= code;
    hashB = Math.imul(hashB, 0x85ebca6b);
  }

  return `${(hashA >>> 0).toString(16).padStart(8, "0")}${(hashB >>> 0).toString(16).padStart(8, "0")}`;
}
