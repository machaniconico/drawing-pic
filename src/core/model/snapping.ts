import type { BBox } from "../geometry/bbox";
import type { Guide } from "./types";

export interface SnapResult {
  dx: number;
  dy: number;
  guidesX: number[];
  guidesY: number[];
  alignmentGuidesX: SnapAlignmentLine[];
  alignmentGuidesY: SnapAlignmentLine[];
}

export interface SnapAlignmentLine {
  position: number;
  spanMin: number;
  spanMax: number;
}

interface AxisSnap {
  delta: number;
  guide: number | null;
  matches: AxisAnchor[];
}

interface AxisAnchor {
  position: number;
  box: BBox | null;
}

const midpoint = (a: number, b: number): number => (a + b) / 2;
const SNAP_EPSILON = 1e-9;

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
  candidateAnchors: readonly AxisAnchor[],
  threshold: number,
): AxisSnap => {
  if (threshold < 0) {
    return { delta: 0, guide: null, matches: [] };
  }

  let bestDistance = Infinity;
  let bestDelta = 0;
  let bestGuide: number | null = null;

  for (const movingAnchor of movingAnchors) {
    for (const candidateAnchor of candidateAnchors) {
      const delta = candidateAnchor.position - movingAnchor;
      const distance = Math.abs(delta);
      if (distance <= threshold && distance < bestDistance) {
        bestDistance = distance;
        bestDelta = delta;
        bestGuide = candidateAnchor.position;
      }
    }
  }

  if (bestGuide === null) {
    return { delta: bestDelta, guide: bestGuide, matches: [] };
  }

  const matches: AxisAnchor[] = [];
  for (const movingAnchor of movingAnchors) {
    for (const candidateAnchor of candidateAnchors) {
      if (candidateAnchor.box === null) {
        continue;
      }

      const delta = candidateAnchor.position - movingAnchor;
      if (Math.abs(delta - bestDelta) > SNAP_EPSILON) {
        continue;
      }

      if (
        matches.some(
          (match) =>
            match.box === candidateAnchor.box &&
            Math.abs(match.position - candidateAnchor.position) <= SNAP_EPSILON,
        )
      ) {
        continue;
      }

      matches.push(candidateAnchor);
    }
  }

  return { delta: bestDelta, guide: bestGuide, matches };
};

const translateBBox = (box: BBox, dx: number, dy: number): BBox => ({
  minX: box.minX + dx,
  minY: box.minY + dy,
  maxX: box.maxX + dx,
  maxY: box.maxY + dy,
});

const objectXAnchors = (box: BBox): AxisAnchor[] =>
  xAnchors(box).map((position) => ({ position, box }));

const objectYAnchors = (box: BBox): AxisAnchor[] =>
  yAnchors(box).map((position) => ({ position, box }));

const guideAnchor = (position: number): AxisAnchor => ({ position, box: null });

const addAlignmentLine = (
  lines: SnapAlignmentLine[],
  position: number,
  spanMin: number,
  spanMax: number,
): void => {
  const existing = lines.find((line) => Math.abs(line.position - position) <= SNAP_EPSILON);
  if (existing === undefined) {
    lines.push({ position, spanMin, spanMax });
    return;
  }

  existing.spanMin = Math.min(existing.spanMin, spanMin);
  existing.spanMax = Math.max(existing.spanMax, spanMax);
};

const alignmentLinesX = (
  matches: readonly AxisAnchor[],
  moved: BBox,
): SnapAlignmentLine[] => {
  const lines: SnapAlignmentLine[] = [];
  for (const match of matches) {
    if (match.box === null) {
      continue;
    }

    addAlignmentLine(
      lines,
      match.position,
      Math.min(moved.minY, match.box.minY),
      Math.max(moved.maxY, match.box.maxY),
    );
  }
  return lines;
};

const alignmentLinesY = (
  matches: readonly AxisAnchor[],
  moved: BBox,
): SnapAlignmentLine[] => {
  const lines: SnapAlignmentLine[] = [];
  for (const match of matches) {
    if (match.box === null) {
      continue;
    }

    addAlignmentLine(
      lines,
      match.position,
      Math.min(moved.minX, match.box.minX),
      Math.max(moved.maxX, match.box.maxX),
    );
  }
  return lines;
};

export const computeSnap = (
  moving: BBox,
  candidates: readonly BBox[],
  threshold: number,
  guides: readonly Guide[] = [],
): SnapResult => {
  const candidateXAnchors = [
    ...candidates.flatMap((candidate) => objectXAnchors(candidate)),
    ...guides.filter((guide) => guide.axis === "x").map((guide) => guideAnchor(guide.position)),
  ];
  const candidateYAnchors = [
    ...candidates.flatMap((candidate) => objectYAnchors(candidate)),
    ...guides.filter((guide) => guide.axis === "y").map((guide) => guideAnchor(guide.position)),
  ];
  const xSnap = computeAxisSnap(xAnchors(moving), candidateXAnchors, threshold);
  const ySnap = computeAxisSnap(yAnchors(moving), candidateYAnchors, threshold);
  const snappedMoving = translateBBox(moving, xSnap.delta, ySnap.delta);

  return {
    dx: xSnap.delta,
    dy: ySnap.delta,
    guidesX: xSnap.guide === null ? [] : [xSnap.guide],
    guidesY: ySnap.guide === null ? [] : [ySnap.guide],
    alignmentGuidesX: alignmentLinesX(xSnap.matches, snappedMoving),
    alignmentGuidesY: alignmentLinesY(ySnap.matches, snappedMoving),
  };
};

export const snapToGrid = (value: number, grid: number): number => {
  if (grid === 0) {
    return value;
  }

  return Math.round(value / grid) * grid;
};
