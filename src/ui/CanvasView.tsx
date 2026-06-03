import { useEffect, useRef, useState, type PointerEvent as ReactPointerEvent, type WheelEvent as ReactWheelEvent } from "react";
import { height as bboxHeight, isEmpty, width as bboxWidth } from "../core/geometry/bbox";
import type { Vec2 } from "../core/geometry/vector";
import { createEllipse, createRect } from "../core/model/factory";
import { hitTest } from "../core/model/hittest";
import { selectionBounds } from "../core/model/bounds";
import type { Document, NodeId, SceneNode } from "../core/model/types";
import { renderDocument } from "../render/canvasRenderer";
import { editorStore, useEditorStore, type EditorViewport } from "../state/store";
import "./CanvasView.css";

interface Size {
  width: number;
  height: number;
}

interface DragState {
  mode: "move" | "pan" | "create-rect" | "create-ellipse";
  pointerId: number;
  startScreen: Vec2;
  lastScreen: Vec2;
  startWorld: Vec2;
  additive: boolean;
  moved: boolean;
}

const MIN_ZOOM = 0.05;
const MAX_ZOOM = 64;
const HANDLE_SIZE = 7;

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

const eventPoint = (
  event: PointerEvent | ReactPointerEvent<HTMLCanvasElement> | ReactWheelEvent<HTMLCanvasElement>,
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

const drawSelectionOverlay = (
  ctx: CanvasRenderingContext2D,
  doc: Document,
  selection: NodeId[],
  viewport: EditorViewport,
  dpr: number,
): void => {
  if (selection.length === 0) {
    return;
  }

  const bounds = selectionBounds(doc, selection);
  const boundsWidth = bboxWidth(bounds);
  const boundsHeight = bboxHeight(bounds);
  if (isEmpty(bounds) || boundsWidth <= 0 || boundsHeight <= 0) {
    return;
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
  const handle = HANDLE_SIZE;
  const halfHandle = handle / 2;
  const handles: Vec2[] = [
    { x, y },
    { x: x + width, y },
    { x: x + width, y: y + height },
    { x, y: y + height },
  ];

  ctx.save();
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.strokeStyle = "#2d8cf0";
  ctx.lineWidth = 1;
  ctx.setLineDash([4, 3]);
  ctx.strokeRect(x + 0.5, y + 0.5, width, height);
  ctx.setLineDash([]);
  ctx.fillStyle = "#ffffff";
  ctx.strokeStyle = "#2d8cf0";
  for (const point of handles) {
    ctx.fillRect(point.x - halfHandle, point.y - halfHandle, handle, handle);
    ctx.strokeRect(point.x - halfHandle + 0.5, point.y - halfHandle + 0.5, handle, handle);
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

export default function CanvasView() {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const dragRef = useRef<DragState | null>(null);
  const spaceHeldRef = useRef(false);
  const frameRef = useRef<number | null>(null);
  const [size, setSize] = useState<Size>({ width: 0, height: 0 });
  const activeTool = useEditorStore((state) => state.activeTool);

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
        drawSelectionOverlay(ctx, doc, selection, viewport, dpr);
        drawShapePreview(ctx, dragRef.current, viewport, dpr);
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

    if (state.activeTool !== "select") {
      return;
    }

    event.preventDefault();
    const hit = hitTest(state.doc, worldPoint, { tolerance: 3 / state.viewport.zoom });
    if (hit === null) {
      state.clearSelection();
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
    if (canvas === null || drag === null || drag.pointerId !== event.pointerId) {
      return;
    }

    event.preventDefault();
    const state = editorStore.getState();
    const point = eventPoint(event, canvas);
    const screenDx = point.x - drag.lastScreen.x;
    const screenDy = point.y - drag.lastScreen.y;

    if (drag.mode === "pan") {
      state.setPan({
        x: state.viewport.pan.x + screenDx,
        y: state.viewport.pan.y + screenDy,
      });
    } else if (drag.mode === "move") {
      state.moveSelection(screenDx / state.viewport.zoom, screenDy / state.viewport.zoom);
    } else {
      scheduleInteractiveDraw();
    }

    dragRef.current = {
      ...drag,
      lastScreen: point,
      moved: drag.moved || Math.abs(point.x - drag.startScreen.x) > 2 || Math.abs(point.y - drag.startScreen.y) > 2,
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

    if (drag.mode === "create-rect") {
      commitShape("rect", drag.startWorld, currentWorld);
    } else if (drag.mode === "create-ellipse") {
      commitShape("ellipse", drag.startWorld, currentWorld);
    }

    if (canvas.hasPointerCapture(event.pointerId)) {
      canvas.releasePointerCapture(event.pointerId);
    }
    dragRef.current = null;
    scheduleInteractiveDraw();
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

  return (
    <section className="canvas-view" ref={containerRef}>
      <canvas
        aria-label="Document canvas"
        className={`canvas-view__canvas ${cursorClass}`}
        onPointerCancel={finishDrag}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={finishDrag}
        onWheel={onWheel}
        ref={canvasRef}
        tabIndex={0}
      />
    </section>
  );
}
