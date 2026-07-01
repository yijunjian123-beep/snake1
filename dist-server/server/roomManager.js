import { randomInt, randomUUID } from "node:crypto";
const ROOM_CODE_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
const ROOM_CODE_LENGTH = 6;
const MAX_ROOM_CODE_ATTEMPTS = 32;
const PVP_SEED_MAX = 1_000_000_000;
export class RoomManager {
    #roomsById = new Map();
    #roomIdByCode = new Map();
    #roomIdByPlayerId = new Map();
    #tickRate;
    #inputDelayTicks;
    constructor(config) {
        this.#tickRate = config.tickRate;
        this.#inputDelayTicks = config.inputDelayTicks;
    }
    get size() {
        return this.#roomsById.size;
    }
    values() {
        return [...this.#roomsById.values()];
    }
    get(roomId) {
        return this.#roomsById.get(roomId);
    }
    getByCode(roomCode) {
        const roomId = this.#roomIdByCode.get(roomCode);
        return roomId === undefined ? undefined : this.#roomsById.get(roomId);
    }
    getByPlayerId(playerId) {
        const roomId = this.#roomIdByPlayerId.get(playerId);
        return roomId === undefined ? undefined : this.#roomsById.get(roomId);
    }
    createMatchmakingRoom(firstPlayer, secondPlayer, now = Date.now()) {
        return this.#createRoom("matchmaking", [
            this.#createRoomPlayer(firstPlayer, "p1", true),
            this.#createRoomPlayer(secondPlayer, "p2", true),
        ], now);
    }
    createPrivateRoom(owner, now = Date.now()) {
        return this.#createRoom("private", [
            this.#createRoomPlayer(owner, "p1", false),
        ], now);
    }
    joinPrivateRoom(roomCode, guest, now = Date.now()) {
        const room = this.getByCode(roomCode);
        if (room === undefined || room.roomType !== "private") {
            return { ok: false, code: "room_not_found" };
        }
        if (room.players.length >= 2) {
            return { ok: false, code: "room_full" };
        }
        const player = this.#createRoomPlayer(guest, "p2", false);
        room.players.push(player);
        room.updatedAt = now;
        this.#roomIdByPlayerId.set(guest.playerId, room.roomId);
        return {
            ok: true,
            room,
            playerSlot: player.playerSlot,
        };
    }
    updatePlayerReady(playerId, ready, now = Date.now()) {
        const room = this.getByPlayerId(playerId);
        if (room === undefined) {
            return undefined;
        }
        const player = room.players.find((candidate) => candidate.playerId === playerId);
        if (player === undefined) {
            return undefined;
        }
        player.ready = ready;
        room.phase = room.players.some((candidate) => candidate.ready) ? "ready" : "waiting";
        room.updatedAt = now;
        return room;
    }
    updatePlayerNickname(playerId, nickname, now = Date.now()) {
        const room = this.getByPlayerId(playerId);
        if (room === undefined) {
            return undefined;
        }
        const player = room.players.find((candidate) => candidate.playerId === playerId);
        if (player === undefined) {
            return undefined;
        }
        player.nickname = nickname;
        room.updatedAt = now;
        return room;
    }
    setPhase(roomId, phase, now = Date.now()) {
        const room = this.#roomsById.get(roomId);
        if (room === undefined) {
            return undefined;
        }
        room.phase = phase;
        room.updatedAt = now;
        if (phase !== "countdown") {
            room.countdownEndsAt = undefined;
        }
        if (phase !== "finished") {
            room.finishedAt = undefined;
        }
        return room;
    }
    startCountdown(roomId, countdownTimer, countdownEndsAt, now = Date.now()) {
        const room = this.setPhase(roomId, "countdown", now);
        if (room === undefined) {
            clearTimeout(countdownTimer);
            return undefined;
        }
        for (const player of room.players) {
            player.ready = true;
        }
        room.countdownTimer = countdownTimer;
        room.countdownEndsAt = countdownEndsAt;
        return room;
    }
    markPlaying(roomId, now = Date.now()) {
        const room = this.setPhase(roomId, "playing", now);
        if (room === undefined) {
            return undefined;
        }
        this.clearCountdown(roomId);
        return room;
    }
    markFinished(roomId, now = Date.now()) {
        const room = this.setPhase(roomId, "finished", now);
        if (room === undefined) {
            return undefined;
        }
        this.clearCountdown(roomId);
        if (room.tickTimer !== null) {
            clearInterval(room.tickTimer);
            room.tickTimer = null;
        }
        room.finishedAt = now;
        return room;
    }
    clearCountdown(roomId) {
        const room = this.#roomsById.get(roomId);
        if (room?.countdownTimer !== null && room?.countdownTimer !== undefined) {
            clearTimeout(room.countdownTimer);
            room.countdownTimer = null;
        }
        if (room !== undefined) {
            room.countdownEndsAt = undefined;
        }
    }
    destroyRoom(roomId) {
        const room = this.#roomsById.get(roomId);
        if (room === undefined) {
            return undefined;
        }
        this.clearCountdown(roomId);
        if (room.tickTimer !== null) {
            clearInterval(room.tickTimer);
            room.tickTimer = null;
        }
        this.#roomsById.delete(roomId);
        this.#roomIdByCode.delete(room.roomCode);
        for (const player of room.players) {
            this.#roomIdByPlayerId.delete(player.playerId);
        }
        return room;
    }
    removePlayer(playerId, now = Date.now()) {
        const room = this.getByPlayerId(playerId);
        if (room === undefined) {
            return undefined;
        }
        const playerIndex = room.players.findIndex((player) => player.playerId === playerId);
        if (playerIndex < 0) {
            return undefined;
        }
        const [removedPlayer] = room.players.splice(playerIndex, 1);
        if (removedPlayer === undefined) {
            return undefined;
        }
        this.#roomIdByPlayerId.delete(playerId);
        room.updatedAt = now;
        if (room.players.length === 0) {
            this.destroyRoom(room.roomId);
            return {
                room,
                removedPlayer,
                remainingPlayers: [],
                roomDestroyed: true,
            };
        }
        return {
            room,
            removedPlayer,
            remainingPlayers: [...room.players],
            roomDestroyed: false,
        };
    }
    #createRoom(roomType, players, now) {
        const room = {
            roomId: randomUUID(),
            roomCode: this.#createRoomCode(),
            roomType,
            players: [...players],
            createdAt: now,
            updatedAt: now,
            phase: "waiting",
            seed: randomInt(PVP_SEED_MAX),
            tickRate: this.#tickRate,
            countdownTimer: null,
            tickTimer: null,
            startTick: 0,
            inputDelayTicks: this.#inputDelayTicks,
        };
        this.#roomsById.set(room.roomId, room);
        this.#roomIdByCode.set(room.roomCode, room.roomId);
        for (const player of room.players) {
            this.#roomIdByPlayerId.set(player.playerId, room.roomId);
        }
        return room;
    }
    #createRoomPlayer(connection, playerSlot, ready) {
        return {
            playerId: connection.playerId,
            playerSlot,
            nickname: connection.nickname,
            ready,
            connected: true,
        };
    }
    #createRoomCode() {
        for (let attempt = 0; attempt < MAX_ROOM_CODE_ATTEMPTS; attempt += 1) {
            let roomCode = "";
            for (let index = 0; index < ROOM_CODE_LENGTH; index += 1) {
                roomCode += ROOM_CODE_ALPHABET[randomInt(ROOM_CODE_ALPHABET.length)];
            }
            if (!this.#roomIdByCode.has(roomCode)) {
                return roomCode;
            }
        }
        return randomUUID().replaceAll("-", "").slice(0, ROOM_CODE_LENGTH).toUpperCase();
    }
}
