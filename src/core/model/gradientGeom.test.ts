import { describe, expect, it } from "vitest";
import { gradientGeometryFromDrag } from "./gradientGeom";

describe("gradient geometry from a drag", () => {
  it("uses the drag endpoints for a linear gradient without mutating them", () => {
    const start = { x: 10, y: 20 };
    const end = { x: -5, y: 45 };

    const geometry = gradientGeometryFromDrag("linear", start, end);

    expect(geometry).toEqual({ start, end });
    expect(geometry.start).not.toBe(start);
    expect(geometry.end).not.toBe(end);
    expect(start).toEqual({ x: 10, y: 20 });
    expect(end).toEqual({ x: -5, y: 45 });
  });

  it("uses the drag start as the radial center and its length as the radius", () => {
    expect(
      gradientGeometryFromDrag("radial", { x: 3, y: 4 }, { x: 6, y: 8 }),
    ).toEqual({
      center: { x: 3, y: 4 },
      radius: 5,
    });
  });

  it("returns a zero radius for a zero-length radial drag", () => {
    expect(
      gradientGeometryFromDrag("radial", { x: -2, y: 7 }, { x: -2, y: 7 }),
    ).toEqual({
      center: { x: -2, y: 7 },
      radius: 0,
    });
  });
});
