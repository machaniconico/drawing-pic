import { beforeEach, describe, expect, it } from "vitest";
import { createRect } from "../model/factory";
import type { PathNode, SceneNode } from "../model/types";
import { isContainer } from "../model/types";
import { createEditorStateForTest, editorStore } from "../../state/store";
import { pathfinder } from "./pathfinder";

const pathArea = (node: PathNode): number =>
  node.subpaths.reduce((total, subpath) => {
    let twiceArea = 0;
    for (let index = 0; index < subpath.anchors.length; index += 1) {
      const a = subpath.anchors[index]!.point;
      const b = subpath.anchors[(index + 1) % subpath.anchors.length]!.point;
      twiceArea += a.x * b.y - b.x * a.y;
    }
    return total + twiceArea / 2;
  }, 0);

const overlappingRects = (): SceneNode[] => [createRect(0, 0, 10, 10), createRect(5, 0, 10, 10)];

describe("pathfinder", () => {
  it("unites overlapping nodes and inherits the frontmost style", () => {
    const [back, front] = overlappingRects();
    if (!back || !front || back.type !== "rect" || front.type !== "rect") {
      throw new Error("Expected rectangles");
    }
    front.fill = { type: "solid", color: { r: 10, g: 20, b: 30, a: 1 } };

    const [result] = pathfinder([back, front], "unite");

    expect(result).toBeDefined();
    expect(pathArea(result!)).toBeCloseTo(150, 8);
    expect(result!.fill).toEqual(front.fill);
    expect(result!.fill).not.toBe(front.fill);
  });

  it("intersects all selected nodes", () => {
    const result = pathfinder(overlappingRects(), "intersect");

    expect(result).toHaveLength(1);
    expect(pathArea(result[0]!)).toBeCloseTo(50, 8);
  });

  it("subtracts every front node from the backmost node and keeps its style", () => {
    const [back, front] = overlappingRects();
    if (!back || !front || back.type !== "rect") {
      throw new Error("Expected rectangles");
    }
    back.opacity = 0.4;

    const [result] = pathfinder([back, front], "minus-front");

    expect(pathArea(result!)).toBeCloseTo(50, 8);
    expect(result!.opacity).toBe(0.4);
  });

  it("excludes the shared area", () => {
    const result = pathfinder(overlappingRects(), "exclude");

    expect(result).toHaveLength(1);
    expect(pathArea(result[0]!)).toBeCloseTo(100, 8);
  });

  it("divides overlapping nodes into each non-overlapping region", () => {
    const result = pathfinder(overlappingRects(), "divide");

    expect(result).toHaveLength(3);
    expect(result.map(pathArea).sort((a, b) => a - b)).toEqual([50, 50, 50]);
  });

  it("subtracts the back nodes from the frontmost node", () => {
    const result = pathfinder(overlappingRects(), "minus-back");

    expect(result).toHaveLength(1);
    expect(pathArea(result[0]!)).toBeCloseTo(50, 8);
  });
});

describe("applyPathfinder", () => {
  beforeEach(() => {
    editorStore.setState(createEditorStateForTest());
  });

  it("replaces the selection with result paths and restores the source nodes on undo", () => {
    const [back, front] = overlappingRects();
    if (!back || !front) {
      throw new Error("Expected rectangles");
    }
    editorStore.getState().addNode(back);
    editorStore.getState().addNode(front);
    editorStore.getState().setSelection([back.id, front.id]);
    const originalDoc = editorStore.getState().doc;

    editorStore.getState().applyPathfinder("divide");

    const state = editorStore.getState();
    const layer = state.doc.nodes[state.doc.layerOrder[0]!];
    expect(state.selection).toHaveLength(3);
    expect(state.selection.every((id) => state.doc.nodes[id]?.type === "path")).toBe(true);
    expect(state.doc.nodes[back.id]).toBeUndefined();
    expect(state.doc.nodes[front.id]).toBeUndefined();
    expect(layer && isContainer(layer) ? layer.children : []).toEqual(state.selection);

    editorStore.getState().undo();

    expect(editorStore.getState().doc).toBe(originalDoc);
    expect(editorStore.getState().doc.nodes[back.id]).toEqual(back);
    expect(editorStore.getState().doc.nodes[front.id]).toEqual(front);
    const restoredLayer = editorStore.getState().doc.nodes[editorStore.getState().doc.layerOrder[0]!];
    expect(restoredLayer && isContainer(restoredLayer) ? restoredLayer.children : []).toEqual([
      back.id,
      front.id,
    ]);
  });
});
