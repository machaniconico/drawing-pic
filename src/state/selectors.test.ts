import { describe, expect, it } from "vitest";
import { fromRect } from "../core/geometry/bbox";
import { createDocument, createGroup, createRect } from "../core/model/factory";
import type { Document, NodeId, SceneNode } from "../core/model/types";
import { isContainer } from "../core/model/types";
import { getDocBounds, getNode, getSelectedNodes, isSelected, nodesInRect } from "./selectors";

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

describe("selectors", () => {
  it("getNode / getSelectedNodes / isSelected read the document and selection", () => {
    const doc = createDocument();
    const a = createRect(0, 0, 10, 10);
    const b = createRect(20, 0, 10, 10);
    addToLayer(doc, [a, b]);

    expect(getNode({ doc }, a.id)).toBe(doc.nodes[a.id]);
    expect(getNode({ doc }, "missing")).toBeUndefined();

    const selectedNodes = getSelectedNodes({ doc, selection: [a.id, "missing", b.id] });
    expect(selectedNodes.map((n) => n.id)).toEqual([a.id, b.id]);

    expect(isSelected({ selection: [a.id] }, a.id)).toBe(true);
    expect(isSelected({ selection: [a.id] }, b.id)).toBe(false);
  });

  it("getDocBounds unions the world bounds of all layers", () => {
    const doc = createDocument();
    const a = createRect(10, 10, 20, 20); // covers (10,10)-(30,30)
    const b = createRect(50, 40, 10, 10); // covers (50,40)-(60,50)
    addToLayer(doc, [a, b]);

    const bounds = getDocBounds({ doc });
    expect(bounds.minX).toBeCloseTo(10, 6);
    expect(bounds.minY).toBeCloseTo(10, 6);
    expect(bounds.maxX).toBeCloseTo(60, 6);
    expect(bounds.maxY).toBeCloseTo(50, 6);
  });

  it("nodesInRect returns shapes whose world bounds intersect the marquee", () => {
    const doc = createDocument();
    const inside = createRect(10, 10, 10, 10);
    const outside = createRect(200, 200, 10, 10);
    const overlapping = createRect(25, 25, 20, 20); // straddles the marquee edge
    addToLayer(doc, [inside, outside, overlapping]);

    const hits = nodesInRect({ doc }, fromRect(0, 0, 30, 30));
    expect(hits).toContain(inside.id);
    expect(hits).toContain(overlapping.id);
    expect(hits).not.toContain(outside.id);
  });

  it("nodesInRect skips hidden and locked nodes", () => {
    const doc = createDocument();
    const visible = createRect(0, 0, 10, 10);
    const hidden = createRect(0, 0, 10, 10);
    hidden.visible = false;
    const locked = createRect(0, 0, 10, 10);
    locked.locked = true;
    addToLayer(doc, [visible, hidden, locked]);

    const hits = nodesInRect({ doc }, fromRect(-5, -5, 30, 30));
    expect(hits).toEqual([visible.id]);
  });

  it("nodesInRect descends into groups to find leaf shapes", () => {
    const doc = createDocument();
    const child = createRect(5, 5, 10, 10);
    const group = createGroup("G", [child.id]);
    doc.nodes[child.id] = child;
    addToLayer(doc, [group]);

    const hits = nodesInRect({ doc }, fromRect(0, 0, 40, 40));
    expect(hits).toContain(child.id);
    // The group container itself is not a hit — only its leaf shapes.
    expect(hits).not.toContain(group.id);
  });

  it("nodesInRect skips an entire locked group subtree", () => {
    const doc = createDocument();
    const child = createRect(5, 5, 10, 10);
    const group = createGroup("Locked", [child.id]);
    group.locked = true;
    doc.nodes[child.id] = child;
    addToLayer(doc, [group]);

    expect(nodesInRect({ doc }, fromRect(0, 0, 40, 40))).toEqual([]);
  });
});
