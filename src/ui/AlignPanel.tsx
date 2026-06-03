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
  const selectionCount = useEditorStore((state) => state.selection.length);
  const alignNodes = useEditorStore((state) => state.alignNodes);
  const distributeNodes = useEditorStore((state) => state.distributeNodes);
  const bringToFront = useEditorStore((state) => state.bringToFront);
  const bringForward = useEditorStore((state) => state.bringForward);
  const sendBackward = useEditorStore((state) => state.sendBackward);
  const sendToBack = useEditorStore((state) => state.sendToBack);

  const canAlign = selectionCount >= 2;
  const canDistribute = selectionCount >= 3;
  const canArrange = selectionCount >= 1;
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
        </div>
      </section>
    </div>
  );
}
