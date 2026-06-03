import { useEffect } from "react";
import type { ToolId } from "./state/store";
import { useEditorStore } from "./state/store";
import CanvasView from "./ui/CanvasView";
import Toolbar from "./ui/Toolbar";

const KEY_TO_TOOL: Record<string, ToolId> = {
  v: "select",
  m: "rect",
  l: "ellipse",
  p: "pen",
  t: "text",
  h: "hand",
};

const isTypingTarget = (target: EventTarget | null): boolean => {
  if (!(target instanceof HTMLElement)) {
    return false;
  }

  const tag = target.tagName.toLowerCase();
  return tag === "input" || tag === "textarea" || tag === "select" || target.isContentEditable;
};

export default function App() {
  const activeTool = useEditorStore((state) => state.activeTool);
  const doc = useEditorStore((state) => state.doc);
  const selection = useEditorStore((state) => state.selection);
  const setActiveTool = useEditorStore((state) => state.setActiveTool);
  const removeNodes = useEditorStore((state) => state.removeNodes);
  const undo = useEditorStore((state) => state.undo);
  const redo = useEditorStore((state) => state.redo);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent): void => {
      if (isTypingTarget(event.target)) {
        return;
      }

      const key = event.key.toLowerCase();
      const hasCommandModifier = event.ctrlKey || event.metaKey;

      if (hasCommandModifier && key === "z") {
        event.preventDefault();
        if (event.shiftKey) {
          redo();
        } else {
          undo();
        }
        return;
      }

      if (key === "delete" || key === "backspace") {
        if (selection.length > 0) {
          event.preventDefault();
          removeNodes(selection);
        }
        return;
      }

      if (hasCommandModifier || event.altKey || event.shiftKey) {
        return;
      }

      const nextTool = KEY_TO_TOOL[key];
      if (nextTool !== undefined) {
        event.preventDefault();
        setActiveTool(nextTool);
      }
    };

    window.addEventListener("keydown", onKeyDown);
    return () => {
      window.removeEventListener("keydown", onKeyDown);
    };
  }, [redo, removeNodes, selection, setActiveTool, undo]);

  return (
    <div className="app">
      <header className="app__menubar">
        <div className="app__brand">Drawing Pic</div>
        <div className="app__doc-meta">
          {doc.name} · {doc.width} × {doc.height}px · {activeTool}
        </div>
      </header>
      <main className="app__workspace">
        <Toolbar />
        <CanvasView />
        <aside className="app__right-panel">Properties</aside>
      </main>
    </div>
  );
}
