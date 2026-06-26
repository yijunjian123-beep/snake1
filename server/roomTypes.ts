import type { PlayerSlot, PvpPlayerId, PvpRoomPlayer, RoomCode, RoomPhase, ServerGameOverMessage, ServerSnapshotMessage } from "../src/pvp/net/protocol.js";
import type {
  PvpInputState,
  PvpPlayerInputRecord,
  PvpPlayerInputState,
  PvpRuntimeState,
} from "../src/pvp/shared/pvpGame.js";

export const CONNECTION_STATES = [
  "idle",
  "in_queue",
  "in_room",
  "countdown",
  "playing",
  "finished",
  "disconnected",
] as const;
export type ConnectionState = (typeof CONNECTION_STATES)[number];

export const ROOM_TYPES = ["matchmaking", "private"] as const;
export type RoomType = (typeof ROOM_TYPES)[number];

export interface ManagedRoomPlayer {
  readonly playerId: PvpPlayerId;
  readonly playerSlot: PlayerSlot;
  nickname?: string;
  ready: boolean;
  connected: boolean;
}

export type RoomPlayerInputState = PvpPlayerInputState;
export type RoomPlayerInputRecord = PvpPlayerInputRecord;
export type RoomInputState = PvpInputState;

export interface ManagedRoom {
  readonly roomId: string;
  readonly roomCode: RoomCode;
  readonly roomType: RoomType;
  readonly players: ManagedRoomPlayer[];
  readonly createdAt: number;
  updatedAt: number;
  phase: RoomPhase;
  readonly seed: number;
  readonly tickRate: number;
  countdownTimer: NodeJS.Timeout | null;
  tickTimer: NodeJS.Timeout | null;
  countdownEndsAt?: number;
  finishedAt?: number;
  readonly startTick: number;
  readonly inputDelayTicks: number;
  inputState?: RoomInputState;
  gameState?: PvpRuntimeState;
  lastSnapshot?: ServerSnapshotMessage;
  lastGameOver?: ServerGameOverMessage;
}

export interface PlayerDepartureResult {
  readonly room: ManagedRoom;
  readonly removedPlayer: ManagedRoomPlayer;
  readonly remainingPlayers: readonly ManagedRoomPlayer[];
  readonly roomDestroyed: boolean;
}

export interface QueueStateSnapshot {
  readonly position?: number;
  readonly waitingMs: number;
  readonly estimatedWaitMs?: number;
  readonly onlineCount: number;
  readonly queuedCount: number;
}

export function countConnectedRoomPlayers(players: readonly ManagedRoomPlayer[]): number {
  return players.reduce((count, player) => count + (player.connected ? 1 : 0), 0);
}

export function toProtocolRoomPlayers(players: readonly ManagedRoomPlayer[]): readonly PvpRoomPlayer[] {
  return players.map((player) => ({
    playerId: player.playerId,
    playerSlot: player.playerSlot,
    nickname: player.nickname,
    ready: player.ready,
    connected: player.connected,
  }));
}

export function findRoomPlayerBySlot(
  players: readonly ManagedRoomPlayer[],
  playerSlot: PlayerSlot,
): ManagedRoomPlayer | undefined {
  return players.find((player) => player.playerSlot === playerSlot);
}

export function findRoomPlayerById(
  players: readonly ManagedRoomPlayer[],
  playerId: PvpPlayerId,
): ManagedRoomPlayer | undefined {
  return players.find((player) => player.playerId === playerId);
}
