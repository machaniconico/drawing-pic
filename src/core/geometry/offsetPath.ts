import type { Vec2 } from "./vector";
import { ringArea } from "./polygonBoolean";
import type { LineJoin, SubPath } from "../model/types";

const EPS = 1e-9;
const CURVE_SEGMENTS = 16;
const ROUND_STEP = Math.PI / 12;

interface OffsetEdge {
  readonly start: Vec2;
  readonly end: Vec2;
  readonly direction: Vec2;
}

const clonePoint = (point: Vec2): Vec2 => ({ x: point.x, y: point.y });

const cloneSubPath = (subpath: SubPath): SubPath => ({
  anchors: subpath.anchors.map((anchor) => ({
    point: clonePoint(anchor.point),
    handleIn: anchor.handleIn ? clonePoint(anchor.handleIn) : null,
    handleOut: anchor.handleOut ? clonePoint(anchor.handleOut) : null,
  })),
  closed: subpath.closed,
});

const add = (a: Vec2, b: Vec2): Vec2 => ({ x: a.x + b.x, y: a.y + b.y });

const sub = (a: Vec2, b: Vec2): Vec2 => ({ x: a.x - b.x, y: a.y - b.y });

const scale = (point: Vec2, scalar: number): Vec2 => ({ x: point.x * scalar, y: point.y * scalar });

const cross = (a: Vec2, b: Vec2): number => a.x * b.y - a.y * b.x;

const dist = (a: Vec2, b: Vec2): number => Math.hypot(a.x - b.x, a.y - b.y);

const len = (point: Vec2): number => Math.hypot(point.x, point.y);

const closeEnough = (a: Vec2, b: Vec2, eps = EPS): boolean =>
  Math.abs(a.x - b.x) <= eps && Math.abs(a.y - b.y) <= eps;

const normalize = (point: Vec2): Vec2 => {
  const length = len(point);
  return length <= EPS ? { x: 0, y: 0 } : { x: point.x / length, y: point.y / length };
};

const cubicPoint = (p0: Vec2, p1: Vec2, p2: Vec2, p3: Vec2, t: number): Vec2 => {
  const mt = 1 - t;
  const mt2 = mt * mt;
  const t2 = t * t;
  return {
    x: mt2 * mt * p0.x + 3 * mt2 * t * p1.x + 3 * mt * t2 * p2.x + t2 * t * p3.x,
    y: mt2 * mt * p0.y + 3 * mt2 * t * p1.y + 3 * mt * t2 * p2.y + t2 * t * p3.y,
  };
};

export const flattenSubPathToPolyline = (subpath: SubPath): Vec2[] => {
  if (subpath.anchors.length === 0) {
    return [];
  }

  const points: Vec2[] = [clonePoint(subpath.anchors[0]!.point)];
  const segmentCount = subpath.closed ? subpath.anchors.length : subpath.anchors.length - 1;

  for (let index = 0; index < segmentCount; index += 1) {
    const anchor = subpath.anchors[index]!;
    const next = subpath.anchors[(index + 1) % subpath.anchors.length]!;
    const p0 = anchor.point;
    const p3 = next.point;

    if (!anchor.handleOut && !next.handleIn) {
      points.push(clonePoint(p3));
      continue;
    }

    const p1 = anchor.handleOut ? add(p0, anchor.handleOut) : p0;
    const p2 = next.handleIn ? add(p3, next.handleIn) : p3;
    for (let step = 1; step <= CURVE_SEGMENTS; step += 1) {
      points.push(cubicPoint(p0, p1, p2, p3, step / CURVE_SEGMENTS));
    }
  }

  return cleanPolyline(points, subpath.closed);
};

const cleanPolyline = (points: readonly Vec2[], closed: boolean): Vec2[] => {
  const cleaned: Vec2[] = [];
  for (const point of points) {
    if (cleaned.length === 0 || !closeEnough(cleaned[cleaned.length - 1]!, point)) {
      cleaned.push(clonePoint(point));
    }
  }

  if (closed && cleaned.length > 1 && closeEnough(cleaned[0]!, cleaned[cleaned.length - 1]!)) {
    cleaned.pop();
  }

  return cleaned;
};

const lineIntersection = (a: Vec2, directionA: Vec2, b: Vec2, directionB: Vec2): Vec2 | null => {
  const denominator = cross(directionA, directionB);
  if (Math.abs(denominator) <= EPS) {
    return null;
  }

  const offset = sub(b, a);
  const t = cross(offset, directionB) / denominator;
  return add(a, scale(directionA, t));
};

const pushPoint = (points: Vec2[], point: Vec2): void => {
  if (points.length === 0 || !closeEnough(points[points.length - 1]!, point)) {
    points.push(point);
  }
};

const arcPoints = (center: Vec2, start: Vec2, end: Vec2, clockwise: boolean): Vec2[] => {
  const radius = dist(center, start);
  if (radius <= EPS || closeEnough(start, end)) {
    return [clonePoint(start)];
  }

  const points: Vec2[] = [clonePoint(start)];
  const startAngle = Math.atan2(start.y - center.y, start.x - center.x);
  let sweep = Math.atan2(end.y - center.y, end.x - center.x) - startAngle;

  if (clockwise) {
    while (sweep <= EPS) {
      sweep += Math.PI * 2;
    }
  } else {
    while (sweep >= -EPS) {
      sweep -= Math.PI * 2;
    }
  }

  const steps = Math.max(1, Math.ceil(Math.abs(sweep) / ROUND_STEP));
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

const joinedPoints = (
  vertex: Vec2,
  previous: OffsetEdge,
  next: OffsetEdge,
  join: LineJoin,
  distance: number,
  miterLimit: number,
): Vec2[] => {
  const bevel = [clonePoint(previous.end), clonePoint(next.start)];

  if (join === "bevel" || Math.abs(distance) <= EPS) {
    return bevel;
  }

  if (join === "round") {
    // 半径ベクトル間の符号付き角は prev.dir→next.dir の回転角と常に一致する
    // (法線は共通スカラー倍なので distance/winding の符号に依存しない)。
    // よって短い弧の向きは cross の符号だけで決まる。
    return arcPoints(vertex, previous.end, next.start, cross(previous.direction, next.direction) > 0);
  }

  const intersection = lineIntersection(previous.start, previous.direction, next.start, next.direction);
  if (!intersection) {
    return bevel;
  }

  const miterLength = dist(vertex, intersection) / Math.abs(distance);
  return miterLength <= miterLimit + EPS ? [intersection] : bevel;
};

const createOffsetEdges = (points: readonly Vec2[], closed: boolean, distance: number): OffsetEdge[] => {
  const edges: OffsetEdge[] = [];
  const segmentCount = closed ? points.length : points.length - 1;
  const winding = closed && ringArea(points) < 0 ? -1 : 1;

  for (let index = 0; index < segmentCount; index += 1) {
    const start = points[index]!;
    const end = points[(index + 1) % points.length]!;
    const direction = normalize(sub(end, start));
    if (len(direction) <= EPS) {
      continue;
    }

    const normal = scale({ x: direction.y, y: -direction.x }, winding * distance);
    edges.push({
      start: add(start, normal),
      end: add(end, normal),
      direction,
    });
  }

  return edges;
};

const anchorsFromPoints = (points: readonly Vec2[]) =>
  points.map((point) => ({
    point: clonePoint(point),
    handleIn: null,
    handleOut: null,
  }));

const offsetClosed = (points: readonly Vec2[], distance: number, join: LineJoin, miterLimit: number): Vec2[] => {
  const edges = createOffsetEdges(points, true, distance);
  if (edges.length < 2) {
    return [];
  }

  const result: Vec2[] = [];
  for (let index = 0; index < points.length; index += 1) {
    const previous = edges[(index + edges.length - 1) % edges.length]!;
    const next = edges[index % edges.length]!;
    for (const point of joinedPoints(points[index]!, previous, next, join, distance, miterLimit)) {
      pushPoint(result, point);
    }
  }

  if (result.length > 1 && closeEnough(result[0]!, result[result.length - 1]!)) {
    result.pop();
  }

  return result;
};

const offsetOpen = (points: readonly Vec2[], distance: number, join: LineJoin, miterLimit: number): Vec2[] => {
  const edges = createOffsetEdges(points, false, distance);
  if (edges.length === 0) {
    return [];
  }

  const result: Vec2[] = [clonePoint(edges[0]!.start)];
  for (let index = 1; index < points.length - 1; index += 1) {
    const previous = edges[index - 1]!;
    const next = edges[index]!;
    for (const point of joinedPoints(points[index]!, previous, next, join, distance, miterLimit)) {
      pushPoint(result, point);
    }
  }
  pushPoint(result, clonePoint(edges[edges.length - 1]!.end));

  return result;
};

/**
 * Offsets flattened subpaths by edge normals and joins the resulting edge lines.
 * This intentionally does not remove self-intersections introduced by large
 * offsets or tight concavities; callers that need robust final contours should
 * run a cleanup/boolean pass after this pure geometry step.
 */
export const offsetSubPaths = (
  subpaths: SubPath[],
  distance: number,
  join: LineJoin,
  miterLimit: number,
): SubPath[] =>
  subpaths.map((subpath) => {
    const points = flattenSubPathToPolyline(subpath);
    const distinctPoints = cleanPolyline(points, subpath.closed);

    if (Math.abs(distance) <= EPS || distinctPoints.length < 2 || (subpath.closed && distinctPoints.length < 3)) {
      return cloneSubPath(subpath);
    }

    const offsetPoints = subpath.closed
      ? offsetClosed(distinctPoints, distance, join, miterLimit)
      : offsetOpen(distinctPoints, distance, join, miterLimit);

    return {
      anchors: anchorsFromPoints(offsetPoints.length > 0 ? offsetPoints : distinctPoints),
      closed: subpath.closed,
    };
  });
