import type { Vec2 } from "./vector";
import type { Anchor, SubPath } from "../model/types";

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

const centroid = (anchors: readonly Anchor[]): Vec2 => {
  let x = 0;
  let y = 0;
  for (const anchor of anchors) {
    x += anchor.point.x;
    y += anchor.point.y;
  }
  return { x: x / anchors.length, y: y / anchors.length };
};

const puckerBloatSubPath = (subpath: SubPath, amount: number): SubPath => {
  if (subpath.anchors.length < 2) {
    return cloneSubPath(subpath);
  }

  const center = centroid(subpath.anchors);
  return {
    closed: subpath.closed,
    anchors: subpath.anchors.map((anchor) => {
      // Radial handle pointing from the centroid toward the anchor, scaled by
      // amount. Positive amount pushes the control points outward so the edges
      // bulge (bloat); negative pulls them inward so the edges cave and the
      // anchors become spikes (pucker). in == out gives the characteristic cusp.
      const radial = { x: (anchor.point.x - center.x) * amount, y: (anchor.point.y - center.y) * amount };
      return {
        point: clonePoint(anchor.point),
        handleIn: clonePoint(radial),
        handleOut: clonePoint(radial),
      };
    }),
  };
};

/**
 * Pucker & Bloat: leaves anchor positions fixed and sets each anchor's bezier
 * handles to a radial vector from the subpath centroid, scaled by `amount`.
 * Positive amounts bloat (edges bulge out), negative amounts pucker (edges cave
 * in, anchors spike). A zero or non-finite amount is a no-op. Subpaths with
 * fewer than two anchors are returned unchanged.
 */
export const puckerBloatSubPaths = (subpaths: SubPath[], amount: number): SubPath[] => {
  if (amount === 0 || !Number.isFinite(amount)) {
    return subpaths.map(cloneSubPath);
  }
  return subpaths.map((subpath) => puckerBloatSubPath(subpath, amount));
};
