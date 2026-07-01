export const CARDINAL_DIRECTIONS = ["up", "right", "down", "left"];
export const DIRECTION_DELTAS = {
    up: { column: 0, row: -1 },
    right: { column: 1, row: 0 },
    down: { column: 0, row: 1 },
    left: { column: -1, row: 0 },
};
export const OPPOSITE_DIRECTIONS = {
    up: "down",
    right: "left",
    down: "up",
    left: "right",
};
export const PERPENDICULAR_PAIRS = {
    up: ["left", "right"],
    right: ["up", "down"],
    down: ["right", "left"],
    left: ["down", "up"],
};
export function getDirectionDelta(direction) {
    return DIRECTION_DELTAS[direction];
}
export function stepCell(cell, direction) {
    const delta = getDirectionDelta(direction);
    return {
        column: cell.column + delta.column,
        row: cell.row + delta.row,
    };
}
export function turnLeft(direction) {
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
export function turnRight(direction) {
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
