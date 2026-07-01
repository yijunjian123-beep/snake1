export function collectExpiredRoomIds(rooms, config, now = Date.now()) {
    const finishedRoomIds = [];
    const expiredPrivateRoomIds = [];
    for (const room of rooms) {
        if (room.phase === "finished" && room.finishedAt !== undefined) {
            if (now - room.finishedAt >= config.finishedRoomTtlMs) {
                finishedRoomIds.push(room.roomId);
            }
            continue;
        }
        if (room.phase === "waiting" || room.phase === "ready") {
            const connectedPlayers = room.players.filter((player) => player.connected).length;
            const timeoutMs = connectedPlayers === 0 ? config.reconnectGraceMs : config.privateRoomWaitTimeoutMs;
            if (now - room.updatedAt >= timeoutMs) {
                expiredPrivateRoomIds.push(room.roomId);
            }
        }
    }
    return {
        finishedRoomIds,
        expiredPrivateRoomIds,
    };
}
