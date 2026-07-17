import { center, isEmpty, type BBox } from "../geometry/bbox";
import type { Vec2 } from "../geometry/vector";

export interface SmartGuide {
  readonly axis: "x" | "y";
  readonly start: Vec2;
  readonly end: Vec2;
}

export interface SmartGuideResult {
  readonly delta: Vec2;
  readonly guides: SmartGuide[];
}

interface AxisAnchor {
  readonly position: number;
  readonly box: BBox;
}

interface AxisMatch {
  readonly delta: number;
  readonly anchors: AxisAnchor[];
}

const EPSILON = 1e-9;

const xAnchors = (box: BBox): number[] => [box.minX, center(box).x, box.maxX];
const yAnchors = (box: BBox): number[] => [box.minY, center(box).y, box.maxY];

const computeAxisMatch = (
  movingAnchors: readonly number[],
  otherAnchors: readonly AxisAnchor[],
  threshold: number,
): AxisMatch => {
  let bestDistance = Infinity;
  let bestDelta = 0;

  for (const movingAnchor of movingAnchors) {
    for (const otherAnchor of otherAnchors) {
      const delta = otherAnchor.position - movingAnchor;
      const distance = Math.abs(delta);
      if (distance <= threshold && distance < bestDistance) {
        bestDistance = distance;
        bestDelta = delta;
      }
    }
  }

  if (!Number.isFinite(bestDistance)) {
    return { delta: 0, anchors: [] };
  }

  const anchors: AxisAnchor[] = [];
  for (const movingAnchor of movingAnchors) {
    for (const otherAnchor of otherAnchors) {
      if (Math.abs(otherAnchor.position - movingAnchor - bestDelta) > EPSILON) {
        continue;
      }
      if (
        anchors.some(
          (anchor) =>
            anchor.box === otherAnchor.box &&
            Math.abs(anchor.position - otherAnchor.position) <= EPSILON,
        )
      ) {
        continue;
      }
      anchors.push(otherAnchor);
    }
  }

  return { delta: bestDelta, anchors };
};

const addGuide = (guides: SmartGuide[], guide: SmartGuide): void => {
  const existingIndex = guides.findIndex(
    (candidate) =>
      candidate.axis === guide.axis &&
      (guide.axis === "x"
        ? Math.abs(candidate.start.x - guide.start.x) <= EPSILON
        : Math.abs(candidate.start.y - guide.start.y) <= EPSILON),
  );
  if (existingIndex < 0) {
    guides.push(guide);
    return;
  }

  const existing = guides[existingIndex];
  if (existing === undefined) {
    return;
  }

  if (guide.axis === "x") {
    guides[existingIndex] = {
      axis: "x",
      start: { x: existing.start.x, y: Math.min(existing.start.y, guide.start.y) },
      end: { x: existing.end.x, y: Math.max(existing.end.y, guide.end.y) },
    };
    return;
  }

  guides[existingIndex] = {
    axis: "y",
    start: { x: Math.min(existing.start.x, guide.start.x), y: existing.start.y },
    end: { x: Math.max(existing.end.x, guide.end.x), y: existing.end.y },
  };
};

/** Computes object edge/center alignment guides and the nearest per-axis correction. */
export const computeSmartGuides = (
  movingBBox: BBox,
  otherBBoxes: readonly BBox[],
  threshold: number,
): SmartGuideResult => {
  if (isEmpty(movingBBox) || threshold < 0) {
    return { delta: { x: 0, y: 0 }, guides: [] };
  }

  const candidates = otherBBoxes.filter((box) => !isEmpty(box));
  const xMatch = computeAxisMatch(
    xAnchors(movingBBox),
    candidates.flatMap((box) => xAnchors(box).map((position) => ({ position, box }))),
    threshold,
  );
  const yMatch = computeAxisMatch(
    yAnchors(movingBBox),
    candidates.flatMap((box) => yAnchors(box).map((position) => ({ position, box }))),
    threshold,
  );
  const moved = {
    minX: movingBBox.minX + xMatch.delta,
    minY: movingBBox.minY + yMatch.delta,
    maxX: movingBBox.maxX + xMatch.delta,
    maxY: movingBBox.maxY + yMatch.delta,
  };
  const guides: SmartGuide[] = [];

  for (const anchor of xMatch.anchors) {
    addGuide(guides, {
      axis: "x",
      start: { x: anchor.position, y: Math.min(moved.minY, anchor.box.minY) },
      end: { x: anchor.position, y: Math.max(moved.maxY, anchor.box.maxY) },
    });
  }
  for (const anchor of yMatch.anchors) {
    addGuide(guides, {
      axis: "y",
      start: { x: Math.min(moved.minX, anchor.box.minX), y: anchor.position },
      end: { x: Math.max(moved.maxX, anchor.box.maxX), y: anchor.position },
    });
  }

  return {
    delta: { x: xMatch.delta, y: yMatch.delta },
    guides,
  };
};
