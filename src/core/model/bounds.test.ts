import { describe, expect, it } from "vitest";
import { translate } from "../geometry/matrix";
import type { Document, NodeId, SceneNode } from "./types";
import { hitTest } from "./hittest";
import { localBounds, selectionBounds, worldBounds } from "./bounds";

const baseNode = {
  opacity: 1,
  visible: true,
  locked: false,
};

const makeDoc = (nodes: Record<NodeId, SceneNode>, layerOrder: NodeId[]): Document => ({
  id: "doc",
  name: "Test",
  width: 800,
  height: 600,
  nodes,
  layerOrder,
});

const layer = (id: NodeId, children: NodeId[], transform = translate(0, 0)): SceneNode => ({
  ...baseNode,
  id,
  name: id,
  type: "layer",
  transform,
  children,
});

const group = (id: NodeId, children: NodeId[], transform = translate(0, 0)): SceneNode => ({
  ...baseNode,
  id,
  name: id,
  type: "group",
  transform,
  children,
  clip: false,
});

const rect = (
  id: NodeId,
  width: number,
  height: number,
  transform = translate(0, 0),
  props: Partial<Pick<SceneNode, "visible" | "locked">> = {},
): SceneNode => ({
  ...baseNode,
  ...props,
  id,
  name: id,
  type: "rect",
  transform,
  fill: { type: "none" },
  stroke: null,
  blendMode: "source-over",
  width,
  height,
  rx: 0,
  ry: 0,
});

describe("model bounds", () => {
  it("returns local bounds for supported shape nodes", () => {
    expect(localBounds(rect("rect", 20, 10))).toEqual({ minX: 0, minY: 0, maxX: 20, maxY: 10 });

    expect(
      localBounds({
        ...baseNode,
        id: "ellipse",
        name: "ellipse",
        type: "ellipse",
        transform: translate(0, 0),
        fill: { type: "none" },
        stroke: null,
        blendMode: "source-over",
        rx: 8,
        ry: 5,
      }),
    ).toEqual({ minX: -8, minY: -5, maxX: 8, maxY: 5 });

    expect(
      localBounds({
        ...baseNode,
        id: "text",
        name: "text",
        type: "text",
        transform: translate(0, 0),
        fill: { type: "none" },
        stroke: null,
        blendMode: "source-over",
        text: "Hello",
        fontFamily: "sans-serif",
        fontSize: 10,
        fontWeight: 400,
        fontStyle: "normal",
        letterSpacing: 0,
        lineHeight: 1.5,
        textAlign: "left",
      }),
    ).toEqual({ minX: 0, minY: 0, maxX: 30, maxY: 15 });
  });

  it("includes path handles in local bounds", () => {
    expect(
      localBounds({
        ...baseNode,
        id: "path",
        name: "path",
        type: "path",
        transform: translate(0, 0),
        fill: { type: "none" },
        stroke: null,
        blendMode: "source-over",
        subpaths: [
          {
            closed: false,
            anchors: [
              {
                point: { x: 10, y: 10 },
                handleIn: { x: -20, y: 5 },
                handleOut: { x: 30, y: -15 },
              },
            ],
          },
        ],
      }),
    ).toEqual({ minX: -10, minY: -5, maxX: 40, maxY: 15 });
  });

  it("composes ancestor transforms for world bounds", () => {
    const doc = makeDoc(
      {
        layer1: layer("layer1", ["group1"], translate(3, 4)),
        group1: group("group1", ["rect1"], translate(10, 20)),
        rect1: rect("rect1", 30, 40, translate(5, 6)),
      },
      ["layer1"],
    );

    expect(worldBounds(doc, "rect1")).toEqual({ minX: 18, minY: 30, maxX: 48, maxY: 70 });
  });

  it("returns the union of selected world bounds", () => {
    const doc = makeDoc(
      {
        layer1: layer("layer1", ["rect1", "rect2"]),
        rect1: rect("rect1", 10, 10, translate(5, 5)),
        rect2: rect("rect2", 20, 10, translate(30, 15)),
      },
      ["layer1"],
    );

    expect(selectionBounds(doc, ["rect1", "rect2"])).toEqual({
      minX: 5,
      minY: 5,
      maxX: 50,
      maxY: 25,
    });
  });

  it("hit-tests the topmost node and returns null when nothing is hit", () => {
    const doc = makeDoc(
      {
        layer1: layer("layer1", ["bottom", "top"]),
        bottom: rect("bottom", 50, 50),
        top: rect("top", 50, 50, translate(10, 10)),
      },
      ["layer1"],
    );

    expect(hitTest(doc, { x: 20, y: 20 })).toBe("top");
    expect(hitTest(doc, { x: 70, y: 70 })).toBeNull();
  });

  it("skips locked and invisible nodes during hit-testing", () => {
    const doc = makeDoc(
      {
        layer1: layer("layer1", ["bottom", "locked", "hidden"]),
        bottom: rect("bottom", 50, 50),
        locked: rect("locked", 50, 50, translate(0, 0), { locked: true }),
        hidden: rect("hidden", 50, 50, translate(0, 0), { visible: false }),
      },
      ["layer1"],
    );

    expect(hitTest(doc, { x: 20, y: 20 })).toBe("bottom");
  });
});
