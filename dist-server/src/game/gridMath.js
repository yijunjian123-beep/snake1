export function cellKey(cell) {
    return `${cell.column}:${cell.row}`;
}
export function cellIndex(cell, grid) {
    return cell.row * grid.columns + cell.column;
}
export function getCellIndex(cell, grid) {
    if (!isInsideGrid(cell, grid)) {
        return null;
    }
    return cellIndex(cell, grid);
}
export function cellsMatch(left, right) {
    return left.column === right.column && left.row === right.row;
}
export function chebyshevDistance(left, right) {
    return Math.max(Math.abs(left.column - right.column), Math.abs(left.row - right.row));
}
export function manhattanDistance(left, right) {
    return Math.abs(left.column - right.column) + Math.abs(left.row - right.row);
}
export function isInsideGrid(cell, grid) {
    return cell.column >= 0 && cell.row >= 0 && cell.column < grid.columns && cell.row < grid.rows;
}
export function isWithinChebyshevRadius(cell, center, radius) {
    if (radius <= 0) {
        return false;
    }
    return chebyshevDistance(cell, center) <= radius;
}
export function isCellInsideZone(cell, zone) {
    return isWithinChebyshevRadius(cell, zone.center, Math.max(0, Math.floor(zone.radius)));
}
