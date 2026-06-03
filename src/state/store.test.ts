import { beforeEach, describe, expect, it } from "vitest";
import { createRect } from "../core/model/factory";
import type { Document, NodeId } from "../core/model/types";
import { canRedo, canUndo, createHistory } from "./history";
import { createEditorStateForTest, editorStore } from "./store";
import { getDocBounds, getSelectedNodes, isSelected } from "./selectors";

const resetStore = (): void => {
  editorStore.setState(createEditorStateForTest());
};

const firstLayerId = (doc: Document): NodeId => doc.layerOrder[0]!;

describe("editorStore", () => {
  beforeEach(() => {
    resetStore();
  });

  it("adds a node, undo restores the previous doc, and redo reapplies it", () => {
    const before = editorStore.getState().doc;
    const rect = createRect(10, 20, 30, 40);

    editorStore.getState().addNode(rect);

    expect(editorStore.getState().doc).not.toBe(before);
    expect(editorStore.getState().doc.nodes[rect.id]).toEqual(rect);
    expect(canUndo(editorStore.getState().history)).toBe(true);

    editorStore.getState().undo();

    expect(editorStore.getState().doc).toBe(before);
    expect(editorStore.getState().doc.nodes[rect.id]).toBeUndefined();
    expect(canRedo(editorStore.getState().history)).toBe(true);

    editorStore.getState().redo();

    expect(editorStore.getState().doc.nodes[rect.id]).toEqual(rect);
    expect(editorStore.getState().doc.nodes[firstLayerId(editorStore.getState().doc)]?.type).toBe("layer");
  });

  it("does not push selection, tool, or viewport changes to history", () => {
    const rect = createRect(0, 0, 10, 10);
    editorStore.getState().addNode(rect);
    const historyDepth = editorStore.getState().history.past.length;

    editorStore.getState().setSelection([rect.id]);
    editorStore.getState().addToSelection(rect.id);
    editorStore.getState().setActiveTool("hand");
    editorStore.getState().setPan({ x: 12, y: 24 });
    editorStore.getState().setZoom(2);
    editorStore.getState().clearSelection();

    expect(editorStore.getState().history.past).toHaveLength(historyDepth);
    expect(editorStore.getState().activeTool).toBe("hand");
    expect(editorStore.getState().viewport).toEqual({ pan: { x: 12, y: 24 }, zoom: 2 });
  });

  it("updates and moves selected nodes through document history", () => {
    const rect = createRect(5, 6, 10, 10);
    editorStore.getState().addNode(rect);
    editorStore.getState().setSelection([rect.id]);

    editorStore.getState().updateNode(rect.id, { name: "Updated rectangle" });
    editorStore.getState().moveSelection(3, 4);

    const moved = editorStore.getState().doc.nodes[rect.id];
    expect(moved?.name).toBe("Updated rectangle");
    expect(moved?.transform.e).toBe(8);
    expect(moved?.transform.f).toBe(10);

    editorStore.getState().undo();
    expect(editorStore.getState().doc.nodes[rect.id]?.transform.e).toBe(5);
    expect(editorStore.getState().doc.nodes[rect.id]?.name).toBe("Updated rectangle");

    editorStore.getState().undo();
    expect(editorStore.getState().doc.nodes[rect.id]?.name).toBe("Rectangle");
  });

  it("removes nodes from parents and clears removed selections", () => {
    const rect = createRect(0, 0, 10, 10);
    editorStore.getState().addNode(rect);
    editorStore.getState().setSelection([rect.id]);

    editorStore.getState().removeNodes([rect.id]);

    const layer = editorStore.getState().doc.nodes[firstLayerId(editorStore.getState().doc)];
    expect(editorStore.getState().doc.nodes[rect.id]).toBeUndefined();
    expect(layer?.type === "layer" ? layer.children : []).not.toContain(rect.id);
    expect(editorStore.getState().selection).toEqual([]);

    editorStore.getState().undo();
    expect(editorStore.getState().doc.nodes[rect.id]).toEqual(rect);
  });

  it("caps document history at 100 snapshots", () => {
    for (let i = 0; i < 105; i += 1) {
      editorStore.getState().addNode(createRect(i, i, 10, 10));
    }

    expect(editorStore.getState().history.past).toHaveLength(100);
  });

  it("selects nodes and computes document bounds with pure selectors", () => {
    const rect = createRect(10, 20, 30, 40);
    editorStore.getState().addNode(rect);
    editorStore.getState().setSelection([rect.id]);

    const state = editorStore.getState();

    expect(isSelected(state, rect.id)).toBe(true);
    expect(getSelectedNodes(state)).toEqual([rect]);
    expect(getDocBounds(state)).toEqual({ minX: 10, minY: 20, maxX: 40, maxY: 60 });
  });

  it("creates generic history with undo and redo availability helpers", () => {
    const history = createHistory<string>();

    expect(canUndo(history)).toBe(false);
    expect(canRedo(history)).toBe(false);
  });
});
