import { beforeEach, describe, expect, it } from "vitest";
import { hitTest } from "../core/model/hittest";
import { createDocument, createGroup, createRect } from "../core/model/factory";
import type { Document, LayerNode, NodeId, SceneNode } from "../core/model/types";
import { createEditorStateForTest, editorStore } from "./store";
import {
  documentForIsolation,
  getActiveIsolationId,
  isNodeDescendantOf,
  isNodeInIsolation,
  normalizeIsolationPath,
  subtreeWorldBounds,
} from "./selectors";

interface IsolationFixture {
  doc: Document;
  layer: LayerNode;
  outer: ReturnType<typeof createGroup>;
  inner: ReturnType<typeof createGroup>;
  outerChild: ReturnType<typeof createRect>;
  innerChild: ReturnType<typeof createRect>;
  outside: ReturnType<typeof createRect>;
}

const addNodes = (doc: Document, nodes: readonly SceneNode[]): void => {
  for (const node of nodes) {
    doc.nodes[node.id] = node;
  }
};

const isolationFixture = (): IsolationFixture => {
  const doc = createDocument();
  const layerId = doc.layerOrder[0]!;
  const layer = doc.nodes[layerId];
  if (layer?.type !== "layer") {
    throw new Error("fixture document must have a layer");
  }

  const innerChild = createRect(5, 2, 10, 8);
  const outerChild = createRect(0, 20, 6, 6);
  const outside = createRect(35, 2, 10, 8);
  const inner = createGroup("Inner", [innerChild.id]);
  const outer = createGroup("Outer", [inner.id, outerChild.id]);
  outer.transform = { ...outer.transform, e: 10 };
  inner.transform = { ...inner.transform, e: 20 };
  layer.children = [outer.id, outside.id];
  addNodes(doc, [outer, inner, innerChild, outerChild, outside]);

  return { doc, layer, outer, inner, outerChild, innerChild, outside };
};

describe("isolation selectors", () => {
  it("detects strict descendants across nested containers", () => {
    const { doc, outer, inner, innerChild, outside } = isolationFixture();

    expect(isNodeDescendantOf(doc, inner.id, outer.id)).toBe(true);
    expect(isNodeDescendantOf(doc, innerChild.id, outer.id)).toBe(true);
    expect(isNodeDescendantOf(doc, outer.id, outer.id)).toBe(false);
    expect(isNodeDescendantOf(doc, outside.id, outer.id)).toBe(false);
    expect(isNodeDescendantOf(doc, "missing" as NodeId, outer.id)).toBe(false);
  });

  it("normalizes stale paths and keeps only a valid nested prefix", () => {
    const { doc, outer, inner, outside } = isolationFixture();

    expect(normalizeIsolationPath(doc, [outer.id, inner.id])).toEqual([outer.id, inner.id]);
    expect(normalizeIsolationPath(doc, [outer.id, "stale" as NodeId])).toEqual([outer.id]);
    expect(normalizeIsolationPath(doc, [outer.id, outside.id])).toEqual([outer.id]);
    expect(normalizeIsolationPath(doc, ["stale" as NodeId, inner.id])).toEqual([]);
  });

  it("limits active isolation to descendants and resolves the active stack entry", () => {
    const { doc, outer, inner, outerChild, innerChild, outside } = isolationFixture();

    expect(getActiveIsolationId([])).toBeNull();
    expect(getActiveIsolationId([outer.id, inner.id])).toBe(inner.id);
    expect(isNodeInIsolation(doc, outside.id, [])).toBe(true);
    expect(isNodeInIsolation(doc, outerChild.id, [outer.id])).toBe(true);
    expect(isNodeInIsolation(doc, innerChild.id, [outer.id, inner.id])).toBe(true);
    expect(isNodeInIsolation(doc, outerChild.id, [outer.id, inner.id])).toBe(false);
    expect(isNodeInIsolation(doc, inner.id, [outer.id, inner.id])).toBe(false);
    expect(isNodeInIsolation(doc, outside.id, [outer.id])).toBe(false);
  });

  it("unions descendant leaf bounds for groups and preserves ancestor transforms in isolated hit tests", () => {
    const { doc, layer, outer, inner, innerChild, outside } = isolationFixture();

    expect(subtreeWorldBounds(doc, inner.id)).toEqual({ minX: 35, minY: 2, maxX: 45, maxY: 10 });
    expect(subtreeWorldBounds(doc, outer.id)).toEqual({ minX: 10, minY: 2, maxX: 45, maxY: 26 });
    expect(subtreeWorldBounds(doc, layer.id)).toEqual({ minX: 10, minY: 2, maxX: 45, maxY: 26 });

    const isolatedDoc = documentForIsolation(doc, [outer.id, inner.id]);
    expect(hitTest(doc, { x: 36, y: 3 })).toBe(outside.id);
    expect(hitTest(isolatedDoc, { x: 36, y: 3 })).toBe(innerChild.id);
    expect(hitTest(isolatedDoc, { x: outside.transform.e + 1, y: outside.transform.f + 1 })).toBe(innerChild.id);
    const isolatedLayer = isolatedDoc.nodes[layer.id];
    expect(isolatedLayer?.type).toBe("layer");
    expect(isolatedLayer?.type === "layer" ? isolatedLayer.children : []).toEqual([outer.id]);
  });
});

describe("editorStore isolation", () => {
  beforeEach(() => {
    editorStore.setState(createEditorStateForTest());
  });

  it("pushes and pops nested isolation without history and filters selection", () => {
    const { doc, outer, inner, outerChild, innerChild, outside } = isolationFixture();
    editorStore.getState().loadDocument(doc);
    const historyDepth = editorStore.getState().history.past.length;

    editorStore.getState().enterIsolation(outer.id);
    editorStore.getState().setSelection([outerChild.id, outside.id]);
    expect(editorStore.getState().isolationPath).toEqual([outer.id]);
    expect(editorStore.getState().selection).toEqual([outerChild.id]);

    editorStore.getState().enterIsolation(inner.id);
    editorStore.getState().setSelection([outerChild.id, innerChild.id]);
    expect(editorStore.getState().isolationPath).toEqual([outer.id, inner.id]);
    expect(editorStore.getState().selection).toEqual([innerChild.id]);

    editorStore.getState().exitIsolation();
    expect(editorStore.getState().isolationPath).toEqual([outer.id]);
    editorStore.getState().exitIsolation();
    expect(editorStore.getState().isolationPath).toEqual([]);
    expect(editorStore.getState().history.past).toHaveLength(historyDepth);
  });

  it("sanitizes isolation when the isolated group is ungrouped", () => {
    const { doc, outer, inner } = isolationFixture();
    editorStore.getState().loadDocument(doc);
    editorStore.setState({ isolationPath: [outer.id], selection: [outer.id] });

    editorStore.getState().ungroupSelection();

    expect(editorStore.getState().doc.nodes[outer.id]).toBeUndefined();
    expect(editorStore.getState().isolationPath).toEqual([]);
    expect(editorStore.getState().selection).toContain(inner.id);
  });

  it("adds new nodes to the isolated group and preserves isolation through undo and redo", () => {
    const { doc, outer } = isolationFixture();
    editorStore.getState().loadDocument(doc);
    editorStore.getState().enterIsolation(outer.id);
    const created = createRect(50, 50, 12, 12);

    editorStore.getState().addNode(created);
    const isolatedGroup = editorStore.getState().doc.nodes[outer.id];
    expect(isolatedGroup?.type === "group" ? isolatedGroup.children : []).toContain(created.id);
    expect(subtreeWorldBounds(editorStore.getState().doc, created.id)).toEqual({
      minX: 50,
      minY: 50,
      maxX: 62,
      maxY: 62,
    });

    editorStore.getState().undo();
    expect(editorStore.getState().doc.nodes[created.id]).toBeUndefined();
    expect(editorStore.getState().isolationPath).toEqual([outer.id]);

    editorStore.getState().redo();
    expect(editorStore.getState().doc.nodes[created.id]).toBeDefined();
    expect(editorStore.getState().isolationPath).toEqual([outer.id]);
  });

  it("blocks direct edits and removals outside the active isolation", () => {
    const { doc, layer, outer, outerChild, outside } = isolationFixture();
    editorStore.getState().loadDocument(doc);
    editorStore.getState().enterIsolation(outer.id);
    const historyDepth = editorStore.getState().history.past.length;

    editorStore.getState().updateNode(outside.id, { name: "Blocked rename" });
    editorStore.getState().removeNodes([outside.id]);
    const blockedAddition = createRect(80, 80, 4, 4);
    editorStore.getState().addNode(blockedAddition, layer.id);
    editorStore.getState().reorderNode(outerChild.id, outer.id, "before");

    expect(editorStore.getState().doc.nodes[outside.id]?.name).not.toBe("Blocked rename");
    expect(editorStore.getState().doc.nodes[outside.id]).toBeDefined();
    expect(editorStore.getState().doc.nodes[blockedAddition.id]).toBeUndefined();
    const currentLayer = editorStore.getState().doc.nodes[layer.id];
    expect(currentLayer?.type === "layer" ? currentLayer.children : []).toEqual([outer.id, outside.id]);
    expect(editorStore.getState().history.past).toHaveLength(historyDepth);

    editorStore.getState().setAllObjectsLocked(true);
    expect(editorStore.getState().doc.nodes[outerChild.id]?.locked).toBe(true);
    expect(editorStore.getState().doc.nodes[outside.id]?.locked).toBe(false);

    editorStore.getState().updateNode(outerChild.id, { name: "Allowed rename" });
    expect(editorStore.getState().doc.nodes[outerChild.id]?.name).toBe("Allowed rename");
    editorStore.getState().removeNodes([outerChild.id]);
    expect(editorStore.getState().doc.nodes[outerChild.id]).toBeUndefined();
  });
});
