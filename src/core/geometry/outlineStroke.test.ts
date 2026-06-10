import { describe, expect, it } from "vitest";
import { strokeOutlineSubPaths } from "./outlineStroke";
import type { Vec2 } from "./vector";
import type { Anchor, LineCap, SubPath } from "../model/types";

const corner = (point: Vec2): Anchor => ({ point, handleIn: null, handleOut: null });

const subpath = (points: readonly Vec2[], closed: boolean): SubPath => ({
  anchors: points.map(corner),
  closed,
});

const square = (): SubPath =>
  subpath(
    [
      { x: 0, y: 0 },
      { x: 100, y: 0 },
      { x: 100, y: 100 },
      { x: 0, y: 100 },
    ],
    true,
  );

const segment = (): SubPath =>
  subpath(
    [
      { x: 0, y: 0 },
      { x: 100, y: 0 },
    ],
    false,
  );

const kappaCircle = (): SubPath => {
  const radius = 50;
  const kappa = 0.5522847498307936;
  const handle = radius * kappa;

  return {
    anchors: [
      {
        point: { x: 100, y: 50 },
        handleIn: { x: 0, y: -handle },
        handleOut: { x: 0, y: handle },
      },
      {
        point: { x: 50, y: 100 },
        handleIn: { x: handle, y: 0 },
        handleOut: { x: -handle, y: 0 },
      },
      {
        point: { x: 0, y: 50 },
        handleIn: { x: 0, y: handle },
        handleOut: { x: 0, y: -handle },
      },
      {
        point: { x: 50, y: 0 },
        handleIn: { x: -handle, y: 0 },
        handleOut: { x: handle, y: 0 },
      },
    ],
    closed: true,
  };
};

const pointsOf = (path: SubPath): Vec2[] => path.anchors.map((anchor) => anchor.point);

const signedArea = (path: SubPath): number => {
  const points = pointsOf(path);
  let area = 0;
  for (let index = 0; index < points.length; index += 1) {
    const a = points[index]!;
    const b = points[(index + 1) % points.length]!;
    area += a.x * b.y - b.x * a.y;
  }
  return area / 2;
};

const bboxOf = (path: SubPath) => {
  const points = pointsOf(path);
  return {
    minX: Math.min(...points.map((point) => point.x)),
    minY: Math.min(...points.map((point) => point.y)),
    maxX: Math.max(...points.map((point) => point.x)),
    maxY: Math.max(...points.map((point) => point.y)),
  };
};

const expectBBoxClose = (
  actual: { minX: number; minY: number; maxX: number; maxY: number },
  expected: { minX: number; minY: number; maxX: number; maxY: number },
): void => {
  expect(actual.minX).toBeCloseTo(expected.minX, 8);
  expect(actual.minY).toBeCloseTo(expected.minY, 8);
  expect(actual.maxX).toBeCloseTo(expected.maxX, 8);
  expect(actual.maxY).toBeCloseTo(expected.maxY, 8);
};

const expectClosedCornerPaths = (paths: readonly SubPath[]): void => {
  for (const path of paths) {
    expect(path.closed).toBe(true);
    expect(path.anchors.every((anchor) => anchor.handleIn === null && anchor.handleOut === null)).toBe(true);
  }
};

describe("strokeOutlineSubPaths", () => {
  it("skips non-positive, non-finite, and degenerate strokes", () => {
    expect(strokeOutlineSubPaths([segment()], 0, "butt", "miter", 4, "center")).toEqual([]);
    expect(strokeOutlineSubPaths([segment()], Number.NaN, "butt", "miter", 4, "center")).toEqual([]);
    expect(strokeOutlineSubPaths([subpath([{ x: 0, y: 0 }], false)], 10, "butt", "miter", 4, "center")).toEqual(
      [],
    );
    expect(
      strokeOutlineSubPaths(
        [
          subpath(
            [
              { x: 0, y: 0 },
              { x: 0, y: 0 },
            ],
            false,
          ),
        ],
        10,
        "butt",
        "miter",
        4,
        "center",
      ),
    ).toEqual([]);
  });

  it("creates center-aligned outer and reversed inner rings for a closed square", () => {
    const result = strokeOutlineSubPaths([square()], 10, "butt", "miter", 4, "center");

    expect(result).toHaveLength(2);
    expectClosedCornerPaths(result);
    expectBBoxClose(bboxOf(result[0]!), { minX: -5, minY: -5, maxX: 105, maxY: 105 });
    expectBBoxClose(bboxOf(result[1]!), { minX: 5, minY: 5, maxX: 95, maxY: 95 });
    expect(Math.sign(signedArea(result[0]!))).toBe(-Math.sign(signedArea(result[1]!)));
  });

  it("creates inside-aligned rings for a closed square", () => {
    const result = strokeOutlineSubPaths([square()], 10, "butt", "miter", 4, "inside");

    expect(result).toHaveLength(2);
    expectClosedCornerPaths(result);
    expectBBoxClose(bboxOf(result[0]!), { minX: 0, minY: 0, maxX: 100, maxY: 100 });
    expectBBoxClose(bboxOf(result[1]!), { minX: 10, minY: 10, maxX: 90, maxY: 90 });
    expect(Math.sign(signedArea(result[0]!))).toBe(-Math.sign(signedArea(result[1]!)));
  });

  it("flattens zero-distance rings for curved closed inside strokes", () => {
    const result = strokeOutlineSubPaths([kappaCircle()], 10, "butt", "miter", 4, "inside");

    expect(result).toHaveLength(2);
    expectClosedCornerPaths(result);
    expect(result[0]!.anchors.length).toBeGreaterThan(4);
    expectBBoxClose(bboxOf(result[0]!), { minX: 0, minY: 0, maxX: 100, maxY: 100 });
    expect(Math.sign(signedArea(result[0]!))).toBe(-Math.sign(signedArea(result[1]!)));
  });

  it("creates outside-aligned rings for a closed square", () => {
    const result = strokeOutlineSubPaths([square()], 10, "butt", "miter", 4, "outside");

    expect(result).toHaveLength(2);
    expectClosedCornerPaths(result);
    expectBBoxClose(bboxOf(result[0]!), { minX: -10, minY: -10, maxX: 110, maxY: 110 });
    expectBBoxClose(bboxOf(result[1]!), { minX: 0, minY: 0, maxX: 100, maxY: 100 });
    expect(Math.sign(signedArea(result[0]!))).toBe(-Math.sign(signedArea(result[1]!)));
  });

  it.each([
    ["butt", { minX: 0, minY: -5, maxX: 100, maxY: 5 }],
    ["square", { minX: -5, minY: -5, maxX: 105, maxY: 5 }],
  ] satisfies [LineCap, { minX: number; minY: number; maxX: number; maxY: number }][])(
    "creates a single open-stroke ring with %s caps",
    (cap, expected) => {
      const result = strokeOutlineSubPaths([segment()], 10, cap, "miter", 4, "outside");

      expect(result).toHaveLength(1);
      expectClosedCornerPaths(result);
      expectBBoxClose(bboxOf(result[0]!), expected);
      expect(pointsOf(result[0]!)).toEqual([
        { x: expected.minX, y: -5 },
        { x: expected.maxX, y: -5 },
        { x: expected.maxX, y: 5 },
        { x: expected.minX, y: 5 },
      ]);
    },
  );

  it("creates sampled round caps for an open segment", () => {
    const result = strokeOutlineSubPaths([segment()], 10, "round", "miter", 4, "inside");

    expect(result).toHaveLength(1);
    expectClosedCornerPaths(result);
    expect(result[0]!.anchors.length).toBeGreaterThan(8);
    expectBBoxClose(bboxOf(result[0]!), { minX: -5, minY: -5, maxX: 105, maxY: 5 });
  });
});
