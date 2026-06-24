import type { SafeSpawnZone } from "./progression";
import type { GridCell, StarAttractor, StarBeast, StarCore } from "./types";

export interface BlackHoleSpawnBlockedCellsInput {
  starBeasts: readonly StarBeast[];
  starAttractors: readonly StarAttractor[];
  starCores: readonly StarCore[];
  includeStarAttractors: boolean;
  extraBlockedCells?: readonly GridCell[];
}

export interface BlackHoleSpawnDangerZonesInput {
  starBeasts: readonly StarBeast[];
  birthCell: GridCell;
}

export function getStarCoreCells(starCores: readonly StarCore[]): GridCell[] {
  return starCores.map((core) => ({
    column: Math.floor(core.x),
    row: Math.floor(core.y),
  }));
}

export function getStarAttractorCells(
  starAttractors: readonly StarAttractor[],
  enabled: boolean,
): GridCell[] {
  return enabled ? starAttractors.map((attractor) => attractor.cell) : [];
}

export function getStarBeastCells(starBeasts: readonly StarBeast[]): GridCell[] {
  return starBeasts.flatMap((beast) => beast.body);
}

export function getBlackHoleSpawnBlockedCells(input: BlackHoleSpawnBlockedCellsInput): GridCell[] {
  return [
    ...getStarBeastCells(input.starBeasts),
    ...getStarAttractorCells(input.starAttractors, input.includeStarAttractors),
    ...getStarCoreCells(input.starCores),
    ...(input.extraBlockedCells ?? []),
  ];
}

export function getBlackHoleSpawnDangerZones(input: BlackHoleSpawnDangerZonesInput): SafeSpawnZone[] {
  return input.starBeasts.map((beast) => ({
    center: beast.body[0] ?? input.birthCell,
    radius: Math.max(3, Math.ceil(beast.length * 0.45)),
  }));
}
