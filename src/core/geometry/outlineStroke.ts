import { flattenSubPathToPolyline, offsetSubPaths } from "./offsetPath";
import { add, distSq, dot, equals, len, normalize, scale, sub, type Vec2 } from "./vector";
import type { LineCap, LineJoin, SubPath } from "../model/types";

const EPS = 1e-9;
const ROUND_STEP = Math.PI / 12;

type StrokeAlign = "center" | "inside" | "outside";

const clonePoint = (point: Vec2): Vec2 => ({ x: point.x, y: point.y });

const finitePoint = (point: Vec2): boolean => Number.isFinite(point.x) && Number.isFinite(point.y);

const cornerSubPath = (points: readonly Vec2[]): SubPath => ({
  anchors: points.map((point) => ({
    point: clonePoint(point),
    handleIn: null,
    handleOut: null,
  })),
  closed: true,
});

const pointsOf = (subpath: SubPath): Vec2[] => subpath.anchors.map((anchor) => clonePoint(anchor.point));

const pushPoint = (points: Vec2[], point: Vec2): void => {
  if (points.length === 0 || !equals(points[points.length - 1]!, point, EPS)) {
    points.push(clonePoint(point));
  }
};

const distinctAnchorPointCount = (subpath: SubPath): number => {
  const distinct: Vec2[] = [];
  for (const anchor of subpath.anchors) {
    if (!finitePoint(anchor.point)) {
      return 0;
    }
    if (!distinct.some((point) => equals(point, anchor.point, EPS))) {
      distinct.push(anchor.point);
    }
  }
  return distinct.length;
};

const offsetPoints = (subpath: SubPath, distance: number, join: LineJoin, miterLimit: number): Vec2[] => {
  if (Math.abs(distance) <= EPS) {
    return flattenSubPathToPolyline(subpath);
  }

  const [offset] = offsetSubPaths([subpath], distance, join, miterLimit);
  return offset ? pointsOf(offset) : [];
};

const closedDistances = (width: number, align: StrokeAlign): readonly [number, number] => {
  if (align === "inside") {
    return [0, -width];
  }
  if (align === "outside") {
    return [width, 0];
  }
  return [width / 2, -width / 2];
};

const firstTangent = (subpath: SubPath): Vec2 => {
  const first = subpath.anchors[0]!;
  if (first.handleOut && len(first.handleOut) > EPS) {
    return normalize(first.handleOut);
  }

  for (let index = 1; index < subpath.anchors.length; index += 1) {
    const delta = sub(subpath.anchors[index]!.point, first.point);
    if (len(delta) > EPS) {
      return normalize(delta);
    }
  }

  return { x: 0, y: 0 };
};

const lastTangent = (subpath: SubPath): Vec2 => {
  const last = subpath.anchors[subpath.anchors.length - 1]!;
  if (last.handleIn && len(last.handleIn) > EPS) {
    return normalize(scale(last.handleIn, -1));
  }

  for (let index = subpath.anchors.length - 2; index >= 0; index -= 1) {
    const delta = sub(last.point, subpath.anchors[index]!.point);
    if (len(delta) > EPS) {
      return normalize(delta);
    }
  }

  return { x: 0, y: 0 };
};

const extendSide = (
  points: readonly Vec2[],
  startTangent: Vec2,
  endTangent: Vec2,
  halfWidth: number,
): Vec2[] =>
  points.map((point, index) => {
    if (index === 0) {
      return add(point, scale(startTangent, -halfWidth));
    }
    if (index === points.length - 1) {
      return add(point, scale(endTangent, halfWidth));
    }
    return clonePoint(point);
  });

const capArcPoints = (center: Vec2, start: Vec2, end: Vec2, outward: Vec2): Vec2[] => {
  const radiusSq = distSq(center, start);
  if (radiusSq <= EPS * EPS || equals(start, end, EPS)) {
    return [clonePoint(start)];
  }

  const startAngle = Math.atan2(start.y - center.y, start.x - center.x);
  const endAngle = Math.atan2(end.y - center.y, end.x - center.x);
  let positiveSweep = endAngle - startAngle;
  while (positiveSweep <= EPS) {
    positiveSweep += Math.PI * 2;
  }

  const negativeSweep = positiveSweep - Math.PI * 2;
  const positiveMid = {
    x: Math.cos(startAngle + positiveSweep / 2),
    y: Math.sin(startAngle + positiveSweep / 2),
  };
  const negativeMid = {
    x: Math.cos(startAngle + negativeSweep / 2),
    y: Math.sin(startAngle + negativeSweep / 2),
  };
  const sweep = dot(positiveMid, outward) >= dot(negativeMid, outward) ? positiveSweep : negativeSweep;
  const radius = Math.sqrt(radiusSq);
  const steps = Math.max(1, Math.ceil(Math.abs(sweep) / ROUND_STEP));
  const points: Vec2[] = [clonePoint(start)];

  for (let step = 1; step < steps; step += 1) {
    const angle = startAngle + (sweep * step) / steps;
    points.push({
      x: center.x + Math.cos(angle) * radius,
      y: center.y + Math.sin(angle) * radius,
    });
  }
  points.push(clonePoint(end));

  return points;
};

const openOutline = (subpath: SubPath, width: number, cap: LineCap, join: LineJoin, miterLimit: number): SubPath | null => {
  const halfWidth = width / 2;
  const startCenter = subpath.anchors[0]!.point;
  const endCenter = subpath.anchors[subpath.anchors.length - 1]!.point;
  const startTangent = firstTangent(subpath);
  const endTangent = lastTangent(subpath);

  if (len(startTangent) <= EPS || len(endTangent) <= EPS) {
    return null;
  }

  let left = offsetPoints(subpath, halfWidth, join, miterLimit);
  let right = offsetPoints(subpath, -halfWidth, join, miterLimit);
  if (left.length < 2 || right.length < 2) {
    return null;
  }

  if (cap === "square") {
    left = extendSide(left, startTangent, endTangent, halfWidth);
    right = extendSide(right, startTangent, endTangent, halfWidth);
  }

  const ring: Vec2[] = [];
  for (const point of left) {
    pushPoint(ring, point);
  }

  const reversedRight = [...right].reverse();
  if (cap === "round") {
    for (const point of capArcPoints(endCenter, left[left.length - 1]!, reversedRight[0]!, endTangent)) {
      pushPoint(ring, point);
    }
  } else {
    pushPoint(ring, reversedRight[0]!);
  }

  for (const point of reversedRight) {
    pushPoint(ring, point);
  }

  if (cap === "round") {
    for (const point of capArcPoints(startCenter, right[0]!, left[0]!, scale(startTangent, -1))) {
      pushPoint(ring, point);
    }
  } else {
    pushPoint(ring, left[0]!);
  }

  if (ring.length > 1 && equals(ring[0]!, ring[ring.length - 1]!, EPS)) {
    ring.pop();
  }

  return ring.length >= 3 ? cornerSubPath(ring) : null;
};

/**
 * Converts stroked centerlines into closed filled stroke-outline rings.
 * This intentionally does not remove self-intersections from offsets or caps;
 * callers that need robust final contours should run a cleanup/boolean pass.
 */
export const strokeOutlineSubPaths = (
  subpaths: SubPath[],
  width: number,
  cap: LineCap,
  join: LineJoin,
  miterLimit: number,
  align: StrokeAlign,
): SubPath[] => {
  if (!Number.isFinite(width) || width <= 0) {
    return [];
  }

  const outlines: SubPath[] = [];
  for (const subpath of subpaths) {
    if (distinctAnchorPointCount(subpath) < 2 || (subpath.closed && distinctAnchorPointCount(subpath) < 3)) {
      continue;
    }

    if (subpath.closed) {
      const [outerDistance, innerDistance] = closedDistances(width, align);
      const outer = offsetPoints(subpath, outerDistance, join, miterLimit);
      const inner = offsetPoints(subpath, innerDistance, join, miterLimit).reverse();

      if (outer.length >= 3 && inner.length >= 3) {
        outlines.push(cornerSubPath(outer), cornerSubPath(inner));
      }
      continue;
    }

    const outline = openOutline(subpath, width, cap, join, miterLimit);
    if (outline) {
      outlines.push(outline);
    }
  }

  return outlines;
};
