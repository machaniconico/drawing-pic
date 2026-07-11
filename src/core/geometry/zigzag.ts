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

const corner = (point: Vec2): Anchor => ({ point, handleIn: null, handleOut: null });

const sub = (a: Vec2, b: Vec2): Vec2 => ({ x: a.x - b.x, y: a.y - b.y });

const len = (point: Vec2): number => Math.hypot(point.x, point.y);

const zigzagSubPath = (subpath: SubPath, size: number, ridges: number): SubPath => {
  const anchors = subpath.anchors;
  const count = anchors.length;
  if (count < 2) {
    return cloneSubPath(subpath);
  }

  const segmentCount = subpath.closed ? count : count - 1;
  const result: Anchor[] = [];
  // A single alternating sign carried across the whole subpath keeps the ridge
  // pattern continuous rather than resetting per segment.
  let sign = 1;

  for (let index = 0; index < segmentCount; index += 1) {
    const a = anchors[index]!.point;
    const b = anchors[(index + 1) % count]!.point;
    result.push(corner(clonePoint(a)));

    const edge = sub(b, a);
    const edgeLen = len(edge);
    if (edgeLen <= EPS) {
      continue;
    }

    // Unit normal (perpendicular to the segment). Displacement direction stays
    // consistent because it is derived from this segment's own orientation.
    const nx = -edge.y / edgeLen;
    const ny = edge.x / edgeLen;

    for (let ridge = 1; ridge <= ridges; ridge += 1) {
      const t = ridge / (ridges + 1);
      const px = a.x + edge.x * t + nx * size * sign;
      const py = a.y + edge.y * t + ny * size * sign;
      result.push(corner({ x: px, y: py }));
      sign = -sign;
    }
  }

  if (!subpath.closed) {
    result.push(corner(clonePoint(anchors[count - 1]!.point)));
  }

  return { anchors: result, closed: subpath.closed };
};

/**
 * Adds evenly spaced ridge points along each anchor-to-anchor segment,
 * displaced perpendicular to the segment with an alternating sign, producing a
 * sharp (corner) zig-zag. Existing bezier handles are ignored: each segment is
 * treated as the straight chord between its anchor points, matching how the
 * other path effects flatten geometry. A size of 0 or ridges < 1 is a no-op.
 */
export const zigzagSubPaths = (subpaths: SubPath[], size: number, ridges: number): SubPath[] => {
  const ridgeCount = Math.floor(ridges);
  if (size === 0 || !Number.isFinite(size) || !Number.isFinite(ridges) || ridgeCount < 1) {
    return subpaths.map(cloneSubPath);
  }
  return subpaths.map((subpath) => zigzagSubPath(subpath, size, ridgeCount));
};
