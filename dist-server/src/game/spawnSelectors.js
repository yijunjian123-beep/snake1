export function getStarCoreCells(starCores) {
    return starCores.map((core) => ({
        column: Math.floor(core.x),
        row: Math.floor(core.y),
    }));
}
export function getStarAttractorCells(starAttractors, enabled) {
    return enabled ? starAttractors.map((attractor) => attractor.cell) : [];
}
export function getStarBeastCells(starBeasts) {
    return starBeasts.flatMap((beast) => beast.body);
}
export function getBlackHoleSpawnBlockedCells(input) {
    return [
        ...getStarBeastCells(input.starBeasts),
        ...getStarAttractorCells(input.starAttractors, input.includeStarAttractors),
        ...getStarCoreCells(input.starCores),
        ...(input.extraBlockedCells ?? []),
    ];
}
export function getBlackHoleSpawnDangerZones(input) {
    return input.starBeasts.map((beast) => ({
        center: beast.body[0] ?? input.birthCell,
        radius: Math.max(3, Math.ceil(beast.length * 0.45)),
    }));
}
