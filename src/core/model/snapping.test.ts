import { describe, expect, it } from "vitest";
import { fromRect } from "../geometry/bbox";
import { computeSnap, snapToGrid } from "./snapping";

describe("model snapping", () => {
  it("snaps a moving left edge to a candidate left edge", () => {
    const result = computeSnap(fromRect(11, 0, 10, 10), [fromRect(10, 40, 20, 20)], 2);

    expect(result).toEqual({
      dx: -1,
      dy: 0,
      guidesX: [10],
      guidesY: [],
    });
  });

  it("snaps center to center on both axes", () => {
    const result = computeSnap(fromRect(18, 19, 10, 10), [fromRect(0, 0, 50, 50)], 3);

    expect(result).toEqual({
      dx: 2,
      dy: 1,
      guidesX: [25],
      guidesY: [25],
    });
  });

  it("does not snap when every match is beyond threshold", () => {
    const result = computeSnap(fromRect(100, 100, 10, 10), [fromRect(0, 0, 10, 10)], 5);

    expect(result).toEqual({
      dx: 0,
      dy: 0,
      guidesX: [],
      guidesY: [],
    });
  });

  it("rounds values to the nearest grid coordinate", () => {
    expect(snapToGrid(23, 10)).toBe(20);
    expect(snapToGrid(26, 10)).toBe(30);
    expect(snapToGrid(-14, 10)).toBe(-10);
  });

  it("chooses the nearest x and y matches independently", () => {
    const result = computeSnap(
      fromRect(47, 102, 10, 10),
      [
        fromRect(60, 300, 20, 20),
        fromRect(300, 100, 10, 10),
      ],
      4,
    );

    expect(result).toEqual({
      dx: 3,
      dy: -2,
      guidesX: [60],
      guidesY: [100],
    });
  });
});
