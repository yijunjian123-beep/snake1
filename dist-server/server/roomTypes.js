export const CONNECTION_STATES = [
    "idle",
    "in_queue",
    "in_room",
    "countdown",
    "playing",
    "finished",
    "disconnected",
];
export const ROOM_TYPES = ["matchmaking", "private"];
export function countConnectedRoomPlayers(players) {
    return players.reduce((count, player) => count + (player.connected ? 1 : 0), 0);
}
export function toProtocolRoomPlayers(players) {
    return players.map((player) => ({
        playerId: player.playerId,
        playerSlot: player.playerSlot,
        nickname: player.nickname,
        ready: player.ready,
        connected: player.connected,
    }));
}
export function findRoomPlayerBySlot(players, playerSlot) {
    return players.find((player) => player.playerSlot === playerSlot);
}
export function findRoomPlayerById(players, playerId) {
    return players.find((player) => player.playerId === playerId);
}
