import {
  useEffect,
  useRef,
  useState,
  type DragEvent as ReactDragEvent,
  type KeyboardEvent as ReactKeyboardEvent,
} from "react";
import { height, isEmpty, width } from "../core/geometry/bbox";
import { IDENTITY } from "../core/geometry/matrix";
import { symbolDefinitionBounds } from "../core/model/bounds";
import {
  asSymbolInstance,
  type Document,
  type SymbolDefinition,
  type SymbolInstanceNode,
} from "../core/model/types";
import { renderDocument } from "../render/canvasRenderer";
import { editorStore, useEditorStore } from "../state/store";
import "./SymbolsPanel.css";

const symbolTypeLabel = (symbol: SymbolDefinition): string => {
  const types = new Set(symbol.nodes.map((node) => node.type));
  if (types.size !== 1) return "Artwork";
  const type = types.values().next().value;
  if (type === "symbol-instance") return "Symbol";
  return type ? `${type.charAt(0).toUpperCase()}${type.slice(1)}` : "Artwork";
};

const THUMBNAIL_SIZE = 40;
const THUMBNAIL_PADDING = 4;

function SymbolThumbnail({ symbol }: { readonly symbol: SymbolDefinition }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const doc = useEditorStore((state) => state.doc);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const context = canvas.getContext("2d");
    if (!context) return;

    const bounds = symbolDefinitionBounds(doc, symbol.id);
    if (isEmpty(bounds)) return;
    const contentWidth = Math.max(width(bounds), 1);
    const contentHeight = Math.max(height(bounds), 1);
    const zoom = Math.min(
      (THUMBNAIL_SIZE - THUMBNAIL_PADDING * 2) / contentWidth,
      (THUMBNAIL_SIZE - THUMBNAIL_PADDING * 2) / contentHeight,
    );
    const instanceId = `symbol-thumbnail-instance-${symbol.id}`;
    const layerId = `symbol-thumbnail-layer-${symbol.id}`;
    const instance: SymbolInstanceNode = {
      id: instanceId,
      name: symbol.name,
      type: "symbol-instance",
      symbolId: symbol.id,
      transform: IDENTITY,
      opacity: 1,
      visible: true,
      locked: false,
    };
    const previewDoc: Document = {
      ...doc,
      id: `symbol-thumbnail-${symbol.id}`,
      width: contentWidth,
      height: contentHeight,
      artboards: [{
        id: `symbol-thumbnail-artboard-${symbol.id}`,
        name: symbol.name,
        x: bounds.minX,
        y: bounds.minY,
        width: contentWidth,
        height: contentHeight,
      }],
      activeArtboardId: `symbol-thumbnail-artboard-${symbol.id}`,
      layerOrder: [layerId],
      guides: [],
      nodes: {
        [layerId]: {
          id: layerId,
          name: "Thumbnail",
          type: "layer",
          children: [instanceId],
          transform: IDENTITY,
          opacity: 1,
          visible: true,
          locked: false,
        },
        [instanceId]: instance,
      } as Document["nodes"],
    };
    const pan = {
      x: THUMBNAIL_PADDING - bounds.minX * zoom
        + (THUMBNAIL_SIZE - THUMBNAIL_PADDING * 2 - contentWidth * zoom) / 2,
      y: THUMBNAIL_PADDING - bounds.minY * zoom
        + (THUMBNAIL_SIZE - THUMBNAIL_PADDING * 2 - contentHeight * zoom) / 2,
    };
    const draw = (): void =>
      renderDocument(context, previewDoc, { zoom, pan, onImageLoad: draw }, {
        skipEditorChrome: true,
      });
    draw();
  }, [doc, symbol]);

  return (
    <span className="symbols-panel__thumbnail" aria-hidden="true">
      <canvas height={THUMBNAIL_SIZE} ref={canvasRef} width={THUMBNAIL_SIZE} />
    </span>
  );
}

interface SymbolRowProps {
  readonly symbol: SymbolDefinition;
  readonly onPlace: () => void;
  readonly onDragStart: (event: ReactDragEvent<HTMLButtonElement>) => void;
  readonly onDragEnd: (event: ReactDragEvent<HTMLButtonElement>) => void;
  readonly onRename: (name: string) => void;
}

function SymbolRow({ symbol, onPlace, onDragStart, onDragEnd, onRename }: SymbolRowProps) {
  const [name, setName] = useState(symbol.name);
  const cancelNameCommit = useRef(false);

  useEffect(() => setName(symbol.name), [symbol.name]);

  const commitName = (): void => {
    if (cancelNameCommit.current) {
      cancelNameCommit.current = false;
      setName(symbol.name);
      return;
    }
    const nextName = name.trim();
    if (nextName === "") {
      setName(symbol.name);
      return;
    }
    if (nextName !== symbol.name) onRename(nextName);
    setName(nextName);
  };

  const handleNameKeyDown = (event: ReactKeyboardEvent<HTMLInputElement>): void => {
    if (event.key === "Enter") event.currentTarget.blur();
    if (event.key === "Escape") {
      event.preventDefault();
      cancelNameCommit.current = true;
      setName(symbol.name);
      event.currentTarget.blur();
    }
  };

  return (
    <li className="symbols-panel__item">
      <button
        aria-label={`Place symbol ${symbol.name}`}
        className="symbols-panel__place"
        draggable
        onClick={onPlace}
        onDragEnd={onDragEnd}
        onDragStart={onDragStart}
        title={`Place ${symbol.name} (or drag it onto the canvas)`}
        type="button"
      >
        <SymbolThumbnail symbol={symbol} />
      </button>
      <span className="symbols-panel__details">
        <input
          aria-label={`Symbol name: ${symbol.name}`}
          className="symbols-panel__name"
          onBlur={commitName}
          onChange={(event) => setName(event.currentTarget.value)}
          onKeyDown={handleNameKeyDown}
          value={name}
        />
        <span className="symbols-panel__type">{symbolTypeLabel(symbol)}</span>
      </span>
    </li>
  );
}

export function SymbolsPanel() {
  const symbols = useEditorStore((state) => Object.values(state.doc.symbols ?? {}));
  const selectionCount = useEditorStore((state) => state.selection.length);
  const selectedInstanceId = useEditorStore((state) => {
    if (state.selection.length !== 1) return null;
    const id = state.selection[0];
    const node = id ? state.doc.nodes[id] : undefined;
    return node && asSymbolInstance(node) ? id : null;
  });
  const placeSymbolInstance = useEditorStore((state) => state.placeSymbolInstance);
  const breakSymbolLink = useEditorStore((state) => state.breakSymbolLink);
  const defineSymbolFromSelection = useEditorStore((state) => state.defineSymbolFromSelection);
  const [newSymbolName, setNewSymbolName] = useState("");

  const placementCenter = (): { x: number; y: number } => {
    const { doc } = editorStore.getState();
    const artboard = doc.artboards?.find((candidate) => candidate.id === doc.activeArtboardId);
    return artboard
      ? { x: artboard.x + artboard.width / 2, y: artboard.y + artboard.height / 2 }
      : { x: doc.width / 2, y: doc.height / 2 };
  };

  const placeAtCenter = (symbolId: string): void => {
    placeSymbolInstance(symbolId, placementCenter());
  };

  const handleDragStart = (
    event: ReactDragEvent<HTMLButtonElement>,
    symbolId: string,
  ): void => {
    event.dataTransfer.effectAllowed = "copy";
    event.dataTransfer.setData("application/x-drawing-pic-symbol", symbolId);
    event.dataTransfer.setData("text/plain", symbolId);
  };

  const handleDragEnd = (
    event: ReactDragEvent<HTMLButtonElement>,
    symbolId: string,
  ): void => {
    const canvas = document.querySelector<HTMLCanvasElement>(".canvas-view__canvas");
    if (!canvas) return;
    const rect = canvas.getBoundingClientRect();
    if (
      event.clientX < rect.left ||
      event.clientX > rect.right ||
      event.clientY < rect.top ||
      event.clientY > rect.bottom
    ) {
      return;
    }

    const { viewport } = editorStore.getState();
    placeSymbolInstance(symbolId, {
      x: (event.clientX - rect.left - viewport.pan.x) / viewport.zoom,
      y: (event.clientY - rect.top - viewport.pan.y) / viewport.zoom,
    });
  };

  const renameSymbol = (symbolId: string, name: string): void => {
    const currentSymbol = editorStore.getState().doc.symbols?.[symbolId];
    if (!currentSymbol || currentSymbol.name === name) return;

    // US-137 does not expose a rename action. Reusing its definition update action
    // first creates the document-history boundary for this metadata-only edit.
    editorStore.getState().updateSymbolDefinition(symbolId, currentSymbol.nodes);
    editorStore.setState((state) => {
      const symbol = state.doc.symbols?.[symbolId];
      if (!symbol || symbol.name === name) return state;
      return {
        doc: {
          ...state.doc,
          symbols: {
            ...(state.doc.symbols ?? {}),
            [symbolId]: { ...symbol, name },
          },
        },
      };
    });
  };

  const createSymbol = (): void => {
    const symbolId = defineSymbolFromSelection(newSymbolName.trim() || undefined);
    if (symbolId) setNewSymbolName("");
  };

  return (
    <div className="symbols-panel" aria-label="Symbols">
      {symbols.length > 0 ? (
        <ol className="symbols-panel__list">
          {symbols.map((symbol) => (
            <SymbolRow
              key={symbol.id}
              onDragEnd={(event) => handleDragEnd(event, symbol.id)}
              onDragStart={(event) => handleDragStart(event, symbol.id)}
              onPlace={() => placeAtCenter(symbol.id)}
              onRename={(name) => renameSymbol(symbol.id, name)}
              symbol={symbol}
            />
          ))}
        </ol>
      ) : (
        <p className="symbols-panel__empty">Create a symbol from selected artwork.</p>
      )}

      <div className="symbols-panel__actions">
        <input
          aria-label="New symbol name"
          className="symbols-panel__new-name"
          onChange={(event) => setNewSymbolName(event.currentTarget.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter" && selectionCount > 0) createSymbol();
          }}
          placeholder="New symbol name"
          value={newSymbolName}
        />
        <button
          className="symbols-panel__button symbols-panel__button--create"
          disabled={selectionCount === 0}
          onClick={createSymbol}
          title={selectionCount > 0 ? "Create symbol from selection" : "Select artwork first"}
          type="button"
        >
          + New Symbol
        </button>
        <button
          className="symbols-panel__button"
          disabled={selectedInstanceId === null}
          onClick={() => breakSymbolLink(selectedInstanceId ?? undefined)}
          title={selectedInstanceId ? "Expand the selected symbol instance" : "Select one symbol instance"}
          type="button"
        >
          Break Link
        </button>
      </div>
    </div>
  );
}
