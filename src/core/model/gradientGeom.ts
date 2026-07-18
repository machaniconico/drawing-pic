import type { Vec2 } from "../geometry/vector";

export interface LinearGradientGeometry {
  start: Vec2;
  end: Vec2;
}

export interface RadialGradientGeometry {
  center: Vec2;
  radius: number;
}

export function gradientGeometryFromDrag(
  type: "linear",
  start: Vec2,
  end: Vec2,
): LinearGradientGeometry;
export function gradientGeometryFromDrag(
  type: "radial",
  start: Vec2,
  end: Vec2,
): RadialGradientGeometry;
export function gradientGeometryFromDrag(
  type: "linear" | "radial",
  start: Vec2,
  end: Vec2,
): LinearGradientGeometry | RadialGradientGeometry {
  if (type === "linear") {
    return {
      start: { ...start },
      end: { ...end },
    };
  }

  return {
    center: { ...start },
    radius: Math.hypot(end.x - start.x, end.y - start.y),
  };
}
