import { beforeEach, describe, expect, it, vi } from "vitest";
import { canUndo } from "./history";
import { apply, compose, IDENTITY, invert, rotationAround, type Matrix } from "../core/geometry/matrix";
import {
  createDocument,
  createEllipse,
  createGroup,
  createImage,
  createPath,
  createRect,
  createText,
  defaultStroke,
  rgba,
  solid,
} from "../core/model/factory";
import { selectionBounds, worldBounds } from "../core/model/bounds";
import type { Document, NodeId, Paint, SceneNode, Stroke } from "../core/model/types";
import { isContainer } from "../core/model/types";
import {
  alignNodes,
  booleanSelection,
  bringToFront,
  cloneSubtree,
  convertShapeToPath,
  distributeByGap,
  distributeNodes,
  flipNodes,
  groupSelection,
  moveSelectionTo,
  nodesWithMatchingFill,
  nodesWithMatchingStroke,
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

const KAPPA = 0.5522847498307936;

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

const applyTransformPatches = (doc: Document, patches: Record<NodeId, { e: number; f: number }>): void => {
  for (const [id, patch] of Object.entries(patches)) {
    const node = doc.nodes[id];
    if (node) {
      node.transform = { ...node.transform, ...patch };
    }
  }
};

describe("convertShapeToPath", () => {
  it("converts a sharp rect to a closed four-anchor path and preserves shared node fields", () => {
    const rect = createRect(10, 20, 30, 40);
    const fill = solid(rgba(12, 34, 56, 0.75));
    const stroke = defaultStroke(rgba(200, 10, 20), 3);
    rect.name = "Card";
    rect.transform = { a: 0.5, b: 0.25, c: -0.125, d: 1.5, e: 10, f: 20 };
    rect.opacity = 0.4;
    rect.visible = false;
    rect.locked = true;
    rect.fill = fill;
    rect.stroke = stroke;
    rect.blendMode = "multiply";
    const before = structuredClone(rect);

    const path = convertShapeToPath(rect);

    expect(rect).toEqual(before);
    expect(path).not.toBeNull();
    if (!path) throw new Error("Expected rect conversion to produce a path");

    expect(path).toMatchObject({
      id: rect.id,
      name: "Card",
      type: "path",
      opacity: 0.4,
      visible: false,
      locked: true,
      blendMode: "multiply",
    });
    expect(path.transform).toBe(rect.transform);
    expect(path.fill).toBe(fill);
    expect(path.stroke).toBe(stroke);
    expect(path.subpaths).toHaveLength(1);
    expect(path.subpaths[0]?.closed).toBe(true);

    const anchors = path.subpaths[0]?.anchors ?? [];
    expect(anchors).toHaveLength(4);
    [{ x: 0, y: 0 }, { x: 30, y: 0 }, { x: 30, y: 40 }, { x: 0, y: 40 }].forEach(
      (point, index) => {
        expectPointCloseTo(anchors[index]!.point, point);
        expect(anchors[index]!.handleIn).toBeNull();
        expect(anchors[index]!.handleOut).toBeNull();
      },
    );
  });

  it("converts a rounded rect to eight anchors with clamped radii and kappa handles", () => {
    const rect = createRect(0, 0, 120, 80);
    rect.rx = 90;
    rect.ry = 70;

    const path = convertShapeToPath(rect);

    expect(path).not.toBeNull();
    if (!path) throw new Error("Expected rounded rect conversion to produce a path");

    const subpath = path.subpaths[0]!;
    expect(subpath.closed).toBe(true);
    expect(subpath.anchors).toHaveLength(8);

    const anchors = subpath.anchors;
    const rx = 60;
    const ry = 40;
    [
      { x: rx, y: 0 },
      { x: 120 - rx, y: 0 },
      { x: 120, y: ry },
      { x: 120, y: 80 - ry },
      { x: 120 - rx, y: 80 },
      { x: rx, y: 80 },
      { x: 0, y: 80 - ry },
      { x: 0, y: ry },
    ].forEach((point, index) => expectPointCloseTo(anchors[index]!.point, point));

    expectPointCloseTo(anchors[1]!.handleOut!, { x: KAPPA * rx, y: 0 });
    expectPointCloseTo(anchors[2]!.handleIn!, { x: 0, y: -KAPPA * ry });
    expectPointCloseTo(anchors[3]!.handleOut!, { x: 0, y: KAPPA * ry });
    expectPointCloseTo(anchors[4]!.handleIn!, { x: KAPPA * rx, y: 0 });
    expectPointCloseTo(anchors[5]!.handleOut!, { x: -KAPPA * rx, y: 0 });
    expectPointCloseTo(anchors[6]!.handleIn!, { x: 0, y: KAPPA * ry });
    expectPointCloseTo(anchors[7]!.handleOut!, { x: 0, y: -KAPPA * ry });
    expectPointCloseTo(anchors[0]!.handleIn!, { x: -KAPPA * rx, y: 0 });
  });

  it("converts an ellipse to four clockwise cubic anchors with scaled tangent handles", () => {
    const ellipse = createEllipse(50, 60, 25, 10);

    const path = convertShapeToPath(ellipse);

    expect(path).not.toBeNull();
    if (!path) throw new Error("Expected ellipse conversion to produce a path");

    expect(path.id).toBe(ellipse.id);
    expect(path.transform).toBe(ellipse.transform);
    expect(path.fill).toBe(ellipse.fill);
    expect(path.stroke).toBe(ellipse.stroke);
    expect(path.subpaths).toHaveLength(1);
    expect(path.subpaths[0]?.closed).toBe(true);

    const anchors = path.subpaths[0]!.anchors;
    expect(anchors).toHaveLength(4);
    [{ x: 25, y: 0 }, { x: 0, y: 10 }, { x: -25, y: 0 }, { x: 0, y: -10 }].forEach(
      (point, index) => expectPointCloseTo(anchors[index]!.point, point),
    );

    expectPointCloseTo(anchors[0]!.handleIn!, { x: 0, y: -KAPPA * 10 });
    expectPointCloseTo(anchors[0]!.handleOut!, { x: 0, y: KAPPA * 10 });
    expectPointCloseTo(anchors[1]!.handleIn!, { x: KAPPA * 25, y: 0 });
    expectPointCloseTo(anchors[1]!.handleOut!, { x: -KAPPA * 25, y: 0 });
    expectPointCloseTo(anchors[2]!.handleIn!, { x: 0, y: KAPPA * 10 });
    expectPointCloseTo(anchors[2]!.handleOut!, { x: 0, y: -KAPPA * 10 });
    expectPointCloseTo(anchors[3]!.handleIn!, { x: -KAPPA * 25, y: 0 });
    expectPointCloseTo(anchors[3]!.handleOut!, { x: KAPPA * 25, y: 0 });
  });

  it("returns null for non-rect and non-ellipse nodes", () => {
    const doc = createDocument();
    const layer = doc.nodes[firstLayerId(doc)]!;
    const nodes: SceneNode[] = [
      createPath(),
      createText("Label", { x: 0, y: 0 }),
      createImage("data:,", 10, 10),
      createGroup("Group"),
      layer,
    ];

    for (const node of nodes) {
      expect(convertShapeToPath(node)).toBeNull();
    }
  });
});

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

  it("selects styled nodes with matching solid fills and leaves the document unchanged", () => {
    const doc = createDocument();
    const reference = createRect(0, 0, 10, 10);
    const match = createRect(20, 0, 10, 10);
    const differentAlpha = createRect(40, 0, 10, 10);
    reference.fill = solid(rgba(255, 0, 0, 0.75));
    match.fill = solid(rgba(255, 0, 0, 0.75));
    differentAlpha.fill = solid(rgba(255, 0, 0, 1));
    addToFirstLayer(doc, [reference, match, differentAlpha]);
    const before = structuredClone(doc) as Document;

    const ids = nodesWithMatchingFill(doc, reference.id);

    expect(ids).toEqual([reference.id, match.id]);
    expect(doc).toEqual(before);
  });

  it("selects styled nodes with matching gradient fills by stops and geometry", () => {
    const doc = createDocument();
    const gradient: Paint = {
      type: "linear",
      start: { x: 0, y: 0 },
      end: { x: 100, y: 50 },
      stops: [
        { offset: 0, color: rgba(255, 0, 0) },
        { offset: 0.5, color: rgba(0, 255, 0, 0.5) },
        { offset: 1, color: rgba(0, 0, 255) },
      ],
    };
    const reference = createRect(0, 0, 10, 10);
    const match = createRect(20, 0, 10, 10);
    const differentStop = createRect(40, 0, 10, 10);
    const differentGeometry = createRect(60, 0, 10, 10);
    reference.fill = gradient;
    match.fill = structuredClone(gradient) as Paint;
    differentStop.fill = {
      ...structuredClone(gradient),
      stops: [
        { offset: 0, color: rgba(255, 0, 0) },
        { offset: 0.75, color: rgba(0, 255, 0, 0.5) },
        { offset: 1, color: rgba(0, 0, 255) },
      ],
    };
    differentGeometry.fill = { ...structuredClone(gradient), end: { x: 100, y: 51 } };
    addToFirstLayer(doc, [reference, match, differentStop, differentGeometry]);

    expect(nodesWithMatchingFill(doc, reference.id)).toEqual([reference.id, match.id]);
  });

  it("selects styled nodes with matching full stroke definitions", () => {
    const doc = createDocument();
    const stroke: Stroke = {
      ...defaultStroke(rgba(12, 34, 56, 0.8), 4),
      cap: "round",
      join: "bevel",
      miterLimit: 6,
      dash: [2, 3, 5],
      dashOffset: 1.5,
      align: "outside",
    };
    const reference = createRect(0, 0, 10, 10);
    const match = createRect(20, 0, 10, 10);
    const differentDash = createRect(40, 0, 10, 10);
    const differentAlign = createRect(60, 0, 10, 10);
    reference.stroke = stroke;
    match.stroke = structuredClone(stroke) as Stroke;
    differentDash.stroke = { ...structuredClone(stroke), dash: [2, 3, 6] };
    differentAlign.stroke = { ...structuredClone(stroke), align: "inside" };
    addToFirstLayer(doc, [reference, match, differentDash, differentAlign]);

    expect(nodesWithMatchingStroke(doc, reference.id)).toEqual([reference.id, match.id]);
  });

  it("selects styled nodes with matching null strokes", () => {
    const doc = createDocument();
    const reference = createRect(0, 0, 10, 10);
    const match = createRect(20, 0, 10, 10);
    const different = createRect(40, 0, 10, 10);
    reference.stroke = null;
    match.stroke = null;
    different.stroke = defaultStroke(rgba(0, 0, 0), 0);
    addToFirstLayer(doc, [reference, match, different]);

    expect(nodesWithMatchingStroke(doc, reference.id)).toEqual([reference.id, match.id]);
  });

  it("returns an empty selection for missing or non-styled select-same references", () => {
    const doc = createDocument();
    const styled = createRect(0, 0, 10, 10);
    const group = createGroup("Group");
    addToFirstLayer(doc, [styled, group]);

    expect(nodesWithMatchingFill(doc, "missing")).toEqual([]);
    expect(nodesWithMatchingStroke(doc, "missing")).toEqual([]);
    expect(nodesWithMatchingFill(doc, group.id)).toEqual([]);
    expect(nodesWithMatchingStroke(doc, group.id)).toEqual([]);
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

  it("aligns a single node to every edge and center of explicit reference bounds", () => {
    const doc = createDocument();
    const rect = createRect(20, 30, 10, 20);
    addToFirstLayer(doc, [rect]);
    const referenceBounds = { minX: 0, minY: 0, maxX: 100, maxY: 100 };

    expect(alignNodes(doc, [rect.id], "left", null, referenceBounds)).toEqual({
      [rect.id]: { e: 0, f: 30 },
    });
    expect(alignNodes(doc, [rect.id], "hcenter", null, referenceBounds)).toEqual({
      [rect.id]: { e: 45, f: 30 },
    });
    expect(alignNodes(doc, [rect.id], "right", null, referenceBounds)).toEqual({
      [rect.id]: { e: 90, f: 30 },
    });
    expect(alignNodes(doc, [rect.id], "top", null, referenceBounds)).toEqual({
      [rect.id]: { e: 20, f: 0 },
    });
    expect(alignNodes(doc, [rect.id], "vcenter", null, referenceBounds)).toEqual({
      [rect.id]: { e: 20, f: 40 },
    });
    expect(alignNodes(doc, [rect.id], "bottom", null, referenceBounds)).toEqual({
      [rect.id]: { e: 20, f: 80 },
    });
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

  it("distributes two nodes across explicit reference bounds while keeping them inside", () => {
    const doc = createDocument();
    const first = createRect(30, 10, 10, 10);
    const last = createRect(60, 20, 20, 10);
    addToFirstLayer(doc, [first, last]);

    const horizontalPatches = distributeNodes(
      doc,
      [first.id, last.id],
      "horizontal",
      { minX: 0, minY: 0, maxX: 100, maxY: 80 },
    );
    const verticalPatches = distributeNodes(
      doc,
      [first.id, last.id],
      "vertical",
      { minX: 0, minY: 0, maxX: 100, maxY: 80 },
    );

    expect(horizontalPatches[first.id]).toEqual({ e: 0, f: 10 });
    expect(horizontalPatches[last.id]).toEqual({ e: 80, f: 20 });
    expect(verticalPatches[first.id]).toEqual({ e: 30, f: 0 });
    expect(verticalPatches[last.id]).toEqual({ e: 60, f: 70 });
  });

  it("distributes nodes horizontally by an exact positive gap and leaves the first node fixed", () => {
    const doc = createDocument();
    const first = createRect(100, 10, 10, 8);
    const middle = createRect(20, 30, 20, 12);
    const last = createRect(60, 50, 5, 16);
    addToFirstLayer(doc, [first, middle, last]);

    const patches = distributeByGap(doc, [first.id, middle.id, last.id], "horizontal", 7);

    expect(patches[middle.id]).toBeUndefined();
    expect(patches[last.id]).toEqual({ e: 47, f: 50 });
    expect(patches[first.id]).toEqual({ e: 59, f: 10 });

    applyTransformPatches(doc, patches);
    const sorted = [middle, last, first].map((node) => worldBounds(doc, node.id));
    expect(sorted[0]!.minX).toBeCloseTo(20, 9);
    expect(sorted[1]!.minX - sorted[0]!.maxX).toBeCloseTo(7, 9);
    expect(sorted[2]!.minX - sorted[1]!.maxX).toBeCloseTo(7, 9);
    expect(worldBounds(doc, middle.id).minY).toBeCloseTo(30, 9);
    expect(worldBounds(doc, last.id).minY).toBeCloseTo(50, 9);
    expect(worldBounds(doc, first.id).minY).toBeCloseTo(10, 9);
  });

  it("distributes nodes vertically by a zero gap and only changes the vertical axis", () => {
    const doc = createDocument();
    const top = createRect(40, 10, 10, 10);
    const middle = createRect(80, 100, 12, 20);
    const bottom = createRect(120, 40, 14, 5);
    addToFirstLayer(doc, [top, middle, bottom]);

    const patches = distributeByGap(doc, [middle.id, bottom.id, top.id], "vertical", 0);

    expect(patches[top.id]).toBeUndefined();
    expect(patches[bottom.id]).toEqual({ e: 120, f: 20 });
    expect(patches[middle.id]).toEqual({ e: 80, f: 25 });

    applyTransformPatches(doc, patches);
    const sorted = [top, bottom, middle].map((node) => worldBounds(doc, node.id));
    expect(sorted[1]!.minY - sorted[0]!.maxY).toBeCloseTo(0, 9);
    expect(sorted[2]!.minY - sorted[1]!.maxY).toBeCloseTo(0, 9);
    expect(worldBounds(doc, top.id).minX).toBeCloseTo(40, 9);
    expect(worldBounds(doc, bottom.id).minX).toBeCloseTo(120, 9);
    expect(worldBounds(doc, middle.id).minX).toBeCloseTo(80, 9);
  });

  it("returns no exact-gap distribution patches with fewer than two usable nodes or non-finite gaps", () => {
    const doc = createDocument();
    const rect = createRect(0, 0, 10, 10);
    const other = createRect(30, 0, 10, 10);
    const empty = createRect(20, 20, 0, 0);
    addToFirstLayer(doc, [rect, other, empty]);

    expect(distributeByGap(doc, [], "horizontal", 10)).toEqual({});
    expect(distributeByGap(doc, [rect.id], "horizontal", 10)).toEqual({});
    expect(distributeByGap(doc, [rect.id, empty.id], "horizontal", 10)).toEqual({});
    expect(distributeByGap(doc, [rect.id, other.id], "vertical", Number.POSITIVE_INFINITY)).toEqual({});
    expect(distributeByGap(doc, [rect.id, other.id], "vertical", Number.NaN)).toEqual({});
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

  it("aligns one selected node to the active artboard and undoes the move", () => {
    const rect = createRect(30, 40, 10, 20);
    editorStore.getState().addNode(rect);
    editorStore.getState().setSelection([rect.id]);
    editorStore.setState((state) => ({
      doc: {
        ...state.doc,
        artboards: [
          { id: "inactive-artboard", name: "Inactive", x: 0, y: 0, width: 100, height: 100 },
          { id: "active-artboard", name: "Active", x: 20, y: 10, width: 200, height: 120 },
        ],
        activeArtboardId: "active-artboard",
      },
    }));
    const historyDepth = editorStore.getState().history.past.length;

    editorStore.getState().alignNodes("right", "artboard");

    expect(editorStore.getState().doc.nodes[rect.id]?.transform.e).toBe(210);
    expect(editorStore.getState().history.past).toHaveLength(historyDepth + 1);

    editorStore.getState().undo();

    expect(editorStore.getState().doc.nodes[rect.id]?.transform.e).toBe(30);
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
