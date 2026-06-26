import { ROOM_PHASES } from "./protocol.js";
export const ROOM_PHASE_TRANSITIONS = {
    waiting: ["ready", "finished"],
    ready: ["waiting", "countdown", "finished"],
    countdown: ["ready", "playing", "finished"],
    playing: ["finished"],
    finished: ["waiting"],
};
export function isValidRoomPhaseTransition(from, to) {
    return from === to || ROOM_PHASE_TRANSITIONS[from].includes(to);
}
export function getNextRoomPhases(from) {
    return ROOM_PHASE_TRANSITIONS[from];
}
export function assertNeverRoomPhase(phase) {
    throw new Error(`Unhandled room phase: ${phase}`);
}
export function getRoomPhaseAfterReadyChange(current) {
    if (current.phase === "playing" || current.phase === "finished" || current.phase === "countdown") {
        return current.phase;
    }
    if (current.players.length === 2 && current.players.every((player) => player.ready && player.connected)) {
        return "ready";
    }
    return "waiting";
}
export function getRoomPhaseAfterCountdown(current) {
    if (current.phase !== "countdown") {
        return current.phase;
    }
    return "playing";
}
export function getRoomPhaseAfterGameOver(current) {
    if (current.phase !== "playing" && current.phase !== "countdown") {
        return current.phase;
    }
    return "finished";
}
export function isTerminalRoomPhase(phase) {
    return phase === "finished";
}
export function isKnownRoomPhase(value) {
    return ROOM_PHASES.includes(value);
}
