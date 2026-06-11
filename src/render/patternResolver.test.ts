import { describe, expect, it } from "vitest";
import { IDENTITY, translate, type Matrix } from "../core/geometry/matrix";
import type { Document, GroupNode, LayerNode, RectNode, SceneNode } from "../core/model/types";
import { patternTileRect, patternTileScale } from "./patternResolver";

const none = { type: "none" } as const;

const layer = (id: string, children: string[], transform: Matrix = IDENTITY): LayerNode => ({
  id,
  name: id,
  type: "layer",
  transform,
  opacity: 1,
  visible: true,
  locked: false,
  children,
});

const group = (
  id: string,
  children: string[],
  transform: Matrix = IDENTITY,
  visible = true,
): GroupNode => ({
  id,
  name: id,
  type: "group",
  transform,
  opacity: 1,
  visible,
  locked: false,
  children,
  clip: false,
});

const rect = (
  id: string,
  width: number,
  height: number,
  transform: Matrix = IDENTITY,
  visible = true,
): RectNode => ({
  id,
  name: id,
  type: "rect",
  transform,
  opacity: 1,
  visible,
  locked: false,
  fill: none,
  stroke: null,
  blendMode: "source-over",
  width,
  height,
  rx: 0,
  ry: 0,
});

const documentWith = (nodes: SceneNode[], layerOrder = ["layer"]): Document => ({
  id: "doc",
  name: "Doc",
  width: 100,
  height: 100,
  layerOrder,
  guides: [],
  nodes: Object.fromEntries(nodes.map((node) => [node.id, node])),
});

describe("patternResolver pure helpers", () => {
  it("returns null for a missing source node", () => {
    const doc = documentWith([layer("layer", [])]);

    expect(patternTileRect(doc, "missing")).toBeNull();
  });

  it("returns null for a layer source node", () => {
    const doc = documentWith([layer("layer", [])]);

    expect(patternTileRect(doc, "layer")).toBeNull();
  });

  it("returns null for empty or degenerate source bounds", () => {
    const doc = documentWith([layer("layer", ["flat"]), rect("flat", 0, 24)]);

    expect(patternTileRect(doc, "flat")).toBeNull();
  });

  it("uses the source world bounds as the tile rect", () => {
    const doc = documentWith([
      layer("layer", ["group"]),
      group("group", ["source"], translate(5, 7)),
      rect("source", 30, 40, translate(10, 20)),
    ]);

    expect(patternTileRect(doc, "source")).toEqual({ x: 15, y: 27, w: 30, h: 40 });
  });

  it("ignores the source root visibility but respects descendant visibility", () => {
    const doc = documentWith([
      layer("layer", ["swatch"]),
      group("swatch", ["visible-child", "hidden-child"], translate(2, 3), false),
      rect("visible-child", 10, 20, translate(5, 7)),
      rect("hidden-child", 100, 100, translate(100, 100), false),
    ]);

    expect(patternTileRect(doc, "swatch")).toEqual({ x: 7, y: 10, w: 10, h: 20 });
  });

  it("caps the larger tile side at the requested maximum", () => {
    expect(patternTileScale({ x: 0, y: 0, w: 4096, h: 1024 })).toBe(0.5);
    expect(patternTileScale({ x: 0, y: 0, w: 300, h: 400 })).toBe(1);
    expect(patternTileScale({ x: 0, y: 0, w: 1000, h: 500 }, 250)).toBe(0.25);
  });
});
