import { describe, expect, it } from "vitest";

import { formatAngle, formatDistance, measureBetween } from "./measure";

describe("model measurement geometry", () => {
  it("measures axis-aligned distances and deltas", () => {
    expect(measureBetween({ x: 10, y: 20 }, { x: 25, y: 20 })).toMatchObject({
      distance: 15,
      dx: 15,
      dy: 0,
    });

    expect(measureBetween({ x: 10, y: 20 }, { x: 10, y: -5 })).toMatchObject({
      distance: 25,
      dx: 0,
      dy: -25,
    });
  });

  it("uses Euclidean distance for a 3-4-5 triangle", () => {
    const result = measureBetween({ x: 1, y: 2 }, { x: 4, y: 6 });

    expect(result.distance).toBe(5);
    expect(result.dx).toBe(3);
    expect(result.dy).toBe(4);
  });

  it("returns cardinal angles from the positive x axis", () => {
    expect(measureBetween({ x: 0, y: 0 }, { x: 10, y: 0 }).angleDeg).toBe(0);
    expect(measureBetween({ x: 0, y: 0 }, { x: 0, y: 10 }).angleDeg).toBe(90);
    expect(measureBetween({ x: 0, y: 0 }, { x: 0, y: -10 }).angleDeg).toBe(-90);
    expect(measureBetween({ x: 0, y: 0 }, { x: -10, y: 0 }).angleDeg).toBe(180);
  });

  it("normalizes angles to the half-open range (-180, 180]", () => {
    expect(measureBetween({ x: 0, y: -0 }, { x: -1, y: 0 }).angleDeg).toBe(180);
  });

  it("returns the midpoint halfway between the endpoints", () => {
    expect(measureBetween({ x: -4, y: 8 }, { x: 10, y: -2 }).midpoint).toEqual({
      x: 3,
      y: 3,
    });
  });

  it("handles zero-length measurements with a defined angle", () => {
    const point = { x: 12, y: -7 };
    const result = measureBetween(point, point);

    expect(result.distance).toBe(0);
    expect(result.dx).toBe(0);
    expect(result.dy).toBe(0);
    expect(result.angleDeg).toBe(0);
    expect(Number.isNaN(result.angleDeg)).toBe(false);
    expect(result.midpoint).toEqual(point);
  });

  it("formats distance and angle as short rounded display strings", () => {
    expect(formatDistance(123.44)).toBe("123.4");
    expect(formatDistance(123.45)).toBe("123.5");
    expect(formatDistance(45)).toBe("45");
    expect(formatAngle(45)).toBe("45deg");
    expect(formatAngle(-90.04)).toBe("-90deg");
    expect(formatAngle(12.35)).toBe("12.4deg");
  });
});
