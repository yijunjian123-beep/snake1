import type { DeathReason, Direction, GamePhase, GridCell, GridMetrics, MatchMode, StarCore } from "../../game/types.js";
import type { GameOverReason, PvpAliveMap, PvpGridCell, PvpPlayerSnapshot, PvpStateHash, PvpWinner, PlayerSlot, RoomPhase, ServerGameOverMessage } from "../net/protocol.js";
export declare const PVP_BOARD_COLUMNS = 28;
export declare const PVP_BOARD_ROWS = 18;
export declare const PVP_STARTING_LENGTH = 4;
export declare const PVP_TARGET_FOOD_COUNT = 3;
export declare const PVP_TARGET_STEP_MS = 360;
export declare const PVP_MIN_INPUT_INTERVAL_MS = 25;
export declare const PVP_MAX_DIRECTION_QUEUE_LENGTH = 2;
export declare const PVP_OPENING_SAFETY_STEPS = 30;
export declare const PVP_INITIAL_DIRECTIONS: Readonly<Record<PlayerSlot, Direction>>;
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
    startTick: number;
    tick: number;
    movementStep: number;
    winnerId: PlayerSlot | null;
}
export interface PvpRuntimeState {
    grid: GridMetrics;
    match: PvpRuntimeMatch;
    movementTicksPerStep: number;
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
    readonly foods: readonly PvpGridCell[];
    readonly players: readonly PvpPlayerSnapshot[];
}
export declare function createPvpBoardGrid(cellSize?: number, offsetX?: number, offsetY?: number): GridMetrics;
export declare function createPvpRuntime(config: PvpRuntimeConfig): PvpRuntimeState;
export declare function getPvpMovementTicksPerStep(tickRate: number): number;
export declare function getPvpMovementStepForTick(runtime: PvpRuntimeState, tick?: number): number;
export declare function createPvpPlayers(grid?: GridMetrics): [PvpPlayerRuntime, PvpPlayerRuntime];
export declare function createPvpInputState(): PvpInputState;
export declare function createPvpPlayerInputState(playerId: PlayerSlot): PvpPlayerInputState;
export declare function recordPvpInput(inputState: PvpInputState, playerId: PlayerSlot, seq: number, tick: number, direction: Direction, inputDelayTicks: number, now?: number): boolean;
export declare function applyPvpInputsForTick(runtime: PvpRuntimeState, tick: number): void;
export declare function queuePvpDirection(player: PvpPlayerRuntime, direction: Direction): boolean;
export declare function advancePvpTick(runtime: PvpRuntimeState): PvpAdvanceResult;
export declare function createPvpSnapshot(runtime: PvpRuntimeState): PvpGameSnapshot;
export declare function hashPvpSnapshot(input: {
    readonly tick: number;
    readonly phase: RoomPhase;
    readonly winnerId: PlayerSlot | null;
    readonly players: readonly PvpPlayerRuntime[];
    readonly foods: readonly GridCell[];
}): PvpStateHash;
export declare function getPvpOutcome(runtime: PvpRuntimeState): {
    readonly winner: PvpWinner;
    readonly reason: GameOverReason;
} | null;
export declare function createPvpGridSummary(runtime: PvpRuntimeState): Readonly<{
    readonly columns: number;
    readonly rows: number;
    readonly cellSize: number;
}>;
