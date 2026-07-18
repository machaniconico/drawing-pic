import type { Vec2 } from "../geometry/vector";
import type { PathNode, SubPath } from "./types";

const EPSILON = 1e-9;
const CURVE_TOLERANCE = 0.05;
const MAX_CURVE_DEPTH = 12;

export interface TextPathFontMetrics {
  /** Returns the horizontal advance for one Unicode code point. */
  measureText(char: string): number;
}

export interface TextPathPlacement {
  readonly char: string;
  readonly position: Vec2;
  /** Path tangent angle in radians, suitable for CanvasRenderingContext2D.rotate. */
  readonly angle: number;
  readonly advance: number;
  /** Arc distance of the glyph center from the start of the path. */
  readonly distance: number;
}

export type TextPathGeometry = readonly SubPath[] | Pick<PathNode, "subpaths">;

interface ArcPoint {
  readonly point: Vec2;
  readonly distance: number;
}

interface ArcPath {
  readonly points: readonly ArcPoint[];
  readonly length: number;
}

const add = (a: Vec2, b: Vec2): Vec2 => ({ x: a.x + b.x, y: a.y + b.y });

const midpoint = (a: Vec2, b: Vec2): Vec2 => ({
  x: (a.x + b.x) / 2,
  y: (a.y + b.y) / 2,
});

const distance = (a: Vec2, b: Vec2): number => Math.hypot(b.x - a.x, b.y - a.y);

const distanceToLine = (point: Vec2, start: Vec2, end: Vec2): number => {
  const dx = end.x - start.x;
  const dy = end.y - start.y;
  const chordLength = Math.hypot(dx, dy);
  if (chordLength <= EPSILON) {
    return distance(point, start);
  }
  return Math.abs(dy * point.x - dx * point.y + end.x * start.y - end.y * start.x) / chordLength;
};

const appendCubic = (
  points: Vec2[],
  p0: Vec2,
  p1: Vec2,
  p2: Vec2,
  p3: Vec2,
  depth = 0,
): void => {
  const flatness = Math.max(distanceToLine(p1, p0, p3), distanceToLine(p2, p0, p3));
  const controlLength = distance(p0, p1) + distance(p1, p2) + distance(p2, p3);
  const chordLength = distance(p0, p3);
  if (
    (flatness <= CURVE_TOLERANCE && controlLength - chordLength <= CURVE_TOLERANCE) ||
    depth >= MAX_CURVE_DEPTH
  ) {
    points.push({ ...p3 });
    return;
  }

  const p01 = midpoint(p0, p1);
  const p12 = midpoint(p1, p2);
  const p23 = midpoint(p2, p3);
  const p012 = midpoint(p01, p12);
  const p123 = midpoint(p12, p23);
  const p0123 = midpoint(p012, p123);

  appendCubic(points, p0, p01, p012, p0123, depth + 1);
  appendCubic(points, p0123, p123, p23, p3, depth + 1);
};

const flattenSubPath = (subpath: SubPath): Vec2[] => {
  const { anchors } = subpath;
  if (anchors.length === 0) {
    return [];
  }

  const points: Vec2[] = [{ ...anchors[0]!.point }];
  const segmentCount = subpath.closed ? anchors.length : anchors.length - 1;
  for (let index = 0; index < segmentCount; index += 1) {
    const start = anchors[index]!;
    const end = anchors[(index + 1) % anchors.length]!;
    if (start.handleOut === null && end.handleIn === null) {
      points.push({ ...end.point });
      continue;
    }

    appendCubic(
      points,
      start.point,
      start.handleOut === null ? start.point : add(start.point, start.handleOut),
      end.handleIn === null ? end.point : add(end.point, end.handleIn),
      end.point,
    );
  }
  return points;
};

const buildArcPath = (subpath: SubPath): ArcPath | null => {
  const flattened = flattenSubPath(subpath);
  if (flattened.length < 2) {
    return null;
  }

  const points: ArcPoint[] = [{ point: flattened[0]!, distance: 0 }];
  let total = 0;
  for (let index = 1; index < flattened.length; index += 1) {
    const point = flattened[index]!;
    const segmentLength = distance(points[points.length - 1]!.point, point);
    if (segmentLength <= EPSILON) {
      continue;
    }
    total += segmentLength;
    points.push({ point, distance: total });
  }

  return points.length < 2 ? null : { points, length: total };
};

const pointAtDistance = (path: ArcPath, target: number): { position: Vec2; angle: number } => {
  let low = 1;
  let high = path.points.length - 1;
  while (low < high) {
    const middle = Math.floor((low + high) / 2);
    if (path.points[middle]!.distance < target) {
      low = middle + 1;
    } else {
      high = middle;
    }
  }

  const end = path.points[low]!;
  const start = path.points[low - 1]!;
  const segmentLength = end.distance - start.distance;
  const t = segmentLength <= EPSILON ? 0 : (target - start.distance) / segmentLength;
  return {
    position: {
      x: start.point.x + (end.point.x - start.point.x) * t,
      y: start.point.y + (end.point.y - start.point.y) * t,
    },
    angle: Math.atan2(end.point.y - start.point.y, end.point.x - start.point.x),
  };
};

const pathSubpaths = (geometry: TextPathGeometry): readonly SubPath[] =>
  "subpaths" in geometry ? geometry.subpaths : geometry;

/**
 * Places Unicode code points on the first non-degenerate subpath using arc length.
 * Glyphs whose centers fall outside the path are omitted, while their advances still
 * contribute to subsequent glyph distances.
 */
export const layoutTextOnPath = (
  text: string,
  geometry: TextPathGeometry,
  fontMetrics: TextPathFontMetrics,
  startOffset = 0,
): TextPathPlacement[] => {
  const path = pathSubpaths(geometry)
    .map(buildArcPath)
    .find((candidate): candidate is ArcPath => candidate !== null);
  if (path === undefined) {
    return [];
  }

  let cursor = Number.isFinite(startOffset) ? startOffset : 0;
  const placements: TextPathPlacement[] = [];
  for (const char of Array.from(text)) {
    const measuredAdvance = fontMetrics.measureText(char);
    const advance = Number.isFinite(measuredAdvance) ? Math.max(0, measuredAdvance) : 0;
    const glyphDistance = cursor + advance / 2;
    cursor += advance;

    if (glyphDistance < -EPSILON || glyphDistance > path.length + EPSILON) {
      continue;
    }

    const clampedDistance = Math.min(path.length, Math.max(0, glyphDistance));
    const sample = pointAtDistance(path, clampedDistance);
    placements.push({
      char,
      position: sample.position,
      angle: sample.angle,
      advance,
      distance: glyphDistance,
    });
  }
  return placements;
};
