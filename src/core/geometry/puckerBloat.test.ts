import { describe, expect, it } from "vitest";
import { puckerBloatSubPaths } from "./puckerBloat";
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

describe("puckerBloatSubPaths", () => {
  it("returns structural clones for a zero amount", () => {
    const input = square();
    const [result] = puckerBloatSubPaths([input], 0);
    expect(result).toEqual(input);
    expect(result).not.toBe(input);
  });

  it("treats a non-finite amount as a no-op", () => {
    const [inf] = puckerBloatSubPaths([square()], Number.POSITIVE_INFINITY);
    expect(inf!.anchors.every((a) => a.handleIn === null && a.handleOut === null)).toBe(true);
    const [nan] = puckerBloatSubPaths([square()], Number.NaN);
    expect(nan!.anchors.every((a) => a.handleIn === null)).toBe(true);
  });

  it("keeps anchor points fixed and sets radial handles for bloat", () => {
    const [result] = puckerBloatSubPaths([square()], 0.5);
    // Centroid of the symmetric square is the origin.
    expect(result!.anchors.map((a) => a.point)).toEqual([
      { x: -10, y: -10 },
      { x: 10, y: -10 },
      { x: 10, y: 10 },
      { x: -10, y: 10 },
    ]);
    // Each handle is radial (anchor - centroid) * amount, and in == out.
    const first = result!.anchors[0]!;
    expect(first.handleIn).toEqual({ x: -5, y: -5 });
    expect(first.handleOut).toEqual({ x: -5, y: -5 });
  });

  it("points handles inward for a negative (pucker) amount", () => {
    const [result] = puckerBloatSubPaths([square()], -0.5);
    const first = result!.anchors[0]!;
    // anchor (-10,-10) → radial *(-0.5) points toward the centroid (inward).
    expect(first.handleIn).toEqual({ x: 5, y: 5 });
  });

  it("leaves an anchor sitting on the centroid untouched (no null→zero handles)", () => {
    // Centroid is the origin; the third anchor sits exactly on it.
    const withCenterAnchor: SubPath = {
      anchors: [corner({ x: -6, y: 0 }), corner({ x: 6, y: 0 }), corner({ x: 0, y: 0 })],
      closed: true,
    };
    const [result] = puckerBloatSubPaths([withCenterAnchor], 0.5);
    const centerAnchor = result!.anchors[2]!;
    expect(centerAnchor.handleIn).toBeNull();
    expect(centerAnchor.handleOut).toBeNull();
    // The off-centre anchors still get radial handles.
    expect(result!.anchors[0]!.handleOut).toEqual({ x: -3, y: 0 });
  });

  it("is a no-op for a subpath whose anchors are all coincident", () => {
    const coincident: SubPath = {
      anchors: [corner({ x: 5, y: 5 }), corner({ x: 5, y: 5 }), corner({ x: 5, y: 5 })],
      closed: true,
    };
    const [result] = puckerBloatSubPaths([coincident], 0.5);
    expect(result!.anchors.every((a) => a.handleIn === null && a.handleOut === null)).toBe(true);
  });

  it("leaves subpaths with fewer than two anchors unchanged", () => {
    const single: SubPath = { anchors: [corner({ x: 3, y: 4 })], closed: false };
    const [result] = puckerBloatSubPaths([single], 0.5);
    expect(result!.anchors[0]!.handleIn).toBeNull();
  });

  it("computes the centroid from anchor positions, not the origin", () => {
    const offset: SubPath = {
      anchors: [corner({ x: 100, y: 100 }), corner({ x: 120, y: 100 }), corner({ x: 110, y: 120 })],
      closed: true,
    };
    const [result] = puckerBloatSubPaths([offset], 1);
    // Centroid = (110, 106.667). Handle of first anchor = point - centroid.
    const first = result!.anchors[0]!;
    expect(first.handleOut!.x).toBeCloseTo(100 - 110, 6);
    expect(first.handleOut!.y).toBeCloseTo(100 - 320 / 3, 6);
  });
});
