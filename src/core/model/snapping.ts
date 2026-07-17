import type { BBox } from "../geometry/bbox";
import type { Vec2 } from "../geometry/vector";
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

export interface SnapMeasurementBadge {
  readonly axis: "x" | "y";
  readonly distance: number;
  readonly start: Vec2;
  readonly end: Vec2;
}

export interface EqualSpacingIndicator {
  readonly axis: "x" | "y";
  readonly distance: number;
  readonly start: Vec2;
  readonly end: Vec2;
}

export interface TransformSnapEdgeResult {
  correction: number;
  guide: number | null;
  alignmentGuides: SnapAlignmentLine[];
}

export interface TransformSnapResult {
  minX: TransformSnapEdgeResult;
  maxX: TransformSnapEdgeResult;
  minY: TransformSnapEdgeResult;
  maxY: TransformSnapEdgeResult;
  alignmentGuidesX: SnapAlignmentLine[];
  alignmentGuidesY: SnapAlignmentLine[];
}

export interface GridGuide extends Guide {
  readonly grid: number;
}

export type TransformSnapGuide = Guide | GridGuide;

export interface RotationSnapOptions {
  readonly threshold: number;
  readonly stepRad?: number;
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

interface TransformAxisSnap {
  correction: number;
  guide: number | null;
  match: AxisAnchor | null;
}

const midpoint = (a: number, b: number): number => (a + b) / 2;
const SNAP_EPSILON = 1e-9;
const FULL_TURN_RAD = Math.PI * 2;
const DEFAULT_ROTATION_SNAP_STEP_RAD = Math.PI / 12;
const CARDINAL_ROTATION_ANGLES_RAD = [0, Math.PI / 2, Math.PI, (Math.PI * 3) / 2] as const;

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

const axisGap = (
  firstMin: number,
  firstMax: number,
  secondMin: number,
  secondMax: number,
): number => {
  if (firstMax < secondMin) {
    return secondMin - firstMax;
  }
  if (secondMax < firstMin) {
    return firstMin - secondMax;
  }
  return 0;
};

const closestCoordinate = (
  firstMin: number,
  firstMax: number,
  secondMin: number,
  secondMax: number,
): number => {
  const overlapMin = Math.max(firstMin, secondMin);
  const overlapMax = Math.min(firstMax, secondMax);
  if (overlapMin <= overlapMax) {
    return midpoint(overlapMin, overlapMax);
  }
  return firstMax < secondMin
    ? midpoint(firstMax, secondMin)
    : midpoint(secondMax, firstMin);
};

const measurementBetweenBoxes = (
  moving: BBox,
  candidate: BBox,
): SnapMeasurementBadge[] => {
  const xGap = axisGap(moving.minX, moving.maxX, candidate.minX, candidate.maxX);
  const yGap = axisGap(moving.minY, moving.maxY, candidate.minY, candidate.maxY);
  const badges: SnapMeasurementBadge[] = [];

  if (xGap > SNAP_EPSILON) {
    const y = closestCoordinate(moving.minY, moving.maxY, candidate.minY, candidate.maxY);
    const startX = moving.maxX < candidate.minX ? moving.maxX : candidate.maxX;
    const endX = moving.maxX < candidate.minX ? candidate.minX : moving.minX;
    badges.push({
      axis: "x",
      distance: xGap,
      start: { x: startX, y },
      end: { x: endX, y },
    });
  }

  if (yGap > SNAP_EPSILON) {
    const x = closestCoordinate(moving.minX, moving.maxX, candidate.minX, candidate.maxX);
    const startY = moving.maxY < candidate.minY ? moving.maxY : candidate.maxY;
    const endY = moving.maxY < candidate.minY ? candidate.minY : moving.minY;
    badges.push({
      axis: "y",
      distance: yGap,
      start: { x, y: startY },
      end: { x, y: endY },
    });
  }

  return badges;
};

/** Returns edge-to-edge distance badges for the geometrically nearest object. */
export const computeNearestDistanceBadges = (
  moving: BBox,
  candidates: readonly BBox[],
): SnapMeasurementBadge[] => {
  let nearest: BBox | null = null;
  let nearestDistance = Infinity;

  for (const candidate of candidates) {
    const xGap = axisGap(moving.minX, moving.maxX, candidate.minX, candidate.maxX);
    const yGap = axisGap(moving.minY, moving.maxY, candidate.minY, candidate.maxY);
    const distance = Math.hypot(xGap, yGap);
    if (distance < nearestDistance) {
      nearest = candidate;
      nearestDistance = distance;
    }
  }

  return nearest === null ? [] : measurementBetweenBoxes(moving, nearest);
};

const orthogonalRangesOverlap = (
  boxes: readonly BBox[],
  axis: "x" | "y",
  tolerance: number,
): boolean => {
  const overlapMin = Math.max(...boxes.map((box) => axis === "x" ? box.minY : box.minX));
  const overlapMax = Math.min(...boxes.map((box) => axis === "x" ? box.maxY : box.maxX));
  return overlapMin <= overlapMax + tolerance;
};

const spacingIndicatorsForTriple = (
  moving: BBox,
  first: BBox,
  second: BBox,
  axis: "x" | "y",
  tolerance: number,
): EqualSpacingIndicator[] => {
  const boxes = [moving, first, second];
  if (!orthogonalRangesOverlap(boxes, axis, tolerance)) {
    return [];
  }

  const minKey = axis === "x" ? "minX" : "minY";
  const maxKey = axis === "x" ? "maxX" : "maxY";
  const ordered = [...boxes].sort((a, b) => a[minKey] - b[minKey]);
  const left = ordered[0];
  const middle = ordered[1];
  const right = ordered[2];
  if (left === undefined || middle === undefined || right === undefined) {
    return [];
  }

  const firstGap = middle[minKey] - left[maxKey];
  const secondGap = right[minKey] - middle[maxKey];
  if (
    firstGap < -SNAP_EPSILON ||
    secondGap < -SNAP_EPSILON ||
    Math.abs(firstGap - secondGap) > Math.max(0, tolerance)
  ) {
    return [];
  }

  const distance = (firstGap + secondGap) / 2;
  const crossMin = Math.max(...boxes.map((box) => axis === "x" ? box.minY : box.minX));
  const crossMax = Math.min(...boxes.map((box) => axis === "x" ? box.maxY : box.maxX));
  const cross = midpoint(crossMin, crossMax);
  return axis === "x"
    ? [
        {
          axis,
          distance,
          start: { x: left.maxX, y: cross },
          end: { x: middle.minX, y: cross },
        },
        {
          axis,
          distance,
          start: { x: middle.maxX, y: cross },
          end: { x: right.minX, y: cross },
        },
      ]
    : [
        {
          axis,
          distance,
          start: { x: cross, y: left.maxY },
          end: { x: cross, y: middle.minY },
        },
        {
          axis,
          distance,
          start: { x: cross, y: middle.maxY },
          end: { x: cross, y: right.minY },
        },
      ];
};

const addUniqueSpacingIndicator = (
  indicators: EqualSpacingIndicator[],
  indicator: EqualSpacingIndicator,
): void => {
  const duplicate = indicators.some(
    (candidate) =>
      candidate.axis === indicator.axis &&
      Math.abs(candidate.start.x - indicator.start.x) <= SNAP_EPSILON &&
      Math.abs(candidate.start.y - indicator.start.y) <= SNAP_EPSILON &&
      Math.abs(candidate.end.x - indicator.end.x) <= SNAP_EPSILON &&
      Math.abs(candidate.end.y - indicator.end.y) <= SNAP_EPSILON,
  );
  if (!duplicate) {
    indicators.push(indicator);
  }
};

/** Detects equal edge gaps in aligned triples that include the moving object. */
export const computeEqualSpacingIndicators = (
  moving: BBox,
  candidates: readonly BBox[],
  tolerance: number,
): EqualSpacingIndicator[] => {
  if (candidates.length < 2 || tolerance < 0) {
    return [];
  }

  const indicators: EqualSpacingIndicator[] = [];
  for (let firstIndex = 0; firstIndex < candidates.length - 1; firstIndex += 1) {
    const first = candidates[firstIndex];
    if (first === undefined) {
      continue;
    }
    for (let secondIndex = firstIndex + 1; secondIndex < candidates.length; secondIndex += 1) {
      const second = candidates[secondIndex];
      if (second === undefined) {
        continue;
      }
      for (const axis of ["x", "y"] as const) {
        for (const indicator of spacingIndicatorsForTriple(
          moving,
          first,
          second,
          axis,
          tolerance,
        )) {
          addUniqueSpacingIndicator(indicators, indicator);
        }
      }
    }
  }
  return indicators;
};

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

const guideAnchor = (position: number): AxisAnchor => ({
  position,
  box: null,
});

const gridAnchor = (position: number): AxisAnchor => ({
  position,
  box: null,
});

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

const transformEdgeResult = (
  correction: number,
  guide: number | null,
  alignmentGuides: SnapAlignmentLine[],
): TransformSnapEdgeResult => ({
  correction,
  guide,
  alignmentGuides,
});

const emptyTransformEdgeResult = (): TransformSnapEdgeResult =>
  transformEdgeResult(0, null, []);

const isGridGuide = (guide: TransformSnapGuide): guide is GridGuide => "grid" in guide;

const transformGuideAnchors = (
  guides: readonly TransformSnapGuide[],
  axis: Guide["axis"],
): AxisAnchor[] =>
  guides
    .filter((guide) => guide.axis === axis && !isGridGuide(guide))
    .map((guide) => guideAnchor(guide.position));

const gridGuides = (
  guides: readonly TransformSnapGuide[],
  axis: Guide["axis"],
): GridGuide[] =>
  guides.filter(
    (guide): guide is GridGuide =>
      guide.axis === axis && isGridGuide(guide) && Math.abs(guide.grid) > SNAP_EPSILON,
  );

const transformLineX = (match: AxisAnchor, moved: BBox): SnapAlignmentLine => ({
  position: match.position,
  spanMin: match.box === null ? moved.minY : Math.min(moved.minY, match.box.minY),
  spanMax: match.box === null ? moved.maxY : Math.max(moved.maxY, match.box.maxY),
});

const transformLineY = (match: AxisAnchor, moved: BBox): SnapAlignmentLine => ({
  position: match.position,
  spanMin: match.box === null ? moved.minX : Math.min(moved.minX, match.box.minX),
  spanMax: match.box === null ? moved.maxX : Math.max(moved.maxX, match.box.maxX),
});

const mergeAlignmentLines = (
  edgeResults: readonly TransformSnapEdgeResult[],
): SnapAlignmentLine[] => {
  const lines: SnapAlignmentLine[] = [];
  for (const edgeResult of edgeResults) {
    for (const line of edgeResult.alignmentGuides) {
      addAlignmentLine(lines, line.position, line.spanMin, line.spanMax);
    }
  }
  return lines;
};

const transformedBBoxForEdge = (
  moving: BBox,
  edge: "minX" | "maxX" | "minY" | "maxY",
  correction: number,
): BBox => ({
  minX: edge === "minX" ? moving.minX + correction : moving.minX,
  maxX: edge === "maxX" ? moving.maxX + correction : moving.maxX,
  minY: edge === "minY" ? moving.minY + correction : moving.minY,
  maxY: edge === "maxY" ? moving.maxY + correction : moving.maxY,
});

const axisValuesForEdge = (
  moving: BBox,
  edge: "minX" | "maxX" | "minY" | "maxY",
): readonly number[] => {
  switch (edge) {
    case "minX":
      return [moving.minX, midpoint(moving.minX, moving.maxX)];
    case "maxX":
      return [moving.maxX, midpoint(moving.minX, moving.maxX)];
    case "minY":
      return [moving.minY, midpoint(moving.minY, moving.maxY)];
    case "maxY":
      return [moving.maxY, midpoint(moving.minY, moving.maxY)];
  }
};

const correctionForTransformAnchor = (
  target: number,
  anchor: number,
  isCenterAnchor: boolean,
): number => (isCenterAnchor ? 2 * (target - anchor) : target - anchor);

const nearestGridAnchor = (value: number, guide: GridGuide): AxisAnchor => {
  const grid = Math.abs(guide.grid);
  return gridAnchor(guide.position + snapToGrid(value - guide.position, grid));
};

const computeTransformAxisSnap = (
  movingAnchors: readonly number[],
  candidateAnchors: readonly AxisAnchor[],
  threshold: number,
  grids: readonly GridGuide[],
): TransformAxisSnap => {
  if (threshold < 0) {
    return { correction: 0, guide: null, match: null };
  }

  let bestDistance = Infinity;
  let bestCorrection = 0;
  let bestMatch: AxisAnchor | null = null;

  for (let movingIndex = 0; movingIndex < movingAnchors.length; movingIndex += 1) {
    const movingAnchor = movingAnchors[movingIndex];
    const isCenterAnchor = movingIndex === 1;
    for (const candidateAnchor of candidateAnchors) {
      const distance = Math.abs(candidateAnchor.position - movingAnchor);
      if (distance <= threshold && distance < bestDistance) {
        bestDistance = distance;
        bestCorrection = correctionForTransformAnchor(
          candidateAnchor.position,
          movingAnchor,
          isCenterAnchor,
        );
        bestMatch = candidateAnchor;
      }
    }
  }

  if (bestMatch !== null) {
    return { correction: bestCorrection, guide: bestMatch.position, match: bestMatch };
  }

  for (let movingIndex = 0; movingIndex < movingAnchors.length; movingIndex += 1) {
    const movingAnchor = movingAnchors[movingIndex];
    const isCenterAnchor = movingIndex === 1;
    for (const guide of grids) {
      const candidateAnchor = nearestGridAnchor(movingAnchor, guide);
      const distance = Math.abs(candidateAnchor.position - movingAnchor);
      if (distance <= threshold && distance < bestDistance) {
        bestDistance = distance;
        bestCorrection = correctionForTransformAnchor(
          candidateAnchor.position,
          movingAnchor,
          isCenterAnchor,
        );
        bestMatch = candidateAnchor;
      }
    }
  }

  return bestMatch === null
    ? { correction: 0, guide: null, match: null }
    : { correction: bestCorrection, guide: bestMatch.position, match: bestMatch };
};

const computeTransformEdgeSnap = (
  moving: BBox,
  edge: "minX" | "maxX" | "minY" | "maxY",
  candidateAnchors: readonly AxisAnchor[],
  threshold: number,
  grids: readonly GridGuide[],
): TransformSnapEdgeResult => {
  const snap = computeTransformAxisSnap(
    axisValuesForEdge(moving, edge),
    candidateAnchors,
    threshold,
    grids,
  );
  if (snap.match === null) {
    return emptyTransformEdgeResult();
  }

  const moved = transformedBBoxForEdge(moving, edge, snap.correction);
  const alignmentLine =
    edge === "minX" || edge === "maxX"
      ? transformLineX(snap.match, moved)
      : transformLineY(snap.match, moved);
  return transformEdgeResult(snap.correction, snap.guide, [alignmentLine]);
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

const normalizePositiveAngle = (angleRad: number): number => {
  const normalized = angleRad % FULL_TURN_RAD;
  return normalized < 0 ? normalized + FULL_TURN_RAD : normalized;
};

const nearestPeriodicAngle = (angleRad: number, targetAngleRad: number): number => {
  const normalizedTarget = normalizePositiveAngle(targetAngleRad);
  const turns = Math.round((angleRad - normalizedTarget) / FULL_TURN_RAD);
  return normalizedTarget + turns * FULL_TURN_RAD;
};

export const snapRotation = (angleRad: number, opts: RotationSnapOptions): number => {
  const { threshold, stepRad = DEFAULT_ROTATION_SNAP_STEP_RAD } = opts;
  if (threshold < 0) {
    return angleRad;
  }

  let bestAngle = angleRad;
  let bestDistance = Infinity;
  const considerCandidate = (candidate: number): void => {
    const distance = Math.abs(candidate - angleRad);
    if (distance <= threshold && distance < bestDistance) {
      bestAngle = candidate;
      bestDistance = distance;
    }
  };

  const absoluteStep = Math.abs(stepRad);
  if (absoluteStep > SNAP_EPSILON) {
    considerCandidate(Math.round(angleRad / absoluteStep) * absoluteStep);
  }

  for (const cardinalAngleRad of CARDINAL_ROTATION_ANGLES_RAD) {
    considerCandidate(nearestPeriodicAngle(angleRad, cardinalAngleRad));
  }

  return bestAngle;
};

export const computeTransformSnap = (
  moving: BBox,
  candidates: readonly BBox[],
  threshold: number,
  guides: readonly TransformSnapGuide[] = [],
): TransformSnapResult => {
  const candidateXAnchors = [
    ...candidates.flatMap((candidate) => objectXAnchors(candidate)),
    ...transformGuideAnchors(guides, "x"),
  ];
  const candidateYAnchors = [
    ...candidates.flatMap((candidate) => objectYAnchors(candidate)),
    ...transformGuideAnchors(guides, "y"),
  ];
  const xGrids = gridGuides(guides, "x");
  const yGrids = gridGuides(guides, "y");

  const minX = computeTransformEdgeSnap(moving, "minX", candidateXAnchors, threshold, xGrids);
  const maxX = computeTransformEdgeSnap(moving, "maxX", candidateXAnchors, threshold, xGrids);
  const minY = computeTransformEdgeSnap(moving, "minY", candidateYAnchors, threshold, yGrids);
  const maxY = computeTransformEdgeSnap(moving, "maxY", candidateYAnchors, threshold, yGrids);

  return {
    minX,
    maxX,
    minY,
    maxY,
    alignmentGuidesX: mergeAlignmentLines([minX, maxX]),
    alignmentGuidesY: mergeAlignmentLines([minY, maxY]),
  };
};
