import { describe, expect, it } from "vitest";
import { createDocument, createGroup, createLayer, createRect } from "../core/model/factory";
import type { Document, NodeId, SceneNode } from "../core/model/types";
import { isContainer } from "../core/model/types";
import { moveNode } from "./layerReorder";

const firstLayerId = (doc: Document): NodeId => doc.layerOrder[0]!;

const addToParent = (doc: Document, parentId: NodeId, nodes: SceneNode[]): void => {
  const parent = doc.nodes[parentId];
  if (!parent || !isContainer(parent)) {
    throw new Error("Test parent must be a container");
  }

  for (const node of nodes) {
    doc.nodes[node.id] = node;
    parent.children.push(node.id);
  }
};

const childrenOf = (doc: Document, id: NodeId): NodeId[] => {
  const node = doc.nodes[id];
  return node && isContainer(node) ? node.children : [];
};

describe("moveNode", () => {
  it("reorders two siblings before the target", () => {
    const doc = createDocument();
    const layerId = firstLayerId(doc);
    const first = createRect(0, 0, 10, 10);
    const second = createRect(10, 0, 10, 10);
    addToParent(doc, layerId, [first, second]);

    const next = moveNode(doc, second.id, first.id, "before");

    expect(next).not.toBe(doc);
    expect(childrenOf(next, layerId)).toEqual([second.id, first.id]);
    expect(childrenOf(doc, layerId)).toEqual([first.id, second.id]);
  });

  it("reorders two siblings after the target", () => {
    const doc = createDocument();
    const layerId = firstLayerId(doc);
    const first = createRect(0, 0, 10, 10);
    const second = createRect(10, 0, 10, 10);
    addToParent(doc, layerId, [first, second]);

    const next = moveNode(doc, first.id, second.id, "after");

    expect(next).not.toBe(doc);
    expect(childrenOf(next, layerId)).toEqual([second.id, first.id]);
    expect(childrenOf(doc, layerId)).toEqual([first.id, second.id]);
  });

  it("moves a node inside a group", () => {
    const doc = createDocument();
    const layerId = firstLayerId(doc);
    const group = createGroup("Group");
    const child = createRect(0, 0, 10, 10);
    addToParent(doc, layerId, [group, child]);

    const next = moveNode(doc, child.id, group.id, "inside");

    expect(next).not.toBe(doc);
    expect(childrenOf(next, layerId)).toEqual([group.id]);
    expect(childrenOf(next, group.id)).toEqual([child.id]);
    expect(childrenOf(doc, layerId)).toEqual([group.id, child.id]);
  });

  it("rejects dropping a parent onto its own descendant", () => {
    const doc = createDocument();
    const layerId = firstLayerId(doc);
    const parent = createGroup("Parent");
    const child = createGroup("Child");
    doc.nodes[parent.id] = parent;
    doc.nodes[child.id] = child;
    childrenOf(doc, layerId).push(parent.id);
    parent.children.push(child.id);

    const next = moveNode(doc, parent.id, child.id, "inside");

    expect(next).toBe(doc);
    expect(childrenOf(doc, layerId)).toEqual([parent.id]);
    expect(childrenOf(doc, parent.id)).toEqual([child.id]);
  });

  it("rejects inside on a non-container", () => {
    const doc = createDocument();
    const layerId = firstLayerId(doc);
    const first = createRect(0, 0, 10, 10);
    const second = createRect(10, 0, 10, 10);
    addToParent(doc, layerId, [first, second]);

    const next = moveNode(doc, first.id, second.id, "inside");

    expect(next).toBe(doc);
    expect(childrenOf(doc, layerId)).toEqual([first.id, second.id]);
  });

  it("reorders within the top-level layer order", () => {
    const doc = createDocument();
    const firstLayer = firstLayerId(doc);
    const secondLayer = createLayer("Layer 2");
    doc.nodes[secondLayer.id] = secondLayer;
    doc.layerOrder.push(secondLayer.id);

    const next = moveNode(doc, firstLayer, secondLayer.id, "after");

    expect(next).not.toBe(doc);
    expect(next.layerOrder).toEqual([secondLayer.id, firstLayer]);
    expect(doc.layerOrder).toEqual([firstLayer, secondLayer.id]);
  });
});
