import type { Vec2 } from "./vector";

/**
 * 2Dアフィン変換行列。Canvas / SVG と同じ列順 [a, b, c, d, e, f] を採用。
 *
 *   | a  c  e |
 *   | b  d  f |
 *   | 0  0  1 |
 *
 * 点変換: x' = a*x + c*y + e,  y' = b*x + d*y + f
 * これは CanvasRenderingContext2D.setTransform(a, b, c, d, e, f) と一致する。
 */
export interface Matrix {
  readonly a: number;
  readonly b: number;
  readonly c: number;
  readonly d: number;
  readonly e: number;
  readonly f: number;
}

export const IDENTITY: Matrix = { a: 1, b: 0, c: 0, d: 1, e: 0, f: 0 };

export const matrix = (
  a: number,
  b: number,
  c: number,
  d: number,
  e: number,
  f: number,
): Matrix => ({ a, b, c, d, e, f });

/** m1 の後に m2 を適用する合成（= m2 * m1）。点に対し apply(compose(m2,m1), p) = apply(m2, apply(m1, p)) */
export const compose = (m2: Matrix, m1: Matrix): Matrix => ({
  a: m2.a * m1.a + m2.c * m1.b,
  b: m2.b * m1.a + m2.d * m1.b,
  c: m2.a * m1.c + m2.c * m1.d,
  d: m2.b * m1.c + m2.d * m1.d,
  e: m2.a * m1.e + m2.c * m1.f + m2.e,
  f: m2.b * m1.e + m2.d * m1.f + m2.f,
});

/** 複数行列を左から順に合成（先頭が最後に適用される） */
export const composeAll = (...ms: Matrix[]): Matrix =>
  ms.reduce((acc, m) => compose(acc, m), IDENTITY);

export const translate = (tx: number, ty: number): Matrix => ({
  a: 1,
  b: 0,
  c: 0,
  d: 1,
  e: tx,
  f: ty,
});

export const scaling = (sx: number, sy: number = sx): Matrix => ({
  a: sx,
  b: 0,
  c: 0,
  d: sy,
  e: 0,
  f: 0,
});

export const rotation = (rad: number): Matrix => {
  const cos = Math.cos(rad);
  const sin = Math.sin(rad);
  return { a: cos, b: sin, c: -sin, d: cos, e: 0, f: 0 };
};

/** 指定中心まわりの回転 */
export const rotationAround = (rad: number, cx: number, cy: number): Matrix =>
  composeAll(translate(cx, cy), rotation(rad), translate(-cx, -cy));

export const apply = (m: Matrix, p: Vec2): Vec2 => ({
  x: m.a * p.x + m.c * p.y + m.e,
  y: m.b * p.x + m.d * p.y + m.f,
});

/** 平行移動成分を無視してベクター（方向）のみ変換する */
export const applyVector = (m: Matrix, v: Vec2): Vec2 => ({
  x: m.a * v.x + m.c * v.y,
  y: m.b * v.x + m.d * v.y,
});

export const determinant = (m: Matrix): number => m.a * m.d - m.b * m.c;

export const invert = (m: Matrix): Matrix | null => {
  const det = determinant(m);
  if (det === 0) return null;
  const id = 1 / det;
  return {
    a: m.d * id,
    b: -m.b * id,
    c: -m.c * id,
    d: m.a * id,
    e: (m.c * m.f - m.d * m.e) * id,
    f: (m.b * m.e - m.a * m.f) * id,
  };
};

export const toCanvasArgs = (
  m: Matrix,
): [number, number, number, number, number, number] => [m.a, m.b, m.c, m.d, m.e, m.f];
