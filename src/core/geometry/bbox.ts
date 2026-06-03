import type { Vec2 } from "./vector";
import { apply, type Matrix } from "./matrix";

/** 軸並行バウンディングボックス（ワールド or ローカル座標） */
export interface BBox {
  readonly minX: number;
  readonly minY: number;
  readonly maxX: number;
  readonly maxY: number;
}

export const EMPTY_BBOX: BBox = {
  minX: Infinity,
  minY: Infinity,
  maxX: -Infinity,
  maxY: -Infinity,
};

export const isEmpty = (b: BBox): boolean => b.minX > b.maxX || b.minY > b.maxY;

export const width = (b: BBox): number => Math.max(0, b.maxX - b.minX);
export const height = (b: BBox): number => Math.max(0, b.maxY - b.minY);
export const center = (b: BBox): Vec2 => ({
  x: (b.minX + b.maxX) / 2,
  y: (b.minY + b.maxY) / 2,
});

export const fromPoints = (points: readonly Vec2[]): BBox => {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const p of points) {
    if (p.x < minX) minX = p.x;
    if (p.y < minY) minY = p.y;
    if (p.x > maxX) maxX = p.x;
    if (p.y > maxY) maxY = p.y;
  }
  return { minX, minY, maxX, maxY };
};

export const fromRect = (x: number, y: number, w: number, h: number): BBox => ({
  minX: Math.min(x, x + w),
  minY: Math.min(y, y + h),
  maxX: Math.max(x, x + w),
  maxY: Math.max(y, y + h),
});

export const union = (a: BBox, b: BBox): BBox => ({
  minX: Math.min(a.minX, b.minX),
  minY: Math.min(a.minY, b.minY),
  maxX: Math.max(a.maxX, b.maxX),
  maxY: Math.max(a.maxY, b.maxY),
});

export const unionAll = (boxes: readonly BBox[]): BBox =>
  boxes.reduce(union, EMPTY_BBOX);

export const contains = (b: BBox, p: Vec2): boolean =>
  p.x >= b.minX && p.x <= b.maxX && p.y >= b.minY && p.y <= b.maxY;

export const intersects = (a: BBox, b: BBox): boolean =>
  a.minX <= b.maxX && a.maxX >= b.minX && a.minY <= b.maxY && a.maxY >= b.minY;

/** 行列でboxの4隅を変換し、新たな軸並行boxを得る */
export const transform = (b: BBox, m: Matrix): BBox => {
  if (isEmpty(b)) return b;
  const corners: Vec2[] = [
    apply(m, { x: b.minX, y: b.minY }),
    apply(m, { x: b.maxX, y: b.minY }),
    apply(m, { x: b.maxX, y: b.maxY }),
    apply(m, { x: b.minX, y: b.maxY }),
  ];
  return fromPoints(corners);
};

export const inflate = (b: BBox, dx: number, dy: number = dx): BBox => ({
  minX: b.minX - dx,
  minY: b.minY - dy,
  maxX: b.maxX + dx,
  maxY: b.maxY + dy,
});
