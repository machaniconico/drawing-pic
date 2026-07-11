import { describe, expect, it } from "vitest";
import { createDocument, createGroup, createRect } from "./factory";
import type { Document, NodeId, SceneNode } from "./types";
import { isContainer } from "./types";
import { hitTest } from "./hittest";

const firstLayerId = (doc: Document): NodeId => doc.layerOrder[0]!;

const addToLayer = (doc: Document, nodes: SceneNode[], parentId?: NodeId): void => {
  const layer = doc.nodes[parentId ?? firstLayerId(doc)];
  if (!layer || !isContainer(layer)) {
    throw new Error("missing container");
  }
  for (const node of nodes) {
    doc.nodes[node.id] = node;
    layer.children.push(node.id);
  }
};

describe("hitTest", () => {
  it("returns the node whose world bounds contain the point", () => {
    const doc = createDocument();
    const rect = createRect(10, 10, 20, 20); // covers (10,10)-(30,30)
    addToLayer(doc, [rect]);

    expect(hitTest(doc, { x: 20, y: 20 })).toBe(rect.id);
    expect(hitTest(doc, { x: 5, y: 5 })).toBeNull();
  });

  it("returns the topmost (last-drawn) node when shapes overlap", () => {
    const doc = createDocument();
    const bottom = createRect(0, 0, 40, 40);
    const top = createRect(10, 10, 40, 40);
    addToLayer(doc, [bottom, top]); // top is later in child order → drawn on top

    // Point inside both → the topmost wins.
    expect(hitTest(doc, { x: 20, y: 20 })).toBe(top.id);
    // Point only inside the bottom shape.
    expect(hitTest(doc, { x: 2, y: 2 })).toBe(bottom.id);
  });

  it("skips hidden and locked nodes", () => {
    const doc = createDocument();
    const hidden = createRect(0, 0, 20, 20);
    hidden.visible = false;
    const locked = createRect(0, 0, 20, 20);
    locked.locked = true;
    addToLayer(doc, [hidden, locked]);

    expect(hitTest(doc, { x: 10, y: 10 })).toBeNull();
  });

  it("honours the tolerance by inflating bounds", () => {
    const doc = createDocument();
    const rect = createRect(10, 10, 10, 10); // covers (10,10)-(20,20)
    addToLayer(doc, [rect]);

    // A point 3px outside the right edge misses with no tolerance, hits with 5.
    expect(hitTest(doc, { x: 23, y: 15 })).toBeNull();
    expect(hitTest(doc, { x: 23, y: 15 }, { tolerance: 5 })).toBe(rect.id);
  });

  it("descends into groups and returns the leaf shape, topmost first", () => {
    const doc = createDocument();
    const lower = createRect(0, 0, 30, 30);
    const upper = createRect(0, 0, 30, 30);
    const group = createGroup("G", [lower.id, upper.id]);
    doc.nodes[lower.id] = lower;
    doc.nodes[upper.id] = upper;
    addToLayer(doc, [group]);

    // Overlapping children → the later child (upper) wins.
    expect(hitTest(doc, { x: 15, y: 15 })).toBe(upper.id);
  });

  it("does not hit inside a locked group", () => {
    const doc = createDocument();
    const child = createRect(0, 0, 30, 30);
    const group = createGroup("Locked", [child.id]);
    group.locked = true;
    doc.nodes[child.id] = child;
    addToLayer(doc, [group]);

    expect(hitTest(doc, { x: 15, y: 15 })).toBeNull();
  });

  it("returns null for an empty document", () => {
    expect(hitTest(createDocument(), { x: 0, y: 0 })).toBeNull();
  });
});
