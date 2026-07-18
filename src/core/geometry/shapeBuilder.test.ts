import { beforeEach, describe, expect, it } from "vitest";
import { createRect } from "../model/factory";
import type { PathNode, SceneNode } from "../model/types";
import { createEditorStateForTest, editorStore } from "../../state/store";
import { pathfinder } from "./pathfinder";
import { shapeBuilder, splitShapeBuilderRegions } from "./shapeBuilder";

const signedArea = (node: PathNode): number => node.subpaths.reduce((total, subpath) => {
  let twiceArea = 0;
  for (let index = 0; index < subpath.anchors.length; index += 1) {
    const a = subpath.anchors[index]!.point;
    const b = subpath.anchors[(index + 1) % subpath.anchors.length]!.point;
    twiceArea += a.x * b.y - b.x * a.y;
  }
  return total + twiceArea / 2;
}, 0);

const overlappingRects = (): SceneNode[] => [createRect(0, 0, 10, 10), createRect(5, 0, 10, 10)];

describe("shapeBuilder", () => {
  it.each([
    ["an individual region", { x: 2, y: 5 }],
    ["the overlap region", { x: 7, y: 5 }],
  ])("unions the selection when clicking %s", (_label, point) => {
    const result = shapeBuilder(overlappingRects(), point, "union");

    expect(result).not.toBeNull();
    expect(result!.nodes).toHaveLength(1);
    expect(signedArea(result!.nodes[0]!)).toBeCloseTo(150, 8);
  });

  it("deletes exactly the Alt-clicked atomic overlap region", () => {
    const result = shapeBuilder(overlappingRects(), { x: 7, y: 5 }, "delete");

    expect(result).not.toBeNull();
    expect(result!.nodes).toHaveLength(1);
    expect(signedArea(result!.nodes[0]!)).toBeCloseTo(100, 8);
  });

  it("returns null for a click outside every divided region", () => {
    expect(shapeBuilder(overlappingRects(), { x: 30, y: 30 }, "union")).toBeNull();
  });

  it("splits disconnected divide lobes into independently clickable regions", () => {
    const horizontal = createRect(0, 0, 30, 10);
    const vertical = createRect(10, -5, 10, 20);
    const divided = pathfinder([horizontal, vertical], "divide");

    expect(divided).toHaveLength(3);
    expect(splitShapeBuilderRegions(divided)).toHaveLength(5);
  });
});

describe("applyShapeBuilder", () => {
  beforeEach(() => editorStore.setState(createEditorStateForTest()));

  it("applies through the store as one undoable replacement and ignores misses", () => {
    const [back, front] = overlappingRects();
    editorStore.getState().addNode(back!);
    editorStore.getState().addNode(front!);
    editorStore.getState().setSelection([back!.id, front!.id]);
    const before = editorStore.getState().doc;
    const historyBeforeMiss = editorStore.getState().history;

    editorStore.getState().applyShapeBuilder({ x: 30, y: 30 });
    expect(editorStore.getState().doc).toBe(before);
    expect(editorStore.getState().history).toBe(historyBeforeMiss);

    editorStore.getState().applyShapeBuilder({ x: 7, y: 5 });
    expect(editorStore.getState().selection).toHaveLength(1);
    expect(editorStore.getState().doc.nodes[back!.id]).toBeUndefined();
    expect(editorStore.getState().doc.nodes[front!.id]).toBeUndefined();

    editorStore.getState().undo();
    expect(editorStore.getState().doc).toBe(before);
  });
});
