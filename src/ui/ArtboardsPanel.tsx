import { useEffect, useState, type KeyboardEvent as ReactKeyboardEvent } from "react";
import type { Artboard } from "../core/model/types";
import { useEditorStore } from "../state/store";
import "./ArtboardsPanel.css";

interface ArtboardRowProps {
  readonly artboard: Artboard;
  readonly active: boolean;
  readonly canRemove: boolean;
  readonly onActivate: () => void;
  readonly onRemove: () => void;
  readonly onRename: (name: string) => void;
}

function ArtboardRow({
  artboard,
  active,
  canRemove,
  onActivate,
  onRemove,
  onRename,
}: ArtboardRowProps) {
  const [name, setName] = useState(artboard.name);

  useEffect(() => setName(artboard.name), [artboard.name]);

  const commitName = (): void => {
    const nextName = name.trim();
    if (nextName === "") {
      setName(artboard.name);
      return;
    }
    onRename(nextName);
    setName(nextName);
  };

  const handleNameKeyDown = (event: ReactKeyboardEvent<HTMLInputElement>): void => {
    if (event.key === "Enter") event.currentTarget.blur();
    if (event.key === "Escape") {
      event.preventDefault();
      setName(artboard.name);
    }
  };

  return (
    <li className={`artboards-panel__item${active ? " artboards-panel__item--active" : ""}`}>
      <button
        aria-label={`Activate ${artboard.name}`}
        aria-pressed={active}
        className="artboards-panel__activate"
        onClick={onActivate}
        type="button"
      >
        <span className="artboards-panel__indicator" aria-hidden="true" />
      </button>
      <input
        aria-label={`Artboard name: ${artboard.name}`}
        className="artboards-panel__name"
        onBlur={commitName}
        onChange={(event) => setName(event.currentTarget.value)}
        onFocus={onActivate}
        onKeyDown={handleNameKeyDown}
        value={name}
      />
      <span className="artboards-panel__dimensions">
        {artboard.width} × {artboard.height}
      </span>
      <button
        aria-label={`Delete ${artboard.name}`}
        className="artboards-panel__remove"
        disabled={!canRemove}
        onClick={onRemove}
        title={canRemove ? "Delete artboard" : "At least one artboard is required"}
        type="button"
      >
        −
      </button>
    </li>
  );
}

export function ArtboardsPanel() {
  const artboards = useEditorStore((state) => state.doc.artboards ?? []);
  const activeArtboardId = useEditorStore((state) => state.doc.activeArtboardId);
  const addArtboard = useEditorStore((state) => state.addArtboard);
  const removeArtboard = useEditorStore((state) => state.removeArtboard);
  const setActiveArtboard = useEditorStore((state) => state.setActiveArtboard);
  const renameArtboard = useEditorStore((state) => state.renameArtboard);

  return (
    <div className="artboards-panel" aria-label="Artboards">
      <ol className="artboards-panel__list">
        {artboards.map((artboard) => (
          <ArtboardRow
            active={artboard.id === activeArtboardId}
            artboard={artboard}
            canRemove={artboards.length > 1}
            key={artboard.id}
            onActivate={() => setActiveArtboard(artboard.id)}
            onRemove={() => removeArtboard(artboard.id)}
            onRename={(name) => renameArtboard(artboard.id, name)}
          />
        ))}
      </ol>
      <button className="artboards-panel__add" onClick={addArtboard} type="button">
        + Add artboard
      </button>
    </div>
  );
}
