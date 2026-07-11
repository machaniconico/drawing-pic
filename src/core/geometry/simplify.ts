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

/** Perpendicular distance from `p` to the segment (chord) through `a` and `b`. */
const distanceToLine = (p: Vec2, a: Vec2, b: Vec2): number => {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const lengthSq = dx * dx + dy * dy;
  if (lengthSq <= EPS) {
    return Math.hypot(p.x - a.x, p.y - a.y);
  }
  const cross = Math.abs(dx * (p.y - a.y) - dy * (p.x - a.x));
  return cross / Math.sqrt(lengthSq);
};

/**
 * An anchor is redundant when it is a pure corner (no handles) whose two
 * adjacent segments are straight lines (the facing handles of its neighbours
 * are also absent) and it lies within `tolerance` of the chord between them.
 * Removing it leaves the visible geometry unchanged up to that tolerance.
 */
const isRedundant = (prev: Anchor, current: Anchor, next: Anchor, tolerance: number): boolean =>
  current.handleIn === null &&
  current.handleOut === null &&
  prev.handleOut === null &&
  next.handleIn === null &&
  distanceToLine(current.point, prev.point, next.point) <= tolerance;

const simplifySubPath = (subpath: SubPath, tolerance: number): SubPath => {
  let anchors = subpath.anchors.map(cloneAnchor);
  const minKeep = subpath.closed ? 3 : 2;

  // Repeated passes let chains of collinear points collapse fully; the anchor
  // count strictly decreases each removing pass, so this always terminates.
  let removedInPass = true;
  while (removedInPass && anchors.length > minKeep) {
    removedInPass = false;
    const count = anchors.length;
    // Cap removals so this pass can never drop below the drawable minimum.
    let budget = count - minKeep;
    const kept: Anchor[] = [];

    for (let index = 0; index < count; index += 1) {
      const anchor = anchors[index]!;
      const isEndpoint = !subpath.closed && (index === 0 || index === count - 1);
      if (isEndpoint || budget <= 0) {
        kept.push(anchor);
        continue;
      }

      // Compare against the previously kept anchor and the next original anchor
      // so consecutive collinear points collapse within a single pass.
      const prev = kept.length > 0 ? kept[kept.length - 1]! : anchors[(index - 1 + count) % count]!;
      const next = anchors[(index + 1) % count]!;

      if (isRedundant(prev, anchor, next, tolerance)) {
        removedInPass = true;
        budget -= 1;
        continue;
      }
      kept.push(anchor);
    }

    anchors = kept;
  }

  return { anchors, closed: subpath.closed };
};

/**
 * Removes redundant near-collinear corner anchors from each subpath. Anchors
 * that carry bezier handles (curve points) and the endpoints of open subpaths
 * are always preserved, and no subpath is reduced below a drawable minimum
 * (3 anchors closed, 2 open). A negative tolerance is treated as 0.
 */
export const simplifySubPaths = (subpaths: SubPath[], tolerance: number): SubPath[] => {
  const tol = tolerance > 0 ? tolerance : 0;
  return subpaths.map((subpath) =>
    subpath.anchors.length <= (subpath.closed ? 3 : 2)
      ? cloneSubPath(subpath)
      : simplifySubPath(subpath, tol),
  );
};
