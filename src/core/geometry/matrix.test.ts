import { describe, expect, it } from "vitest";
import {
  IDENTITY,
  apply,
  applyVector,
  compose,
  composeAll,
  determinant,
  invert,
  matrix,
  rotation,
  rotationAround,
  scaling,
  toCanvasArgs,
  translate,
} from "./matrix";

const expectPointCloseTo = (
  actual: { x: number; y: number },
  expected: { x: number; y: number },
) => {
  expect(actual.x).toBeCloseTo(expected.x);
  expect(actual.y).toBeCloseTo(expected.y);
};

describe("matrix geometry", () => {
  it("creates matrix objects and exposes identity", () => {
    expect(matrix(1, 2, 3, 4, 5, 6)).toEqual({ a: 1, b: 2, c: 3, d: 4, e: 5, f: 6 });
    expect(apply(IDENTITY, { x: 8, y: -3 })).toEqual({ x: 8, y: -3 });
  });

  it("composes m2 after m1 for point application", () => {
    const m1 = translate(10, -2);
    const m2 = scaling(3, 4);
    const p = { x: 2, y: 5 };

    expectPointCloseTo(apply(compose(m2, m1), p), apply(m2, apply(m1, p)));
  });

  it("composeAll applies matrices from right to left", () => {
    const p = { x: 2, y: 3 };
    const composed = composeAll(translate(5, 7), rotation(Math.PI / 2), scaling(2, 3));
    const manual = apply(translate(5, 7), apply(rotation(Math.PI / 2), apply(scaling(2, 3), p)));

    expectPointCloseTo(apply(composed, p), manual);
  });

  it("builds translate and scaling matrices", () => {
    expect(apply(translate(-3, 9), { x: 5, y: 4 })).toEqual({ x: 2, y: 13 });
    expect(apply(scaling(2, -3), { x: 5, y: 4 })).toEqual({ x: 10, y: -12 });
    expect(apply(scaling(2), { x: 5, y: 4 })).toEqual({ x: 10, y: 8 });
  });

  it("rotates points around the origin", () => {
    expectPointCloseTo(apply(rotation(Math.PI / 2), { x: 2, y: 0 }), { x: 0, y: 2 });
    expectPointCloseTo(apply(rotation(Math.PI), { x: 2, y: -3 }), { x: -2, y: 3 });
  });

  it("rotates points around a supplied center", () => {
    expectPointCloseTo(apply(rotationAround(Math.PI / 2, 10, 10), { x: 12, y: 10 }), {
      x: 10,
      y: 12,
    });
  });

  it("applies vectors without translation", () => {
    const m = compose(translate(100, 200), scaling(2, 3));

    expect(apply(m, { x: 1, y: 1 })).toEqual({ x: 102, y: 203 });
    expect(applyVector(m, { x: 1, y: 1 })).toEqual({ x: 2, y: 3 });
  });

  it("computes determinant and inverse for non-singular matrices", () => {
    const m = compose(translate(5, -8), compose(rotation(Math.PI / 3), scaling(2, 4)));
    const inverse = invert(m);

    expect(determinant(scaling(2, 4))).toBe(8);
    expect(inverse).not.toBeNull();
    expectPointCloseTo(apply(inverse!, apply(m, { x: -3, y: 11 })), { x: -3, y: 11 });
  });

  it("returns null when inverting a singular matrix", () => {
    expect(determinant(matrix(1, 2, 2, 4, 10, 20))).toBe(0);
    expect(invert(matrix(1, 2, 2, 4, 10, 20))).toBeNull();
  });

  it("converts to Canvas setTransform argument order", () => {
    expect(toCanvasArgs(matrix(1, 2, 3, 4, 5, 6))).toEqual([1, 2, 3, 4, 5, 6]);
  });
});
