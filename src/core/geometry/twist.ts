import type { Vec2 } from "./vector";
import type { Anchor, SubPath } from "../model/types";

const clonePoint = (point: Vec2): Vec2 => ({ x: point.x, y: point.y });

const cloneAnchor = (anchor: Anchor): Anchor => ({
  point: clonePoint(anchor.point),
  handleIn: anchor.handleIn ? clonePoint(anchor.handleIn) : null,
  handleOut: anchor.handleOut ? clonePoint(anchor.handleOut) : null,
});

const cloneSubPaths = (subpaths: readonly SubPath[]): SubPath[] =>
  subpaths.map((subpath) => ({ anchors: subpath.anchors.map(cloneAnchor), closed: subpath.closed }));

const rotateVector = (v: Vec2, cos: number, sin: number): Vec2 => ({
  x: v.x * cos - v.y * sin,
  y: v.x * sin + v.y * cos,
});

/**
 * Twists the subpaths around their shared centroid: each anchor is rotated by
 * an angle scaled by how far it sits from the centre (0 at the centre, the full
 * `angle` at the outermost anchor), producing a spiral. Handles rotate by the
 * same per-anchor angle so curvature is carried along. A zero or non-finite
 * angle, or fewer than two total anchors, is a no-op.
 */
export const twistSubPaths = (subpaths: SubPath[], angle: number): SubPath[] => {
  if (angle === 0 || !Number.isFinite(angle)) {
    return cloneSubPaths(subpaths);
  }

  const allAnchors = subpaths.flatMap((subpath) => subpath.anchors);
  if (allAnchors.length < 2) {
    return cloneSubPaths(subpaths);
  }

  let cx = 0;
  let cy = 0;
  for (const anchor of allAnchors) {
    cx += anchor.point.x;
    cy += anchor.point.y;
  }
  cx /= allAnchors.length;
  cy /= allAnchors.length;

  let maxDist = 0;
  for (const anchor of allAnchors) {
    maxDist = Math.max(maxDist, Math.hypot(anchor.point.x - cx, anchor.point.y - cy));
  }
  if (maxDist <= 0) {
    return cloneSubPaths(subpaths);
  }

  return subpaths.map((subpath) => ({
    closed: subpath.closed,
    anchors: subpath.anchors.map((anchor) => {
      const rx = anchor.point.x - cx;
      const ry = anchor.point.y - cy;
      const localAngle = (angle * Math.hypot(rx, ry)) / maxDist;
      const cos = Math.cos(localAngle);
      const sin = Math.sin(localAngle);
      const rotated = rotateVector({ x: rx, y: ry }, cos, sin);
      return {
        point: { x: cx + rotated.x, y: cy + rotated.y },
        handleIn: anchor.handleIn ? rotateVector(anchor.handleIn, cos, sin) : null,
        handleOut: anchor.handleOut ? rotateVector(anchor.handleOut, cos, sin) : null,
      };
    }),
  }));
};
