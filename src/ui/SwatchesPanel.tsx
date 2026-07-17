import { hasStyle, type RGBA } from "../core/model/types";
import { useEditorStore } from "../state/store";
import "./SwatchesPanel.css";

const colorCss = (color: RGBA): string =>
  `rgba(${Math.round(color.r)}, ${Math.round(color.g)}, ${Math.round(color.b)}, ${color.a})`;

const colorLabel = (color: RGBA): string =>
  `R ${Math.round(color.r)}, G ${Math.round(color.g)}, B ${Math.round(color.b)}, ${Math.round(color.a * 100)}%`;

export function SwatchesPanel() {
  const swatches = useEditorStore((state) => state.swatches);
  const currentFill = useEditorStore((state) => {
    for (const id of state.selection) {
      const node = state.doc.nodes[id];
      if (!node) {
        continue;
      }

      return hasStyle(node) && node.fill.type === "solid" ? node.fill.color : null;
    }
    return null;
  });
  const hasStyleSelection = useEditorStore((state) =>
    state.selection.some((id) => {
      const node = state.doc.nodes[id];
      return node !== undefined && hasStyle(node);
    }),
  );
  const addSwatch = useEditorStore((state) => state.addSwatch);
  const removeSwatch = useEditorStore((state) => state.removeSwatch);
  const applySwatchToSelection = useEditorStore((state) => state.applySwatchToSelection);

  return (
    <div className="swatches-panel">
      <div className="swatches-panel__grid" role="list" aria-label="Saved colors">
        {swatches.map((swatch) => {
          const label = colorLabel(swatch.color);
          return (
            <div className="swatches-panel__item" role="listitem" key={swatch.id}>
              <button
                type="button"
                className="swatches-panel__swatch"
                onClick={() => applySwatchToSelection(swatch.id)}
                disabled={!hasStyleSelection}
                aria-label={`Apply swatch ${label}`}
                title={`Apply ${label}`}
              >
                <span
                  className="swatches-panel__color"
                  style={{ backgroundColor: colorCss(swatch.color) }}
                  aria-hidden="true"
                />
              </button>
              <button
                type="button"
                className="swatches-panel__remove"
                onClick={() => removeSwatch(swatch.id)}
                aria-label={`Delete swatch ${label}`}
                title="Delete swatch"
              >
                ×
              </button>
            </div>
          );
        })}

        <button
          type="button"
          className="swatches-panel__add"
          disabled={currentFill === null}
          onClick={() => currentFill && addSwatch(currentFill)}
          aria-label="Save current solid fill as a swatch"
          title={currentFill ? "Save current fill" : "Select an object with a solid fill"}
        >
          +
        </button>
      </div>
      {swatches.length === 0 && (
        <p className="swatches-panel__empty">Select a solid-filled object, then press +.</p>
      )}
    </div>
  );
}
