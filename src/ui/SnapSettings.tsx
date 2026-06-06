import type { ChangeEvent } from "react";
import { useEditorStore, type SnapTarget } from "../state/store";
import "./SnapSettings.css";

interface SnapTargetOption {
  target: SnapTarget;
  label: string;
  checked: boolean;
}

export function SnapSettings() {
  const snapSettings = useEditorStore((state) => state.snapSettings);
  const showGrid = useEditorStore((state) => state.showGrid);
  const setSnapEnabled = useEditorStore((state) => state.setSnapEnabled);
  const setSnapTarget = useEditorStore((state) => state.setSnapTarget);
  const setGridSize = useEditorStore((state) => state.setGridSize);
  const setShowGrid = useEditorStore((state) => state.setShowGrid);

  const snapTargets: SnapTargetOption[] = [
    { target: "objects", label: "Objects", checked: snapSettings.toObjects },
    { target: "guides", label: "Guides", checked: snapSettings.toGuides },
    { target: "grid", label: "Grid", checked: snapSettings.toGrid },
  ];

  const handleGridSizeChange = (event: ChangeEvent<HTMLInputElement>) => {
    setGridSize(event.currentTarget.valueAsNumber);
  };

  return (
    <div className="snap-settings" aria-label="Snap settings">
      <label className="snap-settings__row snap-settings__row--master">
        <input
          className="snap-settings__checkbox"
          type="checkbox"
          checked={snapSettings.enabled}
          onChange={(event) => setSnapEnabled(event.currentTarget.checked)}
        />
        <span className="snap-settings__label">Snap</span>
      </label>

      <fieldset className="snap-settings__fieldset" disabled={!snapSettings.enabled}>
        <legend className="snap-settings__legend">SNAP TO</legend>
        <div className="snap-settings__target-grid">
          {snapTargets.map((item) => (
            <label key={item.target} className="snap-settings__row snap-settings__row--target">
              <input
                className="snap-settings__checkbox"
                type="checkbox"
                checked={item.checked}
                onChange={(event) => setSnapTarget(item.target, event.currentTarget.checked)}
              />
              <span className="snap-settings__label">{item.label}</span>
            </label>
          ))}
        </div>
      </fieldset>

      <label className="snap-settings__row snap-settings__row--grid-size">
        <span className="snap-settings__label">Grid size</span>
        <input
          className="snap-settings__number"
          type="number"
          min={1}
          step={1}
          value={snapSettings.gridSize}
          onChange={handleGridSizeChange}
        />
      </label>

      <label className="snap-settings__row">
        <input
          className="snap-settings__checkbox"
          type="checkbox"
          checked={showGrid}
          onChange={(event) => setShowGrid(event.currentTarget.checked)}
        />
        <span className="snap-settings__label">Show grid</span>
      </label>
    </div>
  );
}
