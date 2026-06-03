import { describe, expect, it } from "vitest";
import {
  ZERO,
  add,
  cross,
  dist,
  dot,
  equals,
  len,
  lerp,
  normalize,
  scale,
  sub,
  vec,
} from "./vector";

describe("vector geometry", () => {
  it("creates immutable-shaped vector objects", () => {
    expect(vec(3, -2)).toEqual({ x: 3, y: -2 });
    expect(ZERO).toEqual({ x: 0, y: 0 });
  });

  it("adds and subtracts vectors component-wise", () => {
    expect(add({ x: 2, y: 5 }, { x: -4, y: 7 })).toEqual({ x: -2, y: 12 });
    expect(sub({ x: 2, y: 5 }, { x: -4, y: 7 })).toEqual({ x: 6, y: -2 });
  });

  it("scales vectors by a scalar", () => {
    expect(scale({ x: -3, y: 4 }, 2.5)).toEqual({ x: -7.5, y: 10 });
  });

  it("computes dot and cross products", () => {
    const a = { x: 3, y: 4 };
    const b = { x: -2, y: 5 };

    expect(dot(a, b)).toBe(14);
    expect(cross(a, b)).toBe(23);
  });

  it("computes vector length and distance", () => {
    expect(len({ x: 3, y: 4 })).toBe(5);
    expect(dist({ x: -1, y: -1 }, { x: 2, y: 3 })).toBe(5);
  });

  it("normalizes non-zero vectors", () => {
    expect(normalize({ x: 3, y: 4 })).toEqual({ x: 0.6, y: 0.8 });
    expect(len(normalize({ x: 5, y: 12 }))).toBeCloseTo(1);
  });

  it("normalizes zero-length vectors to ZERO", () => {
    expect(normalize({ x: 0, y: 0 })).toBe(ZERO);
  });

  it("linearly interpolates between points", () => {
    expect(lerp({ x: 10, y: -10 }, { x: 20, y: 30 }, 0.25)).toEqual({ x: 12.5, y: 0 });
  });

  it("compares vectors using the default and custom epsilon", () => {
    expect(equals({ x: 1, y: 1 }, { x: 1 + 1e-10, y: 1 - 1e-10 })).toBe(true);
    expect(equals({ x: 1, y: 1 }, { x: 1.01, y: 1 }, 0.001)).toBe(false);
    expect(equals({ x: 1, y: 1 }, { x: 1.01, y: 1 }, 0.02)).toBe(true);
  });
});
