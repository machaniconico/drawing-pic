import { describe, expect, it } from "vitest";
import type { Vec2 } from "../geometry/vector";
import type { Anchor, SubPath } from "./types";
import {
  deleteAnchor,
  insertAnchor,
  moveAnchor,
  moveHandle,
  reverseSubPath,
  reverseSubPaths,
  setAnchorType,
} from "./pathEdit";

const v = (x: number, y: number): Vec2 => ({ x, y });

const anchor = (
  point: Vec2,
  handleIn: Vec2 | null = null,
  handleOut: Vec2 | null = null,
): Anchor => ({
  point,
  handleIn,
  handleOut,
});

const subpath = (anchors: Anchor[], closed = false): SubPath => ({ anchors, closed });

const expectVecClose = (actual: Vec2 | null, expected: Vec2): void => {
  expect(actual).not.toBeNull();
  if (actual === null) {
    throw new Error("Expected Vec2, received null");
  }
  expect(actual.x).toBeCloseTo(expected.x, 9);
  expect(actual.y).toBeCloseTo(expected.y, 9);
};

describe("path editing operations", () => {
  it("moves an anchor point while keeping handles relative", () => {
    const original = subpath([
      anchor(v(10, 20), v(-3, 4), v(5, 6)),
      anchor(v(30, 20)),
    ]);

    const result = moveAnchor(original, 0, v(2, -5));

    expect(result).not.toBe(original);
    expect(result.anchors[0]).not.toBe(original.anchors[0]);
    expect(result.anchors[0]!.point).toEqual(v(12, 15));
    expect(result.anchors[0]!.handleIn).toEqual(v(-3, 4));
    expect(result.anchors[0]!.handleOut).toEqual(v(5, 6));
    expect(original.anchors[0]!.point).toEqual(v(10, 20));
  });

  it("mirrors the opposite handle as an exact negation", () => {
    const original = subpath([anchor(v(0, 0), v(-1, 0), v(4, 0))]);

    const result = moveHandle(original, 0, "out", v(3, 7), "mirror");

    expect(result.anchors[0]!.handleOut).toEqual(v(3, 7));
    expect(result.anchors[0]!.handleIn).toEqual(v(-3, -7));
    expect(original.anchors[0]!.handleIn).toEqual(v(-1, 0));
  });

  it("aligns the opposite handle while preserving its current length", () => {
    const original = subpath([anchor(v(0, 0), v(-3, 4), v(2, 0))]);

    const result = moveHandle(original, 0, "out", v(0, 6), "align");

    expect(result.anchors[0]!.handleOut).toEqual(v(0, 6));
    expectVecClose(result.anchors[0]!.handleIn, v(0, -5));
  });

  it("moves a handle freely without touching the opposite handle", () => {
    const original = subpath([anchor(v(0, 0), v(-4, -1), v(2, 0))]);

    const result = moveHandle(original, 0, "out", v(9, 3), "free");

    expect(result.anchors[0]!.handleOut).toEqual(v(9, 3));
    expect(result.anchors[0]!.handleIn).toEqual(v(-4, -1));
  });

  it("inserts a corner anchor at the midpoint of a straight segment", () => {
    const original = subpath([anchor(v(0, 0)), anchor(v(10, 10))]);

    const result = insertAnchor(original, 0, 0.5);

    expect(result.anchors).toHaveLength(3);
    expect(result.anchors[1]).toEqual(anchor(v(5, 5)));
    expect(original.anchors).toHaveLength(2);
  });

  it("splits a cubic segment with de Casteljau at t=0.5", () => {
    const original = subpath([
      anchor(v(0, 0), null, v(0, 6)),
      anchor(v(10, 10), v(0, -6), null),
    ]);

    const result = insertAnchor(original, 0, 0.5);

    expect(result.anchors).toHaveLength(3);
    expectVecClose(result.anchors[0]!.handleOut, v(0, 3));
    expectVecClose(result.anchors[1]!.point, v(5, 5));
    expectVecClose(result.anchors[1]!.handleIn, v(-2.5, -1));
    expectVecClose(result.anchors[1]!.handleOut, v(2.5, 1));
    expectVecClose(result.anchors[2]!.handleIn, v(0, -3));
  });

  it("deletes an anchor and leaves the remaining anchors intact", () => {
    const original = subpath([anchor(v(0, 0)), anchor(v(5, 5)), anchor(v(10, 0))], true);

    const result = deleteAnchor(original, 1);

    expect(result.closed).toBe(true);
    expect(result.anchors).toEqual([anchor(v(0, 0)), anchor(v(10, 0))]);
    expect(original.anchors).toHaveLength(3);
  });

  it("sets an anchor to corner by clearing both handles", () => {
    const original = subpath([anchor(v(0, 0), v(-2, 0), v(2, 0))]);

    const result = setAnchorType(original, 0, "corner");

    expect(result.anchors[0]).toEqual(anchor(v(0, 0)));
    expect(original.anchors[0]!.handleIn).toEqual(v(-2, 0));
  });

  it("sets an anchor to smooth with opposite colinear handles", () => {
    const original = subpath([
      anchor(v(0, 0)),
      anchor(v(9, 0)),
      anchor(v(18, 0)),
    ]);

    const result = setAnchorType(original, 1, "smooth");

    expectVecClose(result.anchors[1]!.handleIn, v(-3, 0));
    expectVecClose(result.anchors[1]!.handleOut, v(3, 0));
  });

  it("reverses anchor order and swaps handles", () => {
    const original = subpath(
      [
        anchor(v(0, 0), null, v(5, 0)),
        anchor(v(10, 0), v(-5, 0), v(2, 3)),
        anchor(v(10, 10), v(0, -4), null),
      ],
      false,
    );

    const result = reverseSubPath(original);

    expect(result).not.toBe(original);
    expect(result.closed).toBe(false);
    expect(result.anchors.map((a) => a.point)).toEqual([v(10, 10), v(10, 0), v(0, 0)]);
    // Handles swap in↔out because traversal direction flips.
    expect(result.anchors[0]!.handleIn).toBeNull();
    expect(result.anchors[0]!.handleOut).toEqual(v(0, -4));
    expect(result.anchors[1]!.handleIn).toEqual(v(2, 3));
    expect(result.anchors[1]!.handleOut).toEqual(v(-5, 0));
    expect(result.anchors[2]!.handleIn).toEqual(v(5, 0));
    expect(result.anchors[2]!.handleOut).toBeNull();
    // Original is untouched (pure).
    expect(original.anchors[0]!.point).toEqual(v(0, 0));
  });

  it("preserves the closed flag and deep-clones on reverse", () => {
    const original = subpath([anchor(v(0, 0)), anchor(v(4, 0)), anchor(v(4, 4))], true);
    const result = reverseSubPath(original);
    expect(result.closed).toBe(true);
    expect(result.anchors[0]).not.toBe(original.anchors[2]);
  });

  it("reverseSubPaths maps every subpath and is an involution on points", () => {
    const subpaths = [
      subpath([anchor(v(0, 0)), anchor(v(1, 0))], false),
      subpath([anchor(v(5, 5)), anchor(v(6, 5)), anchor(v(6, 6))], true),
    ];
    const once = reverseSubPaths(subpaths);
    const twice = reverseSubPaths(once);
    expect(once).toHaveLength(2);
    expect(twice[0]!.anchors.map((a) => a.point)).toEqual(subpaths[0]!.anchors.map((a) => a.point));
    expect(twice[1]!.anchors.map((a) => a.point)).toEqual(subpaths[1]!.anchors.map((a) => a.point));
  });
});
