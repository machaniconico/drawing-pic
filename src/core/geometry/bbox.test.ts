import { describe, expect, it } from "vitest";
import { rotation, translate } from "./matrix";
import {
  EMPTY_BBOX,
  contains,
  fromPoints,
  fromRect,
  inflate,
  intersects,
  isEmpty,
  transform,
  union,
  unionAll,
} from "./bbox";

const expectBBoxCloseTo = (
  actual: { minX: number; minY: number; maxX: number; maxY: number },
  expected: { minX: number; minY: number; maxX: number; maxY: number },
) => {
  expect(actual.minX).toBeCloseTo(expected.minX);
  expect(actual.minY).toBeCloseTo(expected.minY);
  expect(actual.maxX).toBeCloseTo(expected.maxX);
  expect(actual.maxY).toBeCloseTo(expected.maxY);
};

describe("bbox geometry", () => {
  it("creates a bbox from points", () => {
    expect(
      fromPoints([
        { x: 3, y: -2 },
        { x: -5, y: 8 },
        { x: 10, y: 4 },
      ]),
    ).toEqual({ minX: -5, minY: -2, maxX: 10, maxY: 8 });
  });

  it("creates a bbox from rect coordinates, including negative sizes", () => {
    expect(fromRect(10, 20, 30, 40)).toEqual({ minX: 10, minY: 20, maxX: 40, maxY: 60 });
    expect(fromRect(10, 20, -30, -40)).toEqual({ minX: -20, minY: -20, maxX: 10, maxY: 20 });
  });

  it("unions two boxes", () => {
    expect(union(fromRect(0, 0, 10, 10), fromRect(5, -5, 20, 3))).toEqual({
      minX: 0,
      minY: -5,
      maxX: 25,
      maxY: 10,
    });
  });

  it("unions all boxes and returns EMPTY_BBOX for an empty list", () => {
    expect(unionAll([fromRect(0, 0, 1, 1), fromRect(-3, 2, 2, 8), fromRect(5, -6, 1, 1)])).toEqual({
      minX: -3,
      minY: -6,
      maxX: 6,
      maxY: 10,
    });
    expect(unionAll([])).toEqual(EMPTY_BBOX);
  });

  it("detects containment including edges", () => {
    const box = fromRect(10, 20, 30, 40);

    expect(contains(box, { x: 10, y: 20 })).toBe(true);
    expect(contains(box, { x: 40, y: 60 })).toBe(true);
    expect(contains(box, { x: 41, y: 60 })).toBe(false);
  });

  it("detects box intersections including touching edges", () => {
    expect(intersects(fromRect(0, 0, 10, 10), fromRect(10, 10, 5, 5))).toBe(true);
    expect(intersects(fromRect(0, 0, 10, 10), fromRect(11, 10, 5, 5))).toBe(false);
  });

  it("transforms a box by translation", () => {
    expect(transform(fromRect(0, 0, 10, 20), translate(5, -3))).toEqual({
      minX: 5,
      minY: -3,
      maxX: 15,
      maxY: 17,
    });
  });

  it("transforms an axis-aligned box under 90 degree rotation to the rotated AABB", () => {
    expectBBoxCloseTo(transform(fromRect(1, 2, 3, 4), rotation(Math.PI / 2)), {
      minX: -6,
      minY: 1,
      maxX: -2,
      maxY: 4,
    });
  });

  it("inflates boxes symmetrically", () => {
    expect(inflate(fromRect(10, 20, 30, 40), 2, 5)).toEqual({
      minX: 8,
      minY: 15,
      maxX: 42,
      maxY: 65,
    });
    expect(inflate(fromRect(10, 20, 30, 40), 2)).toEqual({
      minX: 8,
      minY: 18,
      maxX: 42,
      maxY: 62,
    });
  });

  it("detects empty boxes and preserves them through transform", () => {
    expect(isEmpty(EMPTY_BBOX)).toBe(true);
    expect(isEmpty(fromRect(0, 0, 0, 0))).toBe(false);
    expect(transform(EMPTY_BBOX, translate(10, 20))).toBe(EMPTY_BBOX);
  });
});
