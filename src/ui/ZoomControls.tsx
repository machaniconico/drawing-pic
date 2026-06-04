import { useCallback } from "react";
import { editorStore, useEditorStore } from "../state/store";
import "./ZoomControls.css";

const MIN_ZOOM = 0.05;
const MAX_ZOOM = 64;
const ZOOM_STEP = 1.25;
const FIT_MARGIN = 0.9;
const RULER_OFFSET = 24;

interface ViewportMetrics {
  readonly width: number;
  readonly height: number;
  readonly centerX: number;
  readonly centerY: number;
}

const clamp = (value: number, min: number, max: number): number => Math.min(max, Math.max(min, value));

const getViewportMetrics = (): ViewportMetrics | null => {
  const canvasView = document.querySelector<HTMLElement>(".canvas-view");
  if (canvasView === null) {
    return null;
  }

  const rect = canvasView.getBoundingClientRect();
  const width = Math.max(0, rect.width - RULER_OFFSET);
  const height = Math.max(0, rect.height - RULER_OFFSET);

  if (width <= 0 || height <= 0) {
    return null;
  }

  return {
    width,
    height,
    centerX: RULER_OFFSET + width / 2,
    centerY: RULER_OFFSET + height / 2,
  };
};

export const fitCanvasToScreen = (): void => {
  const metrics = getViewportMetrics();
  if (metrics === null) {
    return;
  }

  const state = editorStore.getState();
  const bounds = {
    minX: 0,
    minY: 0,
    maxX: state.doc.width,
    maxY: state.doc.height,
  };
  const width = bounds.maxX - bounds.minX;
  const height = bounds.maxY - bounds.minY;

  if (width <= 0 || height <= 0) {
    return;
  }

  const zoom = clamp(Math.min(metrics.width / width, metrics.height / height) * FIT_MARGIN, MIN_ZOOM, MAX_ZOOM);
  editorStore.getState().setZoom(zoom);
  editorStore.getState().setPan({
    x: metrics.centerX - ((bounds.minX + bounds.maxX) / 2) * zoom,
    y: metrics.centerY - ((bounds.minY + bounds.maxY) / 2) * zoom,
  });
};

export const resetCanvasZoom = (): void => {
  const metrics = getViewportMetrics();
  const state = editorStore.getState();

  if (metrics === null) {
    state.setZoom(1);
    return;
  }

  const worldCenter = {
    x: (metrics.centerX - state.viewport.pan.x) / state.viewport.zoom,
    y: (metrics.centerY - state.viewport.pan.y) / state.viewport.zoom,
  };

  state.setZoom(1);
  editorStore.getState().setPan({
    x: metrics.centerX - worldCenter.x,
    y: metrics.centerY - worldCenter.y,
  });
};

export default function ZoomControls() {
  const zoom = useEditorStore((state) => state.viewport.zoom);
  const zoomLabel = `${Math.round(zoom * 100)}%`;

  const zoomBy = useCallback((factor: number): void => {
    const metrics = getViewportMetrics();
    const state = editorStore.getState();
    const nextZoom = clamp(state.viewport.zoom * factor, MIN_ZOOM, MAX_ZOOM);

    if (metrics === null) {
      state.setZoom(nextZoom);
      return;
    }

    const worldCenter = {
      x: (metrics.centerX - state.viewport.pan.x) / state.viewport.zoom,
      y: (metrics.centerY - state.viewport.pan.y) / state.viewport.zoom,
    };

    state.setZoom(nextZoom);
    editorStore.getState().setPan({
      x: metrics.centerX - worldCenter.x * nextZoom,
      y: metrics.centerY - worldCenter.y * nextZoom,
    });
  }, []);

  return (
    <div className="zoom-controls" aria-label="Zoom controls">
      <button
        aria-label="Zoom out"
        className="zoom-controls__button"
        disabled={zoom <= MIN_ZOOM}
        onClick={() => zoomBy(1 / ZOOM_STEP)}
        title="Zoom out"
        type="button"
      >
        -
      </button>
      <button
        aria-label="Reset zoom to 100%"
        className="zoom-controls__percent"
        onClick={resetCanvasZoom}
        title="100%"
        type="button"
      >
        {zoomLabel}
      </button>
      <button
        aria-label="Zoom in"
        className="zoom-controls__button"
        disabled={zoom >= MAX_ZOOM}
        onClick={() => zoomBy(ZOOM_STEP)}
        title="Zoom in"
        type="button"
      >
        +
      </button>
      <button className="zoom-controls__fit" onClick={fitCanvasToScreen} title="Fit to screen" type="button">
        Fit
      </button>
    </div>
  );
}
