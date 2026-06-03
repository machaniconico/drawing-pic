import { useEditorStore } from "../state/store";
import { TOOL_DEFS } from "./tools";
import "./Toolbar.css";

export default function Toolbar() {
  const activeTool = useEditorStore((state) => state.activeTool);
  const setActiveTool = useEditorStore((state) => state.setActiveTool);

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
    </nav>
  );
}
