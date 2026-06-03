import { beforeEach, describe, expect, it, vi } from "vitest";
import { canUndo } from "./history";
import { createDocument, createGroup, createRect } from "../core/model/factory";
import { worldBounds } from "../core/model/bounds";
import type { Document, NodeId, SceneNode } from "../core/model/types";
import { isContainer } from "../core/model/types";
import {
  alignNodes,
  bringToFront,
  cloneSubtree,
  distributeNodes,
  sendBackward,
} from "./operations";
import { createEditorStateForTest, editorStore } from "./store";

const firstLayerId = (doc: Document): NodeId => doc.layerOrder[0]!;

const addToFirstLayer = (doc: Document, nodes: SceneNode[]): void => {
  const layer = doc.nodes[firstLayerId(doc)];
  if (!layer || !isContainer(layer)) {
    throw new Error("Test document is missing its first layer");
  }

  for (const node of nodes) {
    doc.nodes[node.id] = node;
    layer.children.push(node.id);
  }
};

const firstLayerChildren = (doc: Document): NodeId[] => {
  const layer = doc.nodes[firstLayerId(doc)];
  return layer && isContainer(layer) ? layer.children : [];
};

const resetStore = (): void => {
  editorStore.setState(createEditorStateForTest());
};

describe("selection operations", () => {
  it("aligns nodes to the left edge of the selection bounds", () => {
    const doc = createDocument();
    const left = createRect(10, 20, 10, 10);
    const right = createRect(40, 5, 20, 20);
    addToFirstLayer(doc, [left, right]);

    const patches = alignNodes(doc, [left.id, right.id], "left");

    expect(patches[left.id]).toBeUndefined();
    expect(patches[right.id]).toEqual({ e: 10, f: 5 });
  });

  it("aligns nodes to the horizontal center of the selection bounds", () => {
    const doc = createDocument();
    const left = createRect(10, 20, 10, 10);
    const right = createRect(40, 5, 20, 20);
    addToFirstLayer(doc, [left, right]);

    const patches = alignNodes(doc, [left.id, right.id], "hcenter");

    expect(patches[left.id]).toEqual({ e: 30, f: 20 });
    expect(patches[right.id]).toEqual({ e: 25, f: 5 });
  });

  it("aligns nodes to the right edge of the selection bounds", () => {
    const doc = createDocument();
    const left = createRect(10, 20, 10, 10);
    const right = createRect(40, 5, 20, 20);
    addToFirstLayer(doc, [left, right]);

    const patches = alignNodes(doc, [left.id, right.id], "right");

    expect(patches[left.id]).toEqual({ e: 50, f: 20 });
    expect(patches[right.id]).toBeUndefined();
  });

  it("aligns nodes to the top edge of the selection bounds", () => {
    const doc = createDocument();
    const top = createRect(30, 5, 10, 10);
    const bottom = createRect(10, 40, 20, 20);
    addToFirstLayer(doc, [top, bottom]);

    const patches = alignNodes(doc, [top.id, bottom.id], "top");

    expect(patches[top.id]).toBeUndefined();
    expect(patches[bottom.id]).toEqual({ e: 10, f: 5 });
  });

  it("aligns nodes to the bottom edge of the selection bounds", () => {
    const doc = createDocument();
    const top = createRect(30, 5, 10, 10);
    const bottom = createRect(10, 40, 20, 20);
    addToFirstLayer(doc, [top, bottom]);

    const patches = alignNodes(doc, [top.id, bottom.id], "bottom");

    expect(patches[top.id]).toEqual({ e: 30, f: 50 });
    expect(patches[bottom.id]).toBeUndefined();
  });

  it("aligns selected groups from descendant bounds and moves their children", () => {
    const doc = createDocument();
    const anchor = createRect(0, 0, 10, 10);
    const child = createRect(20, 0, 10, 10);
    const group = createGroup("Group", [child.id]);
    addToFirstLayer(doc, [anchor, group]);
    doc.nodes[child.id] = child;

    const patches = alignNodes(doc, [anchor.id, group.id], "left");

    expect(patches[anchor.id]).toBeUndefined();
    expect(patches[group.id]).toEqual({ e: -20, f: 0 });

    group.transform = { ...group.transform, ...patches[group.id] };
    expect(worldBounds(doc, child.id).minX).toBe(0);
  });

  it("distributes nodes horizontally with even center spacing", () => {
    const doc = createDocument();
    const first = createRect(0, 0, 10, 10);
    const middle = createRect(30, 0, 10, 10);
    const last = createRect(100, 0, 10, 10);
    addToFirstLayer(doc, [first, middle, last]);

    const patches = distributeNodes(doc, [first.id, middle.id, last.id], "horizontal");

    expect(patches[first.id]).toBeUndefined();
    expect(patches[middle.id]).toEqual({ e: 50, f: 0 });
    expect(patches[last.id]).toBeUndefined();
  });

  it("moves selected children to the front of their parent order", () => {
    const doc = createDocument();
    const back = createRect(0, 0, 10, 10);
    const middle = createRect(20, 0, 10, 10);
    const front = createRect(40, 0, 10, 10);
    addToFirstLayer(doc, [back, middle, front]);

    const patches = bringToFront(doc, [middle.id]);

    expect(patches).toEqual([{ parentId: firstLayerId(doc), order: [back.id, front.id, middle.id] }]);
  });

  it("moves selected children one step backward in their parent order", () => {
    const doc = createDocument();
    const back = createRect(0, 0, 10, 10);
    const middle = createRect(20, 0, 10, 10);
    const front = createRect(40, 0, 10, 10);
    addToFirstLayer(doc, [back, middle, front]);

    const patches = sendBackward(doc, [front.id]);

    expect(patches).toEqual([{ parentId: firstLayerId(doc), order: [back.id, front.id, middle.id] }]);
  });

  it("cloneSubtree assigns fresh ids and repoints child references", () => {
    const doc = createDocument();
    const child = createRect(5, 6, 7, 8);
    const group = createGroup("Group", [child.id]);
    addToFirstLayer(doc, [group]);
    doc.nodes[child.id] = child;
    const idCandidates = [group.id, "clone-group", child.id, "clone-child"];

    const clone = cloneSubtree(doc, group.id, () => idCandidates.shift()!);
    const clonedGroup = clone.nodes[clone.rootId];

    expect(clone.rootId).toBe("clone-group");
    expect(clonedGroup?.id).toBe("clone-group");
    expect(clonedGroup && isContainer(clonedGroup) ? clonedGroup.children : []).toEqual(["clone-child"]);
    expect(clone.nodes["clone-child"]?.id).toBe("clone-child");
    expect(clone.nodes[group.id]).toBeUndefined();
    expect(clone.nodes[child.id]).toBeUndefined();
  });
});

describe("editorStore selection operation actions", () => {
  beforeEach(() => {
    resetStore();
  });

  it("copies selection into clipboard without pushing document history", () => {
    const rect = createRect(1, 2, 10, 10);
    editorStore.getState().addNode(rect);
    editorStore.getState().setSelection([rect.id]);
    const historyDepth = editorStore.getState().history.past.length;

    editorStore.getState().copySelection();

    const state = editorStore.getState();
    expect(state.history.past).toHaveLength(historyDepth);
    expect(state.clipboard).toHaveLength(1);
    expect(state.clipboard[0]).toEqual(rect);
    expect(state.clipboard[0]).not.toBe(rect);
  });

  it("pastes clipboard roots into the active layer as one undoable offset clone step", () => {
    const rect = createRect(1, 2, 10, 10);
    editorStore.getState().addNode(rect);
    editorStore.getState().setSelection([rect.id]);
    editorStore.getState().copySelection();
    const historyDepth = editorStore.getState().history.past.length;

    editorStore.getState().paste();

    const pastedId = editorStore.getState().selection[0]!;
    const pasted = editorStore.getState().doc.nodes[pastedId];
    expect(editorStore.getState().history.past).toHaveLength(historyDepth + 1);
    expect(pastedId).not.toBe(rect.id);
    expect(pasted?.transform.e).toBe(13);
    expect(pasted?.transform.f).toBe(14);
    expect(canUndo(editorStore.getState().history)).toBe(true);

    editorStore.getState().undo();
    expect(editorStore.getState().doc.nodes[pastedId]).toBeUndefined();
  });

  it("pastes clipboard clones without reusing target-document ids", () => {
    type Uuid = `${string}-${string}-${string}-${string}-${string}`;
    const targetCollisionId: Uuid = "00000000-0000-4000-8000-000000000001";
    const freshPasteId: Uuid = "00000000-0000-4000-8000-000000000002";
    const targetRect = createRect(50, 50, 10, 10);
    targetRect.id = targetCollisionId;
    const clipboardRect = createRect(1, 2, 10, 10);
    clipboardRect.id = "clipboard-root";
    editorStore.getState().addNode(targetRect);
    editorStore.setState({ clipboard: [structuredClone(clipboardRect) as SceneNode] });
    const randomUUID = vi
      .fn<() => Uuid>()
      .mockReturnValueOnce(targetCollisionId)
      .mockReturnValueOnce(freshPasteId);

    vi.stubGlobal("crypto", { randomUUID });
    try {
      editorStore.getState().paste();
    } finally {
      vi.unstubAllGlobals();
    }

    const state = editorStore.getState();
    expect(state.selection).toEqual([freshPasteId]);
    expect(state.doc.nodes[targetCollisionId]?.transform.e).toBe(50);
    expect(state.doc.nodes[targetCollisionId]?.transform.f).toBe(50);
    expect(state.doc.nodes[freshPasteId]?.transform.e).toBe(13);
    expect(state.doc.nodes[freshPasteId]?.transform.f).toBe(14);
  });

  it("duplicates selection in the same parent as one undoable offset clone step", () => {
    const rect = createRect(3, 4, 10, 10);
    editorStore.getState().addNode(rect);
    editorStore.getState().setSelection([rect.id]);
    const historyDepth = editorStore.getState().history.past.length;

    editorStore.getState().duplicateSelection();

    const state = editorStore.getState();
    const duplicatedId = state.selection[0]!;
    const duplicated = state.doc.nodes[duplicatedId];
    expect(state.history.past).toHaveLength(historyDepth + 1);
    expect(firstLayerChildren(state.doc)).toEqual([rect.id, duplicatedId]);
    expect(duplicatedId).not.toBe(rect.id);
    expect(duplicated?.transform.e).toBe(15);
    expect(duplicated?.transform.f).toBe(16);

    editorStore.getState().undo();
    expect(editorStore.getState().doc.nodes[duplicatedId]).toBeUndefined();
  });
});
