import { describe, expect, it } from "vitest";
import { fromRect } from "../geometry/bbox";
import {
  computeEqualSpacingIndicators,
  computeNearestDistanceBadges,
  computeSnap,
  computeTransformSnap,
  snapRotation,
  snapToGrid,
} from "./snapping";

const degToRad = (degrees: number): number => (degrees * Math.PI) / 180;

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

  it("snaps rotation to a 15 degree multiple within threshold", () => {
    expect(
      snapRotation(degToRad(44), {
        threshold: degToRad(2),
        stepRad: degToRad(15),
      }),
    ).toBeCloseTo(degToRad(45));
  });

  it("snaps rotation to a cardinal angle even when the configured step would not match", () => {
    expect(
      snapRotation(degToRad(89), {
        threshold: degToRad(2),
        stepRad: degToRad(20),
      }),
    ).toBeCloseTo(degToRad(90));
  });

  it("keeps the original rotation when no snap target is within threshold", () => {
    const angle = degToRad(38);

    expect(
      snapRotation(angle, {
        threshold: degToRad(1),
        stepRad: degToRad(15),
      }),
    ).toBe(angle);
  });

  it("snaps rotation across the zero turn boundary and handles negative angles", () => {
    expect(snapRotation(degToRad(359), { threshold: degToRad(2) })).toBeCloseTo(degToRad(360));
    expect(snapRotation(degToRad(-1), { threshold: degToRad(2) })).toBeCloseTo(0);
  });

  it("uses a 15 degree default rotation snap step", () => {
    expect(snapRotation(degToRad(31), { threshold: degToRad(2) })).toBeCloseTo(degToRad(30));
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

  it("computes independent transform edge corrections for object edge snaps", () => {
    const result = computeTransformSnap(fromRect(8, 50, 10, 10), [fromRect(10, 0, 20, 20)], 3);

    expect(result.minX).toEqual({
      correction: 2,
      guide: 10,
      alignmentGuides: [{ position: 10, spanMin: 0, spanMax: 60 }],
    });
    expect(result.maxX).toEqual({
      correction: 2,
      guide: 20,
      alignmentGuides: [{ position: 20, spanMin: 0, spanMax: 60 }],
    });
    expect(result.minY.correction).toBe(0);
    expect(result.maxY.correction).toBe(0);
    expect(result.alignmentGuidesX).toEqual([
      { position: 10, spanMin: 0, spanMax: 60 },
      { position: 20, spanMin: 0, spanMax: 60 },
    ]);
    expect(result.alignmentGuidesY).toEqual([]);
  });

  it("computes doubled transform corrections when snapping centers with the opposite edge fixed", () => {
    const result = computeTransformSnap(
      fromRect(0, 0, 10, 10),
      [fromRect(-93, 40, 200, 20)],
      2.5,
    );

    expect(result.minX).toEqual({
      correction: 4,
      guide: 7,
      alignmentGuides: [{ position: 7, spanMin: 0, spanMax: 60 }],
    });
    expect(result.maxX).toEqual({
      correction: 4,
      guide: 7,
      alignmentGuides: [{ position: 7, spanMin: 0, spanMax: 60 }],
    });
    expect(result.alignmentGuidesX).toEqual([{ position: 7, spanMin: 0, spanMax: 60 }]);
  });

  it("snaps transform edges and centers to ruler guides", () => {
    const result = computeTransformSnap(
      fromRect(10, 58, 10, 20),
      [],
      3,
      [{ id: "guide-y", axis: "y", position: 60 }],
    );

    expect(result.minY).toEqual({
      correction: 2,
      guide: 60,
      alignmentGuides: [{ position: 60, spanMin: 10, spanMax: 20 }],
    });
    expect(result.maxY).toEqual({
      correction: 0,
      guide: null,
      alignmentGuides: [],
    });
    expect(result.alignmentGuidesY).toEqual([{ position: 60, spanMin: 10, spanMax: 20 }]);
  });

  it("falls back to per-axis grid lines when no object or ruler guide snap matches", () => {
    const result = computeTransformSnap(
      fromRect(1, 12, 20, 19),
      [],
      2.1,
      [
        { id: "grid-x", axis: "x", position: 0, grid: 10 },
        { id: "grid-y", axis: "y", position: 0, grid: 10 },
      ],
    );

    expect(result.minX).toEqual({
      correction: -1,
      guide: 0,
      alignmentGuides: [{ position: 0, spanMin: 12, spanMax: 31 }],
    });
    expect(result.maxX).toEqual({
      correction: -1,
      guide: 20,
      alignmentGuides: [{ position: 20, spanMin: 12, spanMax: 31 }],
    });
    expect(result.minY).toEqual({
      correction: -3,
      guide: 20,
      alignmentGuides: [{ position: 20, spanMin: 1, spanMax: 21 }],
    });
    expect(result.maxY).toEqual({
      correction: -1,
      guide: 30,
      alignmentGuides: [{ position: 30, spanMin: 1, spanMax: 21 }],
    });
  });

  it("returns zero transform corrections and no alignment lines when nothing is within tolerance", () => {
    const result = computeTransformSnap(
      fromRect(100, 100, 10, 10),
      [fromRect(0, 0, 10, 10)],
      2,
      [
        { id: "guide-x", axis: "x", position: 40 },
        { id: "grid-y", axis: "y", position: 13, grid: 25 },
      ],
    );

    expect(result).toEqual({
      minX: { correction: 0, guide: null, alignmentGuides: [] },
      maxX: { correction: 0, guide: null, alignmentGuides: [] },
      minY: { correction: 0, guide: null, alignmentGuides: [] },
      maxY: { correction: 0, guide: null, alignmentGuides: [] },
      alignmentGuidesX: [],
      alignmentGuidesY: [],
    });
  });

  it("reports the edge distance to the nearest object for a measurement badge", () => {
    const result = computeNearestDistanceBadges(
      fromRect(0, 0, 10, 10),
      [fromRect(100, 0, 10, 10), fromRect(30, 0, 20, 10)],
    );

    expect(result).toEqual([
      {
        axis: "x",
        distance: 20,
        start: { x: 10, y: 5 },
        end: { x: 30, y: 5 },
      },
    ]);
  });

  it("reports both axis distances when the nearest object is diagonal", () => {
    expect(
      computeNearestDistanceBadges(
        fromRect(20, 20, 10, 10),
        [fromRect(0, 0, 10, 10)],
      ),
    ).toEqual([
      {
        axis: "x",
        distance: 10,
        start: { x: 10, y: 15 },
        end: { x: 20, y: 15 },
      },
      {
        axis: "y",
        distance: 10,
        start: { x: 15, y: 10 },
        end: { x: 15, y: 20 },
      },
    ]);
  });

  it("creates equal-spacing indicators for three aligned objects", () => {
    expect(
      computeEqualSpacingIndicators(
        fromRect(20, 0, 10, 10),
        [fromRect(0, 0, 10, 10), fromRect(40, 0, 10, 10)],
        0,
      ),
    ).toEqual([
      {
        axis: "x",
        distance: 10,
        start: { x: 10, y: 5 },
        end: { x: 20, y: 5 },
      },
      {
        axis: "x",
        distance: 10,
        start: { x: 30, y: 5 },
        end: { x: 40, y: 5 },
      },
    ]);
  });

  it("treats the equal-spacing tolerance boundary as inclusive", () => {
    const candidates = [fromRect(0, 0, 10, 10), fromRect(40, 0, 10, 10)];

    expect(computeEqualSpacingIndicators(fromRect(20.5, 0, 10, 10), candidates, 1)).toHaveLength(2);
    expect(computeEqualSpacingIndicators(fromRect(20.5, 0, 10, 10), candidates, 0.99)).toEqual([]);
  });

  it("does not report equal spacing for objects outside the same row or column", () => {
    expect(
      computeEqualSpacingIndicators(
        fromRect(20, 30, 10, 10),
        [fromRect(0, 0, 10, 10), fromRect(40, 0, 10, 10)],
        1,
      ),
    ).toEqual([]);
  });
});
