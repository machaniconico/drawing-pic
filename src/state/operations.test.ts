import { beforeEach, describe, expect, it, vi } from "vitest";
import { canUndo } from "./history";
import { createDocument, createGroup, createRect } from "../core/model/factory";
import { worldBounds } from "../core/model/bounds";
import type { Document, NodeId, SceneNode } from "../core/model/types";
import { isContainer } from "../core/model/types";
import {
  alignNodes,
  booleanSelection,
  bringToFront,
  cloneSubtree,
  distributeNodes,
  groupSelection,
  sendBackward,
  ungroupSelection,
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

const ringArea = (points: readonly { x: number; y: number }[]): number => {
  let area = 0;
  for (let index = 0; index < points.length; index += 1) {
    const a = points[index]!;
    const b = points[(index + 1) % points.length]!;
    area += a.x * b.y - b.x * a.y;
  }
  return area / 2;
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

  it("groups two siblings into a new group in sibling order and removes them from the parent order", () => {
    const doc = createDocument();
    const left = createRect(0, 0, 10, 10);
    const right = createRect(20, 0, 10, 10);
    const outside = createRect(40, 0, 10, 10);
    addToFirstLayer(doc, [left, right, outside]);

    const result = groupSelection(doc, [left.id, right.id]);

    expect(result).not.toBeNull();
    expect(result?.parentId).toBe(firstLayerId(doc));
    expect(result?.group.type).toBe("group");
    expect(result?.group.children).toEqual([left.id, right.id]);
    expect(result?.groupedIds).toEqual([left.id, right.id]);
    expect(result?.order).toEqual([result?.group.id, outside.id]);
  });

  it("inserts the group at the frontmost selected sibling position", () => {
    const doc = createDocument();
    const back = createRect(0, 0, 10, 10);
    const middle = createRect(20, 0, 10, 10);
    const front = createRect(40, 0, 10, 10);
    const top = createRect(60, 0, 10, 10);
    addToFirstLayer(doc, [back, middle, front, top]);

    const result = groupSelection(doc, [back.id, front.id]);

    expect(result).not.toBeNull();
    expect(result?.group.children).toEqual([back.id, front.id]);
    expect(result?.order).toEqual([middle.id, result?.group.id, top.id]);
  });

  it("ungroups selected groups by lifting children into the group position in order", () => {
    const doc = createDocument();
    const before = createRect(0, 0, 10, 10);
    const firstChild = createRect(20, 0, 10, 10);
    const secondChild = createRect(40, 0, 10, 10);
    const group = createGroup("Group", [firstChild.id, secondChild.id]);
    const after = createRect(60, 0, 10, 10);
    addToFirstLayer(doc, [before, group, after]);
    doc.nodes[firstChild.id] = firstChild;
    doc.nodes[secondChild.id] = secondChild;

    const result = ungroupSelection(doc, [group.id]);

    expect(result).toEqual([
      {
        parentId: firstLayerId(doc),
        groupIds: [group.id],
        order: [before.id, firstChild.id, secondChild.id, after.id],
        liftedIds: [firstChild.id, secondChild.id],
      },
    ]);
  });

  it("does not group when fewer than two nodes are eligible under the first selected parent", () => {
    const doc = createDocument();
    const layerChild = createRect(0, 0, 10, 10);
    const groupChild = createRect(20, 0, 10, 10);
    const group = createGroup("Group", [groupChild.id]);
    addToFirstLayer(doc, [layerChild, group]);
    doc.nodes[groupChild.id] = groupChild;

    const result = groupSelection(doc, [layerChild.id, groupChild.id]);

    expect(result).toBeNull();
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

  it("builds one closed corner-anchor path for boolean selection", () => {
    const doc = createDocument();
    const left = createRect(0, 0, 10, 10);
    const right = createRect(5, 0, 10, 10);
    addToFirstLayer(doc, [left, right]);

    const result = booleanSelection(doc, [left.id, right.id], "intersect");

    expect(result).not.toBeNull();
    expect(result?.removeIds).toEqual([left.id, right.id]);
    expect(result?.node.type).toBe("path");
    expect(result?.node.subpaths).toHaveLength(1);
    expect(result?.node.subpaths[0]?.closed).toBe(true);
    expect(result?.node.subpaths[0]?.anchors.every((anchor) => anchor.handleIn === null && anchor.handleOut === null)).toBe(true);
    expect(ringArea(result?.node.subpaths[0]?.anchors.map((anchor) => anchor.point) ?? [])).toBeCloseTo(50, 10);
  });

  it("returns null for boolean selection with fewer than two eligible shapes", () => {
    const doc = createDocument();
    const rect = createRect(0, 0, 10, 10);
    addToFirstLayer(doc, [rect]);

    expect(booleanSelection(doc, [rect.id], "union")).toBeNull();
  });

  it("returns an empty result path when two shapes subtract to nothing", () => {
    const doc = createDocument();
    const first = createRect(0, 0, 10, 10);
    const second = createRect(0, 0, 10, 10);
    addToFirstLayer(doc, [first, second]);

    const result = booleanSelection(doc, [first.id, second.id], "subtract");

    expect(result).not.toBeNull();
    expect(result?.removeIds).toEqual([first.id, second.id]);
    expect(result?.node.subpaths).toEqual([]);
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

  it("groups the current selection as one undoable document step and selects the group", () => {
    const left = createRect(0, 0, 10, 10);
    const right = createRect(20, 0, 10, 10);
    editorStore.getState().addNode(left);
    editorStore.getState().addNode(right);
    editorStore.getState().setSelection([left.id, right.id]);
    const historyDepth = editorStore.getState().history.past.length;

    editorStore.getState().groupSelection();

    const state = editorStore.getState();
    const groupId = state.selection[0]!;
    const group = state.doc.nodes[groupId];
    expect(state.history.past).toHaveLength(historyDepth + 1);
    expect(group?.type).toBe("group");
    expect(group && isContainer(group) ? group.children : []).toEqual([left.id, right.id]);
    expect(firstLayerChildren(state.doc)).toEqual([groupId]);

    editorStore.getState().undo();
    expect(editorStore.getState().doc.nodes[groupId]).toBeUndefined();
    expect(firstLayerChildren(editorStore.getState().doc)).toEqual([left.id, right.id]);
  });

  it("ungroups the current selection as one undoable document step and selects lifted children", () => {
    const firstChild = createRect(0, 0, 10, 10);
    const secondChild = createRect(20, 0, 10, 10);
    const group = createGroup("Group", [firstChild.id, secondChild.id]);
    editorStore.getState().addNode(group);
    editorStore.setState((state) => ({
      doc: {
        ...state.doc,
        nodes: {
          ...state.doc.nodes,
          [firstChild.id]: firstChild,
          [secondChild.id]: secondChild,
        },
      },
    }));
    editorStore.getState().setSelection([group.id]);
    const historyDepth = editorStore.getState().history.past.length;

    editorStore.getState().ungroupSelection();

    const state = editorStore.getState();
    expect(state.history.past).toHaveLength(historyDepth + 1);
    expect(state.selection).toEqual([firstChild.id, secondChild.id]);
    expect(firstLayerChildren(state.doc)).toEqual([firstChild.id, secondChild.id]);
    expect(state.doc.nodes[group.id]).toBeUndefined();
  });

  it("ungroups an empty group as one undoable document step", () => {
    const group = createGroup("Group", []);
    editorStore.getState().addNode(group);
    editorStore.getState().setSelection([group.id]);
    const historyDepth = editorStore.getState().history.past.length;

    editorStore.getState().ungroupSelection();

    expect(editorStore.getState().history.past).toHaveLength(historyDepth + 1);
    expect(editorStore.getState().selection).toEqual([]);
    expect(editorStore.getState().doc.nodes[group.id]).toBeUndefined();
    expect(firstLayerChildren(editorStore.getState().doc)).toEqual([]);

    editorStore.getState().undo();

    expect(editorStore.getState().doc.nodes[group.id]).toEqual(group);
    expect(firstLayerChildren(editorStore.getState().doc)).toEqual([group.id]);
  });

  it("runs boolean selection as one undoable replacement step and selects the result", () => {
    const left = createRect(0, 0, 10, 10);
    const right = createRect(5, 0, 10, 10);
    editorStore.getState().addNode(left);
    editorStore.getState().addNode(right);
    editorStore.getState().setSelection([left.id, right.id]);
    const historyDepth = editorStore.getState().history.past.length;

    editorStore.getState().booleanOp("union");

    const state = editorStore.getState();
    const resultId = state.selection[0]!;
    expect(state.history.past).toHaveLength(historyDepth + 1);
    expect(state.doc.nodes[left.id]).toBeUndefined();
    expect(state.doc.nodes[right.id]).toBeUndefined();
    expect(state.doc.nodes[resultId]?.type).toBe("path");
    expect(firstLayerChildren(state.doc)).toEqual([resultId]);

    editorStore.getState().undo();

    expect(editorStore.getState().doc.nodes[left.id]).toEqual(left);
    expect(editorStore.getState().doc.nodes[right.id]).toEqual(right);
    expect(firstLayerChildren(editorStore.getState().doc)).toEqual([left.id, right.id]);
  });

  it("does not push history when boolean selection has fewer than two eligible shapes", () => {
    const rect = createRect(0, 0, 10, 10);
    editorStore.getState().addNode(rect);
    editorStore.getState().setSelection([rect.id]);
    const historyDepth = editorStore.getState().history.past.length;

    editorStore.getState().booleanOp("subtract");

    expect(editorStore.getState().history.past).toHaveLength(historyDepth);
    expect(editorStore.getState().selection).toEqual([rect.id]);
    expect(firstLayerChildren(editorStore.getState().doc)).toEqual([rect.id]);
  });
});
