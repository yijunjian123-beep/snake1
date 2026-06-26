import { randomUUID } from "node:crypto";

import type WebSocket from "ws";

import type { PlayerSlot, PvpPlayerId, PvpSessionToken, RoomCode } from "../src/pvp/net/protocol.js";
import type { ConnectionState } from "./roomTypes.js";

export interface PvpConnection {
  playerId: PvpPlayerId;
  sessionToken: PvpSessionToken;
  socket: WebSocket | null;
  connectedAt: number;
  lastSeenAt: number;
  disconnectedAt: number | null;
  messageWindowStartedAt: number;
  messageCountInWindow: number;
  nickname?: string;
  status: ConnectionState;
  roomId: string | null;
  roomCode?: RoomCode;
  playerSlot?: PlayerSlot;
  queueJoinedAt?: number;
}

export class ConnectionRegistry {
  readonly #connectionsByPlayerId = new Map<PvpPlayerId, PvpConnection>();
  readonly #connectionsBySessionToken = new Map<PvpSessionToken, PvpConnection>();

  get size(): number {
    let activeCount = 0;

    for (const connection of this.#connectionsByPlayerId.values()) {
      if (connection.socket !== null) {
        activeCount += 1;
      }
    }

    return activeCount;
  }

  add(socket: WebSocket, now: number = Date.now()): PvpConnection {
    const connection: PvpConnection = {
      playerId: createPlayerId(),
      sessionToken: createSessionToken(),
      socket,
      connectedAt: now,
      lastSeenAt: now,
      disconnectedAt: null,
      messageWindowStartedAt: now,
      messageCountInWindow: 0,
      status: "idle",
      roomId: null,
    };

    this.#connectionsByPlayerId.set(connection.playerId, connection);
    this.#connectionsBySessionToken.set(connection.sessionToken, connection);
    return connection;
  }

  isCurrent(connection: PvpConnection): boolean {
    return this.#connectionsByPlayerId.get(connection.playerId) === connection;
  }

  remove(connection: PvpConnection): PvpConnection | undefined {
    if (!this.isCurrent(connection)) {
      return undefined;
    }

    this.#connectionsByPlayerId.delete(connection.playerId);
    this.#connectionsBySessionToken.delete(connection.sessionToken);
    return connection;
  }

  touch(connection: PvpConnection, now: number = Date.now()): void {
    if (!this.isCurrent(connection)) {
      return;
    }

    connection.lastSeenAt = now;
  }

  disconnect(connection: PvpConnection, now: number = Date.now()): boolean {
    if (!this.isCurrent(connection)) {
      return false;
    }

    connection.socket = null;
    connection.lastSeenAt = now;
    connection.disconnectedAt = now;
    return true;
  }

  restoreSocket(connection: PvpConnection, sessionToken: PvpSessionToken, now: number = Date.now()): PvpConnection | undefined {
    const restored = this.#connectionsBySessionToken.get(sessionToken);

    if (restored === undefined || restored === connection) {
      return undefined;
    }

    if (!this.isCurrent(connection)) {
      return undefined;
    }

    const { socket: restoredSocket, ...restoredState } = restored;

    this.#connectionsByPlayerId.delete(connection.playerId);
    this.#connectionsBySessionToken.delete(connection.sessionToken);
    this.#connectionsByPlayerId.delete(restored.playerId);
    this.#connectionsBySessionToken.delete(restored.sessionToken);

    connection.playerId = restoredState.playerId;
    connection.sessionToken = restoredState.sessionToken;
    connection.connectedAt = restoredState.connectedAt;
    connection.lastSeenAt = now;
    connection.disconnectedAt = null;
    connection.messageWindowStartedAt = now;
    connection.messageCountInWindow = 0;
    connection.nickname = restoredState.nickname;
    connection.status = restoredState.status;
    connection.roomId = restoredState.roomId;
    connection.roomCode = restoredState.roomCode;
    connection.playerSlot = restoredState.playerSlot;
    connection.queueJoinedAt = restoredState.queueJoinedAt;

    this.#connectionsByPlayerId.set(connection.playerId, connection);
    this.#connectionsBySessionToken.set(connection.sessionToken, connection);

    if (restoredSocket !== null && restoredSocket !== connection.socket) {
      restoredSocket.close(1000, "reconnected");
    }

    return connection;
  }

  getExpired(now: number, timeoutMs: number): readonly PvpConnection[] {
    return [...this.#connectionsByPlayerId.values()].filter(
      (connection) => connection.socket === null && connection.disconnectedAt !== null && now - connection.disconnectedAt > timeoutMs,
    );
  }

  takeMessageCredit(connection: PvpConnection, maxMessages: number, windowMs: number, now: number = Date.now()): boolean {
    if (!this.isCurrent(connection) || connection.socket === null) {
      return false;
    }

    if (now - connection.messageWindowStartedAt >= windowMs) {
      connection.messageWindowStartedAt = now;
      connection.messageCountInWindow = 0;
    }

    connection.messageCountInWindow += 1;
    return connection.messageCountInWindow <= maxMessages;
  }

  get(playerId: PvpPlayerId): PvpConnection | undefined {
    return this.#connectionsByPlayerId.get(playerId);
  }

  getBySessionToken(sessionToken: PvpSessionToken): PvpConnection | undefined {
    return this.#connectionsBySessionToken.get(sessionToken);
  }

  activeValues(): readonly PvpConnection[] {
    return [...this.#connectionsByPlayerId.values()].filter((connection) => connection.socket !== null);
  }

  values(): readonly PvpConnection[] {
    return [...this.#connectionsByPlayerId.values()];
  }
}

function createPlayerId(): PvpPlayerId {
  return `player_${randomUUID().replaceAll("-", "")}`;
}

function createSessionToken(): PvpSessionToken {
  return `session_${randomUUID().replaceAll("-", "")}`;
}
