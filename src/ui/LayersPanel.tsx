import type { CSSProperties, DragEvent, MouseEvent } from "react";
import { useState } from "react";
import { isContainer, type NodeId, type SceneNode } from "../core/model/types";
import type { LayerDropPosition } from "../state/layerReorder";
import { useEditorStore } from "../state/store";
import "./LayersPanel.css";

interface LayerRow {
  id: NodeId;
  node: SceneNode;
  depth: number;
}

type LayerDepthStyle = CSSProperties & {
  "--layer-depth": number;
};

interface DropIndicator {
  id: NodeId;
  position: LayerDropPosition;
}

const dragDataType = "application/x-drawing-pic-node-id";

const typeGlyphs: Record<SceneNode["type"], string> = {
  ellipse: "E",
  group: "G",
  image: "I",
  layer: "L",
  path: "P",
  rect: "R",
  text: "T",
};

const buildRows = (nodes: Record<NodeId, SceneNode>, ids: readonly NodeId[], depth: number): LayerRow[] => {
  const rows: LayerRow[] = [];

  for (let index = ids.length - 1; index >= 0; index -= 1) {
    const id = ids[index];
    if (!id) {
      continue;
    }

    const node = nodes[id];
    if (!node) {
      continue;
    }

    rows.push({ id, node, depth });

    if (isContainer(node)) {
      rows.push(...buildRows(nodes, node.children, depth + 1));
    }
  }

  return rows;
};

const depthStyle = (depth: number): LayerDepthStyle => ({
  "--layer-depth": depth,
});

const dropPositionFromEvent = (event: DragEvent<HTMLDivElement>, node: SceneNode): LayerDropPosition => {
  const rect = event.currentTarget.getBoundingClientRect();
  const y = event.clientY - rect.top;

  if (isContainer(node)) {
    const insideBand = rect.height * 0.25;
    if (y < insideBand) {
      return "before";
    }
    if (y > rect.height - insideBand) {
      return "after";
    }
    return "inside";
  }

  return y < rect.height / 2 ? "before" : "after";
};

const rowClassName = (selected: boolean, indicator: DropIndicator | null, id: NodeId): string => {
  const classes = ["layers-panel__row"];
  if (selected) {
    classes.push("layers-panel__row--selected");
  }
  if (indicator?.id === id) {
    classes.push("layers-panel__row--drag-over", `layers-panel__row--drop-${indicator.position}`);
  }
  return classes.join(" ");
};

export function LayersPanel() {
  const doc = useEditorStore((state) => state.doc);
  const selection = useEditorStore((state) => state.selection);
  const updateNode = useEditorStore((state) => state.updateNode);
  const setSelection = useEditorStore((state) => state.setSelection);
  const addToSelection = useEditorStore((state) => state.addToSelection);
  const reorderNode = useEditorStore((state) => state.reorderNode);
  const [dropIndicator, setDropIndicator] = useState<DropIndicator | null>(null);

  const rows = buildRows(doc.nodes, doc.layerOrder, 0);

  const handleRowClick = (event: MouseEvent<HTMLDivElement>, id: NodeId): void => {
    if (event.shiftKey || event.ctrlKey || event.metaKey) {
      addToSelection(id);
      return;
    }

    setSelection([id]);
  };

  const handleToggleVisible = (event: MouseEvent<HTMLButtonElement>, node: SceneNode): void => {
    event.stopPropagation();
    updateNode(node.id, { visible: !node.visible });
  };

  const handleToggleLocked = (event: MouseEvent<HTMLButtonElement>, node: SceneNode): void => {
    event.stopPropagation();
    updateNode(node.id, { locked: !node.locked });
  };

  const handleDragStart = (event: DragEvent<HTMLDivElement>, id: NodeId): void => {
    event.dataTransfer.effectAllowed = "move";
    event.dataTransfer.setData(dragDataType, id);
    event.dataTransfer.setData("text/plain", id);
  };

  const handleDragOver = (event: DragEvent<HTMLDivElement>, node: SceneNode): void => {
    event.preventDefault();
    event.dataTransfer.dropEffect = "move";
    setDropIndicator({ id: node.id, position: dropPositionFromEvent(event, node) });
  };

  const handleDragLeave = (event: DragEvent<HTMLDivElement>, id: NodeId): void => {
    const relatedTarget = event.relatedTarget;
    if (relatedTarget instanceof Node && event.currentTarget.contains(relatedTarget)) {
      return;
    }

    setDropIndicator((indicator) => (indicator?.id === id ? null : indicator));
  };

  const handleDrop = (event: DragEvent<HTMLDivElement>, node: SceneNode): void => {
    event.preventDefault();
    event.stopPropagation();

    const dragId = event.dataTransfer.getData(dragDataType) || event.dataTransfer.getData("text/plain");
    const position = dropPositionFromEvent(event, node);
    setDropIndicator(null);

    if (dragId) {
      reorderNode(dragId, node.id, position);
    }
  };

  return (
    <aside className="layers-panel" aria-label="Layers">
      <div className="layers-panel__header">Layers</div>
      <div className="layers-panel__tree" role="tree" aria-label="Document layers">
        {rows.map(({ id, node, depth }) => {
          const selected = selection.includes(id);

          return (
            <div
              aria-selected={selected}
              className={rowClassName(selected, dropIndicator, id)}
              draggable
              key={id}
              onClick={(event) => handleRowClick(event, id)}
              onDragEnd={() => setDropIndicator(null)}
              onDragLeave={(event) => handleDragLeave(event, id)}
              onDragOver={(event) => handleDragOver(event, node)}
              onDragStart={(event) => handleDragStart(event, id)}
              onDrop={(event) => handleDrop(event, node)}
              role="treeitem"
              style={depthStyle(depth)}
              tabIndex={0}
            >
              <button
                aria-label={node.visible ? `Hide ${node.name}` : `Show ${node.name}`}
                aria-pressed={node.visible}
                className={
                  node.visible
                    ? "layers-panel__toggle layers-panel__toggle--active"
                    : "layers-panel__toggle"
                }
                onClick={(event) => handleToggleVisible(event, node)}
                title={node.visible ? "Visible" : "Hidden"}
                type="button"
                draggable={false}
              >
                {node.visible ? "V" : "-"}
              </button>
              <button
                aria-label={node.locked ? `Unlock ${node.name}` : `Lock ${node.name}`}
                aria-pressed={node.locked}
                className={
                  node.locked
                    ? "layers-panel__toggle layers-panel__toggle--active"
                    : "layers-panel__toggle"
                }
                onClick={(event) => handleToggleLocked(event, node)}
                title={node.locked ? "Locked" : "Unlocked"}
                type="button"
                draggable={false}
              >
                {node.locked ? "L" : "-"}
              </button>
              <span className={`layers-panel__glyph layers-panel__glyph--${node.type}`} aria-hidden="true">
                {typeGlyphs[node.type]}
              </span>
              <span className="layers-panel__name" title={node.name}>
                {node.name}
              </span>
            </div>
          );
        })}
      </div>
    </aside>
  );
}
