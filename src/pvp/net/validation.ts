import {
  DIRECTIONS,
  ERROR_CODES,
  GAME_OVER_REASONS,
  PLAYER_SLOTS,
  PVP_LIMITS,
  ROOM_PHASES,
} from "./protocol.js";
import type {
  ClientToServerMessage,
  Direction,
  ErrorCode,
  GameOverReason,
  PlayerSlot,
  PvpAliveMap,
  PvpGridCell,
  PvpPlayerId,
  PvpRoomPlayer,
  PvpSessionToken,
  PvpSnakeHeads,
  PvpStateHash,
  PvpWinner,
  RoomCode,
  RoomPhase,
  ServerToClientMessage,
} from "./protocol.js";

export type ValidationResult<T> =
  | { readonly ok: true; readonly value: T }
  | { readonly ok: false; readonly error: string };

const ROOM_CODE_PATTERN = /^[A-Z0-9]+$/;
const PLAYER_ID_PATTERN = /^[A-Za-z0-9_-]+$/;
const SESSION_TOKEN_PATTERN = /^[A-Za-z0-9._-]+$/;
const STATE_HASH_PATTERN = /^[A-Za-z0-9:_-]+$/;

function pass<T>(value: T): ValidationResult<T> {
  return { ok: true, value };
}

function fail<T>(error: string): ValidationResult<T> {
  return { ok: false, error };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function hasStringType(value: Record<string, unknown>, expectedType: string): boolean {
  return value.type === expectedType;
}

function isStringWithin(value: unknown, minLength: number, maxLength: number): value is string {
  return typeof value === "string" && value.length >= minLength && value.length <= maxLength;
}

function isOptionalStringWithin(value: unknown, maxLength: number): value is string | undefined {
  return value === undefined || (typeof value === "string" && value.length > 0 && value.length <= maxLength);
}

function isBoundedInteger(value: unknown, min: number, max: number): value is number {
  return typeof value === "number" && Number.isInteger(value) && value >= min && value <= max;
}

function isClockTime(value: unknown): value is number {
  return isBoundedInteger(value, 0, PVP_LIMITS.maxClockTime);
}

function isNonNegativeSafeInteger(value: unknown): value is number {
  return isBoundedInteger(value, 0, Number.MAX_SAFE_INTEGER);
}

export function isDirection(value: unknown): value is Direction {
  return typeof value === "string" && DIRECTIONS.includes(value as Direction);
}

export function isPlayerSlot(value: unknown): value is PlayerSlot {
  return typeof value === "string" && PLAYER_SLOTS.includes(value as PlayerSlot);
}

export function isRoomPhase(value: unknown): value is RoomPhase {
  return typeof value === "string" && ROOM_PHASES.includes(value as RoomPhase);
}

export function isErrorCode(value: unknown): value is ErrorCode {
  return typeof value === "string" && ERROR_CODES.includes(value as ErrorCode);
}

export function isGameOverReason(value: unknown): value is GameOverReason {
  return typeof value === "string" && GAME_OVER_REASONS.includes(value as GameOverReason);
}

export function isValidTick(value: unknown): value is number {
  return isBoundedInteger(value, PVP_LIMITS.minTick, PVP_LIMITS.maxTick);
}

export function isValidInputSeq(value: unknown): value is number {
  return isBoundedInteger(value, PVP_LIMITS.minSeq, PVP_LIMITS.maxSeq);
}

export function isValidRoomCode(value: unknown): value is RoomCode {
  return (
    isStringWithin(value, PVP_LIMITS.minRoomCodeLength, PVP_LIMITS.maxRoomCodeLength)
    && ROOM_CODE_PATTERN.test(value)
  );
}

export function isValidPlayerId(value: unknown): value is PvpPlayerId {
  return (
    isStringWithin(value, PVP_LIMITS.minPlayerIdLength, PVP_LIMITS.maxPlayerIdLength)
    && PLAYER_ID_PATTERN.test(value)
  );
}

export function isValidSessionToken(value: unknown): value is PvpSessionToken {
  return (
    isStringWithin(value, PVP_LIMITS.minSessionTokenLength, PVP_LIMITS.maxSessionTokenLength)
    && SESSION_TOKEN_PATTERN.test(value)
  );
}

export function isValidStateHash(value: unknown): value is PvpStateHash {
  return (
    isStringWithin(value, PVP_LIMITS.minStateHashLength, PVP_LIMITS.maxStateHashLength)
    && STATE_HASH_PATTERN.test(value)
  );
}

export function isWinner(value: unknown): value is PvpWinner {
  return value === null || value === "draw" || isPlayerSlot(value);
}

function isClientVersion(value: unknown): value is string {
  return isStringWithin(value, 1, PVP_LIMITS.maxClientVersionLength);
}

function isNickname(value: unknown): value is string | undefined {
  return isOptionalStringWithin(value, PVP_LIMITS.maxNicknameLength);
}

function isMessageText(value: unknown): value is string | undefined {
  return value === undefined || (typeof value === "string" && value.length <= 240);
}

function isValidGridCell(value: unknown): value is PvpGridCell {
  if (!isRecord(value)) {
    return false;
  }

  return (
    isBoundedInteger(value.column, 0, PVP_LIMITS.maxBoardCoordinate)
    && isBoundedInteger(value.row, 0, PVP_LIMITS.maxBoardCoordinate)
  );
}

function isSnakeHeads(value: unknown): value is PvpSnakeHeads {
  if (!isRecord(value)) {
    return false;
  }

  return PLAYER_SLOTS.every((slot) => value[slot] === null || isValidGridCell(value[slot]));
}

function isAliveMap(value: unknown): value is PvpAliveMap {
  if (!isRecord(value)) {
    return false;
  }

  return PLAYER_SLOTS.every((slot) => typeof value[slot] === "boolean");
}

function isRoomPlayer(value: unknown): value is PvpRoomPlayer {
  if (!isRecord(value)) {
    return false;
  }

  return (
    isValidPlayerId(value.playerId)
    && isPlayerSlot(value.playerSlot)
    && isNickname(value.nickname)
    && typeof value.ready === "boolean"
    && typeof value.connected === "boolean"
  );
}

function isRoomPlayerList(value: unknown): value is readonly PvpRoomPlayer[] {
  if (!Array.isArray(value) || value.length < 1 || value.length > PLAYER_SLOTS.length) {
    return false;
  }

  const seenSlots = new Set<PlayerSlot>();
  const seenIds = new Set<PvpPlayerId>();

  for (const player of value) {
    if (!isRoomPlayer(player) || seenSlots.has(player.playerSlot) || seenIds.has(player.playerId)) {
      return false;
    }

    seenSlots.add(player.playerSlot);
    seenIds.add(player.playerId);
  }

  return true;
}

function isPlayerSlots(value: unknown): value is readonly PlayerSlot[] {
  if (!Array.isArray(value) || value.length !== PLAYER_SLOTS.length) {
    return false;
  }

  const seenSlots = new Set<PlayerSlot>();

  for (const slot of value) {
    if (!isPlayerSlot(slot) || seenSlots.has(slot)) {
      return false;
    }

    seenSlots.add(slot);
  }

  return true;
}

function isOptionalRoomCode(value: unknown): value is RoomCode | undefined {
  return value === undefined || isValidRoomCode(value);
}

function isOptionalPlayerSlot(value: unknown): value is PlayerSlot | undefined {
  return value === undefined || isPlayerSlot(value);
}

function isOptionalRoomPhase(value: unknown): value is RoomPhase | undefined {
  return value === undefined || isRoomPhase(value);
}

function isOptionalStateHash(value: unknown): value is PvpStateHash | undefined {
  return value === undefined || isValidStateHash(value);
}

function isOptionalSessionToken(value: unknown): value is PvpSessionToken | undefined {
  return value === undefined || isValidSessionToken(value);
}

function isOptionalQueuePosition(value: unknown): value is number | undefined {
  return value === undefined || isBoundedInteger(value, 1, PVP_LIMITS.maxQueuePosition);
}

function isOptionalEstimatedWaitMs(value: unknown): value is number | undefined {
  return value === undefined || isBoundedInteger(value, 0, PVP_LIMITS.maxWaitingMs);
}

function isRetryAfterMs(value: unknown): value is number | undefined {
  return value === undefined || isBoundedInteger(value, 0, PVP_LIMITS.maxWaitingMs);
}

function validateClientRecord(message: Record<string, unknown>): boolean {
  switch (message.type) {
    case "hello":
      return isClientVersion(message.clientVersion)
        && isNickname(message.nickname)
        && isOptionalSessionToken(message.sessionToken);
    case "createRoom":
    case "leaveRoom":
    case "matchmakingJoin":
    case "matchmakingCancel":
      return true;
    case "joinRoom":
      return isValidRoomCode(message.roomCode);
    case "ready":
      return typeof message.ready === "boolean";
    case "input":
      return isValidInputSeq(message.seq) && isValidTick(message.tick) && isDirection(message.direction);
    case "resultCandidate":
      return (
        isValidTick(message.tick)
        && isWinner(message.winner)
        && isGameOverReason(message.reason)
        && isOptionalStateHash(message.stateHash)
      );
    case "ping":
      return isClockTime(message.clientTime);
    default:
      return false;
  }
}

function validateServerRecord(message: Record<string, unknown>): boolean {
  switch (message.type) {
    case "welcome":
      return isValidPlayerId(message.playerId) && isValidSessionToken(message.sessionToken) && isClockTime(message.serverTime);
    case "roomCreated":
    case "matchFound":
      return isValidRoomCode(message.roomCode) && isPlayerSlot(message.playerSlot);
    case "roomJoined":
      return isValidRoomCode(message.roomCode) && isPlayerSlot(message.playerSlot) && isRoomPlayerList(message.players);
    case "roomState":
      return isValidRoomCode(message.roomCode) && isRoomPhase(message.phase) && isRoomPlayerList(message.players);
    case "queueState":
      return (
        isOptionalQueuePosition(message.position)
        && isBoundedInteger(message.waitingMs, 0, PVP_LIMITS.maxWaitingMs)
        && isOptionalEstimatedWaitMs(message.estimatedWaitMs)
        && isBoundedInteger(message.onlineCount, 0, PVP_LIMITS.maxOnlineCount)
        && isBoundedInteger(message.queuedCount, 0, PVP_LIMITS.maxQueuedCount)
      );
    case "countdown":
      return isBoundedInteger(message.startsInMs, 0, PVP_LIMITS.maxCountdownMs);
    case "gameStart":
      return (
        isNonNegativeSafeInteger(message.seed)
        && isValidTick(message.startTick)
        && isBoundedInteger(message.tickRate, PVP_LIMITS.minTickRate, PVP_LIMITS.maxTickRate)
        && isPlayerSlots(message.playerSlots)
        && isBoundedInteger(message.inputDelayTicks, 0, PVP_LIMITS.maxInputDelayTicks)
      );
    case "peerInput":
      return (
        isPlayerSlot(message.playerSlot)
        && isValidInputSeq(message.seq)
        && isValidTick(message.tick)
        && isDirection(message.direction)
      );
    case "snapshot":
      return isRoomPhase(message.phase)
        && isValidTick(message.tick)
        && isValidStateHash(message.stateHash)
        && isSnakeHeads(message.snakeHeads)
        && isAliveMap(message.alive);
    case "gameOver":
      return isWinner(message.winner) && isGameOverReason(message.reason) && isValidTick(message.finalTick);
    case "opponentLeft":
      return true;
    case "reconnectResult":
      return (
        typeof message.ok === "boolean"
        && isOptionalRoomCode(message.roomCode)
        && isOptionalPlayerSlot(message.playerSlot)
        && isOptionalRoomPhase(message.phase)
      );
    case "error":
      return isErrorCode(message.code) && typeof message.message === "string" && message.message.length > 0 && message.message.length <= 240;
    case "pong":
      return isClockTime(message.clientTime) && isClockTime(message.serverTime);
    case "serverShutdown":
      return hasStringType(message, "serverShutdown") && isMessageText(message.message) && isRetryAfterMs(message.retryAfterMs);
    default:
      return false;
  }
}

export function validateClientMessage(value: unknown): ValidationResult<ClientToServerMessage> {
  if (!isRecord(value)) {
    return fail("message must be an object");
  }

  if (typeof value.type !== "string") {
    return fail("message type must be a string");
  }

  if (!validateClientRecord(value)) {
    return fail(`invalid client message: ${value.type}`);
  }

  return pass(value as unknown as ClientToServerMessage);
}

export function validateServerMessage(value: unknown): ValidationResult<ServerToClientMessage> {
  if (!isRecord(value)) {
    return fail("message must be an object");
  }

  if (typeof value.type !== "string") {
    return fail("message type must be a string");
  }

  if (!validateServerRecord(value)) {
    return fail(`invalid server message: ${value.type}`);
  }

  return pass(value as unknown as ServerToClientMessage);
}

export function isClientToServerMessage(value: unknown): value is ClientToServerMessage {
  return validateClientMessage(value).ok;
}

export function isServerToClientMessage(value: unknown): value is ServerToClientMessage {
  return validateServerMessage(value).ok;
}
