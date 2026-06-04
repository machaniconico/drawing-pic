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
      alignmentGuidesX: [
        { position: 10, spanMin: 0, spanMax: 60 },
        { position: 20, spanMin: 0, spanMax: 60 },
      ],
      alignmentGuidesY: [],
    });
  });

  it("snaps center to center on both axes", () => {
    const result = computeSnap(fromRect(18, 19, 10, 10), [fromRect(0, 0, 50, 50)], 3);

    expect(result).toEqual({
      dx: 2,
      dy: 1,
      guidesX: [25],
      guidesY: [25],
      alignmentGuidesX: [{ position: 25, spanMin: 0, spanMax: 50 }],
      alignmentGuidesY: [{ position: 25, spanMin: 0, spanMax: 50 }],
    });
  });

  it("does not snap when every match is beyond threshold", () => {
    const result = computeSnap(fromRect(100, 100, 10, 10), [fromRect(0, 0, 10, 10)], 5);

    expect(result).toEqual({
      dx: 0,
      dy: 0,
      guidesX: [],
      guidesY: [],
      alignmentGuidesX: [],
      alignmentGuidesY: [],
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
      alignmentGuidesX: [{ position: 60, spanMin: 100, spanMax: 320 }],
      alignmentGuidesY: [
        { position: 100, spanMin: 50, spanMax: 310 },
        { position: 105, spanMin: 50, spanMax: 310 },
        { position: 110, spanMin: 50, spanMax: 310 },
      ],
    });
  });

  it("snaps x anchors to vertical guide positions", () => {
    const result = computeSnap(
      fromRect(38, 100, 10, 10),
      [],
      3,
      [{ id: "guide-x", axis: "x", position: 40 }],
    );

    expect(result).toEqual({
      dx: 2,
      dy: 0,
      guidesX: [40],
      guidesY: [],
      alignmentGuidesX: [],
      alignmentGuidesY: [],
    });
  });

  it("snaps y anchors to horizontal guide positions", () => {
    const result = computeSnap(
      fromRect(100, 57, 10, 10),
      [],
      3,
      [{ id: "guide-y", axis: "y", position: 60 }],
    );

    expect(result).toEqual({
      dx: 0,
      dy: -2,
      guidesX: [],
      guidesY: [60],
      alignmentGuidesX: [],
      alignmentGuidesY: [],
    });
  });

  it("reports every object x alignment line that shares the selected snap delta", () => {
    const result = computeSnap(fromRect(2, 20, 10, 10), [fromRect(0, 0, 10, 10)], 3);

    expect(result).toEqual({
      dx: -2,
      dy: 0,
      guidesX: [0],
      guidesY: [],
      alignmentGuidesX: [
        { position: 0, spanMin: 0, spanMax: 30 },
        { position: 5, spanMin: 0, spanMax: 30 },
        { position: 10, spanMin: 0, spanMax: 30 },
      ],
      alignmentGuidesY: [],
    });
  });
});
