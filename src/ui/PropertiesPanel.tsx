import { useEffect, useState, type KeyboardEvent as ReactKeyboardEvent } from "react";
import { isEmpty, width as bboxWidth, height as bboxHeight } from "../core/geometry/bbox";
import { selectionBounds } from "../core/model/bounds";
import {
  hasStyle,
  type GradientStop,
  type LineCap,
  type LineJoin,
  type LinearGradient,
  type Paint,
  type RadialGradient,
  type RGBA,
  type Stroke,
} from "../core/model/types";
import { nodeRotationAngle } from "../state/operations";
import { getSelectedNodes } from "../state/selectors";
import { useEditorStore } from "../state/store";
import "./PropertiesPanel.css";

type FillType = Paint["type"];
type GradientPaint = LinearGradient | RadialGradient;
type PaintTarget =
  | { readonly kind: "fill" }
  | { readonly kind: "stroke"; readonly stroke: Stroke };

const FILL_TYPES: readonly FillType[] = ["none", "solid", "linear", "radial"];
const LINE_CAPS: readonly LineCap[] = ["butt", "round", "square"];
const LINE_JOINS: readonly LineJoin[] = ["miter", "round", "bevel"];
const BLEND_MODES = [
  { label: "Normal", value: "source-over" },
  { label: "Multiply", value: "multiply" },
  { label: "Screen", value: "screen" },
  { label: "Overlay", value: "overlay" },
  { label: "Darken", value: "darken" },
  { label: "Lighten", value: "lighten" },
  { label: "Color Dodge", value: "color-dodge" },
  { label: "Color Burn", value: "color-burn" },
  { label: "Hard Light", value: "hard-light" },
  { label: "Soft Light", value: "soft-light" },
  { label: "Difference", value: "difference" },
  { label: "Exclusion", value: "exclusion" },
  { label: "Hue", value: "hue" },
  { label: "Saturation", value: "saturation" },
  { label: "Color", value: "color" },
  { label: "Luminosity", value: "luminosity" },
] as const satisfies readonly {
  readonly label: string;
  readonly value: GlobalCompositeOperation;
}[];

const FILL_TYPE_LABELS: Record<FillType, string> = {
  none: "None",
  solid: "Solid",
  linear: "Linear",
  radial: "Radial",
};

const DEFAULT_COLOR: RGBA = { r: 0, g: 0, b: 0, a: 1 };

const clamp = (value: number, min: number, max: number): number =>
  Math.min(max, Math.max(min, value));

const toHexByte = (value: number): string =>
  clamp(Math.round(value), 0, 255).toString(16).padStart(2, "0");

const cloneRgba = (color: RGBA): RGBA => ({
  r: clamp(color.r, 0, 255),
  g: clamp(color.g, 0, 255),
  b: clamp(color.b, 0, 255),
  a: clamp(color.a, 0, 1),
});

const rgbaToHex = (color: RGBA): string =>
  `#${toHexByte(color.r)}${toHexByte(color.g)}${toHexByte(color.b)}`;

const hexToRgba = (hex: string, alpha = 1): RGBA => {
  const normalized = hex.trim().replace(/^#/, "");
  const value = /^[0-9a-fA-F]{6}$/.test(normalized) ? normalized : "000000";

  return {
    r: Number.parseInt(value.slice(0, 2), 16),
    g: Number.parseInt(value.slice(2, 4), 16),
    b: Number.parseInt(value.slice(4, 6), 16),
    a: clamp(alpha, 0, 1),
  };
};

const formatUnitNumber = (value: number): string =>
  Number.isFinite(value) ? String(Math.round(clamp(value, 0, 1) * 1000) / 1000) : "0";

const paintColor = (paint: Paint): RGBA | null =>
  paint.type === "solid" ? paint.color : null;

const primaryPaintColor = (paint: Paint): RGBA | null => {
  switch (paint.type) {
    case "solid":
      return paint.color;
    case "linear":
    case "radial":
      return paint.stops[0]?.color ?? null;
    case "none":
      return null;
  }
};

const paintHex = (paint: Paint, fallback = "#000000"): string => {
  const color = paintColor(paint);
  return color ? rgbaToHex(color) : fallback;
};

const paintLabel = (paint: Paint): string => {
  switch (paint.type) {
    case "solid":
      return rgbaToHex(paint.color);
    case "none":
      return "None";
    case "linear":
      return "Linear gradient";
    case "radial":
      return "Radial gradient";
  }
};

const parseFillType = (value: string): FillType | null => {
  const fillType = value as FillType;
  return FILL_TYPES.includes(fillType) ? fillType : null;
};

const parseBlendMode = (value: string): GlobalCompositeOperation | null => {
  const blendMode = value as GlobalCompositeOperation;
  return BLEND_MODES.some((mode) => mode.value === blendMode) ? blendMode : null;
};

const defaultGradientStops = (sourceColor: RGBA | null): GradientStop[] => {
  const baseColor = cloneRgba(sourceColor ?? DEFAULT_COLOR);

  return [
    { offset: 0, color: baseColor },
    { offset: 1, color: { ...baseColor, a: 0 } },
  ];
};

const normalizeGradientStops = (stops: readonly GradientStop[]): GradientStop[] => {
  if (stops.length === 0) {
    return defaultGradientStops(null);
  }

  const normalizedStops = stops
    .map((stop) => ({
      offset: clamp(stop.offset, 0, 1),
      color: cloneRgba(stop.color),
    }))
    .sort((a, b) => a.offset - b.offset);

  if (normalizedStops.length === 1) {
    const stop = normalizedStops[0];
    const companionOffset = stop.offset <= 0.5 ? 1 : 0;
    normalizedStops.push({
      offset: companionOffset,
      color: { ...stop.color, a: 0 },
    });
    normalizedStops.sort((a, b) => a.offset - b.offset);
  }

  return normalizedStops;
};

const cloneGradient = (gradient: GradientPaint): GradientPaint => {
  if (gradient.type === "linear") {
    return {
      type: "linear",
      stops: normalizeGradientStops(gradient.stops),
      start: { ...gradient.start },
      end: { ...gradient.end },
    };
  }

  return {
    type: "radial",
    stops: normalizeGradientStops(gradient.stops),
    center: { ...gradient.center },
    radius: clamp(gradient.radius, 0, 1),
  };
};

const gradientWithStops = (gradient: GradientPaint, stops: readonly GradientStop[]): GradientPaint => {
  const normalizedStops = normalizeGradientStops(stops);

  if (gradient.type === "linear") {
    return {
      type: "linear",
      stops: normalizedStops,
      start: { ...gradient.start },
      end: { ...gradient.end },
    };
  }

  return {
    type: "radial",
    stops: normalizedStops,
    center: { ...gradient.center },
    radius: clamp(gradient.radius, 0, 1),
  };
};

const paintForFillType = (fillType: FillType, currentFill: Paint): Paint => {
  const primaryColor = primaryPaintColor(currentFill);
  const stops =
    currentFill.type === "linear" || currentFill.type === "radial"
      ? normalizeGradientStops(currentFill.stops)
      : defaultGradientStops(primaryColor);

  switch (fillType) {
    case "none":
      return { type: "none" };
    case "solid":
      return {
        type: "solid",
        color: cloneRgba(primaryColor ?? DEFAULT_COLOR),
      };
    case "linear":
      return {
        type: "linear",
        stops,
        start: { x: 0, y: 0 },
        end: { x: 1, y: 0 },
      };
    case "radial":
      return {
        type: "radial",
        stops,
        center: { x: 0.5, y: 0.5 },
        radius: 0.5,
      };
  }
};

const blendRgba = (from: RGBA, to: RGBA, amount: number): RGBA => ({
  r: from.r + (to.r - from.r) * amount,
  g: from.g + (to.g - from.g) * amount,
  b: from.b + (to.b - from.b) * amount,
  a: from.a + (to.a - from.a) * amount,
});

const newStopForGap = (stops: readonly GradientStop[]): GradientStop => {
  const normalizedStops = normalizeGradientStops(stops);
  let gapStart = normalizedStops[0];
  let gapEnd = normalizedStops[normalizedStops.length - 1];
  let largestGap = -1;

  for (let index = 1; index < normalizedStops.length; index += 1) {
    const previousStop = normalizedStops[index - 1];
    const currentStop = normalizedStops[index];
    const gap = currentStop.offset - previousStop.offset;

    if (gap > largestGap) {
      largestGap = gap;
      gapStart = previousStop;
      gapEnd = currentStop;
    }
  }

  const offset = largestGap > 0 ? gapStart.offset + largestGap / 2 : 0.5;
  const amount = largestGap > 0 ? 0.5 : 0;

  return {
    offset: clamp(offset, 0, 1),
    color: cloneRgba(blendRgba(gapStart.color, gapEnd.color, amount)),
  };
};

const formatNumber = (value: number): string =>
  Number.isFinite(value) ? value.toFixed(1) : "-";

const readNumber = (value: number): number | null =>
  Number.isFinite(value) ? value : null;

const formatDashPattern = (dash: readonly number[]): string => dash.join(", ");

const parseDashPattern = (value: string): number[] => {
  const trimmedValue = value.trim();
  if (trimmedValue === "") {
    return [];
  }

  const parts = trimmedValue.split(/[\s,]+/).filter(Boolean);
  const dash = parts.map((part) => Number(part));

  return dash.every((part) => Number.isFinite(part) && part >= 0) ? dash : [];
};

interface CommitNumberInputProps {
  readonly ariaLabel: string;
  readonly disabled?: boolean;
  readonly min?: number;
  readonly onCommit: (value: number) => void;
  readonly value: number | null;
}

function CommitNumberInput({
  ariaLabel,
  disabled = false,
  min,
  onCommit,
  value,
}: CommitNumberInputProps) {
  const formattedValue = value === null ? "" : formatNumber(value);
  const [draft, setDraft] = useState(formattedValue);

  useEffect(() => {
    setDraft(formattedValue);
  }, [formattedValue]);

  const commitDraft = (): void => {
    const trimmedDraft = draft.trim();
    if (trimmedDraft === "") {
      setDraft(formattedValue);
      return;
    }

    const parsedValue = Number(trimmedDraft);
    if (!Number.isFinite(parsedValue)) {
      setDraft(formattedValue);
      return;
    }

    onCommit(parsedValue);
    setDraft(formattedValue);
  };

  const commitOnEnter = (event: ReactKeyboardEvent<HTMLInputElement>): void => {
    if (event.key === "Enter") {
      event.currentTarget.blur();
    }
  };

  return (
    <input
      aria-label={ariaLabel}
      className="properties-panel__number"
      disabled={disabled}
      min={min}
      onBlur={commitDraft}
      onChange={(event) => setDraft(event.currentTarget.value)}
      onKeyDown={commitOnEnter}
      step={1}
      type="number"
      value={draft}
    />
  );
}

interface CommitTextInputProps {
  readonly ariaLabel: string;
  readonly className?: string;
  readonly onCommit: (value: string) => void;
  readonly value: string;
}

function CommitTextInput({
  ariaLabel,
  className = "properties-panel__number",
  onCommit,
  value,
}: CommitTextInputProps) {
  const [draft, setDraft] = useState(value);

  useEffect(() => {
    setDraft(value);
  }, [value]);

  const commitDraft = (): void => {
    onCommit(draft);
  };

  const commitOnEnter = (event: ReactKeyboardEvent<HTMLInputElement>): void => {
    if (event.key === "Enter") {
      event.currentTarget.blur();
    }
  };

  return (
    <input
      aria-label={ariaLabel}
      className={className}
      onBlur={commitDraft}
      onChange={(event) => setDraft(event.currentTarget.value)}
      onKeyDown={commitOnEnter}
      type="text"
      value={draft}
    />
  );
}

export function PropertiesPanel() {
  const doc = useEditorStore((state) => state.doc);
  const selection = useEditorStore((state) => state.selection);
  const updateNode = useEditorStore((state) => state.updateNode);
  const setSelectionPosition = useEditorStore((state) => state.setSelectionPosition);
  const setSelectionSize = useEditorStore((state) => state.setSelectionSize);
  const rotateSelectionBy = useEditorStore((state) => state.rotateSelectionBy);
  const selectedNodes = getSelectedNodes({ doc, selection });

  if (selectedNodes.length === 0) {
    return (
      <aside className="properties-panel" aria-label="Properties">
        <header className="properties-panel__header">
          <h2>Properties</h2>
        </header>
        <div className="properties-panel__empty">No selection</div>
      </aside>
    );
  }

  const bounds = selectionBounds(doc, selection);
  const boundsAreEmpty = isEmpty(bounds);
  const boundsWidth = bboxWidth(bounds);
  const boundsHeight = bboxHeight(bounds);
  const singleSelectionRotationDeg =
    !boundsAreEmpty && selectedNodes.length === 1
      ? (nodeRotationAngle(selectedNodes[0]) * 180) / Math.PI
      : null;

  const commitSelectionX = (x: number): void => {
    if (boundsAreEmpty) {
      return;
    }

    setSelectionPosition(x, bounds.minY);
  };

  const commitSelectionY = (y: number): void => {
    if (boundsAreEmpty) {
      return;
    }

    setSelectionPosition(bounds.minX, y);
  };

  const commitSelectionWidth = (width: number): void => {
    if (boundsAreEmpty) {
      return;
    }

    setSelectionSize(width, boundsHeight);
  };

  const commitSelectionHeight = (height: number): void => {
    if (boundsAreEmpty) {
      return;
    }

    setSelectionSize(boundsWidth, height);
  };

  const commitSelectionRotation = (targetDeg: number): void => {
    if (singleSelectionRotationDeg === null) {
      return;
    }

    rotateSelectionBy(((targetDeg - singleSelectionRotationDeg) * Math.PI) / 180);
  };

  const geometrySection = (
    <section className="properties-panel__section" aria-label="Geometry">
      <h3>Geometry</h3>
      <div className="properties-panel__grid">
        <label className="properties-panel__field">
          <span className="properties-panel__label">X</span>
          <CommitNumberInput
            ariaLabel="Selection X position"
            disabled={boundsAreEmpty}
            onCommit={commitSelectionX}
            value={boundsAreEmpty ? null : bounds.minX}
          />
        </label>
        <label className="properties-panel__field">
          <span className="properties-panel__label">Y</span>
          <CommitNumberInput
            ariaLabel="Selection Y position"
            disabled={boundsAreEmpty}
            onCommit={commitSelectionY}
            value={boundsAreEmpty ? null : bounds.minY}
          />
        </label>
        <label className="properties-panel__field">
          <span className="properties-panel__label">W</span>
          <CommitNumberInput
            ariaLabel="Selection width"
            disabled={boundsAreEmpty}
            min={0}
            onCommit={commitSelectionWidth}
            value={boundsAreEmpty ? null : boundsWidth}
          />
        </label>
        <label className="properties-panel__field">
          <span className="properties-panel__label">H</span>
          <CommitNumberInput
            ariaLabel="Selection height"
            disabled={boundsAreEmpty}
            min={0}
            onCommit={commitSelectionHeight}
            value={boundsAreEmpty ? null : boundsHeight}
          />
        </label>
        <label className="properties-panel__field">
          <span className="properties-panel__label">R</span>
          <CommitNumberInput
            ariaLabel="Selection rotation degrees"
            disabled={singleSelectionRotationDeg === null}
            onCommit={commitSelectionRotation}
            value={singleSelectionRotationDeg}
          />
        </label>
      </div>
    </section>
  );

  if (selectedNodes.length > 1) {
    const sharedOpacity = selectedNodes.every((node) => node.opacity === selectedNodes[0].opacity)
      ? Math.round(selectedNodes[0].opacity * 100)
      : null;

    return (
      <aside className="properties-panel" aria-label="Properties">
        <header className="properties-panel__header">
          <h2>Properties</h2>
        </header>
        <section className="properties-panel__section">
          <div className="properties-panel__selection-count">{selectedNodes.length} objects selected</div>
          <div className="properties-panel__row">
            <span className="properties-panel__label">Opacity</span>
            <span className="properties-panel__readout">
              {sharedOpacity === null ? "Mixed" : `${sharedOpacity}%`}
            </span>
          </div>
        </section>
        {geometrySection}
      </aside>
    );
  }

  const node = selectedNodes[0];
  const opacityPercent = Math.round(clamp(node.opacity, 0, 1) * 100);
  const blendMode =
    parseBlendMode("blendMode" in node ? String(node.blendMode) : "") ?? "source-over";

  const setOpacity = (value: number): void => {
    const nextOpacity = readNumber(value);
    if (nextOpacity === null) {
      return;
    }

    updateNode(node.id, { opacity: clamp(nextOpacity, 0, 100) / 100 });
  };

  const setBlendMode = (value: string): void => {
    const nextBlendMode = parseBlendMode(value);
    if (nextBlendMode === null) {
      return;
    }

    updateNode(node.id, { blendMode: nextBlendMode });
  };

  const setFillType = (fillType: FillType): void => {
    if (!hasStyle(node)) {
      return;
    }

    updateNode(node.id, { fill: paintForFillType(fillType, node.fill) });
  };

  const setFill = (hex: string): void => {
    if (!hasStyle(node)) {
      return;
    }

    updateNode(node.id, {
      fill: {
        type: "solid",
        color: hexToRgba(hex, paintColor(node.fill)?.a ?? 1),
      },
    });
  };

  const setSolidFillAlpha = (value: number): void => {
    const nextAlpha = readNumber(value);
    if (!hasStyle(node) || node.fill.type !== "solid" || nextAlpha === null) {
      return;
    }

    updateNode(node.id, {
      fill: {
        type: "solid",
        color: {
          ...node.fill.color,
          a: clamp(nextAlpha, 0, 1),
        },
      },
    });
  };

  const updateGradientPaint = (target: PaintTarget, gradient: GradientPaint): void => {
    if (!hasStyle(node)) {
      return;
    }

    if (target.kind === "fill") {
      updateNode(node.id, { fill: cloneGradient(gradient) });
      return;
    }

    updateNode(node.id, {
      stroke: {
        ...target.stroke,
        paint: cloneGradient(gradient),
      },
    });
  };

  const setGradientStopOffset = (
    target: PaintTarget,
    gradient: GradientPaint,
    stopIndex: number,
    value: number,
  ): void => {
    const nextOffset = readNumber(value);
    if (nextOffset === null) {
      return;
    }

    const stops = normalizeGradientStops(gradient.stops).map((stop, index) =>
      index === stopIndex ? { ...stop, offset: clamp(nextOffset, 0, 1) } : stop,
    );

    updateGradientPaint(target, gradientWithStops(gradient, stops));
  };

  const setGradientStopColor = (
    target: PaintTarget,
    gradient: GradientPaint,
    stopIndex: number,
    hex: string,
  ): void => {
    const stops = normalizeGradientStops(gradient.stops).map((stop, index) =>
      index === stopIndex ? { ...stop, color: hexToRgba(hex, stop.color.a) } : stop,
    );

    updateGradientPaint(target, gradientWithStops(gradient, stops));
  };

  const setGradientStopAlpha = (
    target: PaintTarget,
    gradient: GradientPaint,
    stopIndex: number,
    value: number,
  ): void => {
    const nextAlpha = readNumber(value);
    if (nextAlpha === null) {
      return;
    }

    const stops = normalizeGradientStops(gradient.stops).map((stop, index) =>
      index === stopIndex
        ? {
            ...stop,
            color: {
              ...stop.color,
              a: clamp(nextAlpha, 0, 1),
            },
          }
        : stop,
    );

    updateGradientPaint(target, gradientWithStops(gradient, stops));
  };

  const addGradientStop = (target: PaintTarget, gradient: GradientPaint): void => {
    updateGradientPaint(
      target,
      gradientWithStops(gradient, [...gradient.stops, newStopForGap(gradient.stops)]),
    );
  };

  const removeGradientStop = (
    target: PaintTarget,
    gradient: GradientPaint,
    stopIndex: number,
  ): void => {
    const stops = normalizeGradientStops(gradient.stops);
    if (stops.length <= 2) {
      return;
    }

    updateGradientPaint(
      target,
      gradientWithStops(gradient, stops.filter((_, index) => index !== stopIndex)),
    );
  };

  const setLinearPoint = (
    target: PaintTarget,
    gradient: LinearGradient,
    point: "start" | "end",
    axis: "x" | "y",
    value: number,
  ): void => {
    const nextValue = readNumber(value);
    if (nextValue === null) {
      return;
    }

    updateGradientPaint(target, {
      type: "linear",
      stops: normalizeGradientStops(gradient.stops),
      start: {
        ...gradient.start,
        [axis]: point === "start" ? clamp(nextValue, 0, 1) : gradient.start[axis],
      },
      end: {
        ...gradient.end,
        [axis]: point === "end" ? clamp(nextValue, 0, 1) : gradient.end[axis],
      },
    });
  };

  const setRadialValue = (
    target: PaintTarget,
    gradient: RadialGradient,
    valueKey: "center-x" | "center-y" | "radius",
    value: number,
  ): void => {
    const nextValue = readNumber(value);
    if (nextValue === null) {
      return;
    }

    const clampedValue = clamp(nextValue, 0, 1);

    updateGradientPaint(target, {
      type: "radial",
      stops: normalizeGradientStops(gradient.stops),
      center: {
        x: valueKey === "center-x" ? clampedValue : gradient.center.x,
        y: valueKey === "center-y" ? clampedValue : gradient.center.y,
      },
      radius: valueKey === "radius" ? clampedValue : clamp(gradient.radius, 0, 1),
    });
  };

  const setStrokeType = (stroke: Stroke | null, strokeType: FillType): void => {
    if (!hasStyle(node) || stroke === null) {
      return;
    }

    updateNode(node.id, {
      stroke: {
        ...stroke,
        paint: paintForFillType(strokeType, stroke.paint),
      },
    });
  };

  const setStrokePaint = (stroke: Stroke | null, hex: string): void => {
    if (!hasStyle(node) || stroke === null) {
      return;
    }

    updateNode(node.id, {
      stroke: {
        ...stroke,
        paint: {
          type: "solid",
          color: hexToRgba(hex, paintColor(stroke.paint)?.a ?? 1),
        },
      },
    });
  };

  const setStrokeWidth = (stroke: Stroke | null, value: number): void => {
    const nextWidth = readNumber(value);
    if (!hasStyle(node) || stroke === null || nextWidth === null) {
      return;
    }

    updateNode(node.id, {
      stroke: {
        ...stroke,
        width: Math.max(0, nextWidth),
      },
    });
  };

  const setStrokeCap = (stroke: Stroke, cap: LineCap): void => {
    if (!hasStyle(node)) {
      return;
    }

    updateNode(node.id, {
      stroke: {
        ...stroke,
        cap,
      },
    });
  };

  const setStrokeJoin = (stroke: Stroke, join: LineJoin): void => {
    if (!hasStyle(node)) {
      return;
    }

    updateNode(node.id, {
      stroke: {
        ...stroke,
        join,
      },
    });
  };

  const setStrokeDash = (stroke: Stroke, value: string): void => {
    if (!hasStyle(node)) {
      return;
    }

    updateNode(node.id, {
      stroke: {
        ...stroke,
        dash: parseDashPattern(value),
      },
    });
  };

  const setStrokeDashOffset = (stroke: Stroke, value: number): void => {
    const nextDashOffset = readNumber(value);
    if (!hasStyle(node) || nextDashOffset === null) {
      return;
    }

    updateNode(node.id, {
      stroke: {
        ...stroke,
        dashOffset: nextDashOffset,
      },
    });
  };

  const setStrokeMiterLimit = (stroke: Stroke, value: number): void => {
    const nextMiterLimit = readNumber(value);
    if (!hasStyle(node) || nextMiterLimit === null) {
      return;
    }

    updateNode(node.id, {
      stroke: {
        ...stroke,
        miterLimit: Math.max(1, nextMiterLimit),
      },
    });
  };

  const styledNode = hasStyle(node) ? node : null;
  const textNode = node.type === "text" ? node : null;
  const gradientFill =
    styledNode !== null && (styledNode.fill.type === "linear" || styledNode.fill.type === "radial")
      ? styledNode.fill
      : null;
  const stroke = styledNode?.stroke ?? null;
  const gradientStroke =
    stroke !== null && (stroke.paint.type === "linear" || stroke.paint.type === "radial")
      ? stroke.paint
      : null;

  const renderGradientEditor = (
    paintName: "Fill" | "Stroke",
    target: PaintTarget,
    gradient: GradientPaint,
  ) => {
    const scopedLabel = (label: string): string =>
      paintName === "Fill" ? label : `${paintName} ${label.charAt(0).toLowerCase()}${label.slice(1)}`;

    return (
      <div
        className="properties-panel__gradient-editor"
        aria-label={`${paintName} gradient stops`}
      >
        <div className="properties-panel__subhead">Stops</div>
        {normalizeGradientStops(gradient.stops).map((stop, index, stops) => (
          <div className="properties-panel__stop" key={`${index}-${stop.offset}`}>
            <span className="properties-panel__stop-index">{index + 1}</span>
            <input
              aria-label={scopedLabel(`Stop ${index + 1} offset`)}
              className="properties-panel__range"
              max={1}
              min={0}
              onChange={(event) =>
                setGradientStopOffset(target, gradient, index, event.currentTarget.valueAsNumber)
              }
              step={0.01}
              type="range"
              value={formatUnitNumber(stop.offset)}
            />
            <input
              aria-label={scopedLabel(`Stop ${index + 1} offset value`)}
              className="properties-panel__number properties-panel__number--compact"
              max={1}
              min={0}
              onChange={(event) =>
                setGradientStopOffset(target, gradient, index, event.currentTarget.valueAsNumber)
              }
              step={0.01}
              type="number"
              value={formatUnitNumber(stop.offset)}
            />
            <input
              aria-label={scopedLabel(`Stop ${index + 1} color`)}
              className="properties-panel__color"
              onChange={(event) =>
                setGradientStopColor(target, gradient, index, event.currentTarget.value)
              }
              type="color"
              value={rgbaToHex(stop.color)}
            />
            <input
              aria-label={scopedLabel(`Stop ${index + 1} alpha`)}
              className="properties-panel__number properties-panel__number--compact"
              max={1}
              min={0}
              onChange={(event) =>
                setGradientStopAlpha(target, gradient, index, event.currentTarget.valueAsNumber)
              }
              step={0.01}
              type="number"
              value={formatUnitNumber(stop.color.a)}
            />
            <button
              aria-label={scopedLabel(`Remove stop ${index + 1}`)}
              className="properties-panel__button properties-panel__button--icon"
              disabled={stops.length <= 2}
              onClick={() => removeGradientStop(target, gradient, index)}
              type="button"
            >
              -
            </button>
          </div>
        ))}
        <button
          className="properties-panel__button"
          onClick={() => addGradientStop(target, gradient)}
          type="button"
        >
          Add Stop
        </button>

        {gradient.type === "linear" ? (
          <div
            className="properties-panel__gradient-geometry"
            aria-label={scopedLabel("Linear gradient direction")}
          >
            <div className="properties-panel__subhead">Direction</div>
            <div className="properties-panel__grid">
              <label className="properties-panel__field">
                <span className="properties-panel__label">SX</span>
                <input
                  aria-label={scopedLabel("Linear gradient start x")}
                  className="properties-panel__number"
                  max={1}
                  min={0}
                  onChange={(event) =>
                    setLinearPoint(target, gradient, "start", "x", event.currentTarget.valueAsNumber)
                  }
                  step={0.05}
                  type="number"
                  value={formatUnitNumber(gradient.start.x)}
                />
              </label>
              <label className="properties-panel__field">
                <span className="properties-panel__label">SY</span>
                <input
                  aria-label={scopedLabel("Linear gradient start y")}
                  className="properties-panel__number"
                  max={1}
                  min={0}
                  onChange={(event) =>
                    setLinearPoint(target, gradient, "start", "y", event.currentTarget.valueAsNumber)
                  }
                  step={0.05}
                  type="number"
                  value={formatUnitNumber(gradient.start.y)}
                />
              </label>
              <label className="properties-panel__field">
                <span className="properties-panel__label">EX</span>
                <input
                  aria-label={scopedLabel("Linear gradient end x")}
                  className="properties-panel__number"
                  max={1}
                  min={0}
                  onChange={(event) =>
                    setLinearPoint(target, gradient, "end", "x", event.currentTarget.valueAsNumber)
                  }
                  step={0.05}
                  type="number"
                  value={formatUnitNumber(gradient.end.x)}
                />
              </label>
              <label className="properties-panel__field">
                <span className="properties-panel__label">EY</span>
                <input
                  aria-label={scopedLabel("Linear gradient end y")}
                  className="properties-panel__number"
                  max={1}
                  min={0}
                  onChange={(event) =>
                    setLinearPoint(target, gradient, "end", "y", event.currentTarget.valueAsNumber)
                  }
                  step={0.05}
                  type="number"
                  value={formatUnitNumber(gradient.end.y)}
                />
              </label>
            </div>
          </div>
        ) : (
          <div
            className="properties-panel__gradient-geometry"
            aria-label={scopedLabel("Radial gradient shape")}
          >
            <div className="properties-panel__subhead">Radial</div>
            <div className="properties-panel__grid">
              <label className="properties-panel__field">
                <span className="properties-panel__label">CX</span>
                <input
                  aria-label={scopedLabel("Radial gradient center x")}
                  className="properties-panel__number"
                  max={1}
                  min={0}
                  onChange={(event) =>
                    setRadialValue(target, gradient, "center-x", event.currentTarget.valueAsNumber)
                  }
                  step={0.05}
                  type="number"
                  value={formatUnitNumber(gradient.center.x)}
                />
              </label>
              <label className="properties-panel__field">
                <span className="properties-panel__label">CY</span>
                <input
                  aria-label={scopedLabel("Radial gradient center y")}
                  className="properties-panel__number"
                  max={1}
                  min={0}
                  onChange={(event) =>
                    setRadialValue(target, gradient, "center-y", event.currentTarget.valueAsNumber)
                  }
                  step={0.05}
                  type="number"
                  value={formatUnitNumber(gradient.center.y)}
                />
              </label>
              <label className="properties-panel__field">
                <span className="properties-panel__label">R</span>
                <input
                  aria-label={scopedLabel("Radial gradient radius")}
                  className="properties-panel__number"
                  max={1}
                  min={0}
                  onChange={(event) =>
                    setRadialValue(target, gradient, "radius", event.currentTarget.valueAsNumber)
                  }
                  step={0.05}
                  type="number"
                  value={formatUnitNumber(gradient.radius)}
                />
              </label>
            </div>
          </div>
        )}
      </div>
    );
  };

  return (
    <aside className="properties-panel" aria-label="Properties">
      <header className="properties-panel__header">
        <h2>Properties</h2>
        <span className="properties-panel__node-type">{node.type}</span>
      </header>

      <section className="properties-panel__section" aria-label="Appearance">
        <h3>Appearance</h3>
        <label className="properties-panel__row properties-panel__row--stacked">
          <span className="properties-panel__label">Opacity</span>
          <span className="properties-panel__opacity-controls">
            <input
              aria-label="Opacity"
              className="properties-panel__range"
              max={100}
              min={0}
              onChange={(event) => setOpacity(event.currentTarget.valueAsNumber)}
              type="range"
              value={opacityPercent}
            />
            <input
              aria-label="Opacity percent"
              className="properties-panel__number properties-panel__number--compact"
              max={100}
              min={0}
              onChange={(event) => setOpacity(event.currentTarget.valueAsNumber)}
              type="number"
              value={opacityPercent}
            />
          </span>
        </label>

        <label className="properties-panel__row">
          <span className="properties-panel__label">Blend mode</span>
          <select
            aria-label="Blend mode"
            className="properties-panel__select"
            onChange={(event) => setBlendMode(event.currentTarget.value)}
            value={blendMode}
          >
            {BLEND_MODES.map((mode) => (
              <option key={mode.value} value={mode.value}>
                {mode.label}
              </option>
            ))}
          </select>
        </label>

        {styledNode !== null ? (
          <>
            <label className="properties-panel__row">
              <span className="properties-panel__label">Fill type</span>
              <select
                aria-label="Fill type"
                className="properties-panel__select"
                onChange={(event) => {
                  const fillType = parseFillType(event.currentTarget.value);
                  if (fillType !== null) {
                    setFillType(fillType);
                  }
                }}
                value={styledNode.fill.type}
              >
                {FILL_TYPES.map((fillType) => (
                  <option key={fillType} value={fillType}>
                    {FILL_TYPE_LABELS[fillType]}
                  </option>
                ))}
              </select>
            </label>

            {styledNode.fill.type === "solid" ? (
              <label className="properties-panel__row">
                <span className="properties-panel__label">Fill</span>
                <span className="properties-panel__paint-control">
                  <input
                    aria-label="Fill color"
                    className="properties-panel__color"
                    onChange={(event) => setFill(event.currentTarget.value)}
                    type="color"
                    value={paintHex(styledNode.fill, "#000000")}
                  />
                  <input
                    aria-label="Fill alpha"
                    className="properties-panel__number properties-panel__number--compact"
                    max={1}
                    min={0}
                    onChange={(event) => setSolidFillAlpha(event.currentTarget.valueAsNumber)}
                    step={0.01}
                    type="number"
                    value={formatUnitNumber(styledNode.fill.color.a)}
                  />
                </span>
              </label>
            ) : (
              <div className="properties-panel__row">
                <span className="properties-panel__label">Fill</span>
                <span className="properties-panel__readout">{paintLabel(styledNode.fill)}</span>
              </div>
            )}

            {gradientFill !== null
              ? renderGradientEditor("Fill", { kind: "fill" }, gradientFill)
              : null}

            <label className="properties-panel__row">
              <span className="properties-panel__label">Stroke type</span>
              <select
                aria-label="Stroke type"
                className="properties-panel__select"
                disabled={stroke === null}
                onChange={(event) => {
                  const strokeType = parseFillType(event.currentTarget.value);
                  if (strokeType !== null) {
                    setStrokeType(stroke, strokeType);
                  }
                }}
                value={stroke?.paint.type ?? "none"}
              >
                {FILL_TYPES.map((strokeType) => (
                  <option key={strokeType} value={strokeType}>
                    {FILL_TYPE_LABELS[strokeType]}
                  </option>
                ))}
              </select>
            </label>

            {stroke?.paint.type === "solid" ? (
              <label className="properties-panel__row">
                <span className="properties-panel__label">Stroke</span>
                <span className="properties-panel__paint-control">
                  <input
                    aria-label="Stroke color"
                    className="properties-panel__color"
                    onChange={(event) => setStrokePaint(stroke, event.currentTarget.value)}
                    type="color"
                    value={paintHex(stroke.paint)}
                  />
                  <span className="properties-panel__readout">{paintLabel(stroke.paint)}</span>
                </span>
              </label>
            ) : (
              <div className="properties-panel__row">
                <span className="properties-panel__label">Stroke</span>
                <span className="properties-panel__readout">
                  {stroke ? paintLabel(stroke.paint) : "No stroke"}
                </span>
              </div>
            )}

            {stroke !== null && gradientStroke !== null
              ? renderGradientEditor("Stroke", { kind: "stroke", stroke }, gradientStroke)
              : null}

            <label className="properties-panel__row">
              <span className="properties-panel__label">Stroke width</span>
              <input
                aria-label="Stroke width"
                className="properties-panel__number"
                disabled={stroke === null}
                min={0}
                onChange={(event) => setStrokeWidth(stroke, event.currentTarget.valueAsNumber)}
                step={0.5}
                type="number"
                value={stroke?.width ?? 0}
              />
            </label>

            {stroke !== null ? (
              <>
                <label className="properties-panel__row">
                  <span className="properties-panel__label">Cap</span>
                  <select
                    aria-label="Stroke cap"
                    className="properties-panel__select"
                    onChange={(event) =>
                      setStrokeCap(stroke, event.currentTarget.value as LineCap)
                    }
                    value={stroke.cap}
                  >
                    {LINE_CAPS.map((cap) => (
                      <option key={cap} value={cap}>
                        {cap}
                      </option>
                    ))}
                  </select>
                </label>

                <label className="properties-panel__row">
                  <span className="properties-panel__label">Join</span>
                  <select
                    aria-label="Stroke join"
                    className="properties-panel__select"
                    onChange={(event) =>
                      setStrokeJoin(stroke, event.currentTarget.value as LineJoin)
                    }
                    value={stroke.join}
                  >
                    {LINE_JOINS.map((join) => (
                      <option key={join} value={join}>
                        {join}
                      </option>
                    ))}
                  </select>
                </label>

                <label className="properties-panel__row">
                  <span className="properties-panel__label">Dash</span>
                  <CommitTextInput
                    ariaLabel="Stroke dash pattern"
                    className="properties-panel__number properties-panel__dash-input"
                    onCommit={(value) => setStrokeDash(stroke, value)}
                    value={formatDashPattern(stroke.dash)}
                  />
                </label>

                <label className="properties-panel__row">
                  <span className="properties-panel__label">Dash offset</span>
                  <CommitNumberInput
                    ariaLabel="Stroke dash offset"
                    onCommit={(value) => setStrokeDashOffset(stroke, value)}
                    value={stroke.dashOffset}
                  />
                </label>

                <label className="properties-panel__row">
                  <span className="properties-panel__label">Miter limit</span>
                  <CommitNumberInput
                    ariaLabel="Stroke miter limit"
                    min={1}
                    onCommit={(value) => setStrokeMiterLimit(stroke, value)}
                    value={stroke.miterLimit}
                  />
                </label>
              </>
            ) : null}
          </>
        ) : null}
      </section>

      {textNode !== null ? (
        <section className="properties-panel__section" aria-label="Text">
          <h3>Text</h3>
          <label className="properties-panel__row properties-panel__row--stacked">
            <span className="properties-panel__label">Content</span>
            <CommitTextInput
              ariaLabel="Text content"
              className="properties-panel__text-input properties-panel__text-input--wide"
              onCommit={(value) => updateNode(textNode.id, { text: value })}
              value={textNode.text}
            />
          </label>

          <label className="properties-panel__row">
            <span className="properties-panel__label">Font family</span>
            <CommitTextInput
              ariaLabel="Font family"
              className="properties-panel__text-input"
              onCommit={(value) => updateNode(textNode.id, { fontFamily: value })}
              value={textNode.fontFamily}
            />
          </label>

          <label className="properties-panel__row">
            <span className="properties-panel__label">Font size</span>
            <CommitNumberInput
              ariaLabel="Font size"
              min={1}
              onCommit={(value) => updateNode(textNode.id, { fontSize: Math.max(1, value) })}
              value={textNode.fontSize}
            />
          </label>

          <label className="properties-panel__row">
            <span className="properties-panel__label">Font weight</span>
            <CommitNumberInput
              ariaLabel="Font weight"
              min={1}
              onCommit={(value) => updateNode(textNode.id, { fontWeight: Math.max(1, value) })}
              value={textNode.fontWeight}
            />
          </label>

          <label className="properties-panel__row">
            <span className="properties-panel__label">Font style</span>
            <select
              aria-label="Font style"
              className="properties-panel__select"
              onChange={(event) =>
                updateNode(textNode.id, {
                  fontStyle: event.currentTarget.value as "normal" | "italic",
                })
              }
              value={textNode.fontStyle}
            >
              <option value="normal">Normal</option>
              <option value="italic">Italic</option>
            </select>
          </label>

          <label className="properties-panel__row">
            <span className="properties-panel__label">Text align</span>
            <select
              aria-label="Text align"
              className="properties-panel__select"
              onChange={(event) =>
                updateNode(textNode.id, {
                  textAlign: event.currentTarget.value as "left" | "center" | "right",
                })
              }
              value={textNode.textAlign}
            >
              <option value="left">Left</option>
              <option value="center">Center</option>
              <option value="right">Right</option>
            </select>
          </label>

          <label className="properties-panel__row">
            <span className="properties-panel__label">Letter spacing</span>
            <CommitNumberInput
              ariaLabel="Letter spacing"
              onCommit={(value) => updateNode(textNode.id, { letterSpacing: value })}
              value={textNode.letterSpacing}
            />
          </label>
        </section>
      ) : null}

      {geometrySection}
    </aside>
  );
}
