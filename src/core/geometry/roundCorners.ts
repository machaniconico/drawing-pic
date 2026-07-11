import type { Vec2 } from "./vector";
import type { Anchor, SubPath } from "../model/types";

const EPS = 1e-9;

const clonePoint = (point: Vec2): Vec2 => ({ x: point.x, y: point.y });

const cloneAnchor = (anchor: Anchor): Anchor => ({
  point: clonePoint(anchor.point),
  handleIn: anchor.handleIn ? clonePoint(anchor.handleIn) : null,
  handleOut: anchor.handleOut ? clonePoint(anchor.handleOut) : null,
});

const cloneSubPath = (subpath: SubPath): SubPath => ({
  anchors: subpath.anchors.map(cloneAnchor),
  closed: subpath.closed,
});

const sub = (a: Vec2, b: Vec2): Vec2 => ({ x: a.x - b.x, y: a.y - b.y });

const add = (a: Vec2, b: Vec2): Vec2 => ({ x: a.x + b.x, y: a.y + b.y });

const scale = (point: Vec2, scalar: number): Vec2 => ({ x: point.x * scalar, y: point.y * scalar });

const len = (point: Vec2): number => Math.hypot(point.x, point.y);

const normalize = (point: Vec2): Vec2 => {
  const length = len(point);
  return length <= EPS ? { x: 0, y: 0 } : { x: point.x / length, y: point.y / length };
};

const isCorner = (anchor: Anchor): boolean => anchor.handleIn === null && anchor.handleOut === null;

/**
 * Rounds a single corner anchor sitting between `prev` and `next` neighbour
 * points, returning the two tangent anchors that replace it. Returns `null`
 * when the corner cannot be rounded (degenerate edges, collinear, or radius so
 * small it vanishes) so the caller can keep the original anchor untouched.
 */
const roundCorner = (vertex: Vec2, prev: Vec2, next: Vec2, radius: number): [Anchor, Anchor] | null => {
  const toPrev = sub(prev, vertex);
  const toNext = sub(next, vertex);
  const lenPrev = len(toPrev);
  const lenNext = len(toNext);
  if (lenPrev <= EPS || lenNext <= EPS) {
    return null;
  }

  const u1 = normalize(toPrev);
  const u2 = normalize(toNext);
  const dot = Math.max(-1, Math.min(1, u1.x * u2.x + u1.y * u2.y));
  // theta is the interior angle at the corner. Collinear (straight-through or
  // fully doubled-back) edges have nothing to round.
  const theta = Math.acos(dot);
  if (theta <= EPS || Math.PI - theta <= EPS) {
    return null;
  }

  const halfTan = Math.tan(theta / 2);
  if (halfTan <= EPS) {
    return null;
  }

  // Trim-back distance along each edge, clamped so a fillet never overruns the
  // midpoint of its adjacent edge (which also protects neighbouring corners).
  const distance = Math.min(radius / halfTan, lenPrev / 2, lenNext / 2);
  if (distance <= EPS) {
    return null;
  }

  const t1 = add(vertex, scale(u1, distance));
  const t2 = add(vertex, scale(u2, distance));

  // Cubic control-handle length that best approximates the tangent circular arc
  // of sweep (pi - theta) and radius distance * tan(theta / 2).
  const arcRadius = distance * halfTan;
  const handleLen = (4 / 3) * arcRadius * Math.tan((Math.PI - theta) / 4);

  return [
    { point: t1, handleIn: null, handleOut: scale(u1, -handleLen) },
    { point: t2, handleIn: scale(u2, -handleLen), handleOut: null },
  ];
};

const roundSubPath = (subpath: SubPath, radius: number): SubPath => {
  const anchors = subpath.anchors;
  const count = anchors.length;
  if (count < 3) {
    return cloneSubPath(subpath);
  }

  const result: Anchor[] = [];
  for (let index = 0; index < count; index += 1) {
    const anchor = anchors[index]!;

    // Endpoints of an open subpath and any anchor that already carries handles
    // (i.e. a smooth/curve point) are left exactly as they are.
    const isEndpoint = !subpath.closed && (index === 0 || index === count - 1);
    if (isEndpoint || !isCorner(anchor)) {
      result.push(cloneAnchor(anchor));
      continue;
    }

    const prev = anchors[(index - 1 + count) % count]!;
    const next = anchors[(index + 1) % count]!;
    const rounded = roundCorner(anchor.point, prev.point, next.point, radius);
    if (!rounded) {
      result.push(cloneAnchor(anchor));
      continue;
    }

    result.push(rounded[0], rounded[1]);
  }

  return { anchors: result, closed: subpath.closed };
};

/**
 * Replaces sharp (handle-less) corner anchors with rounded bezier fillets of
 * the given radius. Anchors that already have handles, and the endpoints of
 * open subpaths, are preserved untouched. This is pure geometry: it does not
 * resolve self-intersections that an over-large radius could introduce.
 */
export const roundCorners = (subpaths: SubPath[], radius: number): SubPath[] => {
  if (!(radius > 0)) {
    return subpaths.map(cloneSubPath);
  }
  return subpaths.map((subpath) => roundSubPath(subpath, radius));
};
