import type { PathfinderOp } from "../core/geometry/pathfinder";
import { useEditorStore } from "../state/store";
import "./PathfinderPanel.css";

interface PathfinderAction {
  op: PathfinderOp;
  label: string;
  title: string;
}

const actions: PathfinderAction[] = [
  { op: "unite", label: "Unite", title: "Unite selected shapes" },
  { op: "minus-front", label: "Minus Front", title: "Subtract front shapes from the back shape" },
  { op: "minus-back", label: "Minus Back", title: "Subtract back shapes from the front shape" },
  { op: "intersect", label: "Intersect", title: "Keep the overlapping area" },
  { op: "exclude", label: "Exclude", title: "Exclude the overlapping area" },
  { op: "divide", label: "Divide", title: "Divide selection into separate regions" },
];

export function PathfinderPanel() {
  const selectionCount = useEditorStore((state) => state.selection.length);
  const applyPathfinder = useEditorStore((state) => state.applyPathfinder);
  const enabled = selectionCount >= 2;

  return (
    <div className="pathfinder-panel" aria-label="Pathfinder operations">
      <div className="pathfinder-panel__grid">
        {actions.map((action) => (
          <button
            key={action.op}
            type="button"
            className="pathfinder-panel__button"
            title={action.title}
            aria-label={action.label}
            disabled={!enabled}
            onClick={() => applyPathfinder(action.op)}
          >
            <span
              className={`pathfinder-panel__icon pathfinder-panel__icon--${action.op}`}
              aria-hidden="true"
            >
              <span className="pathfinder-panel__shape pathfinder-panel__shape--back" />
              <span className="pathfinder-panel__shape pathfinder-panel__shape--front" />
            </span>
            <span className="pathfinder-panel__label">{action.label}</span>
          </button>
        ))}
      </div>
    </div>
  );
}
