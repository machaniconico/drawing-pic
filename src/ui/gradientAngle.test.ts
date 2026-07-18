import { describe, expect, it } from "vitest";

import {
  linearGradientAngle,
  linearGradientCoordinatesForAngle,
  type LinearGradientCoordinates,
} from "./gradientAngle";

const expectCoordinatesCloseTo = (
  actual: LinearGradientCoordinates,
  expected: LinearGradientCoordinates,
): void => {
  expect(actual.start.x).toBeCloseTo(expected.start.x, 9);
  expect(actual.start.y).toBeCloseTo(expected.start.y, 9);
  expect(actual.end.x).toBeCloseTo(expected.end.x, 9);
  expect(actual.end.y).toBeCloseTo(expected.end.y, 9);
};

describe("linear gradient angle coordinates", () => {
  it.each([0, 45, 90, 135, 180, 225, 270, 315, 359.9])(
    "round-trips a %s degree angle through coordinates",
    (angle) => {
      const gradient = {
        start: { x: -0.75, y: 1.25 },
        end: { x: 1.75, y: 1.25 },
      };

      const coordinates = linearGradientCoordinatesForAngle(gradient, angle);

      expect(linearGradientAngle(coordinates)).toBe(angle);
    },
  );

  it("round-trips coordinates while preserving an off-canvas midpoint and length", () => {
    const gradient = {
      start: { x: -0.5, y: -0.25 },
      end: { x: 1.5, y: 1.75 },
    };

    const coordinates = linearGradientCoordinatesForAngle(
      gradient,
      linearGradientAngle(gradient),
    );

    expectCoordinatesCloseTo(coordinates, gradient);
  });

  it("uses a unit-length line around the existing midpoint for a zero-length gradient", () => {
    const coordinates = linearGradientCoordinatesForAngle(
      {
        start: { x: 1.25, y: -0.5 },
        end: { x: 1.25, y: -0.5 },
      },
      90,
    );

    expectCoordinatesCloseTo(coordinates, {
      start: { x: 1.25, y: -1 },
      end: { x: 1.25, y: 0 },
    });
  });
});
