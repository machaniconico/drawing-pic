import { useEffect, useState, type KeyboardEvent as ReactKeyboardEvent } from "react";
import { isEmpty, width as bboxWidth, height as bboxHeight } from "../core/geometry/bbox";
import { selectionBounds } from "../core/model/bounds";
import {
  hasStyle,
  type GradientStop,
  type LinearGradient,
  type Paint,
  type RadialGradient,
  type RGBA,
  type Stroke,
} from "../core/model/types";
import { getSelectedNodes } from "../state/selectors";
import { useEditorStore } from "../state/store";
import "./PropertiesPanel.css";

type FillType = Paint["type"];
type GradientPaint = LinearGradient | RadialGradient;

const FILL_TYPES: readonly FillType[] = ["none", "solid", "linear", "radial"];

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

export function PropertiesPanel() {
  const doc = useEditorStore((state) => state.doc);
  const selection = useEditorStore((state) => state.selection);
  const updateNode = useEditorStore((state) => state.updateNode);
  const setSelectionPosition = useEditorStore((state) => state.setSelectionPosition);
  const setSelectionSize = useEditorStore((state) => state.setSelectionSize);
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

  const setOpacity = (value: number): void => {
    const nextOpacity = readNumber(value);
    if (nextOpacity === null) {
      return;
    }

    updateNode(node.id, { opacity: clamp(nextOpacity, 0, 100) / 100 });
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

  const updateGradientFill = (gradient: GradientPaint): void => {
    if (!hasStyle(node)) {
      return;
    }

    updateNode(node.id, { fill: cloneGradient(gradient) });
  };

  const setGradientStopOffset = (
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

    updateGradientFill(gradientWithStops(gradient, stops));
  };

  const setGradientStopColor = (
    gradient: GradientPaint,
    stopIndex: number,
    hex: string,
  ): void => {
    const stops = normalizeGradientStops(gradient.stops).map((stop, index) =>
      index === stopIndex ? { ...stop, color: hexToRgba(hex, stop.color.a) } : stop,
    );

    updateGradientFill(gradientWithStops(gradient, stops));
  };

  const setGradientStopAlpha = (
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

    updateGradientFill(gradientWithStops(gradient, stops));
  };

  const addGradientStop = (gradient: GradientPaint): void => {
    updateGradientFill(gradientWithStops(gradient, [...gradient.stops, newStopForGap(gradient.stops)]));
  };

  const removeGradientStop = (gradient: GradientPaint, stopIndex: number): void => {
    const stops = normalizeGradientStops(gradient.stops);
    if (stops.length <= 2) {
      return;
    }

    updateGradientFill(gradientWithStops(gradient, stops.filter((_, index) => index !== stopIndex)));
  };

  const setLinearPoint = (
    gradient: LinearGradient,
    point: "start" | "end",
    axis: "x" | "y",
    value: number,
  ): void => {
    const nextValue = readNumber(value);
    if (nextValue === null) {
      return;
    }

    updateGradientFill({
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
    gradient: RadialGradient,
    valueKey: "center-x" | "center-y" | "radius",
    value: number,
  ): void => {
    const nextValue = readNumber(value);
    if (nextValue === null) {
      return;
    }

    const clampedValue = clamp(nextValue, 0, 1);

    updateGradientFill({
      type: "radial",
      stops: normalizeGradientStops(gradient.stops),
      center: {
        x: valueKey === "center-x" ? clampedValue : gradient.center.x,
        y: valueKey === "center-y" ? clampedValue : gradient.center.y,
      },
      radius: valueKey === "radius" ? clampedValue : clamp(gradient.radius, 0, 1),
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

  const styledNode = hasStyle(node) ? node : null;
  const gradientFill =
    styledNode !== null && (styledNode.fill.type === "linear" || styledNode.fill.type === "radial")
      ? styledNode.fill
      : null;
  const linearFill = styledNode?.fill.type === "linear" ? styledNode.fill : null;
  const radialFill = styledNode?.fill.type === "radial" ? styledNode.fill : null;

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

            {gradientFill !== null ? (
              <div className="properties-panel__gradient-editor" aria-label="Fill gradient stops">
                <div className="properties-panel__subhead">Stops</div>
                {normalizeGradientStops(gradientFill.stops).map((stop, index, stops) => (
                  <div className="properties-panel__stop" key={`${index}-${stop.offset}`}>
                    <span className="properties-panel__stop-index">{index + 1}</span>
                    <input
                      aria-label={`Stop ${index + 1} offset`}
                      className="properties-panel__range"
                      max={1}
                      min={0}
                      onChange={(event) =>
                        setGradientStopOffset(gradientFill, index, event.currentTarget.valueAsNumber)
                      }
                      step={0.01}
                      type="range"
                      value={formatUnitNumber(stop.offset)}
                    />
                    <input
                      aria-label={`Stop ${index + 1} offset value`}
                      className="properties-panel__number properties-panel__number--compact"
                      max={1}
                      min={0}
                      onChange={(event) =>
                        setGradientStopOffset(gradientFill, index, event.currentTarget.valueAsNumber)
                      }
                      step={0.01}
                      type="number"
                      value={formatUnitNumber(stop.offset)}
                    />
                    <input
                      aria-label={`Stop ${index + 1} color`}
                      className="properties-panel__color"
                      onChange={(event) =>
                        setGradientStopColor(gradientFill, index, event.currentTarget.value)
                      }
                      type="color"
                      value={rgbaToHex(stop.color)}
                    />
                    <input
                      aria-label={`Stop ${index + 1} alpha`}
                      className="properties-panel__number properties-panel__number--compact"
                      max={1}
                      min={0}
                      onChange={(event) =>
                        setGradientStopAlpha(gradientFill, index, event.currentTarget.valueAsNumber)
                      }
                      step={0.01}
                      type="number"
                      value={formatUnitNumber(stop.color.a)}
                    />
                    <button
                      aria-label={`Remove stop ${index + 1}`}
                      className="properties-panel__button properties-panel__button--icon"
                      disabled={stops.length <= 2}
                      onClick={() => removeGradientStop(gradientFill, index)}
                      type="button"
                    >
                      -
                    </button>
                  </div>
                ))}
                <button
                  className="properties-panel__button"
                  onClick={() => addGradientStop(gradientFill)}
                  type="button"
                >
                  Add Stop
                </button>

                {linearFill !== null ? (
                  <div className="properties-panel__gradient-geometry" aria-label="Linear gradient direction">
                    <div className="properties-panel__subhead">Direction</div>
                    <div className="properties-panel__grid">
                      <label className="properties-panel__field">
                        <span className="properties-panel__label">SX</span>
                        <input
                          aria-label="Linear gradient start x"
                          className="properties-panel__number"
                          max={1}
                          min={0}
                          onChange={(event) =>
                            setLinearPoint(linearFill, "start", "x", event.currentTarget.valueAsNumber)
                          }
                          step={0.05}
                          type="number"
                          value={formatUnitNumber(linearFill.start.x)}
                        />
                      </label>
                      <label className="properties-panel__field">
                        <span className="properties-panel__label">SY</span>
                        <input
                          aria-label="Linear gradient start y"
                          className="properties-panel__number"
                          max={1}
                          min={0}
                          onChange={(event) =>
                            setLinearPoint(linearFill, "start", "y", event.currentTarget.valueAsNumber)
                          }
                          step={0.05}
                          type="number"
                          value={formatUnitNumber(linearFill.start.y)}
                        />
                      </label>
                      <label className="properties-panel__field">
                        <span className="properties-panel__label">EX</span>
                        <input
                          aria-label="Linear gradient end x"
                          className="properties-panel__number"
                          max={1}
                          min={0}
                          onChange={(event) =>
                            setLinearPoint(linearFill, "end", "x", event.currentTarget.valueAsNumber)
                          }
                          step={0.05}
                          type="number"
                          value={formatUnitNumber(linearFill.end.x)}
                        />
                      </label>
                      <label className="properties-panel__field">
                        <span className="properties-panel__label">EY</span>
                        <input
                          aria-label="Linear gradient end y"
                          className="properties-panel__number"
                          max={1}
                          min={0}
                          onChange={(event) =>
                            setLinearPoint(linearFill, "end", "y", event.currentTarget.valueAsNumber)
                          }
                          step={0.05}
                          type="number"
                          value={formatUnitNumber(linearFill.end.y)}
                        />
                      </label>
                    </div>
                  </div>
                ) : radialFill !== null ? (
                  <div className="properties-panel__gradient-geometry" aria-label="Radial gradient shape">
                    <div className="properties-panel__subhead">Radial</div>
                    <div className="properties-panel__grid">
                      <label className="properties-panel__field">
                        <span className="properties-panel__label">CX</span>
                        <input
                          aria-label="Radial gradient center x"
                          className="properties-panel__number"
                          max={1}
                          min={0}
                          onChange={(event) =>
                            setRadialValue(radialFill, "center-x", event.currentTarget.valueAsNumber)
                          }
                          step={0.05}
                          type="number"
                          value={formatUnitNumber(radialFill.center.x)}
                        />
                      </label>
                      <label className="properties-panel__field">
                        <span className="properties-panel__label">CY</span>
                        <input
                          aria-label="Radial gradient center y"
                          className="properties-panel__number"
                          max={1}
                          min={0}
                          onChange={(event) =>
                            setRadialValue(radialFill, "center-y", event.currentTarget.valueAsNumber)
                          }
                          step={0.05}
                          type="number"
                          value={formatUnitNumber(radialFill.center.y)}
                        />
                      </label>
                      <label className="properties-panel__field">
                        <span className="properties-panel__label">R</span>
                        <input
                          aria-label="Radial gradient radius"
                          className="properties-panel__number"
                          max={1}
                          min={0}
                          onChange={(event) =>
                            setRadialValue(radialFill, "radius", event.currentTarget.valueAsNumber)
                          }
                          step={0.05}
                          type="number"
                          value={formatUnitNumber(radialFill.radius)}
                        />
                      </label>
                    </div>
                  </div>
                ) : null}
              </div>
            ) : null}

            <label className="properties-panel__row">
              <span className="properties-panel__label">Stroke</span>
              <span className="properties-panel__paint-control">
                <input
                  aria-label="Stroke color"
                  className="properties-panel__color"
                  disabled={styledNode.stroke === null}
                  onChange={(event) => setStrokePaint(styledNode.stroke, event.currentTarget.value)}
                  type="color"
                  value={styledNode.stroke ? paintHex(styledNode.stroke.paint) : "#000000"}
                />
                <span className="properties-panel__readout">
                  {styledNode.stroke ? paintLabel(styledNode.stroke.paint) : "No stroke"}
                </span>
              </span>
            </label>

            <label className="properties-panel__row">
              <span className="properties-panel__label">Stroke width</span>
              <input
                aria-label="Stroke width"
                className="properties-panel__number"
                disabled={styledNode.stroke === null}
                min={0}
                onChange={(event) => setStrokeWidth(styledNode.stroke, event.currentTarget.valueAsNumber)}
                step={0.5}
                type="number"
                value={styledNode.stroke?.width ?? 0}
              />
            </label>
          </>
        ) : null}
      </section>

      {geometrySection}
    </aside>
  );
}
