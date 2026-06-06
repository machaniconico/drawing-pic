import { useEffect } from "react";
import type { ToolId } from "./state/store";
import { useEditorStore } from "./state/store";
import CanvasView from "./ui/CanvasView";
import { RightPanel } from "./ui/RightPanel";
import Toolbar from "./ui/Toolbar";
import ZoomControls, { fitCanvasToScreen, resetCanvasZoom } from "./ui/ZoomControls";

const KEY_TO_TOOL: Record<string, ToolId> = {
  v: "select",
  a: "node",
  m: "rect",
  l: "ellipse",
  p: "pen",
  t: "text",
  k: "measure",
  i: "eyedropper",
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
  const copySelection = useEditorStore((state) => state.copySelection);
  const paste = useEditorStore((state) => state.paste);
  const duplicateSelection = useEditorStore((state) => state.duplicateSelection);
  const bringToFront = useEditorStore((state) => state.bringToFront);
  const sendToBack = useEditorStore((state) => state.sendToBack);
  const bringForward = useEditorStore((state) => state.bringForward);
  const sendBackward = useEditorStore((state) => state.sendBackward);
  const groupSelection = useEditorStore((state) => state.groupSelection);
  const ungroupSelection = useEditorStore((state) => state.ungroupSelection);
  const moveSelection = useEditorStore((state) => state.moveSelection);
  const flipSelection = useEditorStore((state) => state.flipSelection);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent): void => {
      if (isTypingTarget(event.target)) {
        return;
      }

      const key = event.key.toLowerCase();
      const hasCommandModifier = event.ctrlKey || event.metaKey;

      if (!hasCommandModifier && !event.altKey && event.shiftKey && key === "h") {
        event.preventDefault();
        flipSelection("horizontal");
        return;
      }

      if (!hasCommandModifier && !event.altKey && event.shiftKey && key === "v") {
        event.preventDefault();
        flipSelection("vertical");
        return;
      }

      if (hasCommandModifier && key === "z") {
        event.preventDefault();
        if (event.shiftKey) {
          redo();
        } else {
          undo();
        }
        return;
      }

      if (hasCommandModifier && key === "0") {
        event.preventDefault();
        fitCanvasToScreen();
        return;
      }

      if (hasCommandModifier && key === "1") {
        event.preventDefault();
        resetCanvasZoom();
        return;
      }

      if (hasCommandModifier && key === "c") {
        event.preventDefault();
        copySelection();
        return;
      }

      if (hasCommandModifier && key === "v") {
        event.preventDefault();
        paste();
        return;
      }

      if (hasCommandModifier && key === "d") {
        event.preventDefault();
        duplicateSelection();
        return;
      }

      if (hasCommandModifier && key === "g") {
        event.preventDefault();
        if (event.shiftKey) {
          ungroupSelection();
        } else {
          groupSelection();
        }
        return;
      }

      if (hasCommandModifier && (key === "]" || key === "}")) {
        event.preventDefault();
        if (event.shiftKey) {
          bringToFront();
        } else {
          bringForward();
        }
        return;
      }

      if (hasCommandModifier && (key === "[" || key === "{")) {
        event.preventDefault();
        if (event.shiftKey) {
          sendToBack();
        } else {
          sendBackward();
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

      if (!hasCommandModifier && !event.altKey) {
        const nudgeDistance = event.shiftKey ? 10 : 1;
        const nudgeDelta: Record<string, readonly [number, number]> = {
          arrowup: [0, -nudgeDistance],
          arrowdown: [0, nudgeDistance],
          arrowleft: [-nudgeDistance, 0],
          arrowright: [nudgeDistance, 0],
        };
        const delta = nudgeDelta[key];

        if (delta !== undefined) {
          event.preventDefault();
          if (selection.length > 0) {
            moveSelection(delta[0], delta[1]);
          }
          return;
        }
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
  }, [
    bringForward,
    bringToFront,
    copySelection,
    duplicateSelection,
    flipSelection,
    groupSelection,
    moveSelection,
    paste,
    redo,
    removeNodes,
    selection,
    sendBackward,
    sendToBack,
    setActiveTool,
    ungroupSelection,
    undo,
  ]);

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
        <div className="app__canvas-region">
          <CanvasView />
          <ZoomControls />
        </div>
        <aside className="app__right-panel">
          <RightPanel />
        </aside>
      </main>
    </div>
  );
}
