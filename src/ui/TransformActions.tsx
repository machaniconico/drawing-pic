import { useEditorStore } from "../state/store";
import type { FlipAxis, Rotate90Direction } from "../state/operations";
import "./TransformActions.css";

interface FlipAction {
  axis: FlipAxis;
  icon: string;
  label: string;
  title: string;
}

interface RotateAction {
  direction: Rotate90Direction;
  icon: string;
  label: string;
  title: string;
}

const flipActions: FlipAction[] = [
  { axis: "horizontal", icon: "<>", label: "Flip H", title: "Flip selection horizontally" },
  { axis: "vertical", icon: "^v", label: "Flip V", title: "Flip selection vertically" },
];

const rotateActions: RotateAction[] = [
  { direction: "cw", icon: "90", label: "Rotate 90 CW", title: "Rotate selection 90 degrees clockwise" },
  { direction: "ccw", icon: "-90", label: "Rotate 90 CCW", title: "Rotate selection 90 degrees counterclockwise" },
];

export function TransformActions() {
  const selectionCount = useEditorStore((state) => state.selection.length);
  const flipSelection = useEditorStore((state) => state.flipSelection);
  const rotateSelection90 = useEditorStore((state) => state.rotateSelection90);

  const canTransform = selectionCount > 0;

  return (
    <div className="transform-actions" aria-label="Transform actions">
      <section className="transform-actions__group" aria-labelledby="transform-actions-flip-heading">
        <h3 id="transform-actions-flip-heading" className="transform-actions__group-title">
          FLIP
        </h3>
        <div className="transform-actions__button-grid">
          {flipActions.map((item) => (
            <button
              key={item.axis}
              type="button"
              className="transform-actions__button"
              title={item.title}
              disabled={!canTransform}
              onClick={() => flipSelection(item.axis)}
            >
              <span className="transform-actions__button-icon" aria-hidden="true">
                {item.icon}
              </span>
              <span className="transform-actions__button-label">{item.label}</span>
            </button>
          ))}
        </div>
      </section>

      <section className="transform-actions__group" aria-labelledby="transform-actions-rotate-heading">
        <h3 id="transform-actions-rotate-heading" className="transform-actions__group-title">
          ROTATE
        </h3>
        <div className="transform-actions__button-grid">
          {rotateActions.map((item) => (
            <button
              key={item.direction}
              type="button"
              className="transform-actions__button"
              title={item.title}
              disabled={!canTransform}
              onClick={() => rotateSelection90(item.direction)}
            >
              <span className="transform-actions__button-icon" aria-hidden="true">
                {item.icon}
              </span>
              <span className="transform-actions__button-label">{item.label}</span>
            </button>
          ))}
        </div>
      </section>
    </div>
  );
}
