import type { Vec2 } from "../geometry/vector";
import { dist, lerp } from "../geometry/vector";

export interface Measurement {
  readonly distance: number;
  readonly angleDeg: number;
  readonly dx: number;
  readonly dy: number;
  readonly midpoint: Vec2;
}

const DEGREES_PER_RADIAN = 180 / Math.PI;

const normalizeSignedZero = (n: number): number => (Object.is(n, -0) ? 0 : n);

const normalizeAngleDeg = (angleDeg: number): number => {
  const normalized = ((((angleDeg + 180) % 360) + 360) % 360) - 180;
  return normalizeSignedZero(normalized <= -180 ? 180 : normalized);
};

const formatRounded = (n: number): string => normalizeSignedZero(Math.round(n * 10) / 10).toString();

export const measureBetween = (a: Vec2, b: Vec2): Measurement => {
  const dx = normalizeSignedZero(b.x - a.x);
  const dy = normalizeSignedZero(b.y - a.y);
  const angleDeg = normalizeAngleDeg(Math.atan2(dy, dx) * DEGREES_PER_RADIAN);

  return {
    distance: dist(a, b),
    angleDeg,
    dx,
    dy,
    midpoint: lerp(a, b, 0.5),
  };
};

export const formatDistance = (n: number): string => formatRounded(n);

export const formatAngle = (deg: number): string => `${formatRounded(deg)}deg`;
