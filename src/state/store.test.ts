import { beforeEach, describe, expect, it } from "vitest";
import { createRect } from "../core/model/factory";
import type { Document, NodeId } from "../core/model/types";
import { canRedo, canUndo, createHistory } from "./history";
import { createEditorStateForTest, editorStore, type SnapTarget } from "./store";
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

  it("defaults snap and grid editor state to current behavior", () => {
    expect(editorStore.getState().snapSettings).toEqual({
      enabled: true,
      toObjects: true,
      toGuides: true,
      toGrid: true,
      gridSize: 8,
    });
    expect(editorStore.getState().showGrid).toBe(false);
  });

  it("updates snap enabled without touching other editor state", () => {
    const before = editorStore.getState();

    editorStore.getState().setSnapEnabled(false);

    const after = editorStore.getState();
    expect(after.snapSettings).toEqual({ ...before.snapSettings, enabled: false });
    expect(after.showGrid).toBe(before.showGrid);
    expect(after.doc).toBe(before.doc);
    expect(after.history).toBe(before.history);
  });

  it("updates individual snap targets without touching sibling fields", () => {
    const cases: ReadonlyArray<{ target: SnapTarget; key: "toObjects" | "toGuides" | "toGrid" }> = [
      { target: "objects", key: "toObjects" },
      { target: "guides", key: "toGuides" },
      { target: "grid", key: "toGrid" },
    ];

    for (const { target, key } of cases) {
      resetStore();
      const before = editorStore.getState();

      editorStore.getState().setSnapTarget(target, false);

      const after = editorStore.getState();
      expect(after.snapSettings).toEqual({ ...before.snapSettings, [key]: false });
      expect(after.showGrid).toBe(before.showGrid);
      expect(after.doc).toBe(before.doc);
      expect(after.history).toBe(before.history);
    }
  });

  it("updates grid size and rejects non-positive or NaN values", () => {
    const before = editorStore.getState();

    editorStore.getState().setGridSize(16);

    const changed = editorStore.getState();
    expect(changed.snapSettings).toEqual({ ...before.snapSettings, gridSize: 16 });
    expect(changed.showGrid).toBe(before.showGrid);
    expect(changed.doc).toBe(before.doc);
    expect(changed.history).toBe(before.history);

    editorStore.getState().setGridSize(0);
    editorStore.getState().setGridSize(-4);
    editorStore.getState().setGridSize(Number.NaN);

    expect(editorStore.getState().snapSettings.gridSize).toBe(16);
  });

  it("updates show grid without touching snap settings or history", () => {
    const before = editorStore.getState();

    editorStore.getState().setShowGrid(true);

    const after = editorStore.getState();
    expect(after.showGrid).toBe(true);
    expect(after.snapSettings).toEqual(before.snapSettings);
    expect(after.doc).toBe(before.doc);
    expect(after.history).toBe(before.history);
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

  it("updates guide preferences through undoable document history", () => {
    const id = editorStore.getState().addGuide("x", 80);
    expect(id).not.toBeNull();
    const guideId = id ?? "";

    editorStore.getState().setGuideColor(guideId, "#00d8ff");
    editorStore.getState().setGuideLocked(guideId, true);
    editorStore.getState().setGuideHidden(guideId, true);

    expect(editorStore.getState().doc.guides).toEqual([
      { id: guideId, axis: "x", position: 80, color: "#00d8ff", locked: true, hidden: true },
    ]);

    editorStore.getState().undo();
    expect(editorStore.getState().doc.guides[0]).toEqual({
      id: guideId,
      axis: "x",
      position: 80,
      color: "#00d8ff",
      locked: true,
    });

    editorStore.getState().undo();
    expect(editorStore.getState().doc.guides[0]).toEqual({ id: guideId, axis: "x", position: 80, color: "#00d8ff" });

    editorStore.getState().redo();
    editorStore.getState().redo();
    expect(editorStore.getState().doc.guides[0]?.hidden).toBe(true);
  });

  it("does not push history when guide preference actions miss", () => {
    const before = editorStore.getState().doc;

    editorStore.getState().setGuideColor("missing-guide", "#00d8ff");
    editorStore.getState().setGuideLocked("missing-guide", true);
    editorStore.getState().setGuideHidden("missing-guide", true);

    expect(editorStore.getState().doc).toBe(before);
    expect(editorStore.getState().history.past).toHaveLength(0);
  });
});
