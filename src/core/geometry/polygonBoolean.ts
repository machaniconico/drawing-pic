import { apply, compose, IDENTITY, type Matrix } from "./matrix";
import type { Vec2 } from "./vector";
import type { Document, SceneNode } from "../model/types";
import { isContainer } from "../model/types";

export type BooleanOp = "union" | "intersect" | "subtract" | "exclude";

type PolygonSetName = "subject" | "clip";

interface SourceEdge {
  readonly set: PolygonSetName;
  readonly a: Vec2;
  readonly b: Vec2;
  readonly splitPoints: Vec2[];
}

interface DirectedEdge {
  readonly from: Vec2;
  readonly to: Vec2;
  readonly fromKey: string;
  readonly toKey: string;
  readonly angle: number;
}

const EPS = 1e-9;
const SPLIT_EPS = 1e-7;
const CURVE_SEGMENTS = 16;
const ELLIPSE_SEGMENTS = 48;

const closeEnough = (a: Vec2, b: Vec2, eps = EPS): boolean =>
  Math.abs(a.x - b.x) <= eps && Math.abs(a.y - b.y) <= eps;

const sub = (a: Vec2, b: Vec2): Vec2 => ({ x: a.x - b.x, y: a.y - b.y });

const add = (a: Vec2, b: Vec2): Vec2 => ({ x: a.x + b.x, y: a.y + b.y });

const scale = (v: Vec2, s: number): Vec2 => ({ x: v.x * s, y: v.y * s });

const dot = (a: Vec2, b: Vec2): number => a.x * b.x + a.y * b.y;

const cross = (a: Vec2, b: Vec2): number => a.x * b.y - a.y * b.x;

const len = (v: Vec2): number => Math.hypot(v.x, v.y);

export const ringArea = (ring: readonly Vec2[]): number => {
  let area = 0;
  for (let index = 0; index < ring.length; index += 1) {
    const a = ring[index]!;
    const b = ring[(index + 1) % ring.length]!;
    area += a.x * b.y - b.x * a.y;
  }
  return area / 2;
};

const cleanRing = (ring: readonly Vec2[]): Vec2[] => {
  const cleaned: Vec2[] = [];
  for (const point of ring) {
    if (cleaned.length === 0 || !closeEnough(cleaned[cleaned.length - 1]!, point)) {
      cleaned.push({ x: point.x, y: point.y });
    }
  }
  if (cleaned.length > 1 && closeEnough(cleaned[0]!, cleaned[cleaned.length - 1]!)) {
    cleaned.pop();
  }
  return cleaned;
};

const removeCollinear = (ring: readonly Vec2[]): Vec2[] => {
  let current = cleanRing(ring);
  let changed = true;

  while (changed && current.length >= 3) {
    changed = false;
    const next: Vec2[] = [];
    for (let index = 0; index < current.length; index += 1) {
      const prev = current[(index + current.length - 1) % current.length]!;
      const point = current[index]!;
      const after = current[(index + 1) % current.length]!;
      const v1 = sub(point, prev);
      const v2 = sub(after, point);
      if (len(v1) <= EPS || len(v2) <= EPS || Math.abs(cross(v1, v2)) <= EPS * Math.max(1, len(v1), len(v2))) {
        changed = true;
      } else {
        next.push(point);
      }
    }
    current = next;
  }

  return Math.abs(ringArea(current)) <= EPS ? [] : current;
};

const pointKey = (point: Vec2): string => `${Math.round(point.x / EPS)},${Math.round(point.y / EPS)}`;

const edgeKey = (from: string, to: string): string => `${from}->${to}`;

const pointOnSegmentT = (point: Vec2, a: Vec2, b: Vec2): number => {
  const ab = sub(b, a);
  const lengthSq = dot(ab, ab);
  if (lengthSq <= EPS) {
    return 0;
  }
  return dot(sub(point, a), ab) / lengthSq;
};

const segmentIntersections = (a: Vec2, b: Vec2, c: Vec2, d: Vec2): Vec2[] => {
  const r = sub(b, a);
  const s = sub(d, c);
  const denominator = cross(r, s);
  const ca = sub(c, a);

  if (Math.abs(denominator) <= EPS) {
    if (Math.abs(cross(ca, r)) > EPS) {
      return [];
    }

    const lengthSq = dot(r, r);
    if (lengthSq <= EPS) {
      return [];
    }

    const t0 = dot(sub(c, a), r) / lengthSq;
    const t1 = dot(sub(d, a), r) / lengthSq;
    const start = Math.max(0, Math.min(t0, t1));
    const end = Math.min(1, Math.max(t0, t1));
    if (end < -EPS || start > 1 + EPS || end + EPS < start) {
      return [];
    }

    const points: Vec2[] = [];
    for (const t of [Math.max(0, start), Math.min(1, end)]) {
      const point = add(a, scale(r, t));
      if (!points.some((existing) => closeEnough(existing, point))) {
        points.push(point);
      }
    }
    return points;
  }

  const t = cross(ca, s) / denominator;
  const u = cross(ca, r) / denominator;
  if (t < -EPS || t > 1 + EPS || u < -EPS || u > 1 + EPS) {
    return [];
  }

  return [add(a, scale(r, Math.min(1, Math.max(0, t))))];
};

const buildEdges = (rings: readonly Vec2[][], set: PolygonSetName): SourceEdge[] =>
  rings.flatMap((sourceRing) => {
    const ring = cleanRing(sourceRing);
    if (ring.length < 3 || Math.abs(ringArea(ring)) <= EPS) {
      return [];
    }

    const edges: SourceEdge[] = [];
    for (let index = 0; index < ring.length; index += 1) {
      const a = ring[index]!;
      const b = ring[(index + 1) % ring.length]!;
      if (!closeEnough(a, b)) {
        edges.push({ set, a, b, splitPoints: [a, b] });
      }
    }
    return edges;
  });

const addSplitPoint = (edge: SourceEdge, point: Vec2): void => {
  if (!edge.splitPoints.some((existing) => closeEnough(existing, point))) {
    edge.splitPoints.push(point);
  }
};

export const pointInRing = (point: Vec2, ring: readonly Vec2[]): boolean => {
  let inside = false;
  for (let index = 0, previousIndex = ring.length - 1; index < ring.length; previousIndex = index, index += 1) {
    const a = ring[index]!;
    const b = ring[previousIndex]!;
    const crossesRay = a.y > point.y !== b.y > point.y;
    if (crossesRay) {
      const x = ((b.x - a.x) * (point.y - a.y)) / (b.y - a.y) + a.x;
      if (point.x < x) {
        inside = !inside;
      }
    }
  }
  return inside;
};

export const pointInPolygonSet = (
  point: Vec2,
  rings: readonly Vec2[][],
  containsInRing: (candidate: Vec2, ring: readonly Vec2[]) => boolean = pointInRing,
): boolean => {
  let winding = 0;
  for (const sourceRing of rings) {
    const ring = cleanRing(sourceRing);
    if (ring.length < 3 || !containsInRing(point, ring)) {
      continue;
    }
    winding += ringArea(ring) >= 0 ? 1 : -1;
  }
  return winding !== 0;
};

const opContains = (subject: boolean, clip: boolean, op: BooleanOp): boolean => {
  switch (op) {
    case "union":
      return subject || clip;
    case "intersect":
      return subject && clip;
    case "subtract":
      return subject && !clip;
    case "exclude":
      return subject !== clip;
  }
};

const boundsScale = (rings: readonly Vec2[][]): number => {
  let minX = Number.POSITIVE_INFINITY;
  let minY = Number.POSITIVE_INFINITY;
  let maxX = Number.NEGATIVE_INFINITY;
  let maxY = Number.NEGATIVE_INFINITY;
  for (const ring of rings) {
    for (const point of ring) {
      minX = Math.min(minX, point.x);
      minY = Math.min(minY, point.y);
      maxX = Math.max(maxX, point.x);
      maxY = Math.max(maxY, point.y);
    }
  }
  if (!Number.isFinite(minX)) {
    return 1;
  }
  return Math.max(1, maxX - minX, maxY - minY);
};

const collectDirectedEdges = (
  subject: readonly Vec2[][],
  clip: readonly Vec2[][],
  op: BooleanOp,
): DirectedEdge[] => {
  const edges = [...buildEdges(subject, "subject"), ...buildEdges(clip, "clip")];
  const subjectEdges = edges.filter((edge) => edge.set === "subject");
  const clipEdges = edges.filter((edge) => edge.set === "clip");

  for (const subjectEdge of subjectEdges) {
    for (const clipEdge of clipEdges) {
      for (const point of segmentIntersections(subjectEdge.a, subjectEdge.b, clipEdge.a, clipEdge.b)) {
        addSplitPoint(subjectEdge, point);
        addSplitPoint(clipEdge, point);
      }
    }
  }

  const directed = new Map<string, DirectedEdge>();
  const sampleOffset = boundsScale([...subject, ...clip]) * SPLIT_EPS;

  for (const edge of edges) {
    const sorted = [...edge.splitPoints].sort((left, right) => pointOnSegmentT(left, edge.a, edge.b) - pointOnSegmentT(right, edge.a, edge.b));
    for (let index = 0; index < sorted.length - 1; index += 1) {
      const a = sorted[index]!;
      const b = sorted[index + 1]!;
      const vector = sub(b, a);
      const length = len(vector);
      if (length <= EPS) {
        continue;
      }

      const midpoint = scale(add(a, b), 0.5);
      const leftNormal = { x: -vector.y / length, y: vector.x / length };
      const leftPoint = add(midpoint, scale(leftNormal, sampleOffset));
      const rightPoint = add(midpoint, scale(leftNormal, -sampleOffset));
      const resultLeft = opContains(pointInPolygonSet(leftPoint, subject), pointInPolygonSet(leftPoint, clip), op);
      const resultRight = opContains(pointInPolygonSet(rightPoint, subject), pointInPolygonSet(rightPoint, clip), op);

      if (resultLeft === resultRight) {
        continue;
      }

      const from = resultLeft ? a : b;
      const to = resultLeft ? b : a;
      const fromKey = pointKey(from);
      const toKey = pointKey(to);
      const key = edgeKey(fromKey, toKey);
      if (!directed.has(key)) {
        directed.set(key, {
          from,
          to,
          fromKey,
          toKey,
          angle: Math.atan2(to.y - from.y, to.x - from.x),
        });
      }
    }
  }

  return [...directed.values()];
};

const normalizedTurn = (fromAngle: number, toAngle: number): number => {
  const turn = toAngle - fromAngle;
  return turn < 0 ? turn + Math.PI * 2 : turn;
};

const traceRings = (edges: readonly DirectedEdge[]): Vec2[][] => {
  const available = new Set(edges.map((_, index) => index));
  const outgoing = new Map<string, number[]>();
  edges.forEach((edge, index) => {
    const existing = outgoing.get(edge.fromKey);
    if (existing) {
      existing.push(index);
    } else {
      outgoing.set(edge.fromKey, [index]);
    }
  });

  const rings: Vec2[][] = [];
  while (available.size > 0) {
    const startIndex = available.values().next().value as number | undefined;
    if (startIndex === undefined) {
      break;
    }

    const start = edges[startIndex]!;
    let current = start;
    const ring: Vec2[] = [start.from];

    for (let guard = 0; guard < edges.length + 2; guard += 1) {
      const currentIndex = edges.indexOf(current);
      available.delete(currentIndex);
      ring.push(current.to);
      if (current.toKey === start.fromKey) {
        break;
      }

      const candidates = (outgoing.get(current.toKey) ?? []).filter((index) => available.has(index));
      if (candidates.length === 0) {
        break;
      }

      const nextIndex = candidates.reduce((bestIndex, candidateIndex) => {
        const best = edges[bestIndex]!;
        const candidate = edges[candidateIndex]!;
        const bestTurn = normalizedTurn(current.angle, best.angle);
        const candidateTurn = normalizedTurn(current.angle, candidate.angle);
        return candidateTurn < bestTurn ? candidateIndex : bestIndex;
      }, candidates[0]!);
      current = edges[nextIndex]!;
    }

    const cleaned = removeCollinear(ring);
    if (cleaned.length >= 3) {
      rings.push(cleaned);
    }
  }

  return rings;
};

/**
 * Polygon boolean operations over closed rings.
 *
 * Rings are represented without repeating the first point at the end. Positive
 * winding marks filled exterior rings; negative winding marks holes. This is
 * the convention used for contained subtract: A - B returns A's outer ring plus
 * B as an oppositely wound inner ring.
 */
export const polygonBoolean = (subject: Vec2[][], clip: Vec2[][], op: BooleanOp): Vec2[][] => {
  const subjectRings = subject.map(cleanRing).filter((ring) => ring.length >= 3 && Math.abs(ringArea(ring)) > EPS);
  const clipRings = clip.map(cleanRing).filter((ring) => ring.length >= 3 && Math.abs(ringArea(ring)) > EPS);

  if (subjectRings.length === 0) {
    return op === "union" || op === "exclude" ? clipRings : [];
  }
  if (clipRings.length === 0) {
    return op === "intersect" ? [] : subjectRings;
  }

  return traceRings(collectDirectedEdges(subjectRings, clipRings, op));
};

const pathToNode = (doc: Document, targetId: string): SceneNode[] | null => {
  const visit = (id: string, path: SceneNode[]): SceneNode[] | null => {
    const node = doc.nodes[id];
    if (!node) {
      return null;
    }

    const nextPath = [...path, node];
    if (id === targetId) {
      return nextPath;
    }

    if (!isContainer(node)) {
      return null;
    }

    for (const childId of node.children) {
      const result = visit(childId, nextPath);
      if (result) {
        return result;
      }
    }

    return null;
  };

  for (const layerId of doc.layerOrder) {
    const result = visit(layerId, []);
    if (result) {
      return result;
    }
  }
  return null;
};

const worldTransform = (doc: Document, node: SceneNode): Matrix => {
  const path = pathToNode(doc, node.id);
  if (!path) {
    return node.transform;
  }
  return path.reduce((acc, item) => compose(acc, item.transform), IDENTITY);
};

const cubicPoint = (p0: Vec2, p1: Vec2, p2: Vec2, p3: Vec2, t: number): Vec2 => {
  const oneMinusT = 1 - t;
  const a = oneMinusT * oneMinusT * oneMinusT;
  const b = 3 * oneMinusT * oneMinusT * t;
  const c = 3 * oneMinusT * t * t;
  const d = t * t * t;
  return {
    x: p0.x * a + p1.x * b + p2.x * c + p3.x * d,
    y: p0.y * a + p1.y * b + p2.y * c + p3.y * d,
  };
};

const flattenPathRing = (points: Vec2[], transform: Matrix): Vec2[] => {
  const transformed = points.map((point) => apply(transform, point));
  const ring = removeCollinear(transformed);
  return ringArea(ring) < 0 ? [...ring].reverse() : ring;
};

const flattenPathRingPreserveWinding = (points: Vec2[], transform: Matrix): Vec2[] =>
  removeCollinear(points.map((point) => apply(transform, point)));

const ringWithWinding = (ring: readonly Vec2[], hole: boolean): Vec2[] => {
  const area = ringArea(ring);
  if (hole) {
    return area < 0 ? [...ring] : [...ring].reverse();
  }
  return area >= 0 ? [...ring] : [...ring].reverse();
};

const ringsIntersect = (a: readonly Vec2[], b: readonly Vec2[]): boolean => {
  for (let aIndex = 0; aIndex < a.length; aIndex += 1) {
    const a0 = a[aIndex]!;
    const a1 = a[(aIndex + 1) % a.length]!;
    for (let bIndex = 0; bIndex < b.length; bIndex += 1) {
      const b0 = b[bIndex]!;
      const b1 = b[(bIndex + 1) % b.length]!;
      if (segmentIntersections(a0, a1, b0, b1).length > 0) {
        return true;
      }
    }
  }
  return false;
};

const ringContainedInRing = (ring: readonly Vec2[], container: readonly Vec2[]): boolean =>
  !ringsIntersect(ring, container) && ring.every((point) => pointInRing(point, container));

const orientPathRingsByNesting = (rings: readonly Vec2[][]): Vec2[][] =>
  rings.map((ring, index) => {
    const containingCount = rings.reduce((count, sibling, siblingIndex) => {
      if (siblingIndex === index || sibling.length < 3) {
        return count;
      }
      return ringContainedInRing(ring, sibling) ? count + 1 : count;
    }, 0);
    return ringWithWinding(ring, containingCount % 2 === 1);
  });

export const flattenNodeToPolygons = (doc: Document, node: SceneNode): Vec2[][] => {
  const transform = worldTransform(doc, node);

  switch (node.type) {
    case "rect":
      return [
        flattenPathRing(
          [
            { x: 0, y: 0 },
            { x: node.width, y: 0 },
            { x: node.width, y: node.height },
            { x: 0, y: node.height },
          ],
          transform,
        ),
      ].filter((ring) => ring.length >= 3);
    case "ellipse": {
      const points: Vec2[] = [];
      for (let index = 0; index < ELLIPSE_SEGMENTS; index += 1) {
        const angle = (index / ELLIPSE_SEGMENTS) * Math.PI * 2;
        points.push({ x: Math.cos(angle) * node.rx, y: Math.sin(angle) * node.ry });
      }
      return [flattenPathRing(points, transform)].filter((ring) => ring.length >= 3);
    }
    case "path": {
      const rings = node.subpaths.flatMap((subpath) => {
        if (!subpath.closed || subpath.anchors.length < 3) {
          return [];
        }

        const points: Vec2[] = [subpath.anchors[0]!.point];
        for (let index = 0; index < subpath.anchors.length; index += 1) {
          const anchor = subpath.anchors[index]!;
          const next = subpath.anchors[(index + 1) % subpath.anchors.length]!;
          const p0 = anchor.point;
          const p3 = next.point;
          if (!anchor.handleOut && !next.handleIn) {
            points.push(p3);
            continue;
          }

          const p1 = anchor.handleOut ? add(p0, anchor.handleOut) : p0;
          const p2 = next.handleIn ? add(p3, next.handleIn) : p3;
          for (let step = 1; step <= CURVE_SEGMENTS; step += 1) {
            points.push(cubicPoint(p0, p1, p2, p3, step / CURVE_SEGMENTS));
          }
        }

        const ring = flattenPathRingPreserveWinding(points, transform);
        return ring.length >= 3 ? [ring] : [];
      });
      return orientPathRingsByNesting(rings);
    }
    default:
      return [];
  }
};
