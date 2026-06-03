/**
 * 2Dベクター。イミュータブルなプレーンオブジェクトとして扱う。
 * Illustrator準拠の精密な座標演算の基礎。
 */
export interface Vec2 {
  readonly x: number;
  readonly y: number;
}

export const vec = (x: number, y: number): Vec2 => ({ x, y });

export const ZERO: Vec2 = { x: 0, y: 0 };

export const add = (a: Vec2, b: Vec2): Vec2 => ({ x: a.x + b.x, y: a.y + b.y });
export const sub = (a: Vec2, b: Vec2): Vec2 => ({ x: a.x - b.x, y: a.y - b.y });
export const scale = (a: Vec2, s: number): Vec2 => ({ x: a.x * s, y: a.y * s });
export const neg = (a: Vec2): Vec2 => ({ x: -a.x, y: -a.y });

export const dot = (a: Vec2, b: Vec2): number => a.x * b.x + a.y * b.y;
export const cross = (a: Vec2, b: Vec2): number => a.x * b.y - a.y * b.x;

export const lenSq = (a: Vec2): number => a.x * a.x + a.y * a.y;
export const len = (a: Vec2): number => Math.hypot(a.x, a.y);

export const dist = (a: Vec2, b: Vec2): number => Math.hypot(a.x - b.x, a.y - b.y);
export const distSq = (a: Vec2, b: Vec2): number => {
  const dx = a.x - b.x;
  const dy = a.y - b.y;
  return dx * dx + dy * dy;
};

export const normalize = (a: Vec2): Vec2 => {
  const l = len(a);
  return l === 0 ? ZERO : { x: a.x / l, y: a.y / l };
};

/** 線形補間 t∈[0,1] */
export const lerp = (a: Vec2, b: Vec2, t: number): Vec2 => ({
  x: a.x + (b.x - a.x) * t,
  y: a.y + (b.y - a.y) * t,
});

export const equals = (a: Vec2, b: Vec2, eps = 1e-9): boolean =>
  Math.abs(a.x - b.x) <= eps && Math.abs(a.y - b.y) <= eps;
