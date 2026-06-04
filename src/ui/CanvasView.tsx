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
  width as bboxWidth,
  type BBox,
} from "../core/geometry/bbox";
import { compose, IDENTITY, invert, rotation, scaling, translate, type Matrix } from "../core/geometry/matrix";
import type { Vec2 } from "../core/geometry/vector";
import { corner, createEllipse, createPath, createRect, createText } from "../core/model/factory";
import { hitTest } from "../core/model/hittest";
import { selectionBounds } from "../core/model/bounds";
import type { Anchor, Document, NodeId, SceneNode, TextNode } from "../core/model/types";
import { renderDocument } from "../render/canvasRenderer";
import { nodesInRect } from "../state/selectors";
import { pushHistory } from "../state/history";
import { editorStore, useEditorStore, type EditorStore, type EditorViewport } from "../state/store";
import "./CanvasView.css";

interface Size {
  width: number;
  height: number;
}

type ResizeHandleId = "nw" | "n" | "ne" | "e" | "se" | "s" | "sw" | "w";

interface BaseDragState {
  mode: "move" | "pan" | "create-rect" | "create-ellipse" | "marquee" | "scale" | "rotate";
  pointerId: number;
  startScreen: Vec2;
  lastScreen: Vec2;
  startWorld: Vec2;
  additive: boolean;
  moved: boolean;
}

interface SimpleDragState extends BaseDragState {
  mode: "move" | "pan" | "create-rect" | "create-ellipse" | "marquee";
}

interface TransformDragBase extends BaseDragState {
  additive: false;
  changed: boolean;
  originalDoc: Document;
  originalTransforms: Partial<Record<NodeId, Matrix>>;
  selectedIds: NodeId[];
}

interface ScaleDragState extends TransformDragBase {
  mode: "scale";
  anchorWorld: Vec2;
  handleId: ResizeHandleId;
  handleStartWorld: Vec2;
}

interface RotateDragState extends TransformDragBase {
  mode: "rotate";
  centerWorld: Vec2;
  startAngle: number;
}

type DragState = SimpleDragState | ScaleDragState | RotateDragState;

interface PenDraft {
  anchors: Anchor[];
  cursorWorld: Vec2 | null;
}

interface InlineTextEdit {
  id: NodeId;
  value: string;
  createdEmpty: boolean;
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
const MATRIX_EPSILON = 1e-9;
const SCALE_EPSILON = 1e-6;
const SNAP_ROTATION_RADIANS = Math.PI / 12;

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

const hasDragMoved = (start: Vec2, current: Vec2): boolean =>
  Math.abs(current.x - start.x) > DRAG_MOVE_THRESHOLD ||
  Math.abs(current.y - start.y) > DRAG_MOVE_THRESHOLD;

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
): Matrix => {
  const currentAngle = Math.atan2(
    currentWorld.y - drag.centerWorld.y,
    currentWorld.x - drag.centerWorld.x,
  );
  const rawAngle = currentAngle - drag.startAngle;
  const angle = constrained
    ? Math.round(rawAngle / SNAP_ROTATION_RADIANS) * SNAP_ROTATION_RADIANS
    : rawAngle;

  return composeAboutPoint(drag.centerWorld, rotation(angle));
};

const applyTransformGesture = (
  drag: ScaleDragState | RotateDragState,
  currentWorld: Vec2,
  constrained: boolean,
): boolean => {
  const gestureMatrix = drag.mode === "scale"
    ? scaleGestureMatrix(drag, currentWorld, constrained)
    : rotateGestureMatrix(drag, currentWorld, constrained);
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

const commitTransformGesture = (drag: ScaleDragState | RotateDragState): void => {
  editorStore.setState((state) => ({
    history: pushHistory(state.history, drag.originalDoc),
  }));
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

const drawPenPreview = (
  ctx: CanvasRenderingContext2D,
  draft: PenDraft,
  viewport: EditorViewport,
  dpr: number,
): void => {
  if (draft.anchors.length === 0) {
    return;
  }

  const points = draft.anchors.map((anchor) => worldToScreen(anchor.point, viewport));
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
    for (const point of points.slice(1)) {
      ctx.lineTo(point.x, point.y);
    }
    if (cursorPoint !== null) {
      ctx.lineTo(cursorPoint.x, cursorPoint.y);
    }
    ctx.stroke();
  }

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
  const spaceHeldRef = useRef(false);
  const frameRef = useRef<number | null>(null);
  const inlineTextEditRef = useRef<InlineTextEdit | null>(null);
  const [penDraft, setPenDraftState] = useState<PenDraft>(createEmptyPenDraft);
  const penDraftRef = useRef<PenDraft>(penDraft);
  const [inlineTextEdit, setInlineTextEditState] = useState<InlineTextEdit | null>(null);
  const [size, setSize] = useState<Size>({ width: 0, height: 0 });
  const activeTool = useEditorStore((state) => state.activeTool);
  const doc = useEditorStore((state) => state.doc);
  const viewport = useEditorStore((state) => state.viewport);
  const previousToolRef = useRef(activeTool);

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
        const { doc, selection, viewport } = editorStore.getState();
        const renderViewport: EditorViewport = {
          zoom: viewport.zoom * dpr,
          pan: {
            x: viewport.pan.x * dpr,
            y: viewport.pan.y * dpr,
          },
        };
        ctx.setTransform(1, 0, 0, 1, 0, 0);
        renderDocument(ctx, doc, renderViewport);
        drawSelectionOverlay(ctx, doc, selection, viewport, dpr, editorStore.getState().activeTool === "select");
        drawShapePreview(ctx, dragRef.current, viewport, dpr);
        drawMarqueePreview(ctx, dragRef.current, dpr);
        drawPenPreview(ctx, penDraftRef.current, viewport, dpr);
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
    previousToolRef.current = activeTool;
  }, [activeTool, finalizePenPath]);

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

      setPenDraft((current) => ({
        anchors: [...current.anchors, corner(worldPoint)],
        cursorWorld: worldPoint,
      }));
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

    canvas.setPointerCapture(event.pointerId);
    dragRef.current = {
      mode: "move",
      pointerId: event.pointerId,
      startScreen: point,
      lastScreen: point,
      startWorld: worldPoint,
      additive,
      moved: false,
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

    if (drag.mode === "scale" || drag.mode === "rotate") {
      const currentWorld = screenToWorld(point, state.viewport);
      const changed = applyTransformGesture(drag, currentWorld, event.shiftKey);
      dragRef.current = {
        ...drag,
        lastScreen: point,
        moved,
        changed: drag.changed || changed,
      };
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
      state.moveSelection(screenDx / state.viewport.zoom, screenDy / state.viewport.zoom);
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

    if (drag.mode === "scale" || drag.mode === "rotate") {
      const changed = applyTransformGesture(drag, currentWorld, event.shiftKey);
      if (drag.changed || changed) {
        commitTransformGesture(drag);
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
    dragRef.current = null;
    scheduleInteractiveDraw();
  };

  const onDoubleClick = (event: ReactMouseEvent<HTMLCanvasElement>): void => {
    const state = editorStore.getState();
    if (state.activeTool === "pen") {
      finalizePenPath(false);
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
        onWheel={onWheel}
        ref={canvasRef}
        tabIndex={0}
      />
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
