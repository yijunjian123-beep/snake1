import type { CanvasSize, GridCell, GridMetrics } from "./types";

export interface CanvasPoint {
  x: number;
  y: number;
}

export function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

export function easeOutCubic(value: number): number {
  const inverted = 1 - clamp(value, 0, 1);

  return 1 - inverted * inverted * inverted;
}

export function lerp(start: number, end: number, progress: number): number {
  return start + (end - start) * progress;
}

export function quadraticBezierPoint(
  start: CanvasPoint,
  control: CanvasPoint,
  end: CanvasPoint,
  progress: number,
): CanvasPoint {
  const clamped = clamp(progress, 0, 1);
  const inverse = 1 - clamped;

  return {
    x: inverse * inverse * start.x + 2 * inverse * clamped * control.x + clamped * clamped * end.x,
    y: inverse * inverse * start.y + 2 * inverse * clamped * control.y + clamped * clamped * end.y,
  };
}

export function seededUnit(index: number, offset: number): number {
  const value = Math.sin(index * 127.1 + offset * 311.7) * 43758.5453123;
  return value - Math.floor(value);
}

export function burstUnit(seed: number, offset: number): number {
  return seededUnit(seed + offset * 19.37, offset);
}

export function scaleAlpha(value: number, scale: number): number {
  return clamp(value * scale, 0, 1);
}

export function scaleLightness(value: number, scale: number): number {
  return clamp(value * scale, 0, 100);
}

export function getCanvasSize(canvas: HTMLCanvasElement, dprCap: number): CanvasSize {
  const bounds = canvas.getBoundingClientRect();
  const width = Math.max(1, Math.floor(bounds.width || window.innerWidth));
  const height = Math.max(1, Math.floor(bounds.height || window.innerHeight));
  const dpr = Math.max(1, Math.min(window.devicePixelRatio || 1, dprCap));
  const pixelWidth = Math.max(1, Math.floor(width * dpr));
  const pixelHeight = Math.max(1, Math.floor(height * dpr));

  return { width, height, dpr, pixelWidth, pixelHeight };
}

export function fillRoundedRect(
  context: CanvasRenderingContext2D,
  x: number,
  y: number,
  width: number,
  height: number,
  radius: number,
): void {
  const cornerRadius = Math.min(radius, width / 2, height / 2);

  context.beginPath();
  context.moveTo(x + cornerRadius, y);
  context.lineTo(x + width - cornerRadius, y);
  context.quadraticCurveTo(x + width, y, x + width, y + cornerRadius);
  context.lineTo(x + width, y + height - cornerRadius);
  context.quadraticCurveTo(x + width, y + height, x + width - cornerRadius, y + height);
  context.lineTo(x + cornerRadius, y + height);
  context.quadraticCurveTo(x, y + height, x, y + height - cornerRadius);
  context.lineTo(x, y + cornerRadius);
  context.quadraticCurveTo(x, y, x + cornerRadius, y);
  context.closePath();
  context.fill();
}

export function cellCenter(grid: GridMetrics, cell: GridCell): CanvasPoint {
  return {
    x: grid.offsetX + cell.column * grid.cellSize + grid.cellSize / 2,
    y: grid.offsetY + cell.row * grid.cellSize + grid.cellSize / 2,
  };
}
