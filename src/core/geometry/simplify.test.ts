import { describe, expect, it } from "vitest";
import { simplifySubPaths } from "./simplify";
import type { Vec2 } from "./vector";
import type { Anchor, SubPath } from "../model/types";

const corner = (point: Vec2): Anchor => ({ point, handleIn: null, handleOut: null });

const subpath = (points: readonly Vec2[], closed: boolean): SubPath => ({
  anchors: points.map(corner),
  closed,
});

const pointsOf = (path: SubPath): Vec2[] => path.anchors.map((a) => a.point);

describe("simplifySubPaths", () => {
  it("removes a single collinear interior corner on an open path", () => {
    const line = subpath(
      [
        { x: 0, y: 0 },
        { x: 50, y: 0 },
        { x: 100, y: 0 },
      ],
      false,
    );
    const [result] = simplifySubPaths([line], 0.01);
    expect(pointsOf(result!)).toEqual([
      { x: 0, y: 0 },
      { x: 100, y: 0 },
    ]);
  });

  it("collapses a chain of many collinear points in one call", () => {
    const many = subpath(
      [
        { x: 0, y: 0 },
        { x: 10, y: 0 },
        { x: 20, y: 0 },
        { x: 30, y: 0 },
        { x: 40, y: 0 },
        { x: 50, y: 0 },
      ],
      false,
    );
    const [result] = simplifySubPaths([many], 0.01);
    expect(pointsOf(result!)).toEqual([
      { x: 0, y: 0 },
      { x: 50, y: 0 },
    ]);
  });

  it("keeps points that deviate beyond the tolerance", () => {
    const bumpy = subpath(
      [
        { x: 0, y: 0 },
        { x: 50, y: 5 },
        { x: 100, y: 0 },
      ],
      false,
    );
    // Deviation of the middle point from the chord is 5 > tolerance 1.
    const [result] = simplifySubPaths([bumpy], 1);
    expect(result!.anchors).toHaveLength(3);
    // With a generous tolerance the bump is absorbed.
    const [loose] = simplifySubPaths([bumpy], 10);
    expect(loose!.anchors).toHaveLength(2);
  });

  it("never removes the endpoints of an open path", () => {
    const line = subpath(
      [
        { x: 0, y: 0 },
        { x: 100, y: 0 },
      ],
      false,
    );
    const [result] = simplifySubPaths([line], 100);
    expect(pointsOf(result!)).toEqual([
      { x: 0, y: 0 },
      { x: 100, y: 0 },
    ]);
  });

  it("removes redundant edge midpoints of a closed square without dropping below 3", () => {
    const square = subpath(
      [
        { x: 0, y: 0 },
        { x: 50, y: 0 },
        { x: 100, y: 0 },
        { x: 100, y: 100 },
        { x: 0, y: 100 },
      ],
      true,
    );
    const [result] = simplifySubPaths([square], 0.01);
    // The collinear (50,0) midpoint goes; the 4 real corners remain.
    expect(result!.closed).toBe(true);
    expect(pointsOf(result!)).toEqual([
      { x: 0, y: 0 },
      { x: 100, y: 0 },
      { x: 100, y: 100 },
      { x: 0, y: 100 },
    ]);
  });

  it("keeps a fully collinear closed loop at the minimum of three anchors", () => {
    const degenerate = subpath(
      [
        { x: 0, y: 0 },
        { x: 10, y: 0 },
        { x: 20, y: 0 },
        { x: 30, y: 0 },
      ],
      true,
    );
    const [result] = simplifySubPaths([degenerate], 0.01);
    expect(result!.anchors.length).toBeGreaterThanOrEqual(3);
  });

  it("preserves anchors that carry bezier handles", () => {
    const curved: SubPath = {
      anchors: [
        corner({ x: 0, y: 0 }),
        { point: { x: 50, y: 0 }, handleIn: { x: -10, y: 0 }, handleOut: { x: 10, y: 0 } },
        corner({ x: 100, y: 0 }),
      ],
      closed: false,
    };
    const [result] = simplifySubPaths([curved], 100);
    // The middle anchor has handles → not removable even though collinear.
    expect(result!.anchors).toHaveLength(3);
  });

  it("does not remove a corner whose neighbour segment is a curve", () => {
    const mixed: SubPath = {
      anchors: [
        { point: { x: 0, y: 0 }, handleIn: null, handleOut: { x: 10, y: 0 } },
        corner({ x: 50, y: 0 }),
        corner({ x: 100, y: 0 }),
      ],
      closed: false,
    };
    const [result] = simplifySubPaths([mixed], 100);
    // (50,0) is a pure corner but its incoming segment is a curve (prev.handleOut
    // is set), so it is preserved.
    expect(pointsOf(result!)).toContainEqual({ x: 50, y: 0 });
  });

  it("returns clones and leaves tiny subpaths untouched", () => {
    const tiny = subpath([{ x: 1, y: 1 }], false);
    const [result] = simplifySubPaths([tiny], 5);
    expect(result!.anchors).toHaveLength(1);
    expect(result).not.toBe(tiny);
  });
});
