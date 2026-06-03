import type { CSSProperties, MouseEvent } from "react";
import { isContainer, type NodeId, type SceneNode } from "../core/model/types";
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

export function LayersPanel() {
  const doc = useEditorStore((state) => state.doc);
  const selection = useEditorStore((state) => state.selection);
  const updateNode = useEditorStore((state) => state.updateNode);
  const setSelection = useEditorStore((state) => state.setSelection);
  const addToSelection = useEditorStore((state) => state.addToSelection);

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

  return (
    <aside className="layers-panel" aria-label="Layers">
      <div className="layers-panel__header">Layers</div>
      <div className="layers-panel__tree" role="tree" aria-label="Document layers">
        {rows.map(({ id, node, depth }) => {
          const selected = selection.includes(id);

          return (
            <div
              aria-selected={selected}
              className={selected ? "layers-panel__row layers-panel__row--selected" : "layers-panel__row"}
              key={id}
              onClick={(event) => handleRowClick(event, id)}
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
