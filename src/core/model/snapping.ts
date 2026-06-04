import type { BBox } from "../geometry/bbox";
import type { Guide } from "./types";

export interface SnapResult {
  dx: number;
  dy: number;
  guidesX: number[];
  guidesY: number[];
}

interface AxisSnap {
  delta: number;
  guide: number | null;
}

const midpoint = (a: number, b: number): number => (a + b) / 2;

const xAnchors = (box: BBox): readonly number[] => [
  box.minX,
  midpoint(box.minX, box.maxX),
  box.maxX,
];

const yAnchors = (box: BBox): readonly number[] => [
  box.minY,
  midpoint(box.minY, box.maxY),
  box.maxY,
];

const computeAxisSnap = (
  movingAnchors: readonly number[],
  candidateAnchors: readonly number[],
  threshold: number,
): AxisSnap => {
  if (threshold < 0) {
    return { delta: 0, guide: null };
  }

  let bestDistance = Infinity;
  let bestDelta = 0;
  let bestGuide: number | null = null;

  for (const movingAnchor of movingAnchors) {
    for (const candidateAnchor of candidateAnchors) {
      const delta = candidateAnchor - movingAnchor;
      const distance = Math.abs(delta);
      if (distance <= threshold && distance < bestDistance) {
        bestDistance = distance;
        bestDelta = delta;
        bestGuide = candidateAnchor;
      }
    }
  }

  return { delta: bestDelta, guide: bestGuide };
};

export const computeSnap = (
  moving: BBox,
  candidates: readonly BBox[],
  threshold: number,
  guides: readonly Guide[] = [],
): SnapResult => {
  const candidateXAnchors = [
    ...candidates.flatMap((candidate) => [...xAnchors(candidate)]),
    ...guides.filter((guide) => guide.axis === "x").map((guide) => guide.position),
  ];
  const candidateYAnchors = [
    ...candidates.flatMap((candidate) => [...yAnchors(candidate)]),
    ...guides.filter((guide) => guide.axis === "y").map((guide) => guide.position),
  ];
  const xSnap = computeAxisSnap(xAnchors(moving), candidateXAnchors, threshold);
  const ySnap = computeAxisSnap(yAnchors(moving), candidateYAnchors, threshold);

  return {
    dx: xSnap.delta,
    dy: ySnap.delta,
    guidesX: xSnap.guide === null ? [] : [xSnap.guide],
    guidesY: ySnap.guide === null ? [] : [ySnap.guide],
  };
};

export const snapToGrid = (value: number, grid: number): number => {
  if (grid === 0) {
    return value;
  }

  return Math.round(value / grid) * grid;
};
