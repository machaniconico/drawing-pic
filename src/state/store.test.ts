import { beforeEach, describe, expect, it, vi } from "vitest";
import type { BBox } from "../core/geometry/bbox";
import type { Matrix } from "../core/geometry/matrix";
import { selectionBounds } from "../core/model/bounds";
import { createEllipse, createGroup, createPath, createRect } from "../core/model/factory";
import type { Document, NodeId, Paint, Stroke } from "../core/model/types";
import { canRedo, canUndo, createHistory } from "./history";
import { flipNodes, rotateNodes90, rotateNodesAround } from "./operations";
import { createEditorStateForTest, editorStore, type SnapSettings, type SnapTarget } from "./store";
import { getDocBounds, getSelectedNodes, isSelected } from "./selectors";

type PersistedPrefsMockPayload = {
  snapSettings?: Partial<SnapSettings>;
  showGrid?: boolean;
};

const persistMock = vi.hoisted(() => ({
  loadEditorPrefs: vi.fn<() => PersistedPrefsMockPayload | null>(() => null),
  saveEditorPrefs: vi.fn(),
}));

vi.mock("./persist", () => persistMock);

const resetStore = (): void => {
  editorStore.setState(createEditorStateForTest());
};

const firstLayerId = (doc: Document): NodeId => doc.layerOrder[0]!;

const expectMatrixCloseTo = (actual: Matrix | undefined, expected: Matrix): void => {
  expect(actual).toBeDefined();
  expect(actual?.a).toBeCloseTo(expected.a, 9);
  expect(actual?.b).toBeCloseTo(expected.b, 9);
  expect(actual?.c).toBeCloseTo(expected.c, 9);
  expect(actual?.d).toBeCloseTo(expected.d, 9);
  expect(actual?.e).toBeCloseTo(expected.e, 9);
  expect(actual?.f).toBeCloseTo(expected.f, 9);
};

const expectBoundsCloseTo = (actual: BBox, expected: BBox): void => {
  expect(actual.minX).toBeCloseTo(expected.minX, 9);
  expect(actual.minY).toBeCloseTo(expected.minY, 9);
  expect(actual.maxX).toBeCloseTo(expected.maxX, 9);
  expect(actual.maxY).toBeCloseTo(expected.maxY, 9);
};

describe("editorStore", () => {
  beforeEach(() => {
    persistMock.loadEditorPrefs.mockReturnValue(null);
    persistMock.saveEditorPrefs.mockClear();
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

  it("selects nodes with the same fill as the first selected node without pushing history", () => {
    const redFill: Paint = { type: "solid", color: { r: 255, g: 0, b: 0, a: 1 } };
    const blueFill: Paint = { type: "solid", color: { r: 0, g: 64, b: 255, a: 1 } };
    const redLeft = createRect(0, 0, 10, 10);
    const blue = createRect(20, 0, 10, 10);
    const redRight = createRect(40, 0, 10, 10);
    redLeft.fill = redFill;
    blue.fill = blueFill;
    redRight.fill = { type: "solid", color: { r: 255, g: 0, b: 0, a: 1 } };
    editorStore.getState().addNode(redLeft);
    editorStore.getState().addNode(blue);
    editorStore.getState().addNode(redRight);
    editorStore.getState().setSelection([redLeft.id, blue.id]);
    editorStore.getState().setKeyObject(blue.id);
    editorStore.setState({ history: createHistory<Document>() });
    const beforeDoc = editorStore.getState().doc;

    editorStore.getState().selectSameFill();

    expect(editorStore.getState().selection).toEqual([redLeft.id, redRight.id]);
    expect(editorStore.getState().keyObjectId).toBeNull();
    expect(editorStore.getState().doc).toBe(beforeDoc);
    expect(editorStore.getState().history.past).toHaveLength(0);
    expect(canUndo(editorStore.getState().history)).toBe(false);
  });

  it("selects nodes with the same stroke as the first selected node without pushing history", () => {
    const matchingStroke: Stroke = {
      paint: { type: "solid", color: { r: 20, g: 20, b: 20, a: 1 } },
      width: 3,
      cap: "round",
      join: "round",
      miterLimit: 8,
      dash: [4, 2],
      dashOffset: 1,
      align: "center",
    };
    const otherStroke: Stroke = {
      ...matchingStroke,
      width: 6,
      dash: [4, 2],
    };
    const strokedLeft = createRect(0, 0, 10, 10);
    const other = createRect(20, 0, 10, 10);
    const strokedRight = createRect(40, 0, 10, 10);
    strokedLeft.stroke = matchingStroke;
    other.stroke = otherStroke;
    strokedRight.stroke = {
      ...matchingStroke,
      paint: { type: "solid", color: { r: 20, g: 20, b: 20, a: 1 } },
      dash: [4, 2],
    };
    editorStore.getState().addNode(strokedLeft);
    editorStore.getState().addNode(other);
    editorStore.getState().addNode(strokedRight);
    editorStore.getState().setSelection([strokedLeft.id]);
    editorStore.setState({ history: createHistory<Document>() });
    const beforeDoc = editorStore.getState().doc;

    editorStore.getState().selectSameStroke();

    expect(editorStore.getState().selection).toEqual([strokedLeft.id, strokedRight.id]);
    expect(editorStore.getState().doc).toBe(beforeDoc);
    expect(editorStore.getState().history.past).toHaveLength(0);
    expect(canUndo(editorStore.getState().history)).toBe(false);
  });

  it("does nothing when select same fill or stroke runs without a selection", () => {
    const rect = createRect(0, 0, 10, 10);
    editorStore.getState().addNode(rect);
    editorStore.setState({ history: createHistory<Document>() });
    const before = editorStore.getState();

    editorStore.getState().selectSameFill();
    editorStore.getState().selectSameStroke();

    expect(editorStore.getState().selection).toEqual([]);
    expect(editorStore.getState().doc).toBe(before.doc);
    expect(editorStore.getState().history).toBe(before.history);
  });

  it("sets key object as non-undoable editor state", () => {
    const left = createRect(0, 0, 10, 10);
    const right = createRect(50, 0, 10, 10);
    editorStore.getState().addNode(left);
    editorStore.getState().addNode(right);
    editorStore.getState().setSelection([left.id, right.id]);
    const historyDepth = editorStore.getState().history.past.length;

    editorStore.getState().setKeyObject(right.id);

    expect(editorStore.getState().keyObjectId).toBe(right.id);
    expect(editorStore.getState().history.past).toHaveLength(historyDepth);

    editorStore.getState().setKeyObject(null);

    expect(editorStore.getState().keyObjectId).toBeNull();
    expect(editorStore.getState().history.past).toHaveLength(historyDepth);

    editorStore.getState().setKeyObject(right.id);
    editorStore.getState().setSelection([left.id]);
    editorStore.getState().setKeyObject(right.id);

    expect(editorStore.getState().keyObjectId).toBeNull();
    expect(editorStore.getState().history.past).toHaveLength(historyDepth);
  });

  it("clears key object when it leaves selection", () => {
    const left = createRect(0, 0, 10, 10);
    const right = createRect(50, 0, 10, 10);
    editorStore.getState().addNode(left);
    editorStore.getState().addNode(right);

    editorStore.getState().setSelection([left.id, right.id]);
    editorStore.getState().setKeyObject(right.id);
    editorStore.getState().setSelection([left.id]);

    expect(editorStore.getState().keyObjectId).toBeNull();

    editorStore.getState().setSelection([left.id, right.id]);
    editorStore.getState().setKeyObject(left.id);
    editorStore.getState().clearSelection();

    expect(editorStore.getState().keyObjectId).toBeNull();

    editorStore.getState().setSelection([left.id, right.id]);
    editorStore.getState().setKeyObject(right.id);
    editorStore.getState().removeNodes([right.id]);

    expect(editorStore.getState().selection).toEqual([left.id]);
    expect(editorStore.getState().keyObjectId).toBeNull();
  });

  it("clears key object after duplicate replaces the selection", () => {
    const left = createRect(0, 0, 10, 10);
    const right = createRect(50, 0, 10, 10);
    editorStore.getState().addNode(left);
    editorStore.getState().addNode(right);

    editorStore.getState().setSelection([left.id, right.id]);
    editorStore.getState().setKeyObject(right.id);
    editorStore.getState().duplicateSelection();

    // Selection now points at the freshly cloned nodes; the old key object is gone from it.
    expect(editorStore.getState().selection).not.toContain(right.id);
    expect(editorStore.getState().keyObjectId).toBeNull();
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

  it("sets document size and undoes it as one history step", () => {
    const before = editorStore.getState();
    const beforeDoc = before.doc;
    const nextWidth = beforeDoc.width + 120;
    const nextHeight = beforeDoc.height + 80;

    editorStore.getState().setDocumentSize(nextWidth, nextHeight);

    const after = editorStore.getState();
    expect(after.doc.width).toBe(nextWidth);
    expect(after.doc.height).toBe(nextHeight);
    expect(after.history.past).toHaveLength(before.history.past.length + 1);
    expect(after.selection).toBe(before.selection);
    expect(after.keyObjectId).toBe(before.keyObjectId);
    expect(after.activeTool).toBe(before.activeTool);
    expect(after.viewport).toBe(before.viewport);
    expect(after.snapSettings).toBe(before.snapSettings);
    expect(after.showGrid).toBe(before.showGrid);
    expect(after.clipboard).toBe(before.clipboard);

    editorStore.getState().undo();

    expect(editorStore.getState().doc).toBe(beforeDoc);
    expect(editorStore.getState().doc.width).toBe(beforeDoc.width);
    expect(editorStore.getState().doc.height).toBe(beforeDoc.height);
    expect(canRedo(editorStore.getState().history)).toBe(true);
  });

  it("sets document name and undoes it as one history step", () => {
    const before = editorStore.getState();
    const beforeDoc = before.doc;

    editorStore.getState().setDocumentName("  Client Poster  ");

    const after = editorStore.getState();
    expect(after.doc.name).toBe("Client Poster");
    expect(after.history.past).toHaveLength(before.history.past.length + 1);
    expect(after.selection).toBe(before.selection);
    expect(after.keyObjectId).toBe(before.keyObjectId);
    expect(after.activeTool).toBe(before.activeTool);
    expect(after.viewport).toBe(before.viewport);
    expect(after.snapSettings).toBe(before.snapSettings);
    expect(after.showGrid).toBe(before.showGrid);
    expect(after.clipboard).toBe(before.clipboard);

    editorStore.getState().undo();

    expect(editorStore.getState().doc).toBe(beforeDoc);
    expect(editorStore.getState().doc.name).toBe(beforeDoc.name);
    expect(canRedo(editorStore.getState().history)).toBe(true);
  });

  it("sets and clears document background through undoable history", () => {
    const before = editorStore.getState();
    const beforeDoc = before.doc;
    const color = { r: 24, g: 128, b: 220, a: 1 };

    editorStore.getState().setDocumentBackground(color);

    const withBackground = editorStore.getState();
    expect(withBackground.doc.background).toEqual(color);
    expect(withBackground.doc.background).not.toBe(color);
    expect(withBackground.history.past).toHaveLength(before.history.past.length + 1);

    editorStore.getState().setDocumentBackground({ ...color });

    expect(editorStore.getState().doc).toBe(withBackground.doc);
    expect(editorStore.getState().history.past).toHaveLength(before.history.past.length + 1);

    editorStore.getState().setDocumentBackground(null);

    expect(editorStore.getState().doc.background).toBeNull();
    expect(editorStore.getState().history.past).toHaveLength(before.history.past.length + 2);

    const clearedDoc = editorStore.getState().doc;
    editorStore.getState().setDocumentBackground(null);

    expect(editorStore.getState().doc).toBe(clearedDoc);
    expect(editorStore.getState().history.past).toHaveLength(before.history.past.length + 2);

    editorStore.getState().undo();

    expect(editorStore.getState().doc.background).toEqual(color);
    expect(canRedo(editorStore.getState().history)).toBe(true);

    editorStore.getState().undo();

    expect(editorStore.getState().doc).toBe(beforeDoc);
    expect(editorStore.getState().doc.background).toBeUndefined();

    editorStore.getState().redo();

    expect(editorStore.getState().doc.background).toEqual(color);
  });

  it("does not push history for document metadata no-op guards", () => {
    const initialDoc = editorStore.getState().doc;

    editorStore.getState().setDocumentSize(initialDoc.width, initialDoc.height);
    editorStore.getState().setDocumentSize(Number.NaN, Number.POSITIVE_INFINITY);
    editorStore.getState().setDocumentName(initialDoc.name);
    editorStore.getState().setDocumentName(`  ${initialDoc.name}  `);
    editorStore.getState().setDocumentName("");
    editorStore.getState().setDocumentName("   ");

    expect(editorStore.getState().doc).toBe(initialDoc);
    expect(editorStore.getState().history.past).toHaveLength(0);
    expect(canUndo(editorStore.getState().history)).toBe(false);

    editorStore.getState().setDocumentSize(0, -40);

    expect(editorStore.getState().doc.width).toBe(1);
    expect(editorStore.getState().doc.height).toBe(1);
    expect(editorStore.getState().history.past).toHaveLength(1);

    editorStore.getState().undo();
    expect(editorStore.getState().doc).toBe(initialDoc);

    editorStore.getState().setDocumentSize(Number.NaN, initialDoc.height + 20);

    expect(editorStore.getState().doc.width).toBe(initialDoc.width);
    expect(editorStore.getState().doc.height).toBe(initialDoc.height + 20);
    expect(editorStore.getState().history.past).toHaveLength(1);
  });

  it("rehydrates persisted snap settings and grid visibility over current defaults", () => {
    persistMock.loadEditorPrefs.mockReturnValue({
      snapSettings: {
        enabled: false,
        gridSize: 24,
      },
      showGrid: true,
    });

    const state = createEditorStateForTest();

    expect(state.snapSettings).toEqual({
      enabled: false,
      toObjects: true,
      toGuides: true,
      toGrid: true,
      gridSize: 24,
    });
    expect(state.showGrid).toBe(true);
    expect(state.selection).toEqual([]);
    expect(state.viewport).toEqual({ pan: { x: 0, y: 0 }, zoom: 1 });
    expect(state.keyObjectId).toBeNull();
  });

  it("persists updated preferences from each prefs action without pushing history", () => {
    const cases: ReadonlyArray<{
      act: () => void;
      expected: { snapSettings: Record<string, boolean | number>; showGrid: boolean };
    }> = [
      {
        act: () => editorStore.getState().setSnapEnabled(false),
        expected: {
          snapSettings: { enabled: false, toObjects: true, toGuides: true, toGrid: true, gridSize: 8 },
          showGrid: false,
        },
      },
      {
        act: () => editorStore.getState().setSnapTarget("grid", false),
        expected: {
          snapSettings: { enabled: true, toObjects: true, toGuides: true, toGrid: false, gridSize: 8 },
          showGrid: false,
        },
      },
      {
        act: () => editorStore.getState().setGridSize(16),
        expected: {
          snapSettings: { enabled: true, toObjects: true, toGuides: true, toGrid: true, gridSize: 16 },
          showGrid: false,
        },
      },
      {
        act: () => editorStore.getState().setShowGrid(true),
        expected: {
          snapSettings: { enabled: true, toObjects: true, toGuides: true, toGrid: true, gridSize: 8 },
          showGrid: true,
        },
      },
    ];

    for (const { act, expected } of cases) {
      resetStore();
      persistMock.saveEditorPrefs.mockClear();
      const before = editorStore.getState();

      act();

      expect(persistMock.saveEditorPrefs).toHaveBeenCalledTimes(1);
      expect(persistMock.saveEditorPrefs).toHaveBeenCalledWith(expected);
      expect(editorStore.getState().history).toBe(before.history);
      expect(editorStore.getState().doc).toBe(before.doc);
    }
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

  it("applies fill to styled nodes in a mixed selection as one undoable cloned style step", () => {
    const left = createRect(0, 0, 10, 10);
    const right = createRect(20, 0, 10, 10);
    editorStore.getState().addNode(left);
    editorStore.getState().addNode(right);
    const layerId = firstLayerId(editorStore.getState().doc);
    const fill: Paint = { type: "solid", color: { r: 10, g: 80, b: 240, a: 0.75 } };

    editorStore.getState().setSelection([left.id, layerId, right.id]);
    editorStore.setState({ history: createHistory<Document>() });
    const beforeDoc = editorStore.getState().doc;

    editorStore.getState().applyStyleToSelection({ fill });

    const leftNode = editorStore.getState().doc.nodes[left.id];
    const rightNode = editorStore.getState().doc.nodes[right.id];
    const layer = editorStore.getState().doc.nodes[layerId];
    expect(leftNode?.type).toBe("rect");
    expect(rightNode?.type).toBe("rect");
    if (leftNode?.type !== "rect" || rightNode?.type !== "rect") {
      throw new Error("Expected selected test nodes to be rectangles");
    }

    expect(leftNode.fill).toEqual(fill);
    expect(rightNode.fill).toEqual(fill);
    expect(leftNode.fill).not.toBe(fill);
    expect(rightNode.fill).not.toBe(fill);
    expect(leftNode.fill).not.toBe(rightNode.fill);
    expect(leftNode.fill.type === "solid" ? leftNode.fill.color : null).not.toBe(
      rightNode.fill.type === "solid" ? rightNode.fill.color : null,
    );
    expect("fill" in (layer ?? {})).toBe(false);
    expect(editorStore.getState().history.past).toHaveLength(1);

    editorStore.getState().undo();

    expect(editorStore.getState().doc).toBe(beforeDoc);
    expect(canRedo(editorStore.getState().history)).toBe(true);
  });

  it("applies clamped opacity to every selected node", () => {
    const rect = createRect(0, 0, 10, 10);
    editorStore.getState().addNode(rect);
    const layerId = firstLayerId(editorStore.getState().doc);
    editorStore.getState().setSelection([rect.id, layerId]);
    editorStore.setState({ history: createHistory<Document>() });
    const beforeDoc = editorStore.getState().doc;

    editorStore.getState().applyStyleToSelection({ opacity: -0.25 });

    expect(editorStore.getState().doc.nodes[rect.id]?.opacity).toBe(0);
    expect(editorStore.getState().doc.nodes[layerId]?.opacity).toBe(0);
    expect(editorStore.getState().history.past).toHaveLength(1);

    editorStore.getState().undo();

    expect(editorStore.getState().doc).toBe(beforeDoc);
    expect(editorStore.getState().doc.nodes[rect.id]?.opacity).toBe(1);
    expect(editorStore.getState().doc.nodes[layerId]?.opacity).toBe(1);
  });

  it("does not push history for empty or unchanged selection style patches", () => {
    const rect = createRect(0, 0, 10, 10);
    editorStore.getState().addNode(rect);
    editorStore.setState({ history: createHistory<Document>() });
    const beforeDoc = editorStore.getState().doc;

    editorStore.getState().applyStyleToSelection({ fill: { type: "none" } });
    editorStore.getState().setSelection([rect.id]);
    editorStore.getState().applyStyleToSelection({});
    editorStore.getState().applyStyleToSelection({ fill: rect.fill, stroke: rect.stroke, opacity: rect.opacity });
    editorStore.getState().applyStyleToSelection({ fill: undefined, stroke: undefined, opacity: undefined });

    expect(editorStore.getState().doc).toBe(beforeDoc);
    expect(editorStore.getState().history.past).toHaveLength(0);
    expect(canUndo(editorStore.getState().history)).toBe(false);
  });

  it("pastes copied nodes in place, selects the clones, and undoes as one history step", () => {
    const rect = createRect(24, 36, 10, 10);
    editorStore.getState().addNode(rect);
    editorStore.getState().setSelection([rect.id]);
    editorStore.getState().setKeyObject(rect.id);
    editorStore.getState().copySelection();
    const beforePasteDoc = editorStore.getState().doc;
    editorStore.setState({ history: createHistory<Document>() });

    editorStore.getState().pasteInPlace();

    const pastedIds = editorStore.getState().selection;
    expect(pastedIds).toHaveLength(1);
    expect(pastedIds[0]).not.toBe(rect.id);
    expectMatrixCloseTo(editorStore.getState().doc.nodes[pastedIds[0]!]?.transform, rect.transform);
    expect(editorStore.getState().keyObjectId).toBeNull();
    expect(editorStore.getState().history.past).toHaveLength(1);

    editorStore.getState().undo();

    expect(editorStore.getState().doc).toBe(beforePasteDoc);
    expect(editorStore.getState().doc.nodes[rect.id]).toBeDefined();
    expect(editorStore.getState().doc.nodes[pastedIds[0]!]).toBeUndefined();
    expect(canRedo(editorStore.getState().history)).toBe(true);
  });

  it("does not push history when pasteInPlace has an empty clipboard", () => {
    const beforeDoc = editorStore.getState().doc;

    editorStore.getState().pasteInPlace();

    expect(editorStore.getState().doc).toBe(beforeDoc);
    expect(editorStore.getState().history.past).toHaveLength(0);
    expect(canUndo(editorStore.getState().history)).toBe(false);
  });

  it("flips selected node transforms as one undoable history step", () => {
    const left = createRect(0, 0, 10, 20);
    const right = createRect(40, 10, 20, 10);
    editorStore.getState().addNode(left);
    editorStore.getState().addNode(right);
    editorStore.getState().setSelection([left.id, right.id]);

    const beforeLeft = { ...editorStore.getState().doc.nodes[left.id]!.transform };
    const beforeRight = { ...editorStore.getState().doc.nodes[right.id]!.transform };
    const expected = flipNodes(editorStore.getState().doc, editorStore.getState().selection, "horizontal");
    editorStore.setState({ history: createHistory<Document>() });

    editorStore.getState().flipSelection("horizontal");

    expectMatrixCloseTo(editorStore.getState().doc.nodes[left.id]?.transform, expected[left.id]!);
    expectMatrixCloseTo(editorStore.getState().doc.nodes[right.id]?.transform, expected[right.id]!);
    expect(editorStore.getState().history.past).toHaveLength(1);

    editorStore.getState().undo();

    expect(editorStore.getState().doc.nodes[left.id]?.transform).toEqual(beforeLeft);
    expect(editorStore.getState().doc.nodes[right.id]?.transform).toEqual(beforeRight);
    expect(canRedo(editorStore.getState().history)).toBe(true);
  });

  it("rotates selected node transforms 90 degrees as one undoable history step", () => {
    const rect = createRect(10, 20, 30, 40);
    editorStore.getState().addNode(rect);
    editorStore.getState().setSelection([rect.id]);

    const beforeTransform = { ...editorStore.getState().doc.nodes[rect.id]!.transform };
    const expected = rotateNodes90(editorStore.getState().doc, editorStore.getState().selection, "cw");
    editorStore.setState({ history: createHistory<Document>() });

    editorStore.getState().rotateSelection90("cw");

    expectMatrixCloseTo(editorStore.getState().doc.nodes[rect.id]?.transform, expected[rect.id]!);
    expect(editorStore.getState().history.past).toHaveLength(1);

    editorStore.getState().undo();

    expect(editorStore.getState().doc.nodes[rect.id]?.transform).toEqual(beforeTransform);
    expect(canRedo(editorStore.getState().history)).toBe(true);
  });

  it("rotates selected node transforms by radians as one undoable history step", () => {
    const left = createRect(10, 20, 30, 40);
    const right = createRect(70, 30, 20, 10);
    editorStore.getState().addNode(left);
    editorStore.getState().addNode(right);
    editorStore.getState().setSelection([left.id, right.id]);

    const beforeDoc = editorStore.getState().doc;
    const beforeLeft = { ...beforeDoc.nodes[left.id]!.transform };
    const beforeRight = { ...beforeDoc.nodes[right.id]!.transform };
    const expected = rotateNodesAround(beforeDoc, editorStore.getState().selection, Math.PI / 4);
    editorStore.setState({ history: createHistory<Document>() });

    editorStore.getState().rotateSelectionBy(Math.PI / 4);

    expectMatrixCloseTo(editorStore.getState().doc.nodes[left.id]?.transform, expected[left.id]!);
    expectMatrixCloseTo(editorStore.getState().doc.nodes[right.id]?.transform, expected[right.id]!);
    expect(editorStore.getState().history.past).toHaveLength(1);

    editorStore.getState().undo();

    expect(editorStore.getState().doc).toBe(beforeDoc);
    expect(editorStore.getState().doc.nodes[left.id]?.transform).toEqual(beforeLeft);
    expect(editorStore.getState().doc.nodes[right.id]?.transform).toEqual(beforeRight);
    expect(canRedo(editorStore.getState().history)).toBe(true);
  });

  it("does not push history when flipping or rotating an empty selection", () => {
    const rect = createRect(3, 4, 10, 10);
    editorStore.getState().addNode(rect);
    editorStore.getState().clearSelection();
    editorStore.setState({ history: createHistory<Document>() });
    const beforeDoc = editorStore.getState().doc;
    const beforeTransform = { ...editorStore.getState().doc.nodes[rect.id]!.transform };

    editorStore.getState().flipSelection("vertical");
    editorStore.getState().rotateSelection90("ccw");

    expect(editorStore.getState().doc).toBe(beforeDoc);
    expect(editorStore.getState().doc.nodes[rect.id]?.transform).toEqual(beforeTransform);
    expect(editorStore.getState().history.past).toHaveLength(0);
    expect(canUndo(editorStore.getState().history)).toBe(false);
  });

  it("aligns to union bounds without a key object as one undoable step", () => {
    const left = createRect(0, 0, 10, 10);
    const right = createRect(50, 0, 10, 10);
    editorStore.getState().addNode(left);
    editorStore.getState().addNode(right);
    editorStore.getState().setSelection([left.id, right.id]);
    const beforeDoc = editorStore.getState().doc;
    editorStore.setState({ history: createHistory<Document>() });

    editorStore.getState().alignNodes("left");

    expect(editorStore.getState().doc.nodes[left.id]?.transform.e).toBe(0);
    expect(editorStore.getState().doc.nodes[right.id]?.transform.e).toBe(0);
    expect(editorStore.getState().history.past).toHaveLength(1);

    editorStore.getState().undo();

    expect(editorStore.getState().doc).toBe(beforeDoc);
    expect(editorStore.getState().doc.nodes[right.id]?.transform.e).toBe(50);
    expect(canRedo(editorStore.getState().history)).toBe(true);
  });

  it("aligns to key object bounds and keeps the key fixed as one undoable step", () => {
    const target = createRect(0, 0, 10, 10);
    const key = createRect(50, 0, 10, 10);
    editorStore.getState().addNode(target);
    editorStore.getState().addNode(key);
    editorStore.getState().setSelection([target.id, key.id]);
    editorStore.getState().setKeyObject(key.id);
    const beforeDoc = editorStore.getState().doc;
    editorStore.setState({ history: createHistory<Document>() });

    editorStore.getState().alignNodes("left");

    expect(editorStore.getState().doc.nodes[target.id]?.transform.e).toBe(50);
    expect(editorStore.getState().doc.nodes[key.id]?.transform.e).toBe(50);
    expect(editorStore.getState().keyObjectId).toBe(key.id);
    expect(editorStore.getState().history.past).toHaveLength(1);

    editorStore.getState().undo();

    expect(editorStore.getState().doc).toBe(beforeDoc);
    expect(editorStore.getState().doc.nodes[target.id]?.transform.e).toBe(0);
    expect(editorStore.getState().keyObjectId).toBe(key.id);
    expect(canRedo(editorStore.getState().history)).toBe(true);
  });

  it("distributes selected nodes by horizontal gap as one undoable step", () => {
    const left = createRect(0, 0, 10, 10);
    const middle = createRect(30, 20, 10, 10);
    const right = createRect(100, 40, 10, 10);
    editorStore.getState().addNode(left);
    editorStore.getState().addNode(middle);
    editorStore.getState().addNode(right);
    editorStore.getState().setSelection([left.id, middle.id, right.id]);
    const beforeDoc = editorStore.getState().doc;
    editorStore.setState({ history: createHistory<Document>() });

    editorStore.getState().distributeSelectionByGap("horizontal", 5);

    expect(editorStore.getState().doc.nodes[left.id]?.transform.e).toBe(0);
    expect(editorStore.getState().doc.nodes[middle.id]?.transform.e).toBe(15);
    expect(editorStore.getState().doc.nodes[right.id]?.transform.e).toBe(30);
    expect(editorStore.getState().doc.nodes[middle.id]?.transform.f).toBe(20);
    expect(editorStore.getState().doc.nodes[right.id]?.transform.f).toBe(40);
    expect(editorStore.getState().history.past).toHaveLength(1);

    editorStore.getState().undo();

    expect(editorStore.getState().doc).toBe(beforeDoc);
    expect(editorStore.getState().doc.nodes[middle.id]?.transform.e).toBe(30);
    expect(editorStore.getState().doc.nodes[right.id]?.transform.e).toBe(100);
    expect(canRedo(editorStore.getState().history)).toBe(true);
  });

  it("does not push history when gap distribution returns an empty patch map", () => {
    const left = createRect(0, 0, 10, 10);
    const right = createRect(40, 0, 10, 10);
    editorStore.getState().addNode(left);
    editorStore.getState().addNode(right);
    editorStore.setState({ selection: [left.id], history: createHistory<Document>() });
    const beforeDoc = editorStore.getState().doc;
    const beforeLeft = { ...beforeDoc.nodes[left.id]!.transform };
    const beforeRight = { ...beforeDoc.nodes[right.id]!.transform };

    editorStore.getState().distributeSelectionByGap("horizontal", 5);

    expect(editorStore.getState().doc).toBe(beforeDoc);
    expect(editorStore.getState().doc.nodes[left.id]?.transform).toEqual(beforeLeft);
    expect(editorStore.getState().doc.nodes[right.id]?.transform).toEqual(beforeRight);
    expect(editorStore.getState().history.past).toHaveLength(0);

    editorStore.getState().setSelection([left.id, right.id]);
    editorStore.getState().distributeSelectionByGap("horizontal", Number.NaN);

    expect(editorStore.getState().doc).toBe(beforeDoc);
    expect(editorStore.getState().doc.nodes[left.id]?.transform).toEqual(beforeLeft);
    expect(editorStore.getState().doc.nodes[right.id]?.transform).toEqual(beforeRight);
    expect(editorStore.getState().history.past).toHaveLength(0);
    expect(canUndo(editorStore.getState().history)).toBe(false);
  });

  it("does not push history for invalid rotateSelectionBy calls", () => {
    const rect = createRect(10, 20, 30, 40);
    editorStore.getState().addNode(rect);
    editorStore.setState({ history: createHistory<Document>() });

    editorStore.getState().clearSelection();
    const beforeEmptySelectionDoc = editorStore.getState().doc;
    const beforeTransform = { ...beforeEmptySelectionDoc.nodes[rect.id]!.transform };

    editorStore.getState().rotateSelectionBy(Math.PI / 4);

    expect(editorStore.getState().doc).toBe(beforeEmptySelectionDoc);
    expect(editorStore.getState().doc.nodes[rect.id]?.transform).toEqual(beforeTransform);
    expect(editorStore.getState().history.past).toHaveLength(0);
    expect(canUndo(editorStore.getState().history)).toBe(false);

    editorStore.getState().setSelection([rect.id]);
    const beforeInvalidDeltaDoc = editorStore.getState().doc;

    editorStore.getState().rotateSelectionBy(0);
    editorStore.getState().rotateSelectionBy(Number.NaN);
    editorStore.getState().rotateSelectionBy(Number.POSITIVE_INFINITY);
    editorStore.getState().rotateSelectionBy(Number.NEGATIVE_INFINITY);

    expect(editorStore.getState().doc).toBe(beforeInvalidDeltaDoc);
    expect(editorStore.getState().doc.nodes[rect.id]?.transform).toEqual(beforeTransform);
    expect(editorStore.getState().history.past).toHaveLength(0);
    expect(canUndo(editorStore.getState().history)).toBe(false);
  });

  it("does not push history when rotateSelectionBy produces an empty patch map", () => {
    const missingId: NodeId = "missing-node";
    editorStore.setState({ selection: [missingId], history: createHistory<Document>() });
    const beforeDoc = editorStore.getState().doc;

    editorStore.getState().rotateSelectionBy(Math.PI / 4);

    expect(editorStore.getState().doc).toBe(beforeDoc);
    expect(editorStore.getState().history.past).toHaveLength(0);
    expect(canUndo(editorStore.getState().history)).toBe(false);
  });

  it("sets selection position and undoes it as one history step", () => {
    const left = createRect(10, 20, 10, 20);
    const right = createRect(35, 30, 15, 10);
    editorStore.getState().addNode(left);
    editorStore.getState().addNode(right);
    editorStore.getState().setSelection([left.id, right.id]);
    const beforeDoc = editorStore.getState().doc;
    const beforeBounds = selectionBounds(beforeDoc, [left.id, right.id]);
    editorStore.setState({ history: createHistory<Document>() });

    editorStore.getState().setSelectionPosition(100, 200);

    expectBoundsCloseTo(selectionBounds(editorStore.getState().doc, [left.id, right.id]), {
      minX: 100,
      minY: 200,
      maxX: 140,
      maxY: 220,
    });
    expect(editorStore.getState().history.past).toHaveLength(1);

    editorStore.getState().undo();

    expect(editorStore.getState().doc).toBe(beforeDoc);
    expectBoundsCloseTo(selectionBounds(editorStore.getState().doc, [left.id, right.id]), beforeBounds);
    expect(canRedo(editorStore.getState().history)).toBe(true);
  });

  it("sets selection size and undoes it as one history step", () => {
    const left = createRect(10, 20, 10, 20);
    const right = createRect(35, 30, 15, 10);
    editorStore.getState().addNode(left);
    editorStore.getState().addNode(right);
    editorStore.getState().setSelection([left.id, right.id]);
    const beforeDoc = editorStore.getState().doc;
    const beforeBounds = selectionBounds(beforeDoc, [left.id, right.id]);
    editorStore.setState({ history: createHistory<Document>() });

    editorStore.getState().setSelectionSize(80, 40);

    expectBoundsCloseTo(selectionBounds(editorStore.getState().doc, [left.id, right.id]), {
      minX: 10,
      minY: 20,
      maxX: 90,
      maxY: 60,
    });
    expect(editorStore.getState().history.past).toHaveLength(1);

    editorStore.getState().undo();

    expect(editorStore.getState().doc).toBe(beforeDoc);
    expectBoundsCloseTo(selectionBounds(editorStore.getState().doc, [left.id, right.id]), beforeBounds);
    expect(canRedo(editorStore.getState().history)).toBe(true);
  });

  it("does not push history for empty selection, empty numeric op maps, or NaN numeric transforms", () => {
    const rect = createRect(10, 20, 30, 40);
    editorStore.getState().addNode(rect);
    editorStore.getState().clearSelection();
    editorStore.setState({ history: createHistory<Document>() });
    const beforeDoc = editorStore.getState().doc;

    editorStore.getState().setSelectionPosition(100, 200);
    editorStore.getState().setSelectionSize(80, 40);

    expect(editorStore.getState().doc).toBe(beforeDoc);
    expect(editorStore.getState().history.past).toHaveLength(0);

    const missingId: NodeId = "missing-node";
    editorStore.setState({ selection: [missingId] });

    editorStore.getState().setSelectionPosition(100, 200);
    editorStore.getState().setSelectionSize(80, 40);

    expect(editorStore.getState().doc).toBe(beforeDoc);
    expect(editorStore.getState().history.past).toHaveLength(0);

    editorStore.getState().setSelection([rect.id]);

    editorStore.getState().setSelectionPosition(Number.NaN, 200);
    editorStore.getState().setSelectionPosition(100, Number.NaN);
    editorStore.getState().setSelectionSize(Number.NaN, 40);
    editorStore.getState().setSelectionSize(80, Number.NaN);

    expect(editorStore.getState().doc).toBe(beforeDoc);
    expect(editorStore.getState().doc.nodes[rect.id]?.transform).toEqual(rect.transform);
    expect(editorStore.getState().history.past).toHaveLength(0);
    expect(canUndo(editorStore.getState().history)).toBe(false);
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

  it("makes a clipping mask by grouping two selected top-level nodes", () => {
    const artwork = createRect(0, 0, 40, 40);
    const mask = createRect(5, 5, 20, 20);
    editorStore.getState().addNode(artwork);
    editorStore.getState().addNode(mask);
    editorStore.getState().setSelection([artwork.id, mask.id]);
    const beforeDoc = editorStore.getState().doc;
    editorStore.setState({ history: createHistory<Document>() });

    editorStore.getState().toggleClipMask();

    const [groupId] = editorStore.getState().selection;
    const group = groupId ? editorStore.getState().doc.nodes[groupId] : undefined;
    const layer = editorStore.getState().doc.nodes[firstLayerId(editorStore.getState().doc)];

    expect(group?.type).toBe("group");
    expect(group?.type === "group" ? group.clip : undefined).toBe(true);
    expect(group?.type === "group" ? group.children : []).toEqual([artwork.id, mask.id]);
    expect(layer?.type === "layer" ? layer.children : []).toEqual([groupId]);
    expect(editorStore.getState().history.past).toHaveLength(1);

    editorStore.getState().undo();

    expect(editorStore.getState().doc).toBe(beforeDoc);
    expect(editorStore.getState().selection).toEqual([]);
    expect(canRedo(editorStore.getState().history)).toBe(true);
  });

  it("toggles the clip flag on a selected group as one undoable history step", () => {
    const artwork = createRect(0, 0, 40, 40);
    const mask = createRect(5, 5, 20, 20);
    editorStore.getState().addNode(artwork);
    editorStore.getState().addNode(mask);
    editorStore.getState().setSelection([artwork.id, mask.id]);
    editorStore.getState().groupSelection();
    const groupId = editorStore.getState().selection[0]!;
    const beforeDoc = editorStore.getState().doc;
    editorStore.setState({ history: createHistory<Document>() });

    editorStore.getState().toggleClipMask();

    const clippedGroup = editorStore.getState().doc.nodes[groupId];
    expect(clippedGroup?.type).toBe("group");
    expect(clippedGroup?.type === "group" ? clippedGroup.clip : undefined).toBe(true);
    expect(editorStore.getState().selection).toEqual([groupId]);
    expect(editorStore.getState().history.past).toHaveLength(1);

    editorStore.getState().undo();

    expect(editorStore.getState().doc).toBe(beforeDoc);
    const unclippedGroup = editorStore.getState().doc.nodes[groupId];
    expect(unclippedGroup?.type === "group" ? unclippedGroup.clip : undefined).toBe(false);
    expect(editorStore.getState().selection).toEqual([groupId]);
    expect(canRedo(editorStore.getState().history)).toBe(true);

    editorStore.getState().redo();
    editorStore.getState().toggleClipMask();

    const toggledOffGroup = editorStore.getState().doc.nodes[groupId];
    expect(toggledOffGroup?.type === "group" ? toggledOffGroup.clip : undefined).toBe(false);
  });

  it("does not push history when toggling a clip mask with an empty or single non-group selection", () => {
    const rect = createRect(0, 0, 10, 10);
    editorStore.getState().addNode(rect);
    editorStore.getState().setSelection([rect.id]);
    editorStore.setState({ history: createHistory<Document>() });
    const beforeDoc = editorStore.getState().doc;

    editorStore.getState().toggleClipMask();

    expect(editorStore.getState().doc).toBe(beforeDoc);
    expect(editorStore.getState().selection).toEqual([rect.id]);
    expect(editorStore.getState().history.past).toHaveLength(0);

    editorStore.getState().clearSelection();
    editorStore.getState().toggleClipMask();

    expect(editorStore.getState().doc).toBe(beforeDoc);
    expect(editorStore.getState().selection).toEqual([]);
    expect(editorStore.getState().history.past).toHaveLength(0);
    expect(canUndo(editorStore.getState().history)).toBe(false);
  });

  it("converts selected rect and ellipse nodes to paths in place as one undoable step", () => {
    const rect = createRect(0, 0, 10, 20);
    const ellipse = createEllipse(30, 40, 15, 25);
    editorStore.getState().addNode(rect);
    editorStore.getState().addNode(ellipse);
    editorStore.getState().setSelection([rect.id, ellipse.id]);
    const beforeDoc = editorStore.getState().doc;
    editorStore.setState({ history: createHistory<Document>() });

    editorStore.getState().convertSelectionToPaths();

    const convertedRect = editorStore.getState().doc.nodes[rect.id];
    const convertedEllipse = editorStore.getState().doc.nodes[ellipse.id];
    expect(convertedRect?.type).toBe("path");
    expect(convertedEllipse?.type).toBe("path");
    expect(convertedRect?.id).toBe(rect.id);
    expect(convertedEllipse?.id).toBe(ellipse.id);
    expect(editorStore.getState().selection).toEqual([rect.id, ellipse.id]);
    expect(editorStore.getState().history.past).toHaveLength(1);

    editorStore.getState().undo();

    expect(editorStore.getState().doc).toBe(beforeDoc);
    expect(editorStore.getState().doc.nodes[rect.id]?.type).toBe("rect");
    expect(editorStore.getState().doc.nodes[ellipse.id]?.type).toBe("ellipse");
    expect(editorStore.getState().selection).toEqual([rect.id, ellipse.id]);
    expect(canRedo(editorStore.getState().history)).toBe(true);
  });

  it("does not push history when converting a selection with no convertible shapes", () => {
    const group = createGroup("Object group");
    editorStore.getState().addNode(group);
    const layerId = firstLayerId(editorStore.getState().doc);
    editorStore.getState().setSelection([group.id, layerId]);
    editorStore.setState({ history: createHistory<Document>() });
    const beforeDoc = editorStore.getState().doc;

    editorStore.getState().convertSelectionToPaths();

    expect(editorStore.getState().doc).toBe(beforeDoc);
    expect(editorStore.getState().doc.nodes[group.id]).toBe(group);
    expect(editorStore.getState().doc.nodes[layerId]?.type).toBe("layer");
    expect(editorStore.getState().selection).toEqual([group.id, layerId]);
    expect(editorStore.getState().history.past).toHaveLength(0);
    expect(canUndo(editorStore.getState().history)).toBe(false);
  });

  it("offsets selected paths, rects, and ellipses into new selected path siblings", () => {
    const fill: Paint = { type: "solid", color: { r: 220, g: 20, b: 80, a: 0.75 } };
    const stroke: Stroke = {
      paint: { type: "solid", color: { r: 10, g: 20, b: 30, a: 1 } },
      width: 3,
      cap: "round",
      join: "bevel",
      miterLimit: 2,
      dash: [2, 1],
      dashOffset: 0.5,
      align: "center",
    };
    const path = createPath([
      {
        anchors: [
          { point: { x: 0, y: 0 }, handleIn: null, handleOut: null },
          { point: { x: 20, y: 0 }, handleIn: null, handleOut: null },
          { point: { x: 20, y: 20 }, handleIn: null, handleOut: null },
          { point: { x: 0, y: 20 }, handleIn: null, handleOut: null },
        ],
        closed: true,
      },
    ]);
    path.name = "Logo";
    path.transform = { a: 1, b: 0, c: 0.25, d: 1, e: 5, f: 6 };
    path.fill = fill;
    path.stroke = stroke;
    path.opacity = 0.6;
    path.blendMode = "multiply";
    const rect = createRect(40, 10, 16, 24);
    rect.name = "Panel";
    const ellipse = createEllipse(80, 20, 12, 18);
    ellipse.name = "Badge";
    editorStore.getState().addNode(path);
    editorStore.getState().addNode(rect);
    editorStore.getState().addNode(ellipse);
    editorStore.getState().setSelection([path.id, rect.id, ellipse.id]);
    const layerId = firstLayerId(editorStore.getState().doc);
    const beforeDoc = editorStore.getState().doc;
    const originalPath = structuredClone(path);
    const originalRect = structuredClone(rect);
    const originalEllipse = structuredClone(ellipse);
    editorStore.setState({ history: createHistory<Document>() });

    editorStore.getState().offsetSelectedPaths(4);

    const offsetIds = editorStore.getState().selection;
    expect(offsetIds).toHaveLength(3);
    expect(new Set(offsetIds).size).toBe(3);
    expect(offsetIds).not.toContain(path.id);
    expect(offsetIds).not.toContain(rect.id);
    expect(offsetIds).not.toContain(ellipse.id);
    expect(editorStore.getState().doc.nodes[path.id]).toEqual(originalPath);
    expect(editorStore.getState().doc.nodes[rect.id]).toEqual(originalRect);
    expect(editorStore.getState().doc.nodes[ellipse.id]).toEqual(originalEllipse);

    const layer = editorStore.getState().doc.nodes[layerId];
    expect(layer?.type === "layer" ? layer.children : []).toEqual([
      path.id,
      offsetIds[0],
      rect.id,
      offsetIds[1],
      ellipse.id,
      offsetIds[2],
    ]);

    const offsetPath = editorStore.getState().doc.nodes[offsetIds[0]!];
    const offsetRect = editorStore.getState().doc.nodes[offsetIds[1]!];
    const offsetEllipse = editorStore.getState().doc.nodes[offsetIds[2]!];
    expect(offsetPath?.type).toBe("path");
    expect(offsetRect?.type).toBe("path");
    expect(offsetEllipse?.type).toBe("path");
    if (offsetPath?.type !== "path" || offsetRect?.type !== "path" || offsetEllipse?.type !== "path") {
      throw new Error("Expected offset nodes to be paths");
    }

    expect(offsetPath.name).toBe("Logo offset");
    expect(offsetRect.name).toBe("Panel offset");
    expect(offsetEllipse.name).toBe("Badge offset");
    expectMatrixCloseTo(offsetPath.transform, path.transform);
    expect(offsetPath.fill).toEqual(path.fill);
    expect(offsetPath.stroke).toEqual(path.stroke);
    expect(offsetPath.opacity).toBe(path.opacity);
    expect(offsetPath.visible).toBe(path.visible);
    expect(offsetPath.blendMode).toBe(path.blendMode);
    expect(offsetPath.subpaths).not.toEqual(path.subpaths);
    expect(offsetRect.subpaths).toHaveLength(1);
    expect(offsetEllipse.subpaths).toHaveLength(1);
    expect(editorStore.getState().history.past).toHaveLength(1);

    editorStore.getState().undo();

    expect(editorStore.getState().doc).toBe(beforeDoc);
    expect(editorStore.getState().doc.nodes[offsetIds[0]!]).toBeUndefined();
    expect(editorStore.getState().history.past).toHaveLength(0);
    expect(canRedo(editorStore.getState().history)).toBe(true);
  });

  it("skips locked and unsupported nodes while offsetting selected paths", () => {
    const path = createPath([
      {
        anchors: [
          { point: { x: 0, y: 0 }, handleIn: null, handleOut: null },
          { point: { x: 10, y: 0 }, handleIn: null, handleOut: null },
          { point: { x: 10, y: 10 }, handleIn: null, handleOut: null },
        ],
        closed: true,
      },
    ]);
    const lockedRect = createRect(20, 0, 10, 10);
    lockedRect.locked = true;
    const group = createGroup("Unsupported group");
    editorStore.getState().addNode(path);
    editorStore.getState().addNode(lockedRect);
    editorStore.getState().addNode(group);
    editorStore.getState().setSelection([path.id, lockedRect.id, group.id]);
    editorStore.setState({ history: createHistory<Document>() });

    editorStore.getState().offsetSelectedPaths(3);

    const offsetIds = editorStore.getState().selection;
    expect(offsetIds).toHaveLength(1);
    expect(offsetIds[0]).not.toBe(path.id);
    expect(editorStore.getState().doc.nodes[offsetIds[0]!]?.type).toBe("path");
    expect(editorStore.getState().doc.nodes[lockedRect.id]).toEqual(lockedRect);
    expect(editorStore.getState().doc.nodes[group.id]).toEqual(group);
    expect(editorStore.getState().history.past).toHaveLength(1);
  });

  it("does not push history when offsetting by zero, empty selections, or no eligible nodes", () => {
    const rect = createRect(0, 0, 10, 10);
    editorStore.getState().addNode(rect);
    editorStore.getState().setSelection([rect.id]);
    editorStore.setState({ history: createHistory<Document>() });
    const beforeZeroDoc = editorStore.getState().doc;

    editorStore.getState().offsetSelectedPaths(0);

    expect(editorStore.getState().doc).toBe(beforeZeroDoc);
    expect(editorStore.getState().selection).toEqual([rect.id]);
    expect(editorStore.getState().history.past).toHaveLength(0);

    editorStore.getState().clearSelection();
    editorStore.getState().offsetSelectedPaths(5);

    expect(editorStore.getState().doc).toBe(beforeZeroDoc);
    expect(editorStore.getState().selection).toEqual([]);
    expect(editorStore.getState().history.past).toHaveLength(0);

    const lockedPath = createPath();
    lockedPath.locked = true;
    const group = createGroup("Unsupported group");
    editorStore.getState().addNode(lockedPath);
    editorStore.getState().addNode(group);
    editorStore.getState().setSelection([lockedPath.id, group.id]);
    editorStore.setState({ history: createHistory<Document>() });
    const beforeNoEligibleDoc = editorStore.getState().doc;

    editorStore.getState().offsetSelectedPaths(5);

    expect(editorStore.getState().doc).toBe(beforeNoEligibleDoc);
    expect(editorStore.getState().selection).toEqual([lockedPath.id, group.id]);
    expect(editorStore.getState().history.past).toHaveLength(0);
    expect(canUndo(editorStore.getState().history)).toBe(false);
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

  it("locks every guide as one undoable history step", () => {
    const firstId = editorStore.getState().addGuide("x", 80);
    const secondId = editorStore.getState().addGuide("y", 120);
    expect(firstId).not.toBeNull();
    expect(secondId).not.toBeNull();
    const beforeBulkDoc = editorStore.getState().doc;
    const historyDepth = editorStore.getState().history.past.length;

    editorStore.getState().setAllGuidesLocked(true);

    expect(editorStore.getState().doc.guides).toEqual([
      { id: firstId, axis: "x", position: 80, locked: true },
      { id: secondId, axis: "y", position: 120, locked: true },
    ]);
    expect(editorStore.getState().history.past).toHaveLength(historyDepth + 1);

    editorStore.getState().undo();
    expect(editorStore.getState().doc).toBe(beforeBulkDoc);
    expect(editorStore.getState().doc.guides).toEqual([
      { id: firstId, axis: "x", position: 80 },
      { id: secondId, axis: "y", position: 120 },
    ]);

    editorStore.getState().redo();
    expect(editorStore.getState().doc.guides.every((guide) => guide.locked === true)).toBe(true);
  });

  it("hides every guide as one undoable history step", () => {
    const firstId = editorStore.getState().addGuide("x", 80);
    const secondId = editorStore.getState().addGuide("y", 120);
    expect(firstId).not.toBeNull();
    expect(secondId).not.toBeNull();
    const beforeBulkDoc = editorStore.getState().doc;
    const historyDepth = editorStore.getState().history.past.length;

    editorStore.getState().setAllGuidesHidden(true);

    expect(editorStore.getState().doc.guides).toEqual([
      { id: firstId, axis: "x", position: 80, hidden: true },
      { id: secondId, axis: "y", position: 120, hidden: true },
    ]);
    expect(editorStore.getState().history.past).toHaveLength(historyDepth + 1);

    editorStore.getState().undo();
    expect(editorStore.getState().doc).toBe(beforeBulkDoc);
    expect(editorStore.getState().doc.guides).toEqual([
      { id: firstId, axis: "x", position: 80 },
      { id: secondId, axis: "y", position: 120 },
    ]);

    editorStore.getState().redo();
    expect(editorStore.getState().doc.guides.every((guide) => guide.hidden === true)).toBe(true);
  });

  it("does not push history when bulk guide preference actions have no guides", () => {
    const before = editorStore.getState().doc;

    editorStore.getState().setAllGuidesLocked(true);
    editorStore.getState().setAllGuidesHidden(true);

    expect(editorStore.getState().doc).toEqual(before);
    expect(editorStore.getState().doc.guides).toEqual([]);
    expect(editorStore.getState().history.past).toHaveLength(0);
  });

  it("locks and unlocks every non-layer object as one undoable history step", () => {
    const rect = createRect(0, 0, 10, 10);
    const group = createGroup("Object group");
    editorStore.getState().addNode(rect);
    editorStore.getState().addNode(group);
    const layerId = firstLayerId(editorStore.getState().doc);
    editorStore.setState({ history: createHistory<Document>() });
    const beforeBulkDoc = editorStore.getState().doc;

    editorStore.getState().setAllObjectsLocked(true);

    expect(editorStore.getState().doc.nodes[rect.id]?.locked).toBe(true);
    expect(editorStore.getState().doc.nodes[group.id]?.locked).toBe(true);
    expect(editorStore.getState().doc.nodes[layerId]?.locked).toBe(false);
    expect(editorStore.getState().history.past).toHaveLength(1);

    editorStore.getState().setAllObjectsLocked(true);

    expect(editorStore.getState().history.past).toHaveLength(1);

    editorStore.getState().undo();
    expect(editorStore.getState().doc).toBe(beforeBulkDoc);
    expect(editorStore.getState().doc.nodes[rect.id]?.locked).toBe(false);
    expect(editorStore.getState().doc.nodes[group.id]?.locked).toBe(false);
    expect(editorStore.getState().doc.nodes[layerId]?.locked).toBe(false);

    editorStore.getState().setAllObjectsLocked(false);

    expect(editorStore.getState().doc.nodes[rect.id]?.locked).toBe(false);
    expect(editorStore.getState().doc.nodes[group.id]?.locked).toBe(false);
    expect(editorStore.getState().doc.nodes[layerId]?.locked).toBe(false);
    expect(editorStore.getState().history.past).toHaveLength(0);
  });

  it("hides and shows every non-layer object as one undoable history step", () => {
    const rect = createRect(0, 0, 10, 10);
    const group = createGroup("Object group");
    editorStore.getState().addNode(rect);
    editorStore.getState().addNode(group);
    const layerId = firstLayerId(editorStore.getState().doc);
    editorStore.setState({ history: createHistory<Document>() });
    const beforeBulkDoc = editorStore.getState().doc;

    editorStore.getState().setAllObjectsHidden(true);

    expect(editorStore.getState().doc.nodes[rect.id]?.visible).toBe(false);
    expect(editorStore.getState().doc.nodes[group.id]?.visible).toBe(false);
    expect(editorStore.getState().doc.nodes[layerId]?.visible).toBe(true);
    expect(editorStore.getState().history.past).toHaveLength(1);

    editorStore.getState().setAllObjectsHidden(true);

    expect(editorStore.getState().history.past).toHaveLength(1);

    editorStore.getState().undo();
    expect(editorStore.getState().doc).toBe(beforeBulkDoc);
    expect(editorStore.getState().doc.nodes[rect.id]?.visible).toBe(true);
    expect(editorStore.getState().doc.nodes[group.id]?.visible).toBe(true);
    expect(editorStore.getState().doc.nodes[layerId]?.visible).toBe(true);

    editorStore.getState().setAllObjectsHidden(false);

    expect(editorStore.getState().doc.nodes[rect.id]?.visible).toBe(true);
    expect(editorStore.getState().doc.nodes[group.id]?.visible).toBe(true);
    expect(editorStore.getState().doc.nodes[layerId]?.visible).toBe(true);
    expect(editorStore.getState().history.past).toHaveLength(0);
  });

  it("locks selected nodes as one undoable history step", () => {
    const left = createRect(0, 0, 10, 10);
    const right = createRect(20, 0, 10, 10);
    const unselected = createRect(40, 0, 10, 10);
    editorStore.getState().addNode(left);
    editorStore.getState().addNode(right);
    editorStore.getState().addNode(unselected);
    editorStore.getState().setSelection([left.id, right.id]);
    editorStore.getState().setKeyObject(right.id);
    editorStore.setState({ history: createHistory<Document>() });
    const beforeLockDoc = editorStore.getState().doc;

    editorStore.getState().lockSelection();

    expect(editorStore.getState().doc.nodes[left.id]?.locked).toBe(true);
    expect(editorStore.getState().doc.nodes[right.id]?.locked).toBe(true);
    expect(editorStore.getState().doc.nodes[unselected.id]?.locked).toBe(false);
    expect(editorStore.getState().selection).toEqual([left.id, right.id]);
    expect(editorStore.getState().keyObjectId).toBe(right.id);
    expect(editorStore.getState().history.past).toHaveLength(1);

    editorStore.getState().lockSelection();

    expect(editorStore.getState().history.past).toHaveLength(1);

    editorStore.getState().undo();

    expect(editorStore.getState().doc).toBe(beforeLockDoc);
    expect(editorStore.getState().doc.nodes[left.id]?.locked).toBe(false);
    expect(editorStore.getState().doc.nodes[right.id]?.locked).toBe(false);
    expect(editorStore.getState().doc.nodes[unselected.id]?.locked).toBe(false);
    expect(canRedo(editorStore.getState().history)).toBe(true);
  });

  it("hides selected nodes, clears selection, and undoes the document change", () => {
    const left = createRect(0, 0, 10, 10);
    const right = createRect(20, 0, 10, 10);
    const unselected = createRect(40, 0, 10, 10);
    editorStore.getState().addNode(left);
    editorStore.getState().addNode(right);
    editorStore.getState().addNode(unselected);
    editorStore.getState().setSelection([left.id, right.id]);
    editorStore.getState().setKeyObject(right.id);
    editorStore.setState({ history: createHistory<Document>() });
    const beforeHideDoc = editorStore.getState().doc;

    editorStore.getState().hideSelection();

    expect(editorStore.getState().doc.nodes[left.id]?.visible).toBe(false);
    expect(editorStore.getState().doc.nodes[right.id]?.visible).toBe(false);
    expect(editorStore.getState().doc.nodes[unselected.id]?.visible).toBe(true);
    expect(editorStore.getState().selection).toEqual([]);
    expect(editorStore.getState().keyObjectId).toBeNull();
    expect(editorStore.getState().history.past).toHaveLength(1);

    editorStore.getState().hideSelection();

    expect(editorStore.getState().history.past).toHaveLength(1);

    editorStore.getState().undo();

    expect(editorStore.getState().doc).toBe(beforeHideDoc);
    expect(editorStore.getState().doc.nodes[left.id]?.visible).toBe(true);
    expect(editorStore.getState().doc.nodes[right.id]?.visible).toBe(true);
    expect(editorStore.getState().doc.nodes[unselected.id]?.visible).toBe(true);
    expect(editorStore.getState().selection).toEqual([]);
    expect(canRedo(editorStore.getState().history)).toBe(true);
  });

  it("does not push history for empty or unchanged selection lock and hide actions", () => {
    const rect = createRect(0, 0, 10, 10);
    editorStore.getState().addNode(rect);
    editorStore.setState({ history: createHistory<Document>() });
    const beforeEmptyDoc = editorStore.getState().doc;

    editorStore.getState().lockSelection();
    editorStore.getState().hideSelection();

    expect(editorStore.getState().doc).toBe(beforeEmptyDoc);
    expect(editorStore.getState().selection).toEqual([]);
    expect(editorStore.getState().history.past).toHaveLength(0);

    editorStore.getState().setSelection([rect.id]);
    editorStore.getState().lockSelection();
    editorStore.getState().setAllObjectsHidden(true);
    editorStore.setState({ history: createHistory<Document>() });
    const beforeNoChangeDoc = editorStore.getState().doc;

    editorStore.getState().lockSelection();
    editorStore.getState().hideSelection();

    expect(editorStore.getState().doc).toBe(beforeNoChangeDoc);
    expect(editorStore.getState().selection).toEqual([rect.id]);
    expect(editorStore.getState().history.past).toHaveLength(0);
    expect(canUndo(editorStore.getState().history)).toBe(false);
  });

  it("does not push history when bulk object actions have no object nodes", () => {
    const before = editorStore.getState().doc;

    editorStore.getState().setAllObjectsLocked(true);
    editorStore.getState().setAllObjectsHidden(true);

    expect(editorStore.getState().doc).toBe(before);
    expect(editorStore.getState().history.past).toHaveLength(0);
    expect(canUndo(editorStore.getState().history)).toBe(false);
  });

  it("unlocks every object as a real state transition (lock then unlock)", () => {
    const rect = createRect(0, 0, 10, 10);
    const group = createGroup("Object group");
    editorStore.getState().addNode(rect);
    editorStore.getState().addNode(group);
    const layerId = firstLayerId(editorStore.getState().doc);
    editorStore.setState({ history: createHistory<Document>() });

    editorStore.getState().setAllObjectsLocked(true);
    expect(editorStore.getState().doc.nodes[rect.id]?.locked).toBe(true);
    expect(editorStore.getState().doc.nodes[group.id]?.locked).toBe(true);
    expect(editorStore.getState().history.past).toHaveLength(1);

    // Unlock-all directly after lock-all (no undo): flags must flip true -> false.
    editorStore.getState().setAllObjectsLocked(false);
    expect(editorStore.getState().doc.nodes[rect.id]?.locked).toBe(false);
    expect(editorStore.getState().doc.nodes[group.id]?.locked).toBe(false);
    expect(editorStore.getState().doc.nodes[layerId]?.locked).toBe(false);
    expect(editorStore.getState().history.past).toHaveLength(2);
  });

  it("shows every object as a real state transition (hide then show)", () => {
    const rect = createRect(0, 0, 10, 10);
    const group = createGroup("Object group");
    editorStore.getState().addNode(rect);
    editorStore.getState().addNode(group);
    const layerId = firstLayerId(editorStore.getState().doc);
    editorStore.setState({ history: createHistory<Document>() });

    editorStore.getState().setAllObjectsHidden(true);
    expect(editorStore.getState().doc.nodes[rect.id]?.visible).toBe(false);
    expect(editorStore.getState().doc.nodes[group.id]?.visible).toBe(false);
    expect(editorStore.getState().history.past).toHaveLength(1);

    // Show-all directly after hide-all (no undo): visible must flip false -> true.
    editorStore.getState().setAllObjectsHidden(false);
    expect(editorStore.getState().doc.nodes[rect.id]?.visible).toBe(true);
    expect(editorStore.getState().doc.nodes[group.id]?.visible).toBe(true);
    expect(editorStore.getState().doc.nodes[layerId]?.visible).toBe(true);
    expect(editorStore.getState().history.past).toHaveLength(2);
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
