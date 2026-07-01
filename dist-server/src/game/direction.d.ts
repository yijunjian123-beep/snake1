import type { Direction, GridCell } from "./types.js";
export declare const CARDINAL_DIRECTIONS: readonly Direction[];
export declare const DIRECTION_DELTAS: Readonly<Record<Direction, GridCell>>;
export declare const OPPOSITE_DIRECTIONS: Readonly<Record<Direction, Direction>>;
export declare const PERPENDICULAR_PAIRS: Readonly<Record<Direction, readonly [Direction, Direction]>>;
export declare function getDirectionDelta(direction: Direction): GridCell;
export declare function stepCell(cell: GridCell, direction: Direction): GridCell;
export declare function turnLeft(direction: Direction): Direction;
export declare function turnRight(direction: Direction): Direction;
