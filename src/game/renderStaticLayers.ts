import type { CanvasSize, GridMetrics } from "./types";

export interface StaticLayerDrawers {
  drawBackground(context: CanvasRenderingContext2D, size: CanvasSize): void;
  drawBoard(context: CanvasRenderingContext2D, size: CanvasSize, grid: GridMetrics): void;
}

export interface StaticLayerController {
  readonly backgroundLayer: HTMLCanvasElement;
  readonly boardLayer: HTMLCanvasElement;
  syncBackingStores(size: CanvasSize): void;
  markDirty(): void;
  ensure(grid: GridMetrics, size: CanvasSize): void;
  destroy(): void;
}

export function createStaticLayerController(drawers: StaticLayerDrawers): StaticLayerController {
  const backgroundLayer = document.createElement("canvas");
  const backgroundLayerContext = backgroundLayer.getContext("2d", { alpha: false });
  const boardLayer = document.createElement("canvas");
  const boardLayerContext = boardLayer.getContext("2d", { alpha: false });
  let dirty = true;
  let cachedGridKey = "";

  if (!backgroundLayerContext || !boardLayerContext) {
    throw new Error("Canvas 2D context is not available.");
  }

  const getGridKey = (grid: GridMetrics): string => (
    `${grid.columns}:${grid.rows}:${grid.cellSize}:${grid.offsetX}:${grid.offsetY}`
  );

  return {
    backgroundLayer,
    boardLayer,

    syncBackingStores(size: CanvasSize): void {
      if (backgroundLayer.width !== size.pixelWidth) {
        backgroundLayer.width = size.pixelWidth;
      }

      if (backgroundLayer.height !== size.pixelHeight) {
        backgroundLayer.height = size.pixelHeight;
      }

      if (boardLayer.width !== size.pixelWidth) {
        boardLayer.width = size.pixelWidth;
      }

      if (boardLayer.height !== size.pixelHeight) {
        boardLayer.height = size.pixelHeight;
      }

      backgroundLayerContext.setTransform(size.dpr, 0, 0, size.dpr, 0, 0);
      boardLayerContext.setTransform(size.dpr, 0, 0, size.dpr, 0, 0);
    },

    markDirty(): void {
      dirty = true;
    },

    ensure(grid: GridMetrics, size: CanvasSize): void {
      const gridKey = getGridKey(grid);

      if (!dirty && cachedGridKey === gridKey) {
        return;
      }

      backgroundLayerContext.clearRect(0, 0, size.width, size.height);
      drawers.drawBackground(backgroundLayerContext, size);

      boardLayerContext.clearRect(0, 0, size.width, size.height);
      drawers.drawBoard(boardLayerContext, size, grid);

      cachedGridKey = gridKey;
      dirty = false;
    },

    destroy(): void {
      backgroundLayer.width = 0;
      backgroundLayer.height = 0;
      boardLayer.width = 0;
      boardLayer.height = 0;
    },
  };
}
