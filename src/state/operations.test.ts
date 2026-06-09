import { beforeEach, describe, expect, it, vi } from "vitest";
import { canUndo } from "./history";
import { apply, compose, IDENTITY, invert, rotationAround, type Matrix } from "../core/geometry/matrix";
import { createDocument, createGroup, createRect, defaultStroke, rgba, solid } from "../core/model/factory";
import { selectionBounds, worldBounds } from "../core/model/bounds";
import type { Document, NodeId, SceneNode } from "../core/model/types";
import { isContainer } from "../core/model/types";
import {
  alignNodes,
  booleanSelection,
  bringToFront,
  cloneSubtree,
  distributeNodes,
  flipNodes,
  groupSelection,
  moveSelectionTo,
  nodeRotationAngle,
  resizeSelectionTo,
  rotateNodesAround,
  rotateNodes90,
  sampleStyleAt,
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

const expectMatrixCloseTo = (actual: Matrix, expected: Matrix): void => {
  expect(actual.a).toBeCloseTo(expected.a, 9);
  expect(actual.b).toBeCloseTo(expected.b, 9);
  expect(actual.c).toBeCloseTo(expected.c, 9);
  expect(actual.d).toBeCloseTo(expected.d, 9);
  expect(actual.e).toBeCloseTo(expected.e, 9);
  expect(actual.f).toBeCloseTo(expected.f, 9);
};

const expectPointCloseTo = (
  actual: { x: number; y: number },
  expected: { x: number; y: number },
): void => {
  expect(actual.x).toBeCloseTo(expected.x, 9);
  expect(actual.y).toBeCloseTo(expected.y, 9);
};

const expectBoundsCloseTo = (
  actual: { minX: number; minY: number; maxX: number; maxY: number },
  expected: { minX: number; minY: number; maxX: number; maxY: number },
): void => {
  expect(actual.minX).toBeCloseTo(expected.minX, 9);
  expect(actual.minY).toBeCloseTo(expected.minY, 9);
  expect(actual.maxX).toBeCloseTo(expected.maxX, 9);
  expect(actual.maxY).toBeCloseTo(expected.maxY, 9);
};

const applyMatrixPatches = (doc: Document, patches: Record<NodeId, Matrix>): void => {
  for (const [id, transform] of Object.entries(patches)) {
    const node = doc.nodes[id];
    if (node) {
      node.transform = transform;
    }
  }
};

describe("selection operations", () => {
  it("samples the hit node fill and stroke at a world point", () => {
    const doc = createDocument();
    const rect = createRect(10, 20, 30, 40);
    rect.fill = solid(rgba(255, 0, 0));
    rect.stroke = defaultStroke(rgba(0, 0, 255), 3);
    addToFirstLayer(doc, [rect]);
    const beforeSample = structuredClone(doc) as Document;

    const sampled = sampleStyleAt(doc, { x: 15, y: 25 });

    expect(sampled).toEqual({ fill: rect.fill, stroke: rect.stroke });
    expect(doc).toEqual(beforeSample);
  });

  it("returns null when sampling empty space", () => {
    const doc = createDocument();
    const rect = createRect(10, 20, 30, 40);
    addToFirstLayer(doc, [rect]);

    expect(sampleStyleAt(doc, { x: 100, y: 100 })).toBeNull();
  });

  it("samples the top-most hit node style when shapes overlap", () => {
    const doc = createDocument();
    const back = createRect(0, 0, 20, 20);
    const front = createRect(5, 5, 20, 20);
    back.fill = solid(rgba(255, 0, 0));
    front.fill = solid(rgba(0, 255, 0));
    addToFirstLayer(doc, [back, front]);

    const sampled = sampleStyleAt(doc, { x: 10, y: 10 });

    expect(sampled?.fill).toEqual(front.fill);
  });

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

  it("aligns nodes to the left edge of the key object and leaves the key fixed", () => {
    const doc = createDocument();
    const target = createRect(10, 20, 10, 10);
    const key = createRect(40, 5, 20, 20);
    addToFirstLayer(doc, [target, key]);

    const patches = alignNodes(doc, [target.id, key.id], "left", key.id);

    expect(patches[target.id]).toEqual({ e: 40, f: 20 });
    expect(patches[key.id]).toBeUndefined();
  });

  it("aligns nodes to the horizontal center of the key object and leaves the key fixed", () => {
    const doc = createDocument();
    const left = createRect(10, 20, 10, 10);
    const key = createRect(40, 5, 20, 20);
    const right = createRect(80, 15, 10, 10);
    addToFirstLayer(doc, [left, key, right]);

    const patches = alignNodes(doc, [left.id, key.id, right.id], "hcenter", key.id);

    expect(patches[left.id]).toEqual({ e: 45, f: 20 });
    expect(patches[key.id]).toBeUndefined();
    expect(patches[right.id]).toEqual({ e: 45, f: 15 });
  });

  it("aligns nodes to the right edge of the key object and leaves the key fixed", () => {
    const doc = createDocument();
    const target = createRect(10, 20, 10, 10);
    const key = createRect(40, 5, 20, 20);
    addToFirstLayer(doc, [target, key]);

    const patches = alignNodes(doc, [target.id, key.id], "right", key.id);

    expect(patches[target.id]).toEqual({ e: 50, f: 20 });
    expect(patches[key.id]).toBeUndefined();
  });

  it("falls back to selection bounds alignment when the key object is absent", () => {
    const doc = createDocument();
    const left = createRect(10, 20, 10, 10);
    const right = createRect(40, 5, 20, 20);
    const absent = createRect(100, 100, 10, 10);
    addToFirstLayer(doc, [left, right, absent]);

    const withoutKey = alignNodes(doc, [left.id, right.id], "hcenter");
    const withAbsentKey = alignNodes(doc, [left.id, right.id], "hcenter", absent.id);

    expect(withAbsentKey).toEqual(withoutKey);
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

  it("flips selected nodes horizontally twice back to their original transforms", () => {
    const doc = createDocument();
    const left = createRect(0, 0, 10, 20);
    const right = createRect(40, 10, 20, 10);
    addToFirstLayer(doc, [left, right]);
    const originalLeft = left.transform;
    const originalRight = right.transform;

    applyMatrixPatches(doc, flipNodes(doc, [left.id, right.id], "horizontal"));
    applyMatrixPatches(doc, flipNodes(doc, [left.id, right.id], "horizontal"));

    expectMatrixCloseTo(left.transform, originalLeft);
    expectMatrixCloseTo(right.transform, originalRight);
  });

  it("rotates selected nodes clockwise four times back to identity and twice to 180 degrees", () => {
    const doc = createDocument();
    const rect = createRect(0, 0, 10, 20);
    addToFirstLayer(doc, [rect]);

    applyMatrixPatches(doc, rotateNodes90(doc, [rect.id], "cw"));
    applyMatrixPatches(doc, rotateNodes90(doc, [rect.id], "cw"));
    expectMatrixCloseTo(rect.transform, { a: -1, b: 0, c: 0, d: -1, e: 10, f: 20 });

    applyMatrixPatches(doc, rotateNodes90(doc, [rect.id], "cw"));
    applyMatrixPatches(doc, rotateNodes90(doc, [rect.id], "cw"));
    expectMatrixCloseTo(rect.transform, IDENTITY);
  });

  it("rotates a single node around by 90 degrees the same as clockwise rotateNodes90", () => {
    const doc = createDocument();
    const rect = createRect(10, 20, 30, 40);
    addToFirstLayer(doc, [rect]);

    const aroundPatches = rotateNodesAround(doc, [rect.id], Math.PI / 2);
    const rotate90Patches = rotateNodes90(doc, [rect.id], "cw");

    expectMatrixCloseTo(aroundPatches[rect.id]!, rotate90Patches[rect.id]!);
  });

  it("reads a node's own normalized rotation angle from its transform", () => {
    const identity = createRect(0, 0, 10, 10);
    expect(nodeRotationAngle(identity)).toBe(0);

    const angle = -Math.PI / 3;
    const rotated = createRect(0, 0, 10, 10);
    rotated.transform = {
      a: Math.cos(angle),
      b: Math.sin(angle),
      c: -Math.sin(angle),
      d: Math.cos(angle),
      e: 5,
      f: 6,
    };

    expect(nodeRotationAngle(rotated)).toBeCloseTo(angle, 9);

    rotated.transform = { ...rotated.transform, a: -1, b: -0 };
    expect(nodeRotationAngle(rotated)).toBeCloseTo(Math.PI, 9);
  });

  it("uses the shared union center when rotating multiple nodes around an angle", () => {
    const doc = createDocument();
    const left = createRect(0, 0, 10, 10);
    const right = createRect(30, 0, 10, 10);
    addToFirstLayer(doc, [left, right]);

    const patches = rotateNodesAround(doc, [left.id, right.id], Math.PI / 2);

    expectPointCloseTo(apply(patches[left.id]!, { x: 0, y: 0 }), { x: 25, y: -15 });
    expectPointCloseTo(apply(patches[right.id]!, { x: 10, y: 10 }), { x: 15, y: 25 });
  });

  it("rotates around by 90 degrees four times back to the original transform", () => {
    const doc = createDocument();
    const rect = createRect(12, 34, 20, 30);
    addToFirstLayer(doc, [rect]);
    const original = rect.transform;

    for (let index = 0; index < 4; index += 1) {
      applyMatrixPatches(doc, rotateNodesAround(doc, [rect.id], Math.PI / 2));
    }

    expectMatrixCloseTo(rect.transform, original);
  });

  it("returns no rotate-around patches for empty or degenerate selections", () => {
    const doc = createDocument();
    const pointRect = createRect(10, 20, 0, 0);
    addToFirstLayer(doc, [pointRect]);

    expect(rotateNodesAround(doc, [], Math.PI / 4)).toEqual({});
    expect(rotateNodesAround(doc, [pointRect.id], Math.PI / 4)).toEqual({});
  });

  it("converts rotate-around operations through rotated parent space", () => {
    const doc = createDocument();
    const child = createRect(5, 0, 10, 10);
    const group = createGroup("Group", [child.id]);
    const parentAngle = Math.PI / 6;
    group.transform = {
      a: Math.cos(parentAngle),
      b: Math.sin(parentAngle),
      c: -Math.sin(parentAngle),
      d: Math.cos(parentAngle),
      e: 100,
      f: 50,
    };
    addToFirstLayer(doc, [group]);
    doc.nodes[child.id] = child;

    const bounds = worldBounds(doc, child.id);
    const pivot = {
      x: (bounds.minX + bounds.maxX) / 2,
      y: (bounds.minY + bounds.maxY) / 2,
    };
    const angle = Math.PI / 4;
    const parentInverse = invert(group.transform);
    if (!parentInverse) {
      throw new Error("Expected test parent transform to be invertible");
    }

    const beforeWorld = compose(group.transform, child.transform);
    const expectedWorld = compose(rotationAround(angle, pivot.x, pivot.y), beforeWorld);
    const patches = rotateNodesAround(doc, [child.id], angle);
    const actualWorld = compose(group.transform, patches[child.id]!);

    expectMatrixCloseTo(actualWorld, expectedWorld);
    expectMatrixCloseTo(patches[child.id]!, compose(parentInverse, expectedWorld));
  });

  it("moves a single selected node bbox top-left to the target without resizing it", () => {
    const doc = createDocument();
    const rect = createRect(10, 20, 30, 40);
    addToFirstLayer(doc, [rect]);
    const before = selectionBounds(doc, [rect.id]);

    applyMatrixPatches(doc, moveSelectionTo(doc, [rect.id], 100, 200));

    const after = selectionBounds(doc, [rect.id]);
    expect(after.minX).toBeCloseTo(100, 9);
    expect(after.minY).toBeCloseTo(200, 9);
    expect(after.maxX - after.minX).toBeCloseTo(before.maxX - before.minX, 9);
    expect(after.maxY - after.minY).toBeCloseTo(before.maxY - before.minY, 9);
  });

  it("moves multiple selected nodes as one rigid bbox to the target", () => {
    const doc = createDocument();
    const left = createRect(10, 10, 10, 10);
    const right = createRect(30, 20, 20, 5);
    addToFirstLayer(doc, [left, right]);

    applyMatrixPatches(doc, moveSelectionTo(doc, [left.id, right.id], 100, 200));

    expectBoundsCloseTo(selectionBounds(doc, [left.id, right.id]), {
      minX: 100,
      minY: 200,
      maxX: 140,
      maxY: 215,
    });
    expect(left.transform.e).toBeCloseTo(100, 9);
    expect(left.transform.f).toBeCloseTo(200, 9);
    expect(right.transform.e).toBeCloseTo(120, 9);
    expect(right.transform.f).toBeCloseTo(210, 9);
  });

  it("resizes the selected bbox to double width and half height with a fixed top-left", () => {
    const doc = createDocument();
    const left = createRect(10, 20, 10, 20);
    const right = createRect(30, 40, 20, 20);
    addToFirstLayer(doc, [left, right]);

    applyMatrixPatches(doc, resizeSelectionTo(doc, [left.id, right.id], 80, 20));

    expectBoundsCloseTo(selectionBounds(doc, [left.id, right.id]), {
      minX: 10,
      minY: 20,
      maxX: 90,
      maxY: 40,
    });
  });

  it("keeps zero-size resize axes finite and skips non-positive target axes", () => {
    const doc = createDocument();
    const verticalLine = createRect(10, 20, 0, 10);
    const rect = createRect(50, 60, 20, 30);
    addToFirstLayer(doc, [verticalLine, rect]);
    const originalRectTransform = rect.transform;

    applyMatrixPatches(doc, resizeSelectionTo(doc, [verticalLine.id], 50, 30));
    const lineBounds = selectionBounds(doc, [verticalLine.id]);
    expectBoundsCloseTo(lineBounds, { minX: 10, minY: 20, maxX: 10, maxY: 50 });
    expect(Object.values(verticalLine.transform).every(Number.isFinite)).toBe(true);

    applyMatrixPatches(doc, resizeSelectionTo(doc, [rect.id], -5, 0));
    expectMatrixCloseTo(rect.transform, originalRectTransform);
    expectBoundsCloseTo(selectionBounds(doc, [rect.id]), { minX: 50, minY: 60, maxX: 70, maxY: 90 });
  });

  it("flips a single node corner to its mirrored corner around the node center", () => {
    const doc = createDocument();
    const rect = createRect(10, 20, 30, 40);
    addToFirstLayer(doc, [rect]);

    const patches = flipNodes(doc, [rect.id], "horizontal");
    const nextTransform = patches[rect.id]!;

    expectPointCloseTo(apply(nextTransform, { x: 0, y: 0 }), { x: 40, y: 20 });
    expectPointCloseTo(apply(nextTransform, { x: 30, y: 40 }), { x: 10, y: 60 });
  });

  it("uses the shared union center when flipping multiple nodes", () => {
    const doc = createDocument();
    const left = createRect(0, 0, 10, 10);
    const right = createRect(30, 0, 10, 10);
    addToFirstLayer(doc, [left, right]);

    const patches = flipNodes(doc, [left.id, right.id], "horizontal");

    expectPointCloseTo(apply(patches[left.id]!, { x: 0, y: 0 }), { x: 40, y: 0 });
    expectPointCloseTo(apply(patches[right.id]!, { x: 10, y: 10 }), { x: 0, y: 10 });
  });

  it("converts world flip operations through transformed parent space", () => {
    const doc = createDocument();
    const child = createRect(5, 0, 10, 10);
    const group = createGroup("Group", [child.id]);
    group.transform = { a: 2, b: 0, c: 0, d: 2, e: 100, f: 50 };
    addToFirstLayer(doc, [group]);
    doc.nodes[child.id] = child;

    const patches = flipNodes(doc, [child.id], "horizontal");
    const childWorldAfter = compose(group.transform, patches[child.id]!);

    expectPointCloseTo(apply(childWorldAfter, { x: 0, y: 0 }), { x: 130, y: 50 });
    expectPointCloseTo(apply(childWorldAfter, { x: 10, y: 10 }), { x: 110, y: 70 });
  });

  it("skips transform operations when the parent world transform is singular", () => {
    const doc = createDocument();
    const child = createRect(5, 0, 10, 10);
    const group = createGroup("Group", [child.id]);
    group.transform = { a: 0, b: 0, c: 0, d: 1, e: 100, f: 50 };
    addToFirstLayer(doc, [group]);
    doc.nodes[child.id] = child;

    expect(flipNodes(doc, [child.id], "horizontal")).toEqual({});
    expect(rotateNodes90(doc, [child.id], "cw")).toEqual({});
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
