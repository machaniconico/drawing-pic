import { describe, expect, it } from "vitest";
import type { SubPath } from "./types";
import { layoutTextOnPath, type TextPathFontMetrics } from "./textOnPath";

const corner = (x: number, y: number): SubPath["anchors"][number] => ({
  point: { x, y },
  handleIn: null,
  handleOut: null,
});

const line = (length = 100): SubPath => ({
  anchors: [corner(0, 0), corner(length, 0)],
  closed: false,
});

const fixedAdvance = (advance: number): TextPathFontMetrics => ({
  measureText: () => advance,
});

describe("layoutTextOnPath", () => {
  it("places glyph centers and tangents along a straight path", () => {
    const result = layoutTextOnPath("ABC", [line()], fixedAdvance(10));

    expect(result.map(({ char, position, angle, distance }) => ({ char, position, angle, distance }))).toEqual([
      { char: "A", position: { x: 5, y: 0 }, angle: 0, distance: 5 },
      { char: "B", position: { x: 15, y: 0 }, angle: 0, distance: 15 },
      { char: "C", position: { x: 25, y: 0 }, angle: 0, distance: 25 },
    ]);
  });

  it("follows a curved path by arc length and returns its tangent angle", () => {
    // Standard cubic approximation of a quarter circle with radius 100.
    const kappa = 0.5522847498307936;
    const quarterCircle: SubPath = {
      anchors: [
        {
          point: { x: 100, y: 0 },
          handleIn: null,
          handleOut: { x: 0, y: 100 * kappa },
        },
        {
          point: { x: 0, y: 100 },
          handleIn: { x: 100 * kappa, y: 0 },
          handleOut: null,
        },
      ],
      closed: false,
    };

    const result = layoutTextOnPath("A", [quarterCircle], fixedAdvance(Math.PI * 50));

    expect(result).toHaveLength(1);
    expect(result[0]!.position.x).toBeCloseTo(Math.SQRT1_2 * 100, 1);
    expect(result[0]!.position.y).toBeCloseTo(Math.SQRT1_2 * 100, 1);
    expect(result[0]!.angle).toBeCloseTo((3 * Math.PI) / 4, 1);
  });

  it("applies startOffset before the first glyph advance", () => {
    const result = layoutTextOnPath("AB", [line()], fixedAdvance(10), 20);

    expect(result.map((glyph) => glyph.distance)).toEqual([25, 35]);
    expect(result.map((glyph) => glyph.position.x)).toEqual([25, 35]);
  });

  it("uses each glyph's measured advance to position following glyphs", () => {
    const advances: Record<string, number> = { A: 10, B: 30, C: 20 };
    const result = layoutTextOnPath("ABC", [line()], {
      measureText: (char) => advances[char]!,
    });

    expect(result.map((glyph) => glyph.advance)).toEqual([10, 30, 20]);
    expect(result.map((glyph) => glyph.distance)).toEqual([5, 25, 50]);
  });

  it("skips centers outside the path and handles degenerate geometry", () => {
    expect(layoutTextOnPath("ABC", [line(15)], fixedAdvance(10)).map((glyph) => glyph.char)).toEqual([
      "A",
      "B",
    ]);
    expect(layoutTextOnPath("A", [{ anchors: [corner(0, 0)], closed: false }], fixedAdvance(10))).toEqual([]);
  });

  it("iterates Unicode code points rather than UTF-16 code units", () => {
    const result = layoutTextOnPath("A🎨", [line()], fixedAdvance(10));

    expect(result.map((glyph) => glyph.char)).toEqual(["A", "🎨"]);
  });
});
