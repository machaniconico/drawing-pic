import { LayersPanel } from "./LayersPanel";
import { PropertiesPanel } from "./PropertiesPanel";
import "./RightPanel.css";

export function RightPanel() {
  return (
    <div className="right-panel" aria-label="Properties and layers">
      <section
        aria-labelledby="right-panel-properties-heading"
        className="right-panel__section right-panel__section--properties"
      >
        <header className="right-panel__header">
          <h2 id="right-panel-properties-heading">Properties</h2>
        </header>
        <div className="right-panel__content right-panel__content--properties">
          <PropertiesPanel />
        </div>
      </section>

      <div className="right-panel__divider" role="presentation" />

      <section
        aria-labelledby="right-panel-layers-heading"
        className="right-panel__section right-panel__section--layers"
      >
        <header className="right-panel__header">
          <h2 id="right-panel-layers-heading">Layers</h2>
        </header>
        <div className="right-panel__content right-panel__content--layers">
          <LayersPanel />
        </div>
      </section>
    </div>
  );
}
