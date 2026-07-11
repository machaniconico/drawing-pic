import { describe, expect, it } from "vitest";
import { zigzagSubPaths } from "./zigzag";
import type { Vec2 } from "./vector";
import type { Anchor, SubPath } from "../model/types";

const corner = (point: Vec2): Anchor => ({ point, handleIn: null, handleOut: null });

const subpath = (points: readonly Vec2[], closed: boolean): SubPath => ({
  anchors: points.map(corner),
  closed,
});

describe("zigzagSubPaths", () => {
  it("returns structurally equal clones for a zero size", () => {
    const input = subpath(
      [
        { x: 0, y: 0 },
        { x: 100, y: 0 },
      ],
      false,
    );
    const [result] = zigzagSubPaths([input], 0, 3);
    expect(result).toEqual(input);
    expect(result).not.toBe(input);
  });

  it("treats a ridge count below one as a no-op", () => {
    const input = subpath(
      [
        { x: 0, y: 0 },
        { x: 100, y: 0 },
      ],
      false,
    );
    const [result] = zigzagSubPaths([input], 10, 0);
    expect(result!.anchors).toHaveLength(2);
  });

  it("inserts ridge points on a horizontal open segment with alternating sign", () => {
    const input = subpath(
      [
        { x: 0, y: 0 },
        { x: 100, y: 0 },
      ],
      false,
    );
    const [result] = zigzagSubPaths([input], 10, 3);
    // start + 3 ridges + end
    expect(result!.anchors).toHaveLength(5);
    const ys = result!.anchors.map((a) => a.point.y);
    // Endpoints stay on the baseline; ridges alternate +/-.
    expect(ys[0]).toBeCloseTo(0, 9);
    expect(ys[4]).toBeCloseTo(0, 9);
    // Normal of a left-to-right segment is (0, +1) → first ridge goes +y.
    expect(ys[1]).toBeCloseTo(10, 9);
    expect(ys[2]).toBeCloseTo(-10, 9);
    expect(ys[3]).toBeCloseTo(10, 9);
    // Ridge x positions are evenly spaced quarter points.
    expect(result!.anchors[1]!.point.x).toBeCloseTo(25, 9);
    expect(result!.anchors[2]!.point.x).toBeCloseTo(50, 9);
    expect(result!.anchors[3]!.point.x).toBeCloseTo(75, 9);
  });

  it("all produced anchors are sharp corners", () => {
    const input = subpath(
      [
        { x: 0, y: 0 },
        { x: 60, y: 0 },
      ],
      false,
    );
    const [result] = zigzagSubPaths([input], 5, 2);
    expect(result!.anchors.every((a) => a.handleIn === null && a.handleOut === null)).toBe(true);
  });

  it("keeps a closed square closed and adds ridges on every side", () => {
    const square = subpath(
      [
        { x: 0, y: 0 },
        { x: 100, y: 0 },
        { x: 100, y: 100 },
        { x: 0, y: 100 },
      ],
      true,
    );
    const [result] = zigzagSubPaths([square], 8, 1);
    expect(result!.closed).toBe(true);
    // 4 original anchors + 1 ridge per side = 8.
    expect(result!.anchors).toHaveLength(8);
  });

  it("skips zero-length segments without inserting ridges", () => {
    const degenerate = subpath(
      [
        { x: 10, y: 10 },
        { x: 10, y: 10 },
        { x: 40, y: 10 },
      ],
      false,
    );
    const [result] = zigzagSubPaths([degenerate], 5, 2);
    // First (zero-length) segment contributes only its start anchor; second
    // segment contributes start + 2 ridges; trailing endpoint closes it out.
    expect(result!.anchors).toHaveLength(1 + 3 + 1);
  });

  it("ignores subpaths with fewer than two anchors", () => {
    const single = subpath([{ x: 5, y: 5 }], false);
    const [result] = zigzagSubPaths([single], 10, 3);
    expect(result!.anchors).toHaveLength(1);
  });
});
