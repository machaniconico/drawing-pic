import { describe, expect, it } from "vitest";
import { fromRect } from "../geometry/bbox";
import { computeSmartGuides } from "./smartGuides";

describe("computeSmartGuides", () => {
  it("detects vertical edge alignment and returns an x correction", () => {
    const result = computeSmartGuides(
      fromRect(12, 40, 20, 10),
      [fromRect(10, 0, 20, 20)],
      3,
    );

    expect(result.delta).toEqual({ x: -2, y: 0 });
    expect(result.guides).toContainEqual({
      axis: "x",
      start: { x: 10, y: 0 },
      end: { x: 10, y: 50 },
    });
  });

  it("detects horizontal center alignment and returns a y correction", () => {
    const result = computeSmartGuides(
      fromRect(40, 19, 10, 10),
      [fromRect(0, 0, 20, 50)],
      2,
    );

    expect(result.delta).toEqual({ x: 0, y: 1 });
    expect(result.guides).toContainEqual({
      axis: "y",
      start: { x: 0, y: 25 },
      end: { x: 50, y: 25 },
    });
  });

  it("detects center alignment independently on both axes", () => {
    const result = computeSmartGuides(
      fromRect(18, 19, 10, 10),
      [fromRect(0, 0, 50, 50)],
      3,
    );

    expect(result.delta).toEqual({ x: 2, y: 1 });
    expect(result.guides).toEqual([
      { axis: "x", start: { x: 25, y: 0 }, end: { x: 25, y: 50 } },
      { axis: "y", start: { x: 0, y: 25 }, end: { x: 50, y: 25 } },
    ]);
  });

  it("returns no correction or guides outside the threshold", () => {
    expect(
      computeSmartGuides(
        fromRect(100, 100, 10, 10),
        [fromRect(0, 0, 10, 10)],
        5,
      ),
    ).toEqual({ delta: { x: 0, y: 0 }, guides: [] });
  });
});
