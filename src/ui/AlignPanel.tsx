import { useState } from "react";
import { useEditorStore } from "../state/store";
import type { AlignEdge, DistributeAxis } from "../state/operations";
import "./AlignPanel.css";

interface AlignAction {
  edge: AlignEdge;
  icon: string;
  label: string;
  title: string;
}

interface DistributeAction {
  axis: DistributeAxis;
  icon: string;
  label: string;
  title: string;
}

interface ArrangeAction {
  action: () => void;
  icon: string;
  label: string;
  title: string;
}

const alignActions: AlignAction[] = [
  { edge: "left", icon: "|<", label: "Left", title: "Align left edges" },
  { edge: "hcenter", icon: "><", label: "H Center", title: "Align horizontal centers" },
  { edge: "right", icon: ">|", label: "Right", title: "Align right edges" },
  { edge: "top", icon: "T", label: "Top", title: "Align top edges" },
  { edge: "vcenter", icon: "=", label: "V Center", title: "Align vertical centers" },
  { edge: "bottom", icon: "_", label: "Bottom", title: "Align bottom edges" },
];

const distributeActions: DistributeAction[] = [
  { axis: "horizontal", icon: "<->", label: "Horizontal", title: "Distribute horizontal spacing" },
  { axis: "vertical", icon: "|||", label: "Vertical", title: "Distribute vertical spacing" },
];

export function AlignPanel() {
  const [gap, setGap] = useState(0);
  const selection = useEditorStore((state) => state.selection);
  const nodes = useEditorStore((state) => state.doc.nodes);
  const keyObjectId = useEditorStore((state) => state.keyObjectId);
  const alignNodes = useEditorStore((state) => state.alignNodes);
  const distributeNodes = useEditorStore((state) => state.distributeNodes);
  const distributeSelectionByGap = useEditorStore((state) => state.distributeSelectionByGap);
  const bringToFront = useEditorStore((state) => state.bringToFront);
  const bringForward = useEditorStore((state) => state.bringForward);
  const sendBackward = useEditorStore((state) => state.sendBackward);
  const sendToBack = useEditorStore((state) => state.sendToBack);
  const setKeyObject = useEditorStore((state) => state.setKeyObject);
  const toggleClipMask = useEditorStore((state) => state.toggleClipMask);
  const combineSelectedPaths = useEditorStore((state) => state.combineSelectedPaths);

  const selectionCount = selection.length;
  const selectedNode = selectionCount === 1 ? nodes[selection[0]!] : undefined;
  const canAlign = selectionCount >= 2;
  const canDistribute = selectionCount >= 3;
  const canDistributeByGap = canAlign;
  const canArrange = selectionCount >= 1;
  const canToggleClipMask = selectionCount >= 2 || selectedNode?.type === "group";
  const canCombinePaths =
    selection.filter((id) => {
      const node = nodes[id];
      return (
        node !== undefined &&
        !node.locked &&
        (node.type === "path" || node.type === "rect" || node.type === "ellipse")
      );
    }).length >= 2;
  const activeKeyObjectId = keyObjectId !== null && selection.includes(keyObjectId) ? keyObjectId : "";
  const arrangeActions: ArrangeAction[] = [
    { action: bringToFront, icon: "FF", label: "Bring to Front", title: "Bring selection to front" },
    { action: bringForward, icon: "F", label: "Forward", title: "Bring selection forward" },
    { action: sendBackward, icon: "B", label: "Backward", title: "Send selection backward" },
    { action: sendToBack, icon: "BB", label: "Send to Back", title: "Send selection to back" },
  ];

  return (
    <div className="align-panel" aria-label="Align and arrange">
      <section className="align-panel__group" aria-labelledby="align-panel-align-heading">
        <h3 id="align-panel-align-heading" className="align-panel__group-title">
          ALIGN
        </h3>
        {canAlign ? (
          <label className="align-panel__key-object">
            <span className="align-panel__key-object-label">Align to</span>
            <select
              className="align-panel__key-object-select"
              value={activeKeyObjectId}
              onChange={(event) => setKeyObject(event.target.value === "" ? null : event.target.value)}
            >
              <option value="">Selection (none)</option>
              {selection.map((id) => {
                const node = nodes[id];
                const label = node ? `${node.name} (${id})` : id;

                return (
                  <option key={id} value={id}>
                    {label}
                  </option>
                );
              })}
            </select>
          </label>
        ) : null}
        <div className="align-panel__button-grid align-panel__button-grid--align">
          {alignActions.map((item) => (
            <button
              key={item.edge}
              type="button"
              className="align-panel__button"
              title={item.title}
              disabled={!canAlign}
              onClick={() => alignNodes(item.edge)}
            >
              <span className="align-panel__button-icon" aria-hidden="true">
                {item.icon}
              </span>
              <span className="align-panel__button-label">{item.label}</span>
            </button>
          ))}
        </div>
      </section>

      <section className="align-panel__group" aria-labelledby="align-panel-distribute-heading">
        <h3 id="align-panel-distribute-heading" className="align-panel__group-title">
          DISTRIBUTE
        </h3>
        <div className="align-panel__button-grid align-panel__button-grid--distribute">
          {distributeActions.map((item) => (
            <button
              key={item.axis}
              type="button"
              className="align-panel__button"
              title={item.title}
              disabled={!canDistribute}
              onClick={() => distributeNodes(item.axis)}
            >
              <span className="align-panel__button-icon" aria-hidden="true">
                {item.icon}
              </span>
              <span className="align-panel__button-label">{item.label}</span>
            </button>
          ))}
        </div>
      </section>

      <section className="align-panel__group" aria-labelledby="align-panel-distribute-spacing-heading">
        <h3 id="align-panel-distribute-spacing-heading" className="align-panel__group-title">
          DISTRIBUTE SPACING
        </h3>
        <label className="align-panel__gap-field">
          <span className="align-panel__gap-label">Gap</span>
          <input
            className="align-panel__gap-input"
            type="number"
            min="0"
            step="1"
            value={gap}
            onChange={(event) => setGap(Math.max(0, Number(event.target.value) || 0))}
          />
        </label>
        <div className="align-panel__button-grid align-panel__button-grid--distribute">
          <button
            type="button"
            className="align-panel__button"
            title="Distribute horizontal spacing by gap"
            disabled={!canDistributeByGap}
            onClick={() => distributeSelectionByGap("horizontal", gap)}
          >
            <span className="align-panel__button-icon" aria-hidden="true">
              H
            </span>
            <span className="align-panel__button-label">Horizontal</span>
          </button>
          <button
            type="button"
            className="align-panel__button"
            title="Distribute vertical spacing by gap"
            disabled={!canDistributeByGap}
            onClick={() => distributeSelectionByGap("vertical", gap)}
          >
            <span className="align-panel__button-icon" aria-hidden="true">
              V
            </span>
            <span className="align-panel__button-label">Vertical</span>
          </button>
        </div>
      </section>

      <section className="align-panel__group" aria-labelledby="align-panel-arrange-heading">
        <h3 id="align-panel-arrange-heading" className="align-panel__group-title">
          ARRANGE
        </h3>
        <div className="align-panel__button-grid align-panel__button-grid--arrange">
          {arrangeActions.map((item) => (
            <button
              key={item.label}
              type="button"
              className="align-panel__button align-panel__button--wide"
              title={item.title}
              disabled={!canArrange}
              onClick={item.action}
            >
              <span className="align-panel__button-icon" aria-hidden="true">
                {item.icon}
              </span>
              <span className="align-panel__button-label">{item.label}</span>
            </button>
          ))}
          <button
            type="button"
            className="align-panel__button align-panel__button--wide"
            title="Make or release clipping mask"
            disabled={!canToggleClipMask}
            onClick={toggleClipMask}
          >
            <span className="align-panel__button-icon" aria-hidden="true">
              CL
            </span>
            <span className="align-panel__button-label">Clip</span>
          </button>
          <button
            type="button"
            className="align-panel__button align-panel__button--wide"
            title="Combine selected shapes into one compound path"
            disabled={!canCombinePaths}
            onClick={combineSelectedPaths}
          >
            <span className="align-panel__button-icon" aria-hidden="true">
              CP
            </span>
            <span className="align-panel__button-label">Compound</span>
          </button>
        </div>
      </section>
    </div>
  );
}
