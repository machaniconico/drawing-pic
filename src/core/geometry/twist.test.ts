import { describe, expect, it } from "vitest";
import { twistSubPaths } from "./twist";
import type { Vec2 } from "./vector";
import type { Anchor, SubPath } from "../model/types";

const corner = (point: Vec2): Anchor => ({ point, handleIn: null, handleOut: null });

const square = (): SubPath => ({
  anchors: [
    corner({ x: -10, y: -10 }),
    corner({ x: 10, y: -10 }),
    corner({ x: 10, y: 10 }),
    corner({ x: -10, y: 10 }),
  ],
  closed: true,
});

describe("twistSubPaths", () => {
  it("returns clones for a zero or non-finite angle", () => {
    const input = square();
    expect(twistSubPaths([input], 0)[0]).toEqual(input);
    expect(twistSubPaths([input], Number.POSITIVE_INFINITY)[0]).toEqual(input);
    expect(twistSubPaths([input], Number.NaN)[0]).toEqual(input);
  });

  it("keeps the centroid fixed and preserves each anchor's radius", () => {
    const [result] = twistSubPaths([square()], Math.PI / 4);
    // Centroid is the origin; every corner is sqrt(200) from it, and rotation
    // preserves that distance.
    for (const anchor of result!.anchors) {
      expect(Math.hypot(anchor.point.x, anchor.point.y)).toBeCloseTo(Math.sqrt(200), 6);
    }
  });

  it("rotates outer anchors by the full angle", () => {
    // Two anchors: one at the centre (distance 0), one out at (10,0).
    const line: SubPath = {
      anchors: [corner({ x: 0, y: 0 }), corner({ x: 10, y: 0 })],
      closed: false,
    };
    const [result] = twistSubPaths([line], Math.PI / 2);
    // Centroid = (5,0), maxDist = 5. The far anchor (10,0) is 5 from centre →
    // full 90° rotation about (5,0): (10,0) → (5,5).
    const far = result!.anchors[1]!.point;
    expect(far.x).toBeCloseTo(5, 6);
    expect(far.y).toBeCloseTo(5, 6);
    // The (0,0) anchor is also 5 from centre → also rotates a full 90°: → (5,-5).
    const near = result!.anchors[0]!.point;
    expect(near.x).toBeCloseTo(5, 6);
    expect(near.y).toBeCloseTo(-5, 6);
  });

  it("scales rotation by distance from the centroid", () => {
    // Anchors at distances 0, 1, 2 from their centroid along x.
    const pts: SubPath = {
      anchors: [corner({ x: 0, y: 0 }), corner({ x: 3, y: 0 }), corner({ x: 6, y: 0 })],
      closed: false,
    };
    const [result] = twistSubPaths([pts], Math.PI);
    // Centroid = (3,0), maxDist = 3. Middle anchor is AT the centroid → angle 0
    // → stays put.
    const middle = result!.anchors[1]!.point;
    expect(middle.x).toBeCloseTo(3, 6);
    expect(middle.y).toBeCloseTo(0, 6);
  });

  it("rotates handles along with their anchor", () => {
    const withHandle: SubPath = {
      anchors: [
        corner({ x: -5, y: 0 }),
        { point: { x: 5, y: 0 }, handleIn: { x: -2, y: 0 }, handleOut: { x: 2, y: 0 } },
      ],
      closed: false,
    };
    const [result] = twistSubPaths([withHandle], Math.PI / 2);
    // Both anchors are 5 from the centroid (0,0) → full 90° rotation. The
    // handle (2,0) becomes (0,2).
    const handled = result!.anchors[1]!;
    expect(handled.handleOut!.x).toBeCloseTo(0, 6);
    expect(handled.handleOut!.y).toBeCloseTo(2, 6);
  });

  it("shares one centroid across multiple subpaths", () => {
    const two = [
      { anchors: [corner({ x: 0, y: 0 }), corner({ x: 10, y: 0 })], closed: false },
      { anchors: [corner({ x: 0, y: 10 }), corner({ x: 10, y: 10 })], closed: false },
    ];
    const result = twistSubPaths(two, Math.PI / 6);
    expect(result).toHaveLength(2);
    // Centroid is (5,5); no anchor should remain exactly where it started.
    expect(result[0]!.anchors[0]!.point).not.toEqual({ x: 0, y: 0 });
  });
});
