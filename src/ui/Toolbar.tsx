import { useEditorStore } from "../state/store";
import { TOOL_DEFS } from "./tools";
import "./Toolbar.css";

export default function Toolbar() {
  const activeTool = useEditorStore((state) => state.activeTool);
  const setActiveTool = useEditorStore((state) => state.setActiveTool);
  const addPolygon = useEditorStore((state) => state.addPolygon);
  const addStar = useEditorStore((state) => state.addStar);

  return (
    <nav className="toolbar" aria-label="Tools">
      {TOOL_DEFS.map((tool) => (
        <button
          aria-label={tool.label}
          aria-pressed={activeTool === tool.id}
          className={activeTool === tool.id ? "toolbar__button toolbar__button--active" : "toolbar__button"}
          key={tool.id}
          onClick={() => setActiveTool(tool.id)}
          title={`${tool.label} (${tool.shortcut})`}
          type="button"
        >
          <span aria-hidden="true" className="toolbar__icon">
            {tool.icon}
          </span>
        </button>
      ))}

      <span aria-hidden="true" className="toolbar__divider" />

      <button
        aria-label="Add polygon"
        className="toolbar__button"
        onClick={() => addPolygon(6)}
        title="Add polygon"
        type="button"
      >
        <span aria-hidden="true" className="toolbar__icon">
          ⬡
        </span>
      </button>
      <button
        aria-label="Add star"
        className="toolbar__button"
        onClick={() => addStar(5)}
        title="Add star"
        type="button"
      >
        <span aria-hidden="true" className="toolbar__icon">
          ★
        </span>
      </button>
    </nav>
  );
}
