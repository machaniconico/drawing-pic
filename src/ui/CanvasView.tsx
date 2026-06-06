import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type CSSProperties,
  type ChangeEvent,
  type KeyboardEvent as ReactKeyboardEvent,
  type MouseEvent as ReactMouseEvent,
  type PointerEvent as ReactPointerEvent,
  type WheelEvent as ReactWheelEvent,
} from "react";
import { produce } from "immer";
import {
  center as bboxCenter,
  fromRect,
  height as bboxHeight,
  isEmpty,
  transform as transformBBox,
  width as bboxWidth,
  type BBox,
} from "../core/geometry/bbox";
import { apply, applyVector, compose, IDENTITY, invert, rotation, scaling, translate, type Matrix } from "../core/geometry/matrix";
import type { Vec2 } from "../core/geometry/vector";
import { corner, createEllipse, createPath, createRect, createText } from "../core/model/factory";
import { hitTest } from "../core/model/hittest";
import { formatAngle, formatDistance, measureBetween } from "../core/model/measure";
import { deleteAnchor, insertAnchor, moveAnchor, moveHandle, setAnchorType, type HandleSide } from "../core/model/pathEdit";
import { selectionBounds, worldBounds } from "../core/model/bounds";
import {
  computeSnap,
  computeTransformSnap,
  snapRotation,
  snapToGrid,
  type SnapAlignmentLine,
  type TransformSnapEdgeResult,
  type TransformSnapGuide,
  type TransformSnapResult,
} from "../core/model/snapping";
import { hasStyle, isContainer, type Anchor, type Document, type Guide, type NodeId, type PathNode, type SceneNode, type TextNode } from "../core/model/types";
import { renderDocument } from "../render/canvasRenderer";
import { nodesInRect } from "../state/selectors";
import { pushHistory } from "../state/history";
import { sampleStyleAt, type SampledStyle } from "../state/operations";
import { editorStore, useEditorStore, type EditorStore, type EditorViewport, type SnapSettings } from "../state/store";
import GuidePrefs from "./GuidePrefs";
import { Rulers } from "./Rulers";
import "./CanvasView.css";

interface Size {
  width: number;
  height: number;
}

type ResizeHandleId = "nw" | "n" | "ne" | "e" | "se" | "s" | "sw" | "w";

interface BaseDragState {
  mode:
    | "move"
    | "pan"
    | "create-rect"
    | "create-ellipse"
    | "marquee"
    | "scale"
    | "rotate"
    | "pen-anchor"
    | "node-anchor"
    | "node-handle"
    | "guide"
    | "measure";
  pointerId: number;
  startScreen: Vec2;
  lastScreen: Vec2;
  startWorld: Vec2;
  additive: boolean;
  moved: boolean;
}

interface SimpleDragState extends BaseDragState {
  mode: "pan" | "create-rect" | "create-ellipse" | "marquee";
}

interface TransformDragBase extends BaseDragState {
  additive: boolean;
  changed: boolean;
  originalDoc: Document;
  originalTransforms: Partial<Record<NodeId, Matrix>>;
  selectedIds: NodeId[];
}

interface ScaleDragState extends TransformDragBase {
  mode: "scale";
  anchorWorld: Vec2;
  initialBounds: BBox;
  candidateBounds: BBox[];
  handleId: ResizeHandleId;
  handleStartWorld: Vec2;
}

interface RotateDragState extends TransformDragBase {
  mode: "rotate";
  centerWorld: Vec2;
  startAngle: number;
}

interface MoveDragState extends TransformDragBase {
  mode: "move";
  initialBounds: BBox;
  candidateBounds: BBox[];
}

interface PenAnchorDragState extends BaseDragState {
  mode: "pen-anchor";
  additive: false;
  anchorIndex: number;
  anchorWorld: Vec2;
}

interface SelectedPathAnchor {
  subpathIndex: number;
  anchorIndex: number;
}

interface NodeEditDragBase extends BaseDragState {
  mode: "node-anchor" | "node-handle";
  additive: false;
  changed: boolean;
  nodeId: NodeId;
  target: SelectedPathAnchor;
  originalDoc: Document;
  nodeWorldTransform: Matrix;
}

interface NodeAnchorDragState extends NodeEditDragBase {
  mode: "node-anchor";
  anchorSnapCandidateBounds: BBox[];
}

interface NodeHandleDragState extends NodeEditDragBase {
  mode: "node-handle";
  side: HandleSide;
  originalOffset: Vec2;
}

interface GuideDragState extends BaseDragState {
  mode: "guide";
  additive: false;
  changed: boolean;
  guideId: NodeId;
  axis: Guide["axis"];
  originalDoc: Document;
  originalHistory: EditorStore["history"];
}

interface MeasureDragState extends BaseDragState {
  mode: "measure";
  additive: false;
}

type DragState =
  | SimpleDragState
  | MoveDragState
  | ScaleDragState
  | RotateDragState
  | PenAnchorDragState
  | NodeAnchorDragState
  | NodeHandleDragState
  | GuideDragState
  | MeasureDragState;

interface PenDraft {
  anchors: Anchor[];
  cursorWorld: Vec2 | null;
}

interface InlineTextEdit {
  id: NodeId;
  value: string;
  createdEmpty: boolean;
}

interface SnapGuides {
  guidesX: number[];
  guidesY: number[];
  alignmentGuidesX: SnapAlignmentLine[];
  alignmentGuidesY: SnapAlignmentLine[];
}

interface MoveGesture {
  dx: number;
  dy: number;
  guides: SnapGuides;
}

interface TransformGesture {
  matrix: Matrix;
  guides: SnapGuides;
}

interface RotateGesture extends TransformGesture {
  angleRad: number;
}

interface NodeAnchorGesture {
  localDelta: Vec2;
  guides: SnapGuides;
}

interface NodeEditGestureResult {
  changed: boolean;
  guides: SnapGuides;
}

interface RotationReadout {
  angleRad: number;
  screenPoint: Vec2;
}

interface MeasureOverlay {
  startWorld: Vec2;
  endWorld: Vec2;
}

const MIN_ZOOM = 0.05;
const MAX_ZOOM = 64;
const HANDLE_SIZE = 7;
const HANDLE_HIT_SIZE = 12;
const ROTATION_HANDLE_OFFSET = 28;
const ROTATION_HANDLE_RADIUS = 5;
const ROTATION_HANDLE_HIT_RADIUS = 10;
const PEN_CLOSE_THRESHOLD = 6;
const PEN_ANCHOR_SIZE = 6;
const DRAG_MOVE_THRESHOLD = 2;
const SNAP_THRESHOLD_SCREEN_PX = 6;
const MATRIX_EPSILON = 1e-9;
const SCALE_EPSILON = 1e-6;
const SNAP_ROTATION_RADIANS = Math.PI / 12;
const ROTATION_SNAP_THRESHOLD_RADIANS = SNAP_ROTATION_RADIANS / 2;
const NODE_ANCHOR_SIZE = 7;
const NODE_ANCHOR_HIT_SIZE = 12;
const NODE_HANDLE_RADIUS = 4;
const NODE_HANDLE_HIT_RADIUS = 8;
const NODE_SEGMENT_HIT_TOLERANCE = 6;
const RULER_SIZE = 24;
const GUIDE_HIT_SCREEN_PX = 5;
const DEFAULT_GUIDE_COLOR = "#20d9ff";

const RESIZE_HANDLE_DIRECTIONS: Record<ResizeHandleId, { x: -1 | 0 | 1; y: -1 | 0 | 1 }> = {
  nw: { x: -1, y: -1 },
  n: { x: 0, y: -1 },
  ne: { x: 1, y: -1 },
  e: { x: 1, y: 0 },
  se: { x: 1, y: 1 },
  s: { x: 0, y: 1 },
  sw: { x: -1, y: 1 },
  w: { x: -1, y: 0 },
};

const emptySnapGuides = (): SnapGuides => ({
  guidesX: [],
  guidesY: [],
  alignmentGuidesX: [],
  alignmentGuidesY: [],
});

const OPPOSITE_RESIZE_HANDLES: Record<ResizeHandleId, ResizeHandleId> = {
  nw: "se",
  n: "s",
  ne: "sw",
  e: "w",
  se: "nw",
  s: "n",
  sw: "ne",
  w: "e",
};

interface SelectionOverlayGeometry {
  bounds: BBox;
  x: number;
  y: number;
  width: number;
  height: number;
  resizeHandles: Array<{ id: ResizeHandleId; point: Vec2 }>;
  rotationHandle: Vec2;
  topMidpoint: Vec2;
}

type SelectionHandleHit =
  | { type: "scale"; handleId: ResizeHandleId }
  | { type: "rotate" };

interface GuideHit {
  guide: Guide;
  distance: number;
}

const clamp = (value: number, min: number, max: number): number =>
  Math.min(max, Math.max(min, value));

const getDpr = (): number => window.devicePixelRatio || 1;

const screenToWorld = (point: Vec2, viewport: EditorViewport): Vec2 => ({
  x: (point.x - viewport.pan.x) / viewport.zoom,
  y: (point.y - viewport.pan.y) / viewport.zoom,
});

const worldToScreen = (point: Vec2, viewport: EditorViewport): Vec2 => ({
  x: point.x * viewport.zoom + viewport.pan.x,
  y: point.y * viewport.zoom + viewport.pan.y,
});

const distance = (a: Vec2, b: Vec2): number => Math.hypot(a.x - b.x, a.y - b.y);

const radiansToDegrees = (angleRad: number): number => angleRad * 180 / Math.PI;

const formatRotationReadout = (angleRad: number): string => `${Math.round(radiansToDegrees(angleRad))}deg`;

const hasDragMoved = (start: Vec2, current: Vec2): boolean =>
  Math.abs(current.x - start.x) > DRAG_MOVE_THRESHOLD ||
  Math.abs(current.y - start.y) > DRAG_MOVE_THRESHOLD;

const addVec2 = (a: Vec2, b: Vec2 | null): Vec2 =>
  b === null ? a : { x: a.x + b.x, y: a.y + b.y };

const subVec2 = (a: Vec2, b: Vec2): Vec2 => ({ x: a.x - b.x, y: a.y - b.y });

const constrainMeasureEnd = (start: Vec2, end: Vec2): Vec2 => {
  const dx = end.x - start.x;
  const dy = end.y - start.y;
  const length = Math.hypot(dx, dy);
  if (length <= MATRIX_EPSILON) {
    return end;
  }

  const snappedAngle = Math.round(Math.atan2(dy, dx) / (Math.PI / 4)) * (Math.PI / 4);
  return {
    x: start.x + Math.cos(snappedAngle) * length,
    y: start.y + Math.sin(snappedAngle) * length,
  };
};

const matrixNearlyEqual = (a: Matrix, b: Matrix): boolean =>
  Math.abs(a.a - b.a) < MATRIX_EPSILON &&
  Math.abs(a.b - b.b) < MATRIX_EPSILON &&
  Math.abs(a.c - b.c) < MATRIX_EPSILON &&
  Math.abs(a.d - b.d) < MATRIX_EPSILON &&
  Math.abs(a.e - b.e) < MATRIX_EPSILON &&
  Math.abs(a.f - b.f) < MATRIX_EPSILON;

const eventPoint = (
  event:
    | PointerEvent
    | ReactMouseEvent<HTMLCanvasElement>
    | ReactPointerEvent<HTMLCanvasElement>
    | ReactWheelEvent<HTMLCanvasElement>,
  canvas: HTMLCanvasElement,
): Vec2 => {
  const rect = canvas.getBoundingClientRect();
  return {
    x: event.clientX - rect.left,
    y: event.clientY - rect.top,
  };
};

const createShapeFromDrag = (tool: "rect" | "ellipse", start: Vec2, current: Vec2): SceneNode | null => {
  const x = Math.min(start.x, current.x);
  const y = Math.min(start.y, current.y);
  const width = Math.abs(current.x - start.x);
  const height = Math.abs(current.y - start.y);

  if (width < 1 || height < 1) {
    return null;
  }

  if (tool === "rect") {
    return createRect(x, y, width, height);
  }

  return createEllipse(x + width / 2, y + height / 2, width / 2, height / 2);
};

const getResizeHandlePoint = (bounds: BBox, id: ResizeHandleId): Vec2 => {
  const centerX = (bounds.minX + bounds.maxX) / 2;
  const centerY = (bounds.minY + bounds.maxY) / 2;

  switch (id) {
    case "nw":
      return { x: bounds.minX, y: bounds.minY };
    case "n":
      return { x: centerX, y: bounds.minY };
    case "ne":
      return { x: bounds.maxX, y: bounds.minY };
    case "e":
      return { x: bounds.maxX, y: centerY };
    case "se":
      return { x: bounds.maxX, y: bounds.maxY };
    case "s":
      return { x: centerX, y: bounds.maxY };
    case "sw":
      return { x: bounds.minX, y: bounds.maxY };
    case "w":
      return { x: bounds.minX, y: centerY };
  }
};

const getSelectionOverlayGeometry = (
  doc: Document,
  selection: readonly NodeId[],
  viewport: EditorViewport,
): SelectionOverlayGeometry | null => {
  if (selection.length === 0) {
    return null;
  }

  const bounds = selectionBounds(doc, selection);
  const boundsWidth = bboxWidth(bounds);
  const boundsHeight = bboxHeight(bounds);
  if (isEmpty(bounds) || boundsWidth <= 0 || boundsHeight <= 0) {
    return null;
  }

  const topLeft = worldToScreen({ x: bounds.minX, y: bounds.minY }, viewport);
  const bottomRight = worldToScreen(
    { x: bounds.maxX, y: bounds.maxY },
    viewport,
  );
  const x = Math.min(topLeft.x, bottomRight.x);
  const y = Math.min(topLeft.y, bottomRight.y);
  const width = Math.abs(bottomRight.x - topLeft.x);
  const height = Math.abs(bottomRight.y - topLeft.y);
  const centerX = x + width / 2;
  const resizeHandles: Array<{ id: ResizeHandleId; point: Vec2 }> = [
    { id: "nw", point: { x, y } },
    { id: "n", point: { x: centerX, y } },
    { id: "ne", point: { x: x + width, y } },
    { id: "e", point: { x: x + width, y: y + height / 2 } },
    { id: "se", point: { x: x + width, y: y + height } },
    { id: "s", point: { x: centerX, y: y + height } },
    { id: "sw", point: { x, y: y + height } },
    { id: "w", point: { x, y: y + height / 2 } },
  ];
  const topMidpoint = { x: centerX, y };

  return {
    bounds,
    x,
    y,
    width,
    height,
    resizeHandles,
    rotationHandle: { x: centerX, y: y - ROTATION_HANDLE_OFFSET },
    topMidpoint,
  };
};

const translateBBox = (box: BBox, dx: number, dy: number): BBox => ({
  minX: box.minX + dx,
  minY: box.minY + dy,
  maxX: box.maxX + dx,
  maxY: box.maxY + dy,
});

const collectSnapCandidateBounds = (doc: Document, selection: readonly NodeId[]): BBox[] => {
  const selectedIds = new Set(selection);
  const candidateIds = new Set<NodeId>();

  const addSiblingCandidates = (childIds: readonly NodeId[]): void => {
    const containsSelection = childIds.some((childId) => selectedIds.has(childId));
    if (containsSelection) {
      for (const childId of childIds) {
        if (!selectedIds.has(childId)) {
          candidateIds.add(childId);
        }
      }
    }

    for (const childId of childIds) {
      const child = doc.nodes[childId];
      if (child && isContainer(child)) {
        addSiblingCandidates(child.children);
      }
    }
  };

  const addBounds = (id: NodeId, bounds: BBox[]): void => {
    if (selectedIds.has(id)) {
      return;
    }

    const node = doc.nodes[id];
    if (!node || !node.visible) {
      return;
    }

    if (isContainer(node)) {
      for (const childId of node.children) {
        addBounds(childId, bounds);
      }
      return;
    }

    const box = worldBounds(doc, id);
    if (!isEmpty(box)) {
      bounds.push(box);
    }
  };

  addSiblingCandidates(doc.layerOrder);

  const bounds: BBox[] = [];
  for (const id of candidateIds) {
    addBounds(id, bounds);
  }
  return bounds;
};

const pointBBox = (point: Vec2): BBox => fromRect(point.x, point.y, 0, 0);

const visibleGuides = (guides: readonly Guide[]): Guide[] =>
  guides.filter((guide) => guide.hidden !== true);

const effectiveGridSize = (snapSettings: SnapSettings): number =>
  Math.abs(snapSettings.gridSize);

const snapDisabled = (snapSettings: SnapSettings, overrideDisabled: boolean): boolean =>
  overrideDisabled || !snapSettings.enabled;

const objectSnapCandidates = (
  candidateBounds: readonly BBox[],
  snapSettings: SnapSettings,
): readonly BBox[] => (snapSettings.toObjects ? candidateBounds : []);

const guideSnapCandidates = (
  guides: readonly Guide[],
  snapSettings: SnapSettings,
): Guide[] => (snapSettings.toGuides ? visibleGuides(guides) : []);

const gridSnapDelta = (
  value: number,
  snapSettings: SnapSettings,
): number => {
  const gridSize = effectiveGridSize(snapSettings);
  return snapSettings.toGrid && gridSize > MATRIX_EPSILON
    ? snapToGrid(value, gridSize) - value
    : 0;
};

const transformSnapGuides = (
  guides: readonly Guide[],
  snapSettings: SnapSettings,
): TransformSnapGuide[] => {
  const candidates: TransformSnapGuide[] = snapSettings.toGuides
    ? [...visibleGuides(guides)]
    : [];
  const gridSize = effectiveGridSize(snapSettings);
  if (snapSettings.toGrid && gridSize > MATRIX_EPSILON) {
    candidates.push(
      { id: "grid-x", axis: "x", position: 0, grid: gridSize },
      { id: "grid-y", axis: "y", position: 0, grid: gridSize },
    );
  }
  return candidates;
};

const computeMoveGesture = (
  drag: MoveDragState,
  currentScreen: Vec2,
  viewport: EditorViewport,
  snapSettings: SnapSettings,
  overrideSnappingDisabled: boolean,
): MoveGesture => {
  const rawDx = (currentScreen.x - drag.startScreen.x) / viewport.zoom;
  const rawDy = (currentScreen.y - drag.startScreen.y) / viewport.zoom;

  if (snapDisabled(snapSettings, overrideSnappingDisabled) || isEmpty(drag.initialBounds)) {
    return {
      dx: rawDx,
      dy: rawDy,
      guides: emptySnapGuides(),
    };
  }

  const movedBounds = translateBBox(drag.initialBounds, rawDx, rawDy);
  const snap = computeSnap(
    movedBounds,
    objectSnapCandidates(drag.candidateBounds, snapSettings),
    SNAP_THRESHOLD_SCREEN_PX / viewport.zoom,
    guideSnapCandidates(drag.originalDoc.guides, snapSettings),
  );
  const gridDx = gridSnapDelta(movedBounds.minX, snapSettings);
  const gridDy = gridSnapDelta(movedBounds.minY, snapSettings);
  const snapDx = snap.guidesX.length > 0 ? snap.dx : gridDx;
  const snapDy = snap.guidesY.length > 0 ? snap.dy : gridDy;

  return {
    dx: rawDx + snapDx,
    dy: rawDy + snapDy,
    guides: {
      guidesX: snap.guidesX,
      guidesY: snap.guidesY,
      alignmentGuidesX: snap.alignmentGuidesX,
      alignmentGuidesY: snap.alignmentGuidesY,
    },
  };
};

type XTransformEdge = "minX" | "maxX";
type YTransformEdge = "minY" | "maxY";

const activeScaleXEdge = (handleId: ResizeHandleId): XTransformEdge | null => {
  const direction = RESIZE_HANDLE_DIRECTIONS[handleId];
  if (direction.x < 0) {
    return "minX";
  }
  if (direction.x > 0) {
    return "maxX";
  }
  return null;
};

const activeScaleYEdge = (handleId: ResizeHandleId): YTransformEdge | null => {
  const direction = RESIZE_HANDLE_DIRECTIONS[handleId];
  if (direction.y < 0) {
    return "minY";
  }
  if (direction.y > 0) {
    return "maxY";
  }
  return null;
};

const hasTransformSnapMatch = (edge: TransformSnapEdgeResult): boolean =>
  edge.guide !== null || edge.alignmentGuides.length > 0;

const mergeSnapAlignmentLines = (lines: readonly SnapAlignmentLine[]): SnapAlignmentLine[] => {
  const merged: SnapAlignmentLine[] = [];
  for (const line of lines) {
    const existing = merged.find((candidate) => Math.abs(candidate.position - line.position) <= MATRIX_EPSILON);
    if (existing === undefined) {
      merged.push({ ...line });
      continue;
    }

    existing.spanMin = Math.min(existing.spanMin, line.spanMin);
    existing.spanMax = Math.max(existing.spanMax, line.spanMax);
  }
  return merged;
};

const transformSnapGuidesForActiveEdges = (
  snap: TransformSnapResult,
  xEdge: XTransformEdge | null,
  yEdge: YTransformEdge | null,
): SnapGuides => {
  const alignmentGuidesX = xEdge === null ? [] : snap[xEdge].alignmentGuides;
  const alignmentGuidesY = yEdge === null ? [] : snap[yEdge].alignmentGuides;
  return {
    guidesX: xEdge === null || snap[xEdge].guide === null ? [] : [snap[xEdge].guide],
    guidesY: yEdge === null || snap[yEdge].guide === null ? [] : [snap[yEdge].guide],
    alignmentGuidesX: mergeSnapAlignmentLines(alignmentGuidesX),
    alignmentGuidesY: mergeSnapAlignmentLines(alignmentGuidesY),
  };
};

const scaledPointerAxisForEdge = (
  drag: ScaleDragState,
  movedBounds: BBox,
  edge: XTransformEdge | YTransformEdge,
  correction: number,
): number | null => {
  const axis = edge === "minX" || edge === "maxX" ? "x" : "y";
  const initialEdge = drag.initialBounds[edge];
  const anchor = drag.anchorWorld[axis];
  const pointerStart = drag.handleStartWorld[axis];
  const edgeDenominator = initialEdge - anchor;
  const pointerDenominator = pointerStart - anchor;
  if (Math.abs(edgeDenominator) < SCALE_EPSILON || Math.abs(pointerDenominator) < SCALE_EPSILON) {
    return null;
  }

  const scale = (movedBounds[edge] + correction - anchor) / edgeDenominator;
  return anchor + scale * pointerDenominator;
};

const scaleFromEdgeCorrection = (
  drag: ScaleDragState,
  movedBounds: BBox,
  edge: XTransformEdge | YTransformEdge,
  correction: number,
): number | null => {
  const axis = edge === "minX" || edge === "maxX" ? "x" : "y";
  const initialEdge = drag.initialBounds[edge];
  const anchor = drag.anchorWorld[axis];
  const denominator = initialEdge - anchor;
  if (Math.abs(denominator) < SCALE_EPSILON) {
    return null;
  }

  return (movedBounds[edge] + correction - anchor) / denominator;
};

const correctedScalePointer = (
  drag: ScaleDragState,
  currentWorld: Vec2,
  movedBounds: BBox,
  snap: TransformSnapResult,
  constrained: boolean,
): Vec2 => {
  const xEdge = activeScaleXEdge(drag.handleId);
  const yEdge = activeScaleYEdge(drag.handleId);

  if (constrained) {
    const candidates: Array<{ scale: number; correctionDistance: number }> = [];
    if (xEdge !== null && hasTransformSnapMatch(snap[xEdge])) {
      const scale = scaleFromEdgeCorrection(drag, movedBounds, xEdge, snap[xEdge].correction);
      if (scale !== null) {
        candidates.push({ scale, correctionDistance: Math.abs(snap[xEdge].correction) });
      }
    }
    if (yEdge !== null && hasTransformSnapMatch(snap[yEdge])) {
      const scale = scaleFromEdgeCorrection(drag, movedBounds, yEdge, snap[yEdge].correction);
      if (scale !== null) {
        candidates.push({ scale, correctionDistance: Math.abs(snap[yEdge].correction) });
      }
    }

    const candidate = candidates.reduce<{ scale: number; correctionDistance: number } | null>(
      (best, next) => (best === null || next.correctionDistance < best.correctionDistance ? next : best),
      null,
    );
    return candidate === null
      ? currentWorld
      : {
          x: drag.anchorWorld.x + candidate.scale * (drag.handleStartWorld.x - drag.anchorWorld.x),
          y: drag.anchorWorld.y + candidate.scale * (drag.handleStartWorld.y - drag.anchorWorld.y),
        };
  }

  let corrected = currentWorld;
  if (xEdge !== null && snap[xEdge].correction !== 0) {
    const x = scaledPointerAxisForEdge(drag, movedBounds, xEdge, snap[xEdge].correction);
    corrected = { ...corrected, x: x ?? corrected.x + snap[xEdge].correction };
  }
  if (yEdge !== null && snap[yEdge].correction !== 0) {
    const y = scaledPointerAxisForEdge(drag, movedBounds, yEdge, snap[yEdge].correction);
    corrected = { ...corrected, y: y ?? corrected.y + snap[yEdge].correction };
  }

  return corrected;
};

const computeScaleGesture = (
  drag: ScaleDragState,
  currentWorld: Vec2,
  viewport: EditorViewport,
  constrained: boolean,
  snapSettings: SnapSettings,
  overrideSnappingDisabled: boolean,
): TransformGesture => {
  const rawMatrix = scaleGestureMatrix(drag, currentWorld, constrained);
  if (snapDisabled(snapSettings, overrideSnappingDisabled) || isEmpty(drag.initialBounds)) {
    return {
      matrix: rawMatrix,
      guides: emptySnapGuides(),
    };
  }

  const movedBounds = transformBBox(drag.initialBounds, rawMatrix);
  const snap = computeTransformSnap(
    movedBounds,
    objectSnapCandidates(drag.candidateBounds, snapSettings),
    SNAP_THRESHOLD_SCREEN_PX / viewport.zoom,
    transformSnapGuides(drag.originalDoc.guides, snapSettings),
  );
  const xEdge = activeScaleXEdge(drag.handleId);
  const yEdge = activeScaleYEdge(drag.handleId);
  const snappedWorld = correctedScalePointer(drag, currentWorld, movedBounds, snap, constrained);
  return {
    matrix: scaleGestureMatrix(drag, snappedWorld, constrained),
    guides: transformSnapGuidesForActiveEdges(snap, xEdge, yEdge),
  };
};

const hitSelectionHandle = (
  doc: Document,
  selection: readonly NodeId[],
  viewport: EditorViewport,
  point: Vec2,
): SelectionHandleHit | null => {
  const geometry = getSelectionOverlayGeometry(doc, selection, viewport);
  if (geometry === null) {
    return null;
  }

  if (distance(point, geometry.rotationHandle) <= ROTATION_HANDLE_HIT_RADIUS) {
    return { type: "rotate" };
  }

  const hitHalfSize = HANDLE_HIT_SIZE / 2;
  for (const handle of geometry.resizeHandles) {
    if (
      Math.abs(point.x - handle.point.x) <= hitHalfSize &&
      Math.abs(point.y - handle.point.y) <= hitHalfSize
    ) {
      return { type: "scale", handleId: handle.id };
    }
  }

  return null;
};

const guideScreenCoordinate = (guide: Guide, viewport: EditorViewport): number =>
  guide.axis === "x"
    ? worldToScreen({ x: guide.position, y: 0 }, viewport).x
    : worldToScreen({ x: 0, y: guide.position }, viewport).y;

const hitGuide = (
  doc: Document,
  viewport: EditorViewport,
  point: Vec2,
): Guide | null => {
  let nearest: GuideHit | null = null;

  for (const guide of doc.guides) {
    if (guide.hidden === true) {
      continue;
    }

    const coordinate = guideScreenCoordinate(guide, viewport);
    const distanceToGuide = guide.axis === "x"
      ? Math.abs(point.x - coordinate)
      : Math.abs(point.y - coordinate);
    if (
      distanceToGuide <= GUIDE_HIT_SCREEN_PX &&
      (nearest === null || distanceToGuide < nearest.distance)
    ) {
      nearest = { guide, distance: distanceToGuide };
    }
  }

  return nearest?.guide ?? null;
};

const guidePositionFromWorldPoint = (guide: Pick<Guide, "axis">, worldPoint: Vec2): number =>
  guide.axis === "x" ? worldPoint.x : worldPoint.y;

const isGuideDroppedOnRuler = (axis: Guide["axis"], point: Vec2): boolean =>
  axis === "x" ? point.x <= RULER_SIZE : point.y <= RULER_SIZE;

const moveGuideForGesture = (drag: GuideDragState, position: number): boolean => {
  const state = editorStore.getState();
  const current = state.doc.guides.find((guide) => guide.id === drag.guideId);
  if (current === undefined || current.locked === true || current.position === position) {
    editorStore.setState({ history: drag.originalHistory });
    return false;
  }

  state.moveGuide(drag.guideId, position);
  editorStore.setState({ history: drag.originalHistory });
  return true;
};

const removeGuideForGesture = (drag: GuideDragState): boolean => {
  const state = editorStore.getState();
  const current = state.doc.guides.find((guide) => guide.id === drag.guideId);
  if (current === undefined || current.locked === true) {
    editorStore.setState({ history: drag.originalHistory });
    return false;
  }

  state.removeGuide(drag.guideId);
  editorStore.setState({
    history: pushHistory(drag.originalHistory, drag.originalDoc),
  });
  return true;
};

const guideChangedFromOriginal = (drag: GuideDragState): boolean => {
  const current = editorStore.getState().doc.guides.find((guide) => guide.id === drag.guideId);
  const original = drag.originalDoc.guides.find((guide) => guide.id === drag.guideId);
  return current?.position !== original?.position || current?.axis !== original?.axis;
};

const commitGuideGesture = (drag: GuideDragState): void => {
  if (!drag.changed && !guideChangedFromOriginal(drag)) {
    editorStore.setState({ history: drag.originalHistory });
    return;
  }

  editorStore.setState({
    history: pushHistory(drag.originalHistory, drag.originalDoc),
  });
};

const drawSelectionOverlay = (
  ctx: CanvasRenderingContext2D,
  doc: Document,
  selection: NodeId[],
  viewport: EditorViewport,
  dpr: number,
  showHandles: boolean,
): void => {
  const geometry = getSelectionOverlayGeometry(doc, selection, viewport);
  if (geometry === null) {
    return;
  }

  const handle = HANDLE_SIZE;
  const halfHandle = handle / 2;

  ctx.save();
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.strokeStyle = "#2d8cf0";
  ctx.lineWidth = 1;
  ctx.setLineDash([4, 3]);
  ctx.strokeRect(geometry.x + 0.5, geometry.y + 0.5, geometry.width, geometry.height);
  ctx.setLineDash([]);

  // Scale / rotate handles are interactive only with the Select tool, so only
  // draw them in that mode; the dashed bounding box always indicates selection.
  if (!showHandles) {
    ctx.restore();
    return;
  }

  ctx.beginPath();
  ctx.moveTo(geometry.topMidpoint.x, geometry.topMidpoint.y);
  ctx.lineTo(geometry.rotationHandle.x, geometry.rotationHandle.y);
  ctx.stroke();

  ctx.fillStyle = "#ffffff";
  ctx.strokeStyle = "#2d8cf0";
  for (const { point } of geometry.resizeHandles) {
    ctx.fillRect(point.x - halfHandle, point.y - halfHandle, handle, handle);
    ctx.strokeRect(point.x - halfHandle + 0.5, point.y - halfHandle + 0.5, handle, handle);
  }

  ctx.beginPath();
  ctx.arc(
    geometry.rotationHandle.x,
    geometry.rotationHandle.y,
    ROTATION_HANDLE_RADIUS,
    0,
    Math.PI * 2,
  );
  ctx.fill();
  ctx.stroke();
  ctx.restore();
};

const drawRotationReadout = (
  ctx: CanvasRenderingContext2D,
  readout: RotationReadout | null,
  size: Size,
  dpr: number,
): void => {
  if (readout === null) {
    return;
  }

  const label = formatRotationReadout(readout.angleRad);
  const paddingX = 8;
  const paddingY = 5;
  const offset = 14;

  ctx.save();
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.font = "12px system-ui, -apple-system, BlinkMacSystemFont, Segoe UI, sans-serif";
  ctx.textBaseline = "middle";

  const metrics = ctx.measureText(label);
  const width = Math.ceil(metrics.width + paddingX * 2);
  const height = Math.ceil(12 + paddingY * 2);
  const x = clamp(readout.screenPoint.x + offset, 4, Math.max(4, size.width - width - 4));
  const y = clamp(readout.screenPoint.y - offset - height, 4, Math.max(4, size.height - height - 4));

  ctx.fillStyle = "rgba(17, 24, 39, 0.92)";
  ctx.fillRect(x, y, width, height);
  ctx.strokeStyle = "rgba(255, 255, 255, 0.28)";
  ctx.strokeRect(x + 0.5, y + 0.5, width - 1, height - 1);
  ctx.fillStyle = "#ffffff";
  ctx.fillText(label, x + paddingX, y + height / 2);
  ctx.restore();
};

const drawMeasureOverlay = (
  ctx: CanvasRenderingContext2D,
  overlay: MeasureOverlay | null,
  viewport: EditorViewport,
  size: Size,
  dpr: number,
): void => {
  if (overlay === null) {
    return;
  }

  const measurement = measureBetween(overlay.startWorld, overlay.endWorld);
  const start = worldToScreen(overlay.startWorld, viewport);
  const end = worldToScreen(overlay.endWorld, viewport);
  const midpoint = worldToScreen(measurement.midpoint, viewport);
  const label = `${formatDistance(measurement.distance)} px  ${formatAngle(measurement.angleDeg)}`;
  const paddingX = 8;
  const paddingY = 5;
  const offset = 12;

  ctx.save();
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.lineWidth = 1.5;
  ctx.strokeStyle = "#0f766e";
  ctx.fillStyle = "#ffffff";
  ctx.setLineDash([]);

  ctx.beginPath();
  ctx.moveTo(start.x, start.y);
  ctx.lineTo(end.x, end.y);
  ctx.stroke();

  ctx.beginPath();
  ctx.arc(start.x, start.y, 3.5, 0, Math.PI * 2);
  ctx.fill();
  ctx.stroke();
  ctx.beginPath();
  ctx.arc(end.x, end.y, 3.5, 0, Math.PI * 2);
  ctx.fill();
  ctx.stroke();

  ctx.font = "12px system-ui, -apple-system, BlinkMacSystemFont, Segoe UI, sans-serif";
  ctx.textBaseline = "middle";
  const metrics = ctx.measureText(label);
  const width = Math.ceil(metrics.width + paddingX * 2);
  const height = Math.ceil(12 + paddingY * 2);
  const anchor = distance(start, end) < 80 ? end : midpoint;
  const x = clamp(anchor.x + offset, 4, Math.max(4, size.width - width - 4));
  const y = clamp(anchor.y - offset - height, 4, Math.max(4, size.height - height - 4));

  ctx.fillStyle = "rgba(17, 24, 39, 0.94)";
  ctx.fillRect(x, y, width, height);
  ctx.strokeStyle = "rgba(255, 255, 255, 0.28)";
  ctx.strokeRect(x + 0.5, y + 0.5, width - 1, height - 1);
  ctx.fillStyle = "#ffffff";
  ctx.fillText(label, x + paddingX, y + height / 2);
  ctx.restore();
};

const drawDocumentGuides = (
  ctx: CanvasRenderingContext2D,
  guides: readonly Guide[],
  viewport: EditorViewport,
  size: Size,
  dpr: number,
): void => {
  if (guides.length === 0) {
    return;
  }

  ctx.save();
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.lineWidth = 1;

  for (const guide of guides) {
    if (guide.hidden === true) {
      continue;
    }

    const coordinate = guideScreenCoordinate(guide, viewport);
    ctx.strokeStyle = guide.color ?? DEFAULT_GUIDE_COLOR;
    ctx.globalAlpha = guide.locked === true ? 0.42 : 0.9;
    ctx.setLineDash(guide.locked === true ? [4, 4] : []);
    ctx.beginPath();
    if (guide.axis === "x") {
      ctx.moveTo(coordinate + 0.5, 0);
      ctx.lineTo(coordinate + 0.5, size.height);
    } else {
      ctx.moveTo(0, coordinate + 0.5);
      ctx.lineTo(size.width, coordinate + 0.5);
    }
    ctx.stroke();
  }

  ctx.restore();
};

const drawGridOverlay = (
  ctx: CanvasRenderingContext2D,
  viewport: EditorViewport,
  size: Size,
  dpr: number,
  gridSize: number,
): void => {
  const spacing = Math.abs(gridSize);
  if (spacing <= MATRIX_EPSILON || size.width <= 0 || size.height <= 0) {
    return;
  }

  // Skip drawing when the grid would be denser than a few screen pixels: such a
  // grid is visually just noise and, when zoomed far out, would draw tens of
  // thousands of lines per frame. This bounds the loops below to size/MIN px.
  const MIN_SCREEN_SPACING = 4;
  if (spacing * viewport.zoom < MIN_SCREEN_SPACING) {
    return;
  }

  const worldTopLeft = screenToWorld({ x: 0, y: 0 }, viewport);
  const worldBottomRight = screenToWorld({ x: size.width, y: size.height }, viewport);
  const minX = Math.min(worldTopLeft.x, worldBottomRight.x);
  const maxX = Math.max(worldTopLeft.x, worldBottomRight.x);
  const minY = Math.min(worldTopLeft.y, worldBottomRight.y);
  const maxY = Math.max(worldTopLeft.y, worldBottomRight.y);
  const firstX = Math.ceil(minX / spacing) * spacing;
  const firstY = Math.ceil(minY / spacing) * spacing;

  ctx.save();
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.strokeStyle = "rgba(15, 23, 42, 0.08)";
  ctx.lineWidth = 1;
  ctx.setLineDash([]);

  ctx.beginPath();
  for (let x = firstX; x <= maxX + MATRIX_EPSILON; x += spacing) {
    const screenX = worldToScreen({ x, y: 0 }, viewport).x;
    ctx.moveTo(Math.round(screenX) + 0.5, 0);
    ctx.lineTo(Math.round(screenX) + 0.5, size.height);
  }
  for (let y = firstY; y <= maxY + MATRIX_EPSILON; y += spacing) {
    const screenY = worldToScreen({ x: 0, y }, viewport).y;
    ctx.moveTo(0, Math.round(screenY) + 0.5);
    ctx.lineTo(size.width, Math.round(screenY) + 0.5);
  }
  ctx.stroke();
  ctx.restore();
};

const transformableSelection = (doc: Document, selection: readonly NodeId[]): NodeId[] =>
  selection.filter((id) => {
    const node = doc.nodes[id];
    return Boolean(node && node.visible && !node.locked);
  });

const captureOriginalTransforms = (
  doc: Document,
  ids: readonly NodeId[],
): Partial<Record<NodeId, Matrix>> => {
  const transforms: Partial<Record<NodeId, Matrix>> = {};
  for (const id of ids) {
    const node = doc.nodes[id];
    if (node) {
      transforms[id] = { ...node.transform };
    }
  }
  return transforms;
};

const pathToNode = (doc: Document, id: NodeId): SceneNode[] | null => {
  const visit = (nodeId: NodeId, path: SceneNode[]): SceneNode[] | null => {
    const node = doc.nodes[nodeId];
    if (!node) {
      return null;
    }

    const nextPath = [...path, node];
    if (node.id === id) {
      return nextPath;
    }

    if (node.type === "layer" || node.type === "group") {
      for (const childId of node.children) {
        const childPath = visit(childId, nextPath);
        if (childPath) {
          return childPath;
        }
      }
    }

    return null;
  };

  for (const layerId of doc.layerOrder) {
    const path = visit(layerId, []);
    if (path) {
      return path;
    }
  }

  return null;
};

const parentWorldTransform = (doc: Document, id: NodeId): Matrix => {
  const path = pathToNode(doc, id);
  if (path === null) {
    return IDENTITY;
  }

  return path.slice(0, -1).reduce((acc, node) => compose(acc, node.transform), IDENTITY);
};

const nodeWorldTransform = (doc: Document, id: NodeId): Matrix => {
  const path = pathToNode(doc, id);
  if (path === null) {
    return IDENTITY;
  }

  return path.reduce((acc, node) => compose(acc, node.transform), IDENTITY);
};

const getEditablePathNode = (
  doc: Document,
  selection: readonly NodeId[],
): { id: NodeId; node: PathNode; worldTransform: Matrix } | null => {
  if (selection.length !== 1) {
    return null;
  }

  const id = selection[0];
  if (id === undefined) {
    return null;
  }

  const node = doc.nodes[id];
  if (!node || node.type !== "path" || node.locked || !node.visible) {
    return null;
  }

  return { id, node, worldTransform: nodeWorldTransform(doc, id) };
};

const collectAnchorSnapCandidateBounds = (
  doc: Document,
  draggedNodeId: NodeId,
  draggedTarget: SelectedPathAnchor,
): BBox[] => {
  const bounds: BBox[] = [];
  for (const node of Object.values(doc.nodes)) {
    if (node.type !== "path" || node.locked || !node.visible) {
      continue;
    }

    const worldTransform = nodeWorldTransform(doc, node.id);
    for (const [subpathIndex, subpath] of node.subpaths.entries()) {
      for (const [anchorIndex, anchor] of subpath.anchors.entries()) {
        if (
          node.id === draggedNodeId &&
          subpathIndex === draggedTarget.subpathIndex &&
          anchorIndex === draggedTarget.anchorIndex
        ) {
          continue;
        }

        bounds.push(pointBBox(apply(worldTransform, anchor.point)));
      }
    }
  }
  return bounds;
};

const isValidSelectedAnchor = (node: PathNode, anchor: SelectedPathAnchor | null): anchor is SelectedPathAnchor => {
  if (anchor === null) {
    return false;
  }

  const subpath = node.subpaths[anchor.subpathIndex];
  return Boolean(subpath && anchor.anchorIndex >= 0 && anchor.anchorIndex < subpath.anchors.length);
};

const selectedAnchorsEqual = (a: SelectedPathAnchor | null, b: SelectedPathAnchor | null): boolean =>
  a === b ||
  (a !== null &&
    b !== null &&
    a.subpathIndex === b.subpathIndex &&
    a.anchorIndex === b.anchorIndex);

const vecNearlyEqual = (a: Vec2, b: Vec2): boolean =>
  Math.abs(a.x - b.x) < MATRIX_EPSILON && Math.abs(a.y - b.y) < MATRIX_EPSILON;

const handleNearlyEqual = (a: Vec2 | null, b: Vec2 | null): boolean =>
  a === b || (a !== null && b !== null && vecNearlyEqual(a, b));

const pathSubpathsNearlyEqual = (a: PathNode["subpaths"], b: PathNode["subpaths"]): boolean =>
  a.length === b.length &&
  a.every((subpath, subpathIndex) => {
    const other = b[subpathIndex];
    return Boolean(
      other &&
        subpath.closed === other.closed &&
        subpath.anchors.length === other.anchors.length &&
        subpath.anchors.every((anchor, anchorIndex) => {
          const otherAnchor = other.anchors[anchorIndex];
          return Boolean(
            otherAnchor &&
              vecNearlyEqual(anchor.point, otherAnchor.point) &&
              handleNearlyEqual(anchor.handleIn, otherAnchor.handleIn) &&
              handleNearlyEqual(anchor.handleOut, otherAnchor.handleOut),
          );
        }),
    );
  });

const clonePathSubpaths = (subpaths: PathNode["subpaths"]): PathNode["subpaths"] =>
  subpaths.map((subpath) => ({
    closed: subpath.closed,
    anchors: subpath.anchors.map((anchor) => ({
      point: { ...anchor.point },
      handleIn: anchor.handleIn === null ? null : { ...anchor.handleIn },
      handleOut: anchor.handleOut === null ? null : { ...anchor.handleOut },
    })),
  }));

const cloneStroke = (stroke: SampledStyle["stroke"]): SampledStyle["stroke"] =>
  stroke === null ? null : structuredClone(stroke);

const applySampledStyleToSelection = (ids: readonly NodeId[], style: SampledStyle): boolean => {
  if (ids.length === 0) {
    return false;
  }

  const state = editorStore.getState();
  const selectedIds = [...new Set(ids)];
  const originalDoc = structuredClone(state.doc) as Document;
  let changed = false;

  editorStore.setState(
    produce((store: EditorStore) => {
      for (const id of selectedIds) {
        const node = store.doc.nodes[id];
        if (!node || !hasStyle(node)) {
          continue;
        }

        node.fill = structuredClone(style.fill);
        node.stroke = cloneStroke(style.stroke);
        changed = true;
      }

      if (changed) {
        store.history = pushHistory(store.history, originalDoc);
      }
    }),
  );

  return changed;
};

const screenDeltaToNodeLocal = (
  drag: NodeEditDragBase,
  point: Vec2,
  viewport: EditorViewport,
): Vec2 => {
  const worldDelta = {
    x: (point.x - drag.startScreen.x) / viewport.zoom,
    y: (point.y - drag.startScreen.y) / viewport.zoom,
  };
  const invertedWorld = invert(drag.nodeWorldTransform);
  return invertedWorld === null ? worldDelta : applyVector(invertedWorld, worldDelta);
};

const originalAnchorWorldPoint = (drag: NodeAnchorDragState): Vec2 | null => {
  const originalNode = drag.originalDoc.nodes[drag.nodeId];
  if (!originalNode || originalNode.type !== "path") {
    return null;
  }

  const originalSubpath = originalNode.subpaths[drag.target.subpathIndex];
  const originalAnchor = originalSubpath?.anchors[drag.target.anchorIndex];
  return originalAnchor === undefined ? null : apply(drag.nodeWorldTransform, originalAnchor.point);
};

const worldDeltaToNodeLocal = (drag: NodeEditDragBase, worldDelta: Vec2): Vec2 => {
  const invertedWorld = invert(drag.nodeWorldTransform);
  return invertedWorld === null ? worldDelta : applyVector(invertedWorld, worldDelta);
};

const computeNodeAnchorGesture = (
  drag: NodeAnchorDragState,
  currentScreen: Vec2,
  viewport: EditorViewport,
  snapSettings: SnapSettings,
  overrideSnappingDisabled: boolean,
): NodeAnchorGesture | null => {
  const anchorWorld = originalAnchorWorldPoint(drag);
  if (anchorWorld === null) {
    return null;
  }

  const rawWorldPoint = {
    x: anchorWorld.x + (currentScreen.x - drag.startScreen.x) / viewport.zoom,
    y: anchorWorld.y + (currentScreen.y - drag.startScreen.y) / viewport.zoom,
  };
  if (snapDisabled(snapSettings, overrideSnappingDisabled)) {
    return {
      localDelta: worldDeltaToNodeLocal(drag, subVec2(rawWorldPoint, anchorWorld)),
      guides: emptySnapGuides(),
    };
  }

  const moving = pointBBox(rawWorldPoint);
  const snap = computeSnap(
    moving,
    objectSnapCandidates(drag.anchorSnapCandidateBounds, snapSettings),
    SNAP_THRESHOLD_SCREEN_PX / viewport.zoom,
    guideSnapCandidates(drag.originalDoc.guides, snapSettings),
  );
  const gridDx = gridSnapDelta(rawWorldPoint.x, snapSettings);
  const gridDy = gridSnapDelta(rawWorldPoint.y, snapSettings);
  const snapDx = snap.guidesX.length > 0 ? snap.dx : gridDx;
  const snapDy = snap.guidesY.length > 0 ? snap.dy : gridDy;
  const snappedWorldPoint = {
    x: rawWorldPoint.x + snapDx,
    y: rawWorldPoint.y + snapDy,
  };

  return {
    localDelta: worldDeltaToNodeLocal(drag, subVec2(snappedWorldPoint, anchorWorld)),
    guides: {
      guidesX: snap.guidesX,
      guidesY: snap.guidesY,
      alignmentGuidesX: snap.alignmentGuidesX,
      alignmentGuidesY: snap.alignmentGuidesY,
    },
  };
};

type NodeEditHit =
  | { type: "handle"; target: SelectedPathAnchor; side: HandleSide; offset: Vec2 }
  | { type: "anchor"; target: SelectedPathAnchor }
  | { type: "segment"; target: SelectedPathAnchor; t: number };

const cubicPoint = (p0: Vec2, p1: Vec2, p2: Vec2, p3: Vec2, t: number): Vec2 => {
  const mt = 1 - t;
  const mt2 = mt * mt;
  const t2 = t * t;
  return {
    x: mt2 * mt * p0.x + 3 * mt2 * t * p1.x + 3 * mt * t2 * p2.x + t2 * t * p3.x,
    y: mt2 * mt * p0.y + 3 * mt2 * t * p1.y + 3 * mt * t2 * p2.y + t2 * t * p3.y,
  };
};

const nearestOnSegment = (point: Vec2, a: Vec2, b: Vec2): { distance: number; t: number } => {
  const ab = subVec2(b, a);
  const lengthSquared = ab.x * ab.x + ab.y * ab.y;
  if (lengthSquared === 0) {
    return { distance: distance(point, a), t: 0 };
  }

  const ap = subVec2(point, a);
  const t = clamp((ap.x * ab.x + ap.y * ab.y) / lengthSquared, 0, 1);
  return { distance: distance(point, { x: a.x + ab.x * t, y: a.y + ab.y * t }), t };
};

const nearestOnCubic = (
  point: Vec2,
  p0: Vec2,
  p1: Vec2,
  p2: Vec2,
  p3: Vec2,
): { distance: number; t: number } => {
  let previous = p0;
  let previousT = 0;
  let nearest = {
    distance: Number.POSITIVE_INFINITY,
    t: 0,
  };
  for (let step = 1; step <= 24; step += 1) {
    const currentT = step / 24;
    const current = cubicPoint(p0, p1, p2, p3, currentT);
    const segmentNearest = nearestOnSegment(point, previous, current);
    if (segmentNearest.distance < nearest.distance) {
      nearest = {
        distance: segmentNearest.distance,
        t: previousT + (currentT - previousT) * segmentNearest.t,
      };
    }
    previous = current;
    previousT = currentT;
  }
  return nearest;
};

const hitNodeEditOverlay = (
  node: PathNode,
  worldTransform: Matrix,
  viewport: EditorViewport,
  point: Vec2,
  selectedAnchor: SelectedPathAnchor | null,
): NodeEditHit | null => {
  if (isValidSelectedAnchor(node, selectedAnchor)) {
    const subpath = node.subpaths[selectedAnchor.subpathIndex]!;
    const anchor = subpath.anchors[selectedAnchor.anchorIndex]!;
    const handleHits: Array<{ side: HandleSide; offset: Vec2 }> = [];
    if (anchor.handleIn !== null) {
      handleHits.push({ side: "in", offset: anchor.handleIn });
    }
    if (anchor.handleOut !== null) {
      handleHits.push({ side: "out", offset: anchor.handleOut });
    }

    for (const handle of handleHits) {
      const screenPoint = worldToScreen(apply(worldTransform, addVec2(anchor.point, handle.offset)), viewport);
      if (distance(point, screenPoint) <= NODE_HANDLE_HIT_RADIUS) {
        return {
          type: "handle",
          target: selectedAnchor,
          side: handle.side,
          offset: handle.offset,
        };
      }
    }
  }

  const halfHit = NODE_ANCHOR_HIT_SIZE / 2;
  for (const [subpathIndex, subpath] of node.subpaths.entries()) {
    for (const [anchorIndex, anchor] of subpath.anchors.entries()) {
      const screenPoint = worldToScreen(apply(worldTransform, anchor.point), viewport);
      if (Math.abs(point.x - screenPoint.x) <= halfHit && Math.abs(point.y - screenPoint.y) <= halfHit) {
        return { type: "anchor", target: { subpathIndex, anchorIndex } };
      }
    }
  }

  let nearestSegment: ({ distance: number } & Extract<NodeEditHit, { type: "segment" }>) | null = null;
  for (const [subpathIndex, subpath] of node.subpaths.entries()) {
    for (const [anchorIndex, anchor] of subpath.anchors.entries()) {
      const nextIndex = anchorIndex + 1 < subpath.anchors.length ? anchorIndex + 1 : subpath.closed ? 0 : -1;
      const nextAnchor = nextIndex >= 0 ? subpath.anchors[nextIndex] : undefined;
      if (nextAnchor === undefined) {
        continue;
      }

      const p0 = worldToScreen(apply(worldTransform, anchor.point), viewport);
      const p1 = worldToScreen(apply(worldTransform, addVec2(anchor.point, anchor.handleOut)), viewport);
      const p2 = worldToScreen(apply(worldTransform, addVec2(nextAnchor.point, nextAnchor.handleIn)), viewport);
      const p3 = worldToScreen(apply(worldTransform, nextAnchor.point), viewport);
      const nearest = nearestOnCubic(point, p0, p1, p2, p3);
      if (nearest.distance <= NODE_SEGMENT_HIT_TOLERANCE && (nearestSegment === null || nearest.distance < nearestSegment.distance)) {
        nearestSegment = {
          type: "segment",
          target: { subpathIndex, anchorIndex },
          t: nearest.t,
          distance: nearest.distance,
        };
      }
    }
  }

  return nearestSegment;
};

const composeAboutPoint = (point: Vec2, transform: Matrix): Matrix =>
  compose(
    translate(point.x, point.y),
    compose(transform, compose(translate(-point.x, -point.y), IDENTITY)),
  );

const axisScale = (
  currentWorld: Vec2,
  anchorWorld: Vec2,
  handleStartWorld: Vec2,
  axis: "x" | "y",
): number => {
  const denominator = handleStartWorld[axis] - anchorWorld[axis];
  if (Math.abs(denominator) < SCALE_EPSILON) {
    return 1;
  }

  return (currentWorld[axis] - anchorWorld[axis]) / denominator;
};

const uniformScale = (
  currentWorld: Vec2,
  anchorWorld: Vec2,
  handleStartWorld: Vec2,
  direction: { x: -1 | 0 | 1; y: -1 | 0 | 1 },
): number => {
  const startX = direction.x === 0 ? 0 : handleStartWorld.x - anchorWorld.x;
  const startY = direction.y === 0 ? 0 : handleStartWorld.y - anchorWorld.y;
  const currentX = direction.x === 0 ? 0 : currentWorld.x - anchorWorld.x;
  const currentY = direction.y === 0 ? 0 : currentWorld.y - anchorWorld.y;
  const lengthSquared = startX * startX + startY * startY;

  if (lengthSquared < SCALE_EPSILON) {
    return 1;
  }

  return (currentX * startX + currentY * startY) / lengthSquared;
};

const scaleGestureMatrix = (
  drag: ScaleDragState,
  currentWorld: Vec2,
  constrained: boolean,
): Matrix => {
  const direction = RESIZE_HANDLE_DIRECTIONS[drag.handleId];
  let sx = direction.x === 0
    ? 1
    : axisScale(currentWorld, drag.anchorWorld, drag.handleStartWorld, "x");
  let sy = direction.y === 0
    ? 1
    : axisScale(currentWorld, drag.anchorWorld, drag.handleStartWorld, "y");

  if (constrained) {
    const scale = uniformScale(currentWorld, drag.anchorWorld, drag.handleStartWorld, direction);
    sx = scale;
    sy = scale;
  }

  return composeAboutPoint(drag.anchorWorld, scaling(sx, sy));
};

const rotateGestureMatrix = (
  drag: RotateDragState,
  currentWorld: Vec2,
  constrained: boolean,
  snappingDisabled: boolean,
): RotateGesture => {
  const currentAngle = Math.atan2(
    currentWorld.y - drag.centerWorld.y,
    currentWorld.x - drag.centerWorld.x,
  );
  const rawAngle = currentAngle - drag.startAngle;
  const angle = constrained
    ? Math.round(rawAngle / SNAP_ROTATION_RADIANS) * SNAP_ROTATION_RADIANS
    : snappingDisabled
      ? rawAngle
      : snapRotation(rawAngle, { threshold: ROTATION_SNAP_THRESHOLD_RADIANS });

  return {
    matrix: composeAboutPoint(drag.centerWorld, rotation(angle)),
    guides: emptySnapGuides(),
    angleRad: angle,
  };
};

const applyTransformGesture = (
  drag: ScaleDragState | RotateDragState,
  currentWorld: Vec2,
  constrained: boolean,
  gestureMatrixOverride: Matrix | null = null,
): boolean => {
  const gestureMatrix = gestureMatrixOverride ?? (drag.mode === "scale"
    ? scaleGestureMatrix(drag, currentWorld, constrained)
    : rotateGestureMatrix(drag, currentWorld, constrained, true).matrix);
  let changed = false;

  editorStore.setState(
    produce((state: EditorStore) => {
      for (const id of drag.selectedIds) {
        const node = state.doc.nodes[id];
        const originalTransform = drag.originalTransforms[id];
        if (!node || node.locked || !node.visible || originalTransform === undefined) {
          continue;
        }

        const parentWorld = parentWorldTransform(drag.originalDoc, id);
        const invertedParentWorld = invert(parentWorld);
        const worldGestureTransform = compose(
          gestureMatrix,
          compose(parentWorld, originalTransform),
        );
        const nextTransform = invertedParentWorld === null
          ? compose(gestureMatrix, originalTransform)
          : compose(invertedParentWorld, worldGestureTransform);
        if (matrixNearlyEqual(node.transform, nextTransform)) {
          continue;
        }

        node.transform = nextTransform;
        changed = true;
      }
    }),
  );

  return changed;
};

const applyMoveGesture = (drag: MoveDragState, dx: number, dy: number): boolean => {
  let changed = false;

  editorStore.setState(
    produce((state: EditorStore) => {
      for (const id of drag.selectedIds) {
        const node = state.doc.nodes[id];
        const originalTransform = drag.originalTransforms[id];
        if (!node || node.locked || !node.visible || originalTransform === undefined) {
          continue;
        }

        const parentWorld = parentWorldTransform(drag.originalDoc, id);
        const invertedParentWorld = invert(parentWorld);
        const localDelta = invertedParentWorld === null
          ? { x: dx, y: dy }
          : applyVector(invertedParentWorld, { x: dx, y: dy });
        const nextTransform = {
          ...originalTransform,
          e: originalTransform.e + localDelta.x,
          f: originalTransform.f + localDelta.y,
        };
        if (matrixNearlyEqual(node.transform, nextTransform)) {
          continue;
        }

        node.transform = nextTransform;
        changed = true;
      }
    }),
  );

  return changed;
};

const commitTransformGesture = (drag: TransformDragBase): void => {
  editorStore.setState((state) => ({
    history: pushHistory(state.history, drag.originalDoc),
  }));
};

const applyNodeEditGesture = (
  drag: NodeAnchorDragState | NodeHandleDragState,
  currentScreen: Vec2,
  viewport: EditorViewport,
  freeHandle: boolean,
  snapSettings: SnapSettings,
  overrideSnappingDisabled: boolean,
): NodeEditGestureResult => {
  const originalNode = drag.originalDoc.nodes[drag.nodeId];
  if (!originalNode || originalNode.type !== "path") {
    return { changed: false, guides: emptySnapGuides() };
  }

  const originalSubpath = originalNode.subpaths[drag.target.subpathIndex];
  if (originalSubpath === undefined) {
    return { changed: false, guides: emptySnapGuides() };
  }

  const anchorGesture = drag.mode === "node-anchor"
    ? computeNodeAnchorGesture(drag, currentScreen, viewport, snapSettings, overrideSnappingDisabled)
    : null;
  if (drag.mode === "node-anchor" && anchorGesture === null) {
    return { changed: false, guides: emptySnapGuides() };
  }

  const localDelta = anchorGesture?.localDelta ?? screenDeltaToNodeLocal(drag, currentScreen, viewport);
  const nextSubpath =
    drag.mode === "node-anchor"
      ? moveAnchor(originalSubpath, drag.target.anchorIndex, localDelta)
      : moveHandle(
          originalSubpath,
          drag.target.anchorIndex,
          drag.side,
          { x: drag.originalOffset.x + localDelta.x, y: drag.originalOffset.y + localDelta.y },
          freeHandle ? "free" : "mirror",
        );
  const nextSubpaths = clonePathSubpaths(originalNode.subpaths);
  nextSubpaths[drag.target.subpathIndex] = nextSubpath;
  let changed = false;

  editorStore.setState(
    produce((state: EditorStore) => {
      const node = state.doc.nodes[drag.nodeId];
      if (!node || node.type !== "path" || node.locked || !node.visible) {
        return;
      }

      if (pathSubpathsNearlyEqual(node.subpaths, nextSubpaths)) {
        return;
      }

      node.subpaths = nextSubpaths;
      changed = true;
    }),
  );

  return { changed, guides: anchorGesture?.guides ?? emptySnapGuides() };
};

const nodeEditChangedFromOriginal = (drag: NodeAnchorDragState | NodeHandleDragState): boolean => {
  const originalNode = drag.originalDoc.nodes[drag.nodeId];
  const currentNode = editorStore.getState().doc.nodes[drag.nodeId];
  return Boolean(
    originalNode &&
      originalNode.type === "path" &&
      currentNode &&
      currentNode.type === "path" &&
      !pathSubpathsNearlyEqual(originalNode.subpaths, currentNode.subpaths),
  );
};

const commitNodeEditGesture = (drag: NodeAnchorDragState | NodeHandleDragState): void => {
  editorStore.setState((state) => ({
    history: pushHistory(state.history, drag.originalDoc),
  }));
};

const insertNodeEditAnchor = (
  nodeId: NodeId,
  target: SelectedPathAnchor,
  t: number,
): SelectedPathAnchor | null => {
  const state = editorStore.getState();
  const node = state.doc.nodes[nodeId];
  if (!node || node.type !== "path" || node.locked || !node.visible) {
    return null;
  }

  const subpath = node.subpaths[target.subpathIndex];
  if (subpath === undefined) {
    return null;
  }

  const originalDoc = structuredClone(state.doc) as Document;
  const nextSubpath = insertAnchor(subpath, target.anchorIndex, t);
  const nextSelection: SelectedPathAnchor = {
    subpathIndex: target.subpathIndex,
    anchorIndex: target.anchorIndex + 1,
  };
  let changed = false;

  editorStore.setState(
    produce((store: EditorStore) => {
      const path = store.doc.nodes[nodeId];
      if (!path || path.type !== "path" || path.locked || !path.visible) {
        return;
      }

      const nextSubpaths = clonePathSubpaths(path.subpaths);
      nextSubpaths[target.subpathIndex] = nextSubpath;
      if (pathSubpathsNearlyEqual(path.subpaths, nextSubpaths)) {
        return;
      }

      path.subpaths = nextSubpaths;
      store.history = pushHistory(store.history, originalDoc);
      changed = true;
    }),
  );

  return changed ? nextSelection : null;
};

const toggleNodeEditAnchorType = (nodeId: NodeId, target: SelectedPathAnchor): boolean => {
  const state = editorStore.getState();
  const node = state.doc.nodes[nodeId];
  if (!node || node.type !== "path" || node.locked || !node.visible) {
    return false;
  }

  const subpath = node.subpaths[target.subpathIndex];
  const anchor = subpath?.anchors[target.anchorIndex];
  if (subpath === undefined || anchor === undefined) {
    return false;
  }

  const originalDoc = structuredClone(state.doc) as Document;
  const nextType = anchor.handleIn !== null || anchor.handleOut !== null ? "corner" : "smooth";
  const nextSubpath = setAnchorType(subpath, target.anchorIndex, nextType);
  let changed = false;

  editorStore.setState(
    produce((store: EditorStore) => {
      const path = store.doc.nodes[nodeId];
      if (!path || path.type !== "path" || path.locked || !path.visible) {
        return;
      }

      const nextSubpaths = clonePathSubpaths(path.subpaths);
      nextSubpaths[target.subpathIndex] = nextSubpath;
      if (pathSubpathsNearlyEqual(path.subpaths, nextSubpaths)) {
        return;
      }

      path.subpaths = nextSubpaths;
      store.history = pushHistory(store.history, originalDoc);
      changed = true;
    }),
  );

  return changed;
};

const deleteNodeEditAnchor = (
  nodeId: NodeId,
  target: SelectedPathAnchor,
): { removedNode: boolean; selectedAnchor: SelectedPathAnchor | null } => {
  const state = editorStore.getState();
  const node = state.doc.nodes[nodeId];
  if (!node || node.type !== "path" || node.locked || !node.visible) {
    return { removedNode: false, selectedAnchor: null };
  }

  const subpath = node.subpaths[target.subpathIndex];
  if (subpath === undefined || target.anchorIndex < 0 || target.anchorIndex >= subpath.anchors.length) {
    return { removedNode: false, selectedAnchor: null };
  }

  if (subpath.anchors.length <= 2) {
    state.removeNodes([nodeId]);
    return { removedNode: true, selectedAnchor: null };
  }

  const originalDoc = structuredClone(state.doc) as Document;
  const nextSubpath = deleteAnchor(subpath, target.anchorIndex);
  const nextSelection: SelectedPathAnchor = {
    subpathIndex: target.subpathIndex,
    anchorIndex: Math.min(target.anchorIndex, nextSubpath.anchors.length - 1),
  };
  let changed = false;

  editorStore.setState(
    produce((store: EditorStore) => {
      const path = store.doc.nodes[nodeId];
      if (!path || path.type !== "path" || path.locked || !path.visible) {
        return;
      }

      const nextSubpaths = clonePathSubpaths(path.subpaths);
      nextSubpaths[target.subpathIndex] = nextSubpath;
      if (pathSubpathsNearlyEqual(path.subpaths, nextSubpaths)) {
        return;
      }

      path.subpaths = nextSubpaths;
      store.history = pushHistory(store.history, originalDoc);
      changed = true;
    }),
  );

  return { removedNode: false, selectedAnchor: changed ? nextSelection : null };
};

const drawNodeEditOverlay = (
  ctx: CanvasRenderingContext2D,
  doc: Document,
  selection: readonly NodeId[],
  viewport: EditorViewport,
  dpr: number,
  selectedAnchor: SelectedPathAnchor | null,
): void => {
  const editable = getEditablePathNode(doc, selection);
  if (editable === null) {
    return;
  }

  const halfAnchor = NODE_ANCHOR_SIZE / 2;

  ctx.save();
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.lineWidth = 1;
  ctx.setLineDash([]);

  if (isValidSelectedAnchor(editable.node, selectedAnchor)) {
    const subpath = editable.node.subpaths[selectedAnchor.subpathIndex]!;
    const anchor = subpath.anchors[selectedAnchor.anchorIndex]!;
    const anchorPoint = worldToScreen(apply(editable.worldTransform, anchor.point), viewport);
    const handleEntries: Array<{ side: HandleSide; offset: Vec2 }> = [];
    if (anchor.handleIn !== null) {
      handleEntries.push({ side: "in", offset: anchor.handleIn });
    }
    if (anchor.handleOut !== null) {
      handleEntries.push({ side: "out", offset: anchor.handleOut });
    }

    ctx.strokeStyle = "#f59e0b";
    ctx.fillStyle = "#ffffff";
    for (const handle of handleEntries) {
      const handlePoint = worldToScreen(apply(editable.worldTransform, addVec2(anchor.point, handle.offset)), viewport);
      ctx.beginPath();
      ctx.moveTo(anchorPoint.x, anchorPoint.y);
      ctx.lineTo(handlePoint.x, handlePoint.y);
      ctx.stroke();

      ctx.beginPath();
      ctx.arc(handlePoint.x, handlePoint.y, NODE_HANDLE_RADIUS, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();
    }
  }

  ctx.strokeStyle = "#2d8cf0";
  for (const [subpathIndex, subpath] of editable.node.subpaths.entries()) {
    for (const [anchorIndex, anchor] of subpath.anchors.entries()) {
      const point = worldToScreen(apply(editable.worldTransform, anchor.point), viewport);
      const isSelected =
        selectedAnchor !== null &&
        selectedAnchor.subpathIndex === subpathIndex &&
        selectedAnchor.anchorIndex === anchorIndex;
      ctx.fillStyle = isSelected ? "#2d8cf0" : "#ffffff";
      ctx.fillRect(point.x - halfAnchor, point.y - halfAnchor, NODE_ANCHOR_SIZE, NODE_ANCHOR_SIZE);
      ctx.strokeRect(
        point.x - halfAnchor + 0.5,
        point.y - halfAnchor + 0.5,
        NODE_ANCHOR_SIZE,
        NODE_ANCHOR_SIZE,
      );
    }
  }

  ctx.restore();
};

const drawShapePreview = (
  ctx: CanvasRenderingContext2D,
  drag: DragState | null,
  viewport: EditorViewport,
  dpr: number,
): void => {
  if (drag === null || (drag.mode !== "create-rect" && drag.mode !== "create-ellipse")) {
    return;
  }

  const currentWorld = screenToWorld(drag.lastScreen, viewport);
  const topLeft = worldToScreen(
    {
      x: Math.min(drag.startWorld.x, currentWorld.x),
      y: Math.min(drag.startWorld.y, currentWorld.y),
    },
    viewport,
  );
  const bottomRight = worldToScreen(
    {
      x: Math.max(drag.startWorld.x, currentWorld.x),
      y: Math.max(drag.startWorld.y, currentWorld.y),
    },
    viewport,
  );
  const width = bottomRight.x - topLeft.x;
  const height = bottomRight.y - topLeft.y;

  ctx.save();
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.strokeStyle = "#2d8cf0";
  ctx.fillStyle = "rgba(45, 140, 240, 0.1)";
  ctx.lineWidth = 1;
  ctx.setLineDash([6, 4]);
  ctx.beginPath();
  if (drag.mode === "create-ellipse") {
    ctx.ellipse(
      topLeft.x + width / 2,
      topLeft.y + height / 2,
      Math.abs(width / 2),
      Math.abs(height / 2),
      0,
      0,
      Math.PI * 2,
    );
  } else {
    ctx.rect(topLeft.x, topLeft.y, width, height);
  }
  ctx.fill();
  ctx.stroke();
  ctx.restore();
};

const drawMarqueePreview = (
  ctx: CanvasRenderingContext2D,
  drag: DragState | null,
  dpr: number,
): void => {
  if (drag === null || drag.mode !== "marquee" || !drag.moved) {
    return;
  }

  const x = Math.min(drag.startScreen.x, drag.lastScreen.x);
  const y = Math.min(drag.startScreen.y, drag.lastScreen.y);
  const width = Math.abs(drag.lastScreen.x - drag.startScreen.x);
  const height = Math.abs(drag.lastScreen.y - drag.startScreen.y);

  ctx.save();
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.strokeStyle = "#2d8cf0";
  ctx.fillStyle = "rgba(45, 140, 240, 0.1)";
  ctx.lineWidth = 1;
  ctx.setLineDash([6, 4]);
  ctx.fillRect(x, y, width, height);
  ctx.strokeRect(x + 0.5, y + 0.5, width, height);
  ctx.restore();
};

const drawSnapGuides = (
  ctx: CanvasRenderingContext2D,
  guides: SnapGuides,
  viewport: EditorViewport,
  dpr: number,
): void => {
  if (guides.alignmentGuidesX.length === 0 && guides.alignmentGuidesY.length === 0) {
    return;
  }

  ctx.save();
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.strokeStyle = "#ff2d8f";
  ctx.lineWidth = 1;
  ctx.setLineDash([]);

  for (const guide of guides.alignmentGuidesX) {
    const start = worldToScreen({ x: guide.position, y: guide.spanMin }, viewport);
    const end = worldToScreen({ x: guide.position, y: guide.spanMax }, viewport);
    ctx.beginPath();
    ctx.moveTo(start.x + 0.5, start.y);
    ctx.lineTo(end.x + 0.5, end.y);
    ctx.stroke();
  }

  for (const guide of guides.alignmentGuidesY) {
    const start = worldToScreen({ x: guide.spanMin, y: guide.position }, viewport);
    const end = worldToScreen({ x: guide.spanMax, y: guide.position }, viewport);
    ctx.beginPath();
    ctx.moveTo(start.x, start.y + 0.5);
    ctx.lineTo(end.x, end.y + 0.5);
    ctx.stroke();
  }

  ctx.restore();
};

const drawPenPreview = (
  ctx: CanvasRenderingContext2D,
  draft: PenDraft,
  viewport: EditorViewport,
  dpr: number,
  activeAnchorIndex: number | null,
): void => {
  if (draft.anchors.length === 0) {
    return;
  }

  const anchors = draft.anchors;
  const points = anchors.map((anchor) => worldToScreen(anchor.point, viewport));
  const cursorPoint = draft.cursorWorld === null ? null : worldToScreen(draft.cursorWorld, viewport);
  const halfDot = PEN_ANCHOR_SIZE / 2;

  ctx.save();
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.strokeStyle = "#2d8cf0";
  ctx.fillStyle = "#ffffff";
  ctx.lineWidth = 1.25;
  ctx.setLineDash([]);

  if (points.length > 1 || cursorPoint !== null) {
    ctx.beginPath();
    ctx.moveTo(points[0].x, points[0].y);
    for (let index = 0; index < anchors.length - 1; index += 1) {
      const current = anchors[index];
      const next = anchors[index + 1];
      if (current === undefined || next === undefined) {
        continue;
      }

      const cp1 = worldToScreen(addVec2(current.point, current.handleOut), viewport);
      const cp2 = worldToScreen(addVec2(next.point, next.handleIn), viewport);
      const end = points[index + 1];
      if (end === undefined) {
        continue;
      }
      ctx.bezierCurveTo(cp1.x, cp1.y, cp2.x, cp2.y, end.x, end.y);
    }
    if (cursorPoint !== null) {
      const lastAnchor = anchors[anchors.length - 1];
      if (lastAnchor !== undefined) {
        const cp1 = worldToScreen(addVec2(lastAnchor.point, lastAnchor.handleOut), viewport);
        ctx.bezierCurveTo(cp1.x, cp1.y, cursorPoint.x, cursorPoint.y, cursorPoint.x, cursorPoint.y);
      }
    }
    ctx.stroke();
  }

  ctx.strokeStyle = "#f59e0b";
  ctx.fillStyle = "#ffffff";
  ctx.lineWidth = 1;
  for (const [index, anchor] of anchors.entries()) {
    if (activeAnchorIndex !== null && index !== activeAnchorIndex) {
      continue;
    }

    const anchorPoint = points[index];
    if (anchorPoint === undefined) {
      continue;
    }

    const handlePoints = [anchor.handleIn, anchor.handleOut]
      .filter((handle): handle is Vec2 => handle !== null)
      .map((handle) => worldToScreen({ x: anchor.point.x + handle.x, y: anchor.point.y + handle.y }, viewport));

    for (const handlePoint of handlePoints) {
      ctx.beginPath();
      ctx.moveTo(anchorPoint.x, anchorPoint.y);
      ctx.lineTo(handlePoint.x, handlePoint.y);
      ctx.stroke();

      ctx.beginPath();
      ctx.arc(handlePoint.x, handlePoint.y, 3, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();
    }
  }

  ctx.strokeStyle = "#2d8cf0";
  ctx.fillStyle = "#ffffff";
  for (const point of points) {
    ctx.fillRect(point.x - halfDot, point.y - halfDot, PEN_ANCHOR_SIZE, PEN_ANCHOR_SIZE);
    ctx.strokeRect(
      point.x - halfDot + 0.5,
      point.y - halfDot + 0.5,
      PEN_ANCHOR_SIZE,
      PEN_ANCHOR_SIZE,
    );
  }

  ctx.restore();
};

const createEmptyPenDraft = (): PenDraft => ({
  anchors: [],
  cursorWorld: null,
});

export default function CanvasView() {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const textAreaRef = useRef<HTMLTextAreaElement | null>(null);
  const dragRef = useRef<DragState | null>(null);
  const measureOverlayRef = useRef<MeasureOverlay | null>(null);
  const snapGuidesRef = useRef<SnapGuides>(emptySnapGuides());
  const rotationReadoutRef = useRef<RotationReadout | null>(null);
  const spaceHeldRef = useRef(false);
  const frameRef = useRef<number | null>(null);
  const inlineTextEditRef = useRef<InlineTextEdit | null>(null);
  const [penDraft, setPenDraftState] = useState<PenDraft>(createEmptyPenDraft);
  const penDraftRef = useRef<PenDraft>(penDraft);
  const [selectedPathAnchor, setSelectedPathAnchorState] = useState<SelectedPathAnchor | null>(null);
  const selectedPathAnchorRef = useRef<SelectedPathAnchor | null>(selectedPathAnchor);
  const [inlineTextEdit, setInlineTextEditState] = useState<InlineTextEdit | null>(null);
  const [activeGuideId, setActiveGuideId] = useState<NodeId | null>(null);
  const [size, setSize] = useState<Size>({ width: 0, height: 0 });
  const activeTool = useEditorStore((state) => state.activeTool);
  const doc = useEditorStore((state) => state.doc);
  const selection = useEditorStore((state) => state.selection);
  const viewport = useEditorStore((state) => state.viewport);
  const previousToolRef = useRef(activeTool);

  useEffect(() => {
    if (activeGuideId !== null && !doc.guides.some((guide) => guide.id === activeGuideId)) {
      setActiveGuideId(null);
    }
  }, [activeGuideId, doc.guides]);

  const setInlineTextEdit = (edit: InlineTextEdit | null): void => {
    inlineTextEditRef.current = edit;
    setInlineTextEditState(edit);
  };

  const beginInlineTextEdit = (node: TextNode, createdEmpty: boolean): void => {
    setInlineTextEdit({
      id: node.id,
      value: node.text,
      createdEmpty,
    });
  };

  const finishInlineTextEdit = (mode: "commit" | "cancel"): void => {
    const edit = inlineTextEditRef.current;
    if (edit === null) {
      return;
    }

    inlineTextEditRef.current = null;
    setInlineTextEditState(null);

    const state = editorStore.getState();
    if (mode === "commit") {
      const patch: Partial<TextNode> = { text: edit.value };
      state.updateNode(edit.id, patch);
    } else if (edit.createdEmpty) {
      state.removeNodes([edit.id]);
    }

    canvasRef.current?.focus();
  };

  useEffect(() => {
    const container = containerRef.current;
    if (container === null) {
      return;
    }

    const updateSize = (): void => {
      const rect = container.getBoundingClientRect();
      setSize({
        width: Math.max(0, Math.round(rect.width)),
        height: Math.max(0, Math.round(rect.height)),
      });
    };

    updateSize();
    const observer = new ResizeObserver(updateSize);
    observer.observe(container);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (canvas === null) {
      return;
    }

    const dpr = getDpr();
    canvas.width = Math.max(1, Math.round(size.width * dpr));
    canvas.height = Math.max(1, Math.round(size.height * dpr));
    canvas.style.width = `${size.width}px`;
    canvas.style.height = `${size.height}px`;
  }, [size]);

  useEffect(() => {
    const scheduleDraw = (): void => {
      if (frameRef.current !== null) {
        return;
      }

      frameRef.current = window.requestAnimationFrame(() => {
        frameRef.current = null;
        const canvas = canvasRef.current;
        if (canvas === null) {
          return;
        }

        const ctx = canvas.getContext("2d");
        if (ctx === null) {
          return;
        }

        const dpr = getDpr();
        const { doc, selection, viewport, snapSettings, showGrid } = editorStore.getState();
        const renderViewport: EditorViewport = {
          zoom: viewport.zoom * dpr,
          pan: {
            x: viewport.pan.x * dpr,
            y: viewport.pan.y * dpr,
          },
        };
        ctx.setTransform(1, 0, 0, 1, 0, 0);
        renderDocument(ctx, doc, renderViewport);
        if (showGrid) {
          drawGridOverlay(ctx, viewport, size, dpr, snapSettings.gridSize);
        }
        const activeTool = editorStore.getState().activeTool;
        drawDocumentGuides(ctx, doc.guides, viewport, size, dpr);
        if (activeTool !== "node") {
          drawSelectionOverlay(ctx, doc, selection, viewport, dpr, activeTool === "select");
        }
        if (activeTool === "node") {
          drawNodeEditOverlay(ctx, doc, selection, viewport, dpr, selectedPathAnchorRef.current);
        }
        drawSnapGuides(ctx, snapGuidesRef.current, viewport, dpr);
        drawRotationReadout(ctx, rotationReadoutRef.current, size, dpr);
        drawMeasureOverlay(ctx, measureOverlayRef.current, viewport, size, dpr);
        drawShapePreview(ctx, dragRef.current, viewport, dpr);
        drawMarqueePreview(ctx, dragRef.current, dpr);
        drawPenPreview(
          ctx,
          penDraftRef.current,
          viewport,
          dpr,
          dragRef.current?.mode === "pen-anchor" ? dragRef.current.anchorIndex : null,
        );
      });
    };

    scheduleDraw();
    const unsubscribe = editorStore.subscribe(scheduleDraw);
    return () => {
      unsubscribe();
      if (frameRef.current !== null) {
        window.cancelAnimationFrame(frameRef.current);
        frameRef.current = null;
      }
    };
  }, [size]);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.code === "Space" && !event.repeat) {
        spaceHeldRef.current = true;
      }
    };
    const onKeyUp = (event: KeyboardEvent): void => {
      if (event.code === "Space") {
        spaceHeldRef.current = false;
      }
    };

    window.addEventListener("keydown", onKeyDown);
    window.addEventListener("keyup", onKeyUp);
    return () => {
      window.removeEventListener("keydown", onKeyDown);
      window.removeEventListener("keyup", onKeyUp);
    };
  }, []);

  const commitShape = (tool: "rect" | "ellipse", start: Vec2, current: Vec2): void => {
    const shape = createShapeFromDrag(tool, start, current);
    if (shape === null) {
      return;
    }

    const state = editorStore.getState();
    state.addNode(shape);
    state.setSelection([shape.id]);
    state.setActiveTool("select");
  };

  const scheduleInteractiveDraw = (): void => {
    const state = editorStore.getState();
    state.setPan({ ...state.viewport.pan });
  };

  const setMeasureOverlay = (overlay: MeasureOverlay | null): void => {
    measureOverlayRef.current = overlay;
    scheduleInteractiveDraw();
  };

  const cancelMeasureDrag = (): void => {
    const activeDrag = dragRef.current;
    if (activeDrag?.mode === "measure") {
      const canvas = canvasRef.current;
      if (canvas !== null && canvas.hasPointerCapture(activeDrag.pointerId)) {
        canvas.releasePointerCapture(activeDrag.pointerId);
      }
      dragRef.current = null;
    }
    setMeasureOverlay(null);
  };

  const setSelectedPathAnchor = useCallback((anchor: SelectedPathAnchor | null): void => {
    if (selectedAnchorsEqual(selectedPathAnchorRef.current, anchor)) {
      return;
    }

    selectedPathAnchorRef.current = anchor;
    setSelectedPathAnchorState(anchor);
    scheduleInteractiveDraw();
  }, []);

  const setPenDraft = useCallback((draft: PenDraft | ((current: PenDraft) => PenDraft)): void => {
    const next = typeof draft === "function" ? draft(penDraftRef.current) : draft;
    penDraftRef.current = next;
    setPenDraftState(next);
  }, []);

  const finalizePenPath = useCallback((closed: boolean): void => {
    const draft = penDraftRef.current;
    if (draft.anchors.length >= 2) {
      const path = createPath([{ anchors: draft.anchors, closed }]);
      const state = editorStore.getState();
      state.addNode(path);
      state.setSelection([path.id]);
    }

    setPenDraft(createEmptyPenDraft());
    scheduleInteractiveDraw();
  }, [setPenDraft]);

  useEffect(() => {
    if (previousToolRef.current === "pen" && activeTool !== "pen") {
      finalizePenPath(false);
    }
    if (previousToolRef.current === "measure" && activeTool !== "measure") {
      cancelMeasureDrag();
    }
    previousToolRef.current = activeTool;
  }, [activeTool, finalizePenPath]);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key !== "Escape" || editorStore.getState().activeTool !== "measure") {
        return;
      }

      event.preventDefault();
      cancelMeasureDrag();
    };

    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, []);

  useEffect(() => {
    if (activeTool !== "node") {
      setSelectedPathAnchor(null);
      return;
    }

    const editable = getEditablePathNode(doc, selection);
    if (editable === null || !isValidSelectedAnchor(editable.node, selectedPathAnchor)) {
      setSelectedPathAnchor(null);
    }
  }, [activeTool, doc, selection, selectedPathAnchor, setSelectedPathAnchor]);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent): void => {
      if (editorStore.getState().activeTool !== "pen") {
        return;
      }

      if (event.key === "Enter") {
        event.preventDefault();
        finalizePenPath(true);
      } else if (event.key === "Escape") {
        event.preventDefault();
        finalizePenPath(false);
      }
    };

    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [finalizePenPath]);

  useEffect(() => {
    if (inlineTextEdit === null) {
      return;
    }

    const frame = window.requestAnimationFrame(() => {
      const textArea = textAreaRef.current;
      if (textArea === null) {
        return;
      }

      textArea.focus();
      textArea.setSelectionRange(textArea.value.length, textArea.value.length);
    });

    return () => window.cancelAnimationFrame(frame);
  }, [inlineTextEdit?.id]);

  const onPointerDown = (event: ReactPointerEvent<HTMLCanvasElement>): void => {
    const canvas = canvasRef.current;
    if (canvas === null) {
      return;
    }

    canvas.focus();
    const state = editorStore.getState();
    const point = eventPoint(event, canvas);
    const worldPoint = screenToWorld(point, state.viewport);
    const panMode = state.activeTool === "hand" || spaceHeldRef.current;

    if (panMode) {
      event.preventDefault();
      canvas.setPointerCapture(event.pointerId);
      dragRef.current = {
        mode: "pan",
        pointerId: event.pointerId,
        startScreen: point,
        lastScreen: point,
        startWorld: worldPoint,
        additive: false,
        moved: false,
      };
      return;
    }

    if (state.activeTool === "eyedropper") {
      event.preventDefault();
      if (state.selection.length === 0) {
        return;
      }

      const sampledStyle = sampleStyleAt(state.doc, worldPoint, { tolerance: 3 / state.viewport.zoom });
      if (sampledStyle === null) {
        return;
      }

      applySampledStyleToSelection(state.selection, sampledStyle);
      return;
    }

    if (state.activeTool === "measure") {
      event.preventDefault();
      canvas.setPointerCapture(event.pointerId);
      dragRef.current = {
        mode: "measure",
        pointerId: event.pointerId,
        startScreen: point,
        lastScreen: point,
        startWorld: worldPoint,
        additive: false,
        moved: false,
      };
      setMeasureOverlay({
        startWorld: worldPoint,
        endWorld: worldPoint,
      });
      return;
    }

    if (state.activeTool === "select") {
      const guideHit = hitGuide(state.doc, state.viewport, point);
      if (guideHit !== null) {
        event.preventDefault();
        setActiveGuideId(guideHit.id);
        if (guideHit.locked === true) {
          scheduleInteractiveDraw();
          return;
        }

        canvas.setPointerCapture(event.pointerId);
        dragRef.current = {
          mode: "guide",
          pointerId: event.pointerId,
          startScreen: point,
          lastScreen: point,
          startWorld: worldPoint,
          additive: false,
          moved: false,
          changed: false,
          guideId: guideHit.id,
          axis: guideHit.axis,
          originalDoc: structuredClone(state.doc) as Document,
          originalHistory: state.history,
        };
        return;
      }
    }

    if (state.activeTool === "rect" || state.activeTool === "ellipse") {
      event.preventDefault();
      canvas.setPointerCapture(event.pointerId);
      dragRef.current = {
        mode: state.activeTool === "rect" ? "create-rect" : "create-ellipse",
        pointerId: event.pointerId,
        startScreen: point,
        lastScreen: point,
        startWorld: worldPoint,
        additive: false,
        moved: false,
      };
      scheduleInteractiveDraw();
      return;
    }

    if (state.activeTool === "pen") {
      event.preventDefault();
      const firstAnchor = penDraftRef.current.anchors[0];
      if (
        firstAnchor !== undefined &&
        penDraftRef.current.anchors.length >= 2 &&
        distance(point, worldToScreen(firstAnchor.point, state.viewport)) <= PEN_CLOSE_THRESHOLD
      ) {
        finalizePenPath(true);
        return;
      }

      if (event.detail >= 2) {
        finalizePenPath(false);
        return;
      }

      const hit = hitTest(state.doc, worldPoint, { tolerance: 3 / state.viewport.zoom });
      if (hit !== null) {
        return;
      }

      const anchorIndex = penDraftRef.current.anchors.length;
      canvas.setPointerCapture(event.pointerId);
      setPenDraft((current) => ({
        anchors: [...current.anchors, corner(worldPoint)],
        cursorWorld: worldPoint,
      }));
      dragRef.current = {
        mode: "pen-anchor",
        pointerId: event.pointerId,
        startScreen: point,
        lastScreen: point,
        startWorld: worldPoint,
        additive: false,
        moved: false,
        anchorIndex,
        anchorWorld: worldPoint,
      };
      scheduleInteractiveDraw();
      return;
    }

    if (state.activeTool === "text") {
      event.preventDefault();
      const hit = hitTest(state.doc, worldPoint, { tolerance: 3 / state.viewport.zoom });
      if (hit !== null) {
        return;
      }

      const textNode = createText("", worldPoint);
      state.addNode(textNode);
      state.setSelection([textNode.id]);
      beginInlineTextEdit(textNode, true);
      return;
    }

    if (state.activeTool === "node") {
      event.preventDefault();
      const editable = getEditablePathNode(state.doc, state.selection);
      if (editable !== null) {
        const editHit = hitNodeEditOverlay(
          editable.node,
          editable.worldTransform,
          state.viewport,
          point,
          selectedPathAnchorRef.current,
        );

        if (editHit?.type === "handle") {
          setSelectedPathAnchor(editHit.target);
          canvas.setPointerCapture(event.pointerId);
          dragRef.current = {
            mode: "node-handle",
            pointerId: event.pointerId,
            startScreen: point,
            lastScreen: point,
            startWorld: worldPoint,
            additive: false,
            moved: false,
            changed: false,
            nodeId: editable.id,
            target: editHit.target,
            originalDoc: structuredClone(state.doc) as Document,
            nodeWorldTransform: editable.worldTransform,
            side: editHit.side,
            originalOffset: editHit.offset,
          };
          scheduleInteractiveDraw();
          return;
        }

        if (editHit?.type === "anchor") {
          setSelectedPathAnchor(editHit.target);
          if (event.altKey) {
            toggleNodeEditAnchorType(editable.id, editHit.target);
            return;
          }

          if (event.detail >= 2) {
            return;
          }

          canvas.setPointerCapture(event.pointerId);
          dragRef.current = {
            mode: "node-anchor",
            pointerId: event.pointerId,
            startScreen: point,
            lastScreen: point,
            startWorld: worldPoint,
            additive: false,
            moved: false,
            changed: false,
            nodeId: editable.id,
            target: editHit.target,
            originalDoc: structuredClone(state.doc) as Document,
            nodeWorldTransform: editable.worldTransform,
            anchorSnapCandidateBounds: collectAnchorSnapCandidateBounds(state.doc, editable.id, editHit.target),
          };
          scheduleInteractiveDraw();
          return;
        }

        if (editHit?.type === "segment") {
          const insertedAnchor = insertNodeEditAnchor(editable.id, editHit.target, editHit.t);
          setSelectedPathAnchor(insertedAnchor);
          return;
        }
      }

      const hit = hitTest(state.doc, worldPoint, { tolerance: 3 / state.viewport.zoom });
      if (hit === null) {
        state.clearSelection();
        setSelectedPathAnchor(null);
        return;
      }

      const hitNode = state.doc.nodes[hit];
      if (hitNode?.type === "path") {
        state.setSelection([hit]);
        setSelectedPathAnchor(null);
      } else if (editable !== null && hit === editable.id) {
        setSelectedPathAnchor(null);
      }
      return;
    }

    if (state.activeTool !== "select") {
      return;
    }

    event.preventDefault();
    const handleHit = hitSelectionHandle(state.doc, state.selection, state.viewport, point);
    if (handleHit !== null) {
      const selectedIds = transformableSelection(state.doc, state.selection);
      const geometry = getSelectionOverlayGeometry(state.doc, state.selection, state.viewport);
      if (selectedIds.length === 0 || geometry === null) {
        return;
      }

      const originalDoc = structuredClone(state.doc) as Document;
      const originalTransforms = captureOriginalTransforms(state.doc, selectedIds);
      canvas.setPointerCapture(event.pointerId);

      if (handleHit.type === "scale") {
        rotationReadoutRef.current = null;
        const anchorId = OPPOSITE_RESIZE_HANDLES[handleHit.handleId];
        dragRef.current = {
          mode: "scale",
          pointerId: event.pointerId,
          startScreen: point,
          lastScreen: point,
          startWorld: worldPoint,
          additive: false,
          moved: false,
          changed: false,
          originalDoc,
          originalTransforms,
          selectedIds,
          anchorWorld: getResizeHandlePoint(geometry.bounds, anchorId),
          initialBounds: geometry.bounds,
          candidateBounds: collectSnapCandidateBounds(state.doc, state.selection),
          handleId: handleHit.handleId,
          // Use the actual pointer-down world position as the scale reference so
          // the gesture starts at scale=1 wherever the user grabbed (within the
          // handle hit radius) instead of snapping to the idealized handle point.
          handleStartWorld: worldPoint,
        };
      } else {
        const centerWorld = bboxCenter(geometry.bounds);
        dragRef.current = {
          mode: "rotate",
          pointerId: event.pointerId,
          startScreen: point,
          lastScreen: point,
          startWorld: worldPoint,
          additive: false,
          moved: false,
          changed: false,
          originalDoc,
          originalTransforms,
          selectedIds,
          centerWorld,
          startAngle: Math.atan2(worldPoint.y - centerWorld.y, worldPoint.x - centerWorld.x),
        };
        rotationReadoutRef.current = {
          angleRad: 0,
          screenPoint: point,
        };
      }

      scheduleInteractiveDraw();
      return;
    }

    const hit = hitTest(state.doc, worldPoint, { tolerance: 3 / state.viewport.zoom });
    if (hit === null) {
      canvas.setPointerCapture(event.pointerId);
      dragRef.current = {
        mode: "marquee",
        pointerId: event.pointerId,
        startScreen: point,
        lastScreen: point,
        startWorld: worldPoint,
        additive: event.shiftKey,
        moved: false,
      };
      scheduleInteractiveDraw();
      return;
    }

    const additive = event.shiftKey;
    if (additive) {
      state.addToSelection(hit);
    } else if (!state.selection.includes(hit)) {
      state.setSelection([hit]);
    }

    const moveState = editorStore.getState();
    const selectedIds = transformableSelection(moveState.doc, moveState.selection);
    if (selectedIds.length === 0) {
      return;
    }

    canvas.setPointerCapture(event.pointerId);
    dragRef.current = {
      mode: "move",
      pointerId: event.pointerId,
      startScreen: point,
      lastScreen: point,
      startWorld: worldPoint,
      additive,
      moved: false,
      changed: false,
      originalDoc: structuredClone(moveState.doc) as Document,
      originalTransforms: captureOriginalTransforms(moveState.doc, selectedIds),
      selectedIds,
      initialBounds: selectionBounds(moveState.doc, moveState.selection),
      candidateBounds: collectSnapCandidateBounds(moveState.doc, moveState.selection),
    };
  };

  const onPointerMove = (event: ReactPointerEvent<HTMLCanvasElement>): void => {
    const canvas = canvasRef.current;
    const drag = dragRef.current;
    if (canvas === null) {
      return;
    }

    const state = editorStore.getState();
    const point = eventPoint(event, canvas);

    if (state.activeTool === "pen" && drag === null && penDraftRef.current.anchors.length > 0) {
      setPenDraft((current) => ({
        ...current,
        cursorWorld: screenToWorld(point, state.viewport),
      }));
      scheduleInteractiveDraw();
      return;
    }

    if (drag === null || drag.pointerId !== event.pointerId) {
      return;
    }

    event.preventDefault();
    const moved = drag.moved || hasDragMoved(drag.startScreen, point);

    if (drag.mode === "measure") {
      if (state.activeTool !== "measure") {
        cancelMeasureDrag();
        return;
      }

      const currentWorld = screenToWorld(point, state.viewport);
      const endWorld = event.shiftKey ? constrainMeasureEnd(drag.startWorld, currentWorld) : currentWorld;
      dragRef.current = {
        ...drag,
        lastScreen: point,
        moved,
      };
      setMeasureOverlay({
        startWorld: drag.startWorld,
        endWorld,
      });
      return;
    }

    if (drag.mode === "guide") {
      const currentWorld = screenToWorld(point, state.viewport);
      const position = guidePositionFromWorldPoint(drag, currentWorld);
      const changed = moveGuideForGesture(drag, position);
      dragRef.current = {
        ...drag,
        lastScreen: point,
        moved,
        changed: drag.changed || changed,
      };
      if (!changed) {
        scheduleInteractiveDraw();
      }
      return;
    }

    if (drag.mode === "pen-anchor") {
      const currentWorld = screenToWorld(point, state.viewport);
      const handleOut = {
        x: currentWorld.x - drag.anchorWorld.x,
        y: currentWorld.y - drag.anchorWorld.y,
      };
      const handleIn = {
        x: -handleOut.x,
        y: -handleOut.y,
      };

      setPenDraft((current) => {
        const anchor = current.anchors[drag.anchorIndex];
        if (anchor === undefined) {
          return {
            ...current,
            cursorWorld: currentWorld,
          };
        }

        const anchors = [...current.anchors];
        anchors[drag.anchorIndex] = {
          ...anchor,
          handleIn,
          handleOut,
        };
        return {
          anchors,
          cursorWorld: currentWorld,
        };
      });
      dragRef.current = {
        ...drag,
        lastScreen: point,
        moved,
      };
      scheduleInteractiveDraw();
      return;
    }

    if (drag.mode === "node-anchor" || drag.mode === "node-handle") {
      const gesture = applyNodeEditGesture(
        drag,
        point,
        state.viewport,
        event.altKey,
        state.snapSettings,
        event.ctrlKey || event.metaKey,
      );
      snapGuidesRef.current = gesture.guides;
      dragRef.current = {
        ...drag,
        lastScreen: point,
        moved,
        changed: drag.changed || gesture.changed,
      };
      if (!gesture.changed) {
        scheduleInteractiveDraw();
      }
      return;
    }

    if (drag.mode === "scale" || drag.mode === "rotate") {
      const currentWorld = screenToWorld(point, state.viewport);
      const snappingDisabled = snapDisabled(state.snapSettings, event.ctrlKey || event.metaKey);
      let gesture: TransformGesture;
      if (drag.mode === "rotate") {
        const rotateGesture = rotateGestureMatrix(drag, currentWorld, event.shiftKey, snappingDisabled);
        gesture = rotateGesture;
        rotationReadoutRef.current = {
          angleRad: rotateGesture.angleRad,
          screenPoint: point,
        };
      } else {
        gesture = computeScaleGesture(
          drag,
          currentWorld,
          state.viewport,
          event.shiftKey,
          state.snapSettings,
          event.ctrlKey || event.metaKey,
        );
        rotationReadoutRef.current = null;
      }
      const changed = applyTransformGesture(drag, currentWorld, event.shiftKey, gesture.matrix);
      snapGuidesRef.current = gesture.guides;
      dragRef.current = {
        ...drag,
        lastScreen: point,
        moved,
        changed: drag.changed || changed,
      };
      if (!changed) {
        scheduleInteractiveDraw();
      }
      return;
    }

    const screenDx = point.x - drag.lastScreen.x;
    const screenDy = point.y - drag.lastScreen.y;

    if (drag.mode === "pan") {
      state.setPan({
        x: state.viewport.pan.x + screenDx,
        y: state.viewport.pan.y + screenDy,
      });
    } else if (drag.mode === "move") {
      if (!moved) {
        snapGuidesRef.current = emptySnapGuides();
        dragRef.current = {
          ...drag,
          lastScreen: point,
          moved,
        };
        scheduleInteractiveDraw();
        return;
      }

      const gesture = computeMoveGesture(
        drag,
        point,
        state.viewport,
        state.snapSettings,
        event.ctrlKey || event.metaKey,
      );
      const changed = applyMoveGesture(drag, gesture.dx, gesture.dy);
      snapGuidesRef.current = gesture.guides;
      dragRef.current = {
        ...drag,
        lastScreen: point,
        moved,
        changed: drag.changed || changed,
      };
      if (!changed) {
        scheduleInteractiveDraw();
      }
      return;
    } else if (drag.mode === "create-rect" || drag.mode === "create-ellipse" || drag.mode === "marquee") {
      scheduleInteractiveDraw();
    }

    dragRef.current = {
      ...drag,
      lastScreen: point,
      moved,
    };
  };

  const finishDrag = (event: ReactPointerEvent<HTMLCanvasElement>): void => {
    const canvas = canvasRef.current;
    const drag = dragRef.current;
    if (canvas === null || drag === null || drag.pointerId !== event.pointerId) {
      return;
    }

    event.preventDefault();
    const point = eventPoint(event, canvas);
    const state = editorStore.getState();
    const currentWorld = screenToWorld(point, state.viewport);
    const moved = drag.moved || hasDragMoved(drag.startScreen, point);

    if (drag.mode === "measure" && state.activeTool !== "measure") {
      cancelMeasureDrag();
      return;
    }

    if (drag.mode === "guide") {
      if (isGuideDroppedOnRuler(drag.axis, point)) {
        removeGuideForGesture(drag);
      } else {
        const position = guidePositionFromWorldPoint(drag, currentWorld);
        const changed = moveGuideForGesture(drag, position);
        commitGuideGesture({
          ...drag,
          changed: drag.changed || changed,
        });
      }
    } else if (drag.mode === "pen-anchor") {
      const handleOut = moved
        ? {
            x: currentWorld.x - drag.anchorWorld.x,
            y: currentWorld.y - drag.anchorWorld.y,
          }
        : null;
      const handleIn = handleOut === null
        ? null
        : {
            x: -handleOut.x,
            y: -handleOut.y,
          };

      setPenDraft((current) => {
        const anchor = current.anchors[drag.anchorIndex];
        if (anchor === undefined) {
          return {
            ...current,
            cursorWorld: currentWorld,
          };
        }

        const anchors = [...current.anchors];
        anchors[drag.anchorIndex] = {
          ...anchor,
          handleIn,
          handleOut,
        };
        return {
          anchors,
          cursorWorld: currentWorld,
        };
      });
    } else if (drag.mode === "measure") {
      const endWorld = event.shiftKey ? constrainMeasureEnd(drag.startWorld, currentWorld) : currentWorld;
      setMeasureOverlay({
        startWorld: drag.startWorld,
        endWorld,
      });
    } else if (drag.mode === "node-anchor" || drag.mode === "node-handle") {
      applyNodeEditGesture(
        drag,
        point,
        state.viewport,
        event.altKey,
        state.snapSettings,
        event.ctrlKey || event.metaKey,
      );
      if (nodeEditChangedFromOriginal(drag)) {
        commitNodeEditGesture(drag);
      }
    } else if (drag.mode === "scale" || drag.mode === "rotate") {
      const snappingDisabled = snapDisabled(state.snapSettings, event.ctrlKey || event.metaKey);
      const gesture = drag.mode === "scale"
        ? computeScaleGesture(
            drag,
            currentWorld,
            state.viewport,
            event.shiftKey,
            state.snapSettings,
            event.ctrlKey || event.metaKey,
          )
        : rotateGestureMatrix(drag, currentWorld, event.shiftKey, snappingDisabled);
      const changed = applyTransformGesture(drag, currentWorld, event.shiftKey, gesture.matrix);
      if (drag.changed || changed) {
        commitTransformGesture(drag);
      }
    } else if (drag.mode === "move") {
      if (moved) {
        const gesture = computeMoveGesture(
          drag,
          point,
          state.viewport,
          state.snapSettings,
          event.ctrlKey || event.metaKey,
        );
        const changed = applyMoveGesture(drag, gesture.dx, gesture.dy);
        if (drag.changed || changed) {
          commitTransformGesture(drag);
        }
      }
    } else if (drag.mode === "create-rect") {
      commitShape("rect", drag.startWorld, currentWorld);
    } else if (drag.mode === "create-ellipse") {
      commitShape("ellipse", drag.startWorld, currentWorld);
    } else if (drag.mode === "marquee") {
      if (!moved) {
        state.clearSelection();
      } else {
        const rect = fromRect(
          drag.startWorld.x,
          drag.startWorld.y,
          currentWorld.x - drag.startWorld.x,
          currentWorld.y - drag.startWorld.y,
        );
        const hits = nodesInRect(state, rect);
        if (event.shiftKey) {
          for (const id of hits) {
            state.addToSelection(id);
          }
        } else {
          state.setSelection(hits);
        }
      }
    }

    if (canvas.hasPointerCapture(event.pointerId)) {
      canvas.releasePointerCapture(event.pointerId);
    }
    snapGuidesRef.current = emptySnapGuides();
    rotationReadoutRef.current = null;
    dragRef.current = null;
    scheduleInteractiveDraw();
  };

  const onDoubleClick = (event: ReactMouseEvent<HTMLCanvasElement>): void => {
    const state = editorStore.getState();
    if (state.activeTool === "pen") {
      finalizePenPath(false);
      return;
    }

    if (state.activeTool === "node") {
      const canvas = canvasRef.current;
      if (canvas === null) {
        return;
      }

      const editable = getEditablePathNode(state.doc, state.selection);
      if (editable === null) {
        return;
      }

      event.preventDefault();
      const point = eventPoint(event, canvas);
      const editHit = hitNodeEditOverlay(
        editable.node,
        editable.worldTransform,
        state.viewport,
        point,
        selectedPathAnchorRef.current,
      );
      if (editHit?.type === "anchor") {
        setSelectedPathAnchor(editHit.target);
        toggleNodeEditAnchorType(editable.id, editHit.target);
      }
      return;
    }

    if (state.activeTool !== "select" && state.activeTool !== "text") {
      return;
    }

    const canvas = canvasRef.current;
    if (canvas === null) {
      return;
    }

    event.preventDefault();
    const point = eventPoint(event, canvas);
    const worldPoint = screenToWorld(point, state.viewport);
    const hit = hitTest(state.doc, worldPoint, { tolerance: 3 / state.viewport.zoom });
    if (hit === null) {
      return;
    }

    const node = state.doc.nodes[hit];
    if (node?.type === "text") {
      state.setSelection([node.id]);
      beginInlineTextEdit(node, false);
    }
  };

  const onInlineTextInput = (event: ChangeEvent<HTMLTextAreaElement>): void => {
    const edit = inlineTextEditRef.current;
    if (edit === null) {
      return;
    }

    setInlineTextEdit({
      ...edit,
      value: event.currentTarget.value,
    });
  };

  const onInlineTextKeyDown = (event: ReactKeyboardEvent<HTMLTextAreaElement>): void => {
    if (event.key === "Enter" && !event.shiftKey) {
      event.preventDefault();
      finishInlineTextEdit("commit");
    } else if (event.key === "Escape") {
      event.preventDefault();
      finishInlineTextEdit("cancel");
    }
  };

  const onCanvasKeyDown = (event: ReactKeyboardEvent<HTMLCanvasElement>): void => {
    if (event.key !== "Delete" && event.key !== "Backspace") {
      return;
    }

    const activeDrag = dragRef.current;
    if (activeDrag?.mode === "guide") {
      event.preventDefault();
      event.stopPropagation();
      event.nativeEvent.stopImmediatePropagation();

      removeGuideForGesture(activeDrag);
      const canvas = canvasRef.current;
      if (canvas !== null && canvas.hasPointerCapture(activeDrag.pointerId)) {
        canvas.releasePointerCapture(activeDrag.pointerId);
      }
      dragRef.current = null;
      scheduleInteractiveDraw();
      return;
    }

    const state = editorStore.getState();
    if (state.activeTool !== "node") {
      return;
    }

    const editable = getEditablePathNode(state.doc, state.selection);
    const selectedAnchor = selectedPathAnchorRef.current;
    if (editable === null || !isValidSelectedAnchor(editable.node, selectedAnchor)) {
      return;
    }

    event.preventDefault();
    event.stopPropagation();
    event.nativeEvent.stopImmediatePropagation();

    const result = deleteNodeEditAnchor(editable.id, selectedAnchor);
    setSelectedPathAnchor(result.selectedAnchor);
  };

  const onWheel = (event: ReactWheelEvent<HTMLCanvasElement>): void => {
    event.preventDefault();
    const canvas = canvasRef.current;
    if (canvas === null) {
      return;
    }

    const state = editorStore.getState();
    const point = eventPoint(event, canvas);

    if (event.ctrlKey || event.metaKey) {
      const before = screenToWorld(point, state.viewport);
      const factor = Math.exp(-event.deltaY * 0.0015);
      const zoom = clamp(state.viewport.zoom * factor, MIN_ZOOM, MAX_ZOOM);
      state.setZoom(zoom);
      state.setPan({
        x: point.x - before.x * zoom,
        y: point.y - before.y * zoom,
      });
      return;
    }

    state.setPan({
      x: state.viewport.pan.x - event.deltaX,
      y: state.viewport.pan.y - event.deltaY,
    });
  };

  const cursorClass =
    activeTool === "hand"
      ? "canvas-view__canvas--hand"
      : activeTool === "select"
        ? "canvas-view__canvas--select"
        : "canvas-view__canvas--crosshair";
  const editingNode = inlineTextEdit === null ? null : doc.nodes[inlineTextEdit.id];
  const inlineTextStyle = (() => {
    if (inlineTextEdit === null || editingNode?.type !== "text") {
      return null;
    }

    const screenPoint = worldToScreen(
      { x: editingNode.transform.e, y: editingNode.transform.f },
      viewport,
    );
    const fontSize = editingNode.fontSize * viewport.zoom;
    const lines = inlineTextEdit.value.split("\n");
    const longestLineLength = Math.max(1, ...lines.map((line) => line.length));
    const lineHeight = fontSize * editingNode.lineHeight;
    const width = Math.max(160, longestLineLength * fontSize * 0.62 + 24);
    const height = Math.max(36, lines.length * lineHeight + 16);

    return {
      left: `${screenPoint.x}px`,
      top: `${screenPoint.y}px`,
      width: `${width}px`,
      height: `${height}px`,
      fontFamily: editingNode.fontFamily,
      fontSize: `${fontSize}px`,
      fontStyle: editingNode.fontStyle,
      fontWeight: editingNode.fontWeight,
      lineHeight: String(editingNode.lineHeight),
      textAlign: editingNode.textAlign,
    } satisfies CSSProperties;
  })();

  return (
    <section className="canvas-view" ref={containerRef}>
      <canvas
        aria-label="Document canvas"
        className={`canvas-view__canvas ${cursorClass}`}
        onPointerCancel={finishDrag}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={finishDrag}
        onDoubleClick={onDoubleClick}
        onKeyDown={onCanvasKeyDown}
        onWheel={onWheel}
        ref={canvasRef}
        tabIndex={0}
      />
      <Rulers onGuideActivated={setActiveGuideId} />
      <GuidePrefs activeGuideId={activeGuideId} />
      {inlineTextEdit !== null && inlineTextStyle !== null ? (
        <textarea
          aria-label="Edit text"
          className="canvas-view__text-editor"
          onBlur={() => finishInlineTextEdit("commit")}
          onChange={onInlineTextInput}
          onKeyDown={onInlineTextKeyDown}
          ref={textAreaRef}
          spellCheck={false}
          style={inlineTextStyle}
          value={inlineTextEdit.value}
        />
      ) : null}
    </section>
  );
}
