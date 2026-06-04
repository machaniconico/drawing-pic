import { useEffect, useMemo, useRef, useState, type PointerEvent as ReactPointerEvent, type RefObject } from "react";
import type { Vec2 } from "../core/geometry/vector";
import type { Guide, NodeId } from "../core/model/types";
import { editorStore, useEditorStore, type EditorStore, type EditorViewport } from "../state/store";
import "./Rulers.css";

interface RulerSize {
  width: number;
  height: number;
}

interface Tick {
  value: number;
  position: number;
  kind: "minor" | "major";
  label: string | null;
}

interface RulerGuideDrag {
  id: NodeId;
  axis: Guide["axis"];
  pointerId: number;
  historyAfterCreate: EditorStore["history"];
}

const RULER_SIZE = 24;
const MAJOR_LABEL_SPACING_PX = 72;
const MIN_MINOR_SPACING_PX = 8;
const MIN_ZOOM = 1e-6;

const niceCeil = (value: number): number => {
  if (!Number.isFinite(value) || value <= 0) {
    return 1;
  }

  const power = 10 ** Math.floor(Math.log10(value));
  const normalized = value / power;

  if (normalized <= 1) {
    return power;
  }
  if (normalized <= 2) {
    return 2 * power;
  }
  if (normalized <= 5) {
    return 5 * power;
  }
  return 10 * power;
};

const countFractionDigits = (step: number): number => {
  if (!Number.isFinite(step) || step >= 1) {
    return 0;
  }

  return Math.min(6, Math.ceil(-Math.log10(step)) + 1);
};

const formatLabel = (value: number, step: number): string => {
  const fractionDigits = countFractionDigits(step);
  const rounded = Number(value.toFixed(fractionDigits));
  return Object.is(rounded, -0) ? "0" : String(rounded);
};

const estimateLabelWidth = (label: string): number => label.length * 6 + 12;

const clientPoint = (event: PointerEvent | ReactPointerEvent<SVGSVGElement>, element: Element): Vec2 => {
  const rect = element.getBoundingClientRect();
  return {
    x: event.clientX - rect.left,
    y: event.clientY - rect.top,
  };
};

const worldPositionForAxis = (point: Vec2, axis: Guide["axis"], viewport: EditorViewport): number =>
  axis === "x"
    ? (point.x - viewport.pan.x) / viewport.zoom
    : (point.y - viewport.pan.y) / viewport.zoom;

const chooseMajorStep = (minWorld: number, maxWorld: number, zoom: number): number => {
  let majorStep = niceCeil(MAJOR_LABEL_SPACING_PX / zoom);

  for (let attempt = 0; attempt < 8; attempt += 1) {
    const minLabel = formatLabel(Math.floor(minWorld / majorStep) * majorStep, majorStep);
    const maxLabel = formatLabel(Math.ceil(maxWorld / majorStep) * majorStep, majorStep);
    const labelSpacing = Math.max(
      MAJOR_LABEL_SPACING_PX,
      estimateLabelWidth(minLabel),
      estimateLabelWidth(maxLabel),
    );

    if (majorStep * zoom >= labelSpacing) {
      return majorStep;
    }

    majorStep = niceCeil((labelSpacing + 1) / zoom);
  }

  return majorStep;
};

const minorDivisionsFor = (majorStep: number, zoom: number): number => {
  const preferredDivisions = majorStep / niceCeil(MIN_MINOR_SPACING_PX / zoom);

  if (preferredDivisions >= 5) {
    return 5;
  }
  if (preferredDivisions >= 2) {
    return 2;
  }
  return 1;
};

const buildTicks = (
  axisLength: number,
  axisOffset: number,
  pan: number,
  zoom: number,
): Tick[] => {
  if (axisLength <= 0 || zoom <= MIN_ZOOM) {
    return [];
  }

  const minWorld = (axisOffset - pan) / zoom;
  const maxWorld = (axisOffset + axisLength - pan) / zoom;
  const majorStep = chooseMajorStep(minWorld, maxWorld, zoom);
  const minorDivisions = minorDivisionsFor(majorStep, zoom);
  const minorStep = majorStep / minorDivisions;
  const start = Math.floor(minWorld / minorStep) * minorStep;
  const end = Math.ceil(maxWorld / minorStep) * minorStep;
  const ticks: Tick[] = [];
  const maxTickCount = Math.ceil((end - start) / minorStep) + 1;

  for (let index = 0; index < maxTickCount; index += 1) {
    const value = start + index * minorStep;
    const position = value * zoom + pan - axisOffset;

    if (position < -1 || position > axisLength + 1) {
      continue;
    }

    const majorIndex = Math.round(value / majorStep);
    const isMajor = Math.abs(value - majorIndex * majorStep) < Math.abs(minorStep) * 0.001;
    ticks.push({
      value,
      position,
      kind: isMajor ? "major" : "minor",
      label: isMajor ? formatLabel(value, majorStep) : null,
    });
  }

  return ticks;
};

const useElementSize = (): [RefObject<HTMLDivElement>, RulerSize] => {
  const ref = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState<RulerSize>({ width: 0, height: 0 });

  useEffect(() => {
    const element = ref.current;
    if (element === null) {
      return;
    }

    const updateSize = (): void => {
      const rect = element.getBoundingClientRect();
      setSize({
        width: Math.max(0, Math.round(rect.width)),
        height: Math.max(0, Math.round(rect.height)),
      });
    };

    updateSize();
    const observer = new ResizeObserver(updateSize);
    observer.observe(element);
    return () => observer.disconnect();
  }, []);

  return [ref, size];
};

export function Rulers() {
  const viewport = useEditorStore((state) => state.viewport);
  const [rootRef, size] = useElementSize();
  const dragRef = useRef<RulerGuideDrag | null>(null);
  const horizontalLength = Math.max(0, size.width - RULER_SIZE);
  const verticalLength = Math.max(0, size.height - RULER_SIZE);

  const horizontalTicks = useMemo(
    () => buildTicks(horizontalLength, RULER_SIZE, viewport.pan.x, viewport.zoom),
    [horizontalLength, viewport.pan.x, viewport.zoom],
  );
  const verticalTicks = useMemo(
    () => buildTicks(verticalLength, RULER_SIZE, viewport.pan.y, viewport.zoom),
    [verticalLength, viewport.pan.y, viewport.zoom],
  );

  const beginGuideDrag = (event: ReactPointerEvent<SVGSVGElement>, axis: Guide["axis"]): void => {
    const root = rootRef.current;
    if (root === null) {
      return;
    }

    event.preventDefault();
    const state = editorStore.getState();
    const point = clientPoint(event, root);
    const position = worldPositionForAxis(point, axis, state.viewport);
    const id = state.addGuide(axis, position);
    if (id === null) {
      return;
    }

    dragRef.current = {
      id,
      axis,
      pointerId: event.pointerId,
      historyAfterCreate: editorStore.getState().history,
    };
    event.currentTarget.setPointerCapture(event.pointerId);
  };

  const moveGuideDrag = (event: ReactPointerEvent<SVGSVGElement>): void => {
    const root = rootRef.current;
    const drag = dragRef.current;
    if (root === null || drag === null || drag.pointerId !== event.pointerId) {
      return;
    }

    event.preventDefault();
    const state = editorStore.getState();
    const point = clientPoint(event, root);
    const position = worldPositionForAxis(point, drag.axis, state.viewport);
    state.moveGuide(drag.id, position);
    editorStore.setState({ history: drag.historyAfterCreate });
  };

  const finishGuideDrag = (event: ReactPointerEvent<SVGSVGElement>): void => {
    const root = rootRef.current;
    const drag = dragRef.current;
    if (root === null || drag === null || drag.pointerId !== event.pointerId) {
      return;
    }

    event.preventDefault();
    const state = editorStore.getState();
    const point = clientPoint(event, root);
    const position = worldPositionForAxis(point, drag.axis, state.viewport);
    state.moveGuide(drag.id, position);
    editorStore.setState({ history: drag.historyAfterCreate });

    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
    dragRef.current = null;
  };

  return (
    <div aria-hidden="true" className="rulers" ref={rootRef}>
      <div className="rulers__corner" />
      <svg
        className="rulers__axis rulers__axis--horizontal"
        height={RULER_SIZE}
        onPointerCancel={finishGuideDrag}
        onPointerDown={(event) => beginGuideDrag(event, "y")}
        onPointerMove={moveGuideDrag}
        onPointerUp={finishGuideDrag}
        role="presentation"
        style={{ cursor: "ns-resize", pointerEvents: "auto" }}
        viewBox={`0 0 ${horizontalLength} ${RULER_SIZE}`}
        width={horizontalLength}
      >
        <line className="rulers__baseline" x1={0} x2={horizontalLength} y1={RULER_SIZE - 0.5} y2={RULER_SIZE - 0.5} />
        {horizontalTicks.map((tick) => {
          const tickHeight = tick.kind === "major" ? 12 : 6;
          return (
            <g key={`${tick.kind}-x-${tick.value}`}>
              <line
                className={`rulers__tick rulers__tick--${tick.kind}`}
                x1={tick.position}
                x2={tick.position}
                y1={RULER_SIZE}
                y2={RULER_SIZE - tickHeight}
              />
              {tick.label !== null ? (
                <text className="rulers__label" x={tick.position + 3} y={10}>
                  {tick.label}
                </text>
              ) : null}
            </g>
          );
        })}
      </svg>
      <svg
        className="rulers__axis rulers__axis--vertical"
        height={verticalLength}
        onPointerCancel={finishGuideDrag}
        onPointerDown={(event) => beginGuideDrag(event, "x")}
        onPointerMove={moveGuideDrag}
        onPointerUp={finishGuideDrag}
        role="presentation"
        style={{ cursor: "ew-resize", pointerEvents: "auto" }}
        viewBox={`0 0 ${RULER_SIZE} ${verticalLength}`}
        width={RULER_SIZE}
      >
        <line className="rulers__baseline" x1={RULER_SIZE - 0.5} x2={RULER_SIZE - 0.5} y1={0} y2={verticalLength} />
        {verticalTicks.map((tick) => {
          const tickWidth = tick.kind === "major" ? 12 : 6;
          return (
            <g key={`${tick.kind}-y-${tick.value}`}>
              <line
                className={`rulers__tick rulers__tick--${tick.kind}`}
                x1={RULER_SIZE}
                x2={RULER_SIZE - tickWidth}
                y1={tick.position}
                y2={tick.position}
              />
              {tick.label !== null ? (
                <text
                  className="rulers__label rulers__label--vertical"
                  transform={`translate(10 ${tick.position - 3}) rotate(-90)`}
                >
                  {tick.label}
                </text>
              ) : null}
            </g>
          );
        })}
      </svg>
    </div>
  );
}
