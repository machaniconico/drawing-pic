import { describe, expect, it } from "vitest";
import { roundCorners } from "./roundCorners";
import type { Vec2 } from "./vector";
import type { Anchor, SubPath } from "../model/types";

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

describe("roundCorners", () => {
  it("returns structurally equal clones for a non-positive radius", () => {
    const input = square();
    const [result] = roundCorners([input], 0);
    expect(result).toEqual(input);
    expect(result).not.toBe(input);
    expect(result!.anchors[0]).not.toBe(input.anchors[0]);
  });

  it("treats negative radius as a no-op", () => {
    const [result] = roundCorners([square()], -10);
    expect(result!.anchors).toHaveLength(4);
    expect(result!.anchors.every((a) => a.handleIn === null && a.handleOut === null)).toBe(true);
  });

  it("splits each square corner into two tangent anchors", () => {
    const [result] = roundCorners([square()], 20);
    expect(result!.closed).toBe(true);
    expect(result!.anchors).toHaveLength(8);
  });

  it("places tangent points radius-distance along each edge for right angles", () => {
    const [result] = roundCorners([square()], 20);
    // Corner (0,0) sits between the incoming edge from (0,100) and the outgoing
    // edge to (100,0). For a 90° corner the trim-back distance equals the radius
    // (20). The tangent anchors are emitted toward-prev first, then toward-next.
    const first = result!.anchors[0]!;
    const second = result!.anchors[1]!;
    expect(first.point.x).toBeCloseTo(0, 6);
    expect(first.point.y).toBeCloseTo(20, 6);
    expect(second.point.x).toBeCloseTo(20, 6);
    expect(second.point.y).toBeCloseTo(0, 6);
  });

  it("gives the quarter-circle kappa handle length for 90° corners", () => {
    const [result] = roundCorners([square()], 20);
    const first = result!.anchors[0]!;
    // handle length ≈ radius * (4/3) * tan(pi/8) ≈ 20 * 0.55228 ≈ 11.0457
    expect(first.handleOut).not.toBeNull();
    expect(Math.hypot(first.handleOut!.x, first.handleOut!.y)).toBeCloseTo(20 * 0.5522847498, 5);
    expect(first.handleIn).toBeNull();
  });

  it("clamps the fillet so it never exceeds half the shortest edge", () => {
    // Very thin rectangle: height 10, so max trim-back is 5 regardless of radius.
    const rect = subpath(
      [
        { x: 0, y: 0 },
        { x: 100, y: 0 },
        { x: 100, y: 10 },
        { x: 0, y: 10 },
      ],
      true,
    );
    const [result] = roundCorners([rect], 999);
    expect(result!.anchors).toHaveLength(8);
    for (const anchor of result!.anchors) {
      expect(anchor.point.y).toBeGreaterThanOrEqual(-EPSILON);
      expect(anchor.point.y).toBeLessThanOrEqual(10 + EPSILON);
      // No tangent point should sit past the vertical midpoint of the short edge.
      const withinShortEdge = anchor.point.y <= 5 + EPSILON || anchor.point.y >= 5 - EPSILON;
      expect(withinShortEdge).toBe(true);
    }
  });

  it("leaves anchors that already carry handles untouched", () => {
    const curved: SubPath = {
      anchors: [
        { point: { x: 0, y: 0 }, handleIn: null, handleOut: { x: 10, y: 0 } },
        corner({ x: 100, y: 0 }),
        { point: { x: 100, y: 100 }, handleIn: { x: 0, y: -10 }, handleOut: null },
      ],
      closed: true,
    };
    const [result] = roundCorners([curved], 15);
    // Only the middle pure corner gets rounded → 2 anchors; the two smooth
    // anchors survive → 4 total.
    expect(result!.anchors).toHaveLength(4);
    const smooth = result!.anchors[0]!;
    expect(smooth.handleOut).toEqual({ x: 10, y: 0 });
  });

  it("leaves the endpoints of an open subpath sharp", () => {
    const open = subpath(
      [
        { x: 0, y: 0 },
        { x: 50, y: 0 },
        { x: 50, y: 50 },
      ],
      false,
    );
    const [result] = roundCorners([open], 10);
    const start = result!.anchors[0]!;
    const end = result!.anchors[result!.anchors.length - 1]!;
    expect(start.point).toEqual({ x: 0, y: 0 });
    expect(start.handleIn).toBeNull();
    expect(start.handleOut).toBeNull();
    expect(end.point).toEqual({ x: 50, y: 50 });
    expect(end.handleOut).toBeNull();
    // The single interior corner (50,0) becomes two tangent anchors.
    expect(result!.anchors).toHaveLength(4);
  });

  it("keeps collinear anchors unrounded", () => {
    const line = subpath(
      [
        { x: 0, y: 0 },
        { x: 50, y: 0 },
        { x: 100, y: 0 },
        { x: 100, y: 50 },
      ],
      true,
    );
    const [result] = roundCorners([line], 10);
    // The straight-through anchor at (50,0) is not a corner and is preserved,
    // so only the two genuine corners round → 2 + 2 + 1 = 5 anchors.
    const midpoints = result!.anchors.filter((a) => a.point.x === 50 && a.point.y === 0);
    expect(midpoints).toHaveLength(1);
    expect(midpoints[0]!.handleIn).toBeNull();
    expect(midpoints[0]!.handleOut).toBeNull();
  });

  it("ignores degenerate subpaths with fewer than three anchors", () => {
    const twoPoint = subpath(
      [
        { x: 0, y: 0 },
        { x: 10, y: 0 },
      ],
      false,
    );
    const [result] = roundCorners([twoPoint], 5);
    expect(result!.anchors).toHaveLength(2);
  });
});

const EPSILON = 1e-6;
