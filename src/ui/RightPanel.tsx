import { LayersPanel } from "./LayersPanel";
import { PropertiesPanel } from "./PropertiesPanel";
import { AlignPanel } from "./AlignPanel";
import { PathfinderPanel } from "./PathfinderPanel";
import { TransformActions } from "./TransformActions";
import { SnapSettings } from "./SnapSettings";
import { ExportMenu } from "./ExportMenu";
import { ImportButton } from "./ImportButton";
import { DocSettings } from "./DocSettings";
import { SwatchesPanel } from "./SwatchesPanel";
import "./RightPanel.css";

export function RightPanel() {
  return (
    <div className="right-panel" aria-label="Properties and layers">
      <section
        aria-labelledby="right-panel-export-heading"
        className="right-panel__section right-panel__section--export"
      >
        <header className="right-panel__header">
          <h2 id="right-panel-export-heading">Export</h2>
        </header>
        <div className="right-panel__content right-panel__content--export">
          <ImportButton />
          <ExportMenu />
        </div>
      </section>

      <div className="right-panel__divider" role="presentation" />

      <section
        aria-labelledby="right-panel-document-heading"
        className="right-panel__section right-panel__section--document"
      >
        <header className="right-panel__header">
          <h2 id="right-panel-document-heading">Document</h2>
        </header>
        <div className="right-panel__content right-panel__content--document">
          <DocSettings />
        </div>
      </section>

      <div className="right-panel__divider" role="presentation" />

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
        aria-labelledby="right-panel-swatches-heading"
        className="right-panel__section right-panel__section--swatches"
      >
        <header className="right-panel__header">
          <h2 id="right-panel-swatches-heading">Swatches</h2>
        </header>
        <div className="right-panel__content right-panel__content--swatches">
          <SwatchesPanel />
        </div>
      </section>

      <div className="right-panel__divider" role="presentation" />

      <section
        aria-labelledby="right-panel-align-heading"
        className="right-panel__section right-panel__section--align"
      >
        <header className="right-panel__header">
          <h2 id="right-panel-align-heading">Align</h2>
        </header>
        <div className="right-panel__content right-panel__content--align">
          <AlignPanel />
        </div>
      </section>

      <div className="right-panel__divider" role="presentation" />

      <section
        aria-labelledby="right-panel-pathfinder-heading"
        className="right-panel__section right-panel__section--pathfinder"
      >
        <header className="right-panel__header">
          <h2 id="right-panel-pathfinder-heading">Pathfinder</h2>
        </header>
        <div className="right-panel__content right-panel__content--pathfinder">
          <PathfinderPanel />
        </div>
      </section>

      <div className="right-panel__divider" role="presentation" />

      <section
        aria-labelledby="right-panel-transform-heading"
        className="right-panel__section right-panel__section--transform"
      >
        <header className="right-panel__header">
          <h2 id="right-panel-transform-heading">Transform</h2>
        </header>
        <div className="right-panel__content right-panel__content--transform">
          <TransformActions />
        </div>
      </section>

      <div className="right-panel__divider" role="presentation" />

      <section
        aria-labelledby="right-panel-snap-heading"
        className="right-panel__section right-panel__section--snap"
      >
        <header className="right-panel__header">
          <h2 id="right-panel-snap-heading">Snap</h2>
        </header>
        <div className="right-panel__content right-panel__content--snap">
          <SnapSettings />
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
