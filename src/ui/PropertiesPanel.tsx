import { isEmpty, width as bboxWidth, height as bboxHeight } from "../core/geometry/bbox";
import { worldBounds } from "../core/model/bounds";
import { hasStyle, type Paint, type RGBA, type Stroke } from "../core/model/types";
import { getSelectedNodes } from "../state/selectors";
import { useEditorStore } from "../state/store";
import "./PropertiesPanel.css";

const clamp = (value: number, min: number, max: number): number =>
  Math.min(max, Math.max(min, value));

const toHexByte = (value: number): string =>
  clamp(Math.round(value), 0, 255).toString(16).padStart(2, "0");

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

const paintColor = (paint: Paint): RGBA | null =>
  paint.type === "solid" ? paint.color : null;

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

const formatNumber = (value: number): string =>
  Number.isFinite(value) ? value.toFixed(1) : "-";

const readNumber = (value: number): number | null =>
  Number.isFinite(value) ? value : null;

export function PropertiesPanel() {
  const doc = useEditorStore((state) => state.doc);
  const selection = useEditorStore((state) => state.selection);
  const updateNode = useEditorStore((state) => state.updateNode);
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
      </aside>
    );
  }

  const node = selectedNodes[0];
  const bounds = worldBounds(doc, node.id);
  const boundsAreEmpty = isEmpty(bounds);
  const opacityPercent = Math.round(clamp(node.opacity, 0, 1) * 100);

  const setOpacity = (value: number): void => {
    const nextOpacity = readNumber(value);
    if (nextOpacity === null) {
      return;
    }

    updateNode(node.id, { opacity: clamp(nextOpacity, 0, 100) / 100 });
  };

  const setX = (value: number): void => {
    const nextX = readNumber(value);
    if (nextX === null) {
      return;
    }

    updateNode(node.id, { transform: { ...node.transform, e: nextX } });
  };

  const setY = (value: number): void => {
    const nextY = readNumber(value);
    if (nextY === null) {
      return;
    }

    updateNode(node.id, { transform: { ...node.transform, f: nextY } });
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

        {hasStyle(node) ? (
          <>
            <label className="properties-panel__row">
              <span className="properties-panel__label">Fill</span>
              <span className="properties-panel__paint-control">
                <input
                  aria-label="Fill color"
                  className="properties-panel__color"
                  onChange={(event) => setFill(event.currentTarget.value)}
                  type="color"
                  value={paintHex(node.fill, "#c8c8c8")}
                />
                <span className="properties-panel__readout">{paintLabel(node.fill)}</span>
              </span>
            </label>

            <label className="properties-panel__row">
              <span className="properties-panel__label">Stroke</span>
              <span className="properties-panel__paint-control">
                <input
                  aria-label="Stroke color"
                  className="properties-panel__color"
                  disabled={node.stroke === null}
                  onChange={(event) => setStrokePaint(node.stroke, event.currentTarget.value)}
                  type="color"
                  value={node.stroke ? paintHex(node.stroke.paint) : "#000000"}
                />
                <span className="properties-panel__readout">
                  {node.stroke ? paintLabel(node.stroke.paint) : "No stroke"}
                </span>
              </span>
            </label>

            <label className="properties-panel__row">
              <span className="properties-panel__label">Stroke width</span>
              <input
                aria-label="Stroke width"
                className="properties-panel__number"
                disabled={node.stroke === null}
                min={0}
                onChange={(event) => setStrokeWidth(node.stroke, event.currentTarget.valueAsNumber)}
                step={0.5}
                type="number"
                value={node.stroke?.width ?? 0}
              />
            </label>
          </>
        ) : null}
      </section>

      <section className="properties-panel__section" aria-label="Geometry">
        <h3>Geometry</h3>
        <div className="properties-panel__grid">
          <label className="properties-panel__field">
            <span className="properties-panel__label">X</span>
            <input
              aria-label="X position"
              className="properties-panel__number"
              onChange={(event) => setX(event.currentTarget.valueAsNumber)}
              step={1}
              type="number"
              value={node.transform.e}
            />
          </label>
          <label className="properties-panel__field">
            <span className="properties-panel__label">Y</span>
            <input
              aria-label="Y position"
              className="properties-panel__number"
              onChange={(event) => setY(event.currentTarget.valueAsNumber)}
              step={1}
              type="number"
              value={node.transform.f}
            />
          </label>
          <div className="properties-panel__field">
            <span className="properties-panel__label">W</span>
            <span className="properties-panel__metric">
              {boundsAreEmpty ? "-" : formatNumber(bboxWidth(bounds))}
            </span>
          </div>
          <div className="properties-panel__field">
            <span className="properties-panel__label">H</span>
            <span className="properties-panel__metric">
              {boundsAreEmpty ? "-" : formatNumber(bboxHeight(bounds))}
            </span>
          </div>
        </div>
      </section>
    </aside>
  );
}
