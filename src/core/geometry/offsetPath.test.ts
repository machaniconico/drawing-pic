import { describe, expect, it } from "vitest";
import { offsetSubPaths } from "./offsetPath";
import type { Vec2 } from "./vector";
import type { Anchor, SubPath } from "../model/types";

const corner = (point: Vec2): Anchor => ({ point, handleIn: null, handleOut: null });

const subpath = (points: readonly Vec2[], closed: boolean): SubPath => ({
  anchors: points.map(corner),
  closed,
});

const pointsOf = (path: SubPath): Vec2[] => path.anchors.map((anchor) => anchor.point);

const expectPointClose = (actual: Vec2, expected: Vec2): void => {
  expect(actual.x).toBeCloseTo(expected.x, 8);
  expect(actual.y).toBeCloseTo(expected.y, 8);
};

const expectPointsClose = (actual: readonly Vec2[], expected: readonly Vec2[]): void => {
  expect(actual).toHaveLength(expected.length);
  for (let index = 0; index < expected.length; index += 1) {
    expectPointClose(actual[index]!, expected[index]!);
  }
};

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

describe("offsetSubPaths", () => {
  it("returns a structurally equal copy for zero distance", () => {
    const original: SubPath = {
      anchors: [
        {
          point: { x: 0, y: 0 },
          handleIn: null,
          handleOut: { x: 10, y: 0 },
        },
        {
          point: { x: 100, y: 0 },
          handleIn: { x: -10, y: 0 },
          handleOut: null,
        },
      ],
      closed: false,
    };

    const result = offsetSubPaths([original], 0, "miter", 4);

    expect(result).toEqual([original]);
    expect(result[0]).not.toBe(original);
    expect(result[0]!.anchors[0]).not.toBe(original.anchors[0]);
  });

  it("offsets a closed CCW square outward with miter joins", () => {
    const result = offsetSubPaths([square()], 10, "miter", 4)[0]!;

    expect(result.closed).toBe(true);
    expect(result.anchors.every((anchor) => anchor.handleIn === null && anchor.handleOut === null)).toBe(true);
    expectPointsClose(pointsOf(result), [
      { x: -10, y: -10 },
      { x: 110, y: -10 },
      { x: 110, y: 110 },
      { x: -10, y: 110 },
    ]);
  });

  it("offsets a closed CCW square inward with negative distance", () => {
    const result = offsetSubPaths([square()], -10, "miter", 4)[0]!;

    expect(result.closed).toBe(true);
    expectPointsClose(pointsOf(result), [
      { x: 10, y: 10 },
      { x: 90, y: 10 },
      { x: 90, y: 90 },
      { x: 10, y: 90 },
    ]);
  });

  it("approximates round joins with extra anchors", () => {
    const result = offsetSubPaths([square()], 10, "round", 4)[0]!;

    expect(result.closed).toBe(true);
    expect(result.anchors.length).toBeGreaterThan(4);
    expect(result.anchors.every((anchor) => anchor.handleIn === null && anchor.handleOut === null)).toBe(true);
  });

  it("keeps inward round joins as short arcs inside the original shape", () => {
    const result = offsetSubPaths([square()], -10, "round", 4)[0]!;

    expect(result.closed).toBe(true);
    expect(result.anchors.length).toBeGreaterThan(4);
    for (const anchor of result.anchors) {
      expect(anchor.point.x).toBeGreaterThanOrEqual(-1e-8);
      expect(anchor.point.x).toBeLessThanOrEqual(100 + 1e-8);
      expect(anchor.point.y).toBeGreaterThanOrEqual(-1e-8);
      expect(anchor.point.y).toBeLessThanOrEqual(100 + 1e-8);
    }
  });

  it("falls back to bevel joins when the miter limit is exceeded", () => {
    const result = offsetSubPaths([square()], 10, "miter", 1)[0]!;

    expect(result.closed).toBe(true);
    expectPointsClose(pointsOf(result), [
      { x: -10, y: 0 },
      { x: 0, y: -10 },
      { x: 100, y: -10 },
      { x: 110, y: 0 },
      { x: 110, y: 100 },
      { x: 100, y: 110 },
      { x: 0, y: 110 },
      { x: -10, y: 100 },
    ]);
  });

  it("offsets open polylines to the left-normal side without adding caps", () => {
    const open = subpath(
      [
        { x: 0, y: 0 },
        { x: 100, y: 0 },
        { x: 100, y: 100 },
      ],
      false,
    );

    const result = offsetSubPaths([open], 10, "miter", 4)[0]!;

    expect(result.closed).toBe(false);
    expectPointsClose(pointsOf(result), [
      { x: 0, y: -10 },
      { x: 110, y: -10 },
      { x: 110, y: 100 },
    ]);
  });
});
