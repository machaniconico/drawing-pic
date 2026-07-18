export interface GradientPoint {
  readonly x: number;
  readonly y: number;
}

export interface LinearGradientCoordinates {
  readonly start: GradientPoint;
  readonly end: GradientPoint;
}

export const linearGradientAngle = (gradient: LinearGradientCoordinates): number => {
  const degrees =
    (Math.atan2(gradient.end.y - gradient.start.y, gradient.end.x - gradient.start.x) * 180) /
    Math.PI;
  const normalizedDegrees = ((degrees % 360) + 360) % 360;

  return Math.round(normalizedDegrees * 10) / 10;
};

export const linearGradientCoordinatesForAngle = (
  gradient: LinearGradientCoordinates,
  angleDegrees: number,
): LinearGradientCoordinates => {
  const midpoint = {
    x: (gradient.start.x + gradient.end.x) / 2,
    y: (gradient.start.y + gradient.end.y) / 2,
  };
  const currentLength = Math.hypot(
    gradient.end.x - gradient.start.x,
    gradient.end.y - gradient.start.y,
  );
  const length = currentLength > 0 ? currentLength : 1;
  const radians = (angleDegrees * Math.PI) / 180;
  const halfDelta = {
    x: (Math.cos(radians) * length) / 2,
    y: (Math.sin(radians) * length) / 2,
  };

  return {
    start: {
      x: midpoint.x - halfDelta.x,
      y: midpoint.y - halfDelta.y,
    },
    end: {
      x: midpoint.x + halfDelta.x,
      y: midpoint.y + halfDelta.y,
    },
  };
};
