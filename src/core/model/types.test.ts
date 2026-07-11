import { describe, expect, it } from "vitest";
import {
  createEllipse,
  createGroup,
  createImage,
  createLayer,
  createPath,
  createRect,
  createText,
} from "./factory";
import type { SceneNode } from "./types";
import { hasStyle, isContainer, isShape } from "./types";

const nodes: Record<string, SceneNode> = {
  layer: createLayer("L"),
  group: createGroup("G"),
  path: createPath(),
  rect: createRect(0, 0, 10, 10),
  ellipse: createEllipse(0, 0, 5, 5),
  text: createText("hi", { x: 0, y: 0 }),
  image: createImage("data:,", 10, 10),
};

describe("scene node type guards", () => {
  it("isContainer is true only for layers and groups", () => {
    expect(isContainer(nodes.layer!)).toBe(true);
    expect(isContainer(nodes.group!)).toBe(true);
    for (const type of ["path", "rect", "ellipse", "text", "image"]) {
      expect(isContainer(nodes[type]!)).toBe(false);
    }
  });

  it("isShape is true for the five leaf shape types, false for containers", () => {
    for (const type of ["path", "rect", "ellipse", "text", "image"]) {
      expect(isShape(nodes[type]!)).toBe(true);
    }
    expect(isShape(nodes.layer!)).toBe(false);
    expect(isShape(nodes.group!)).toBe(false);
  });

  it("hasStyle covers path/rect/ellipse/text but not image or containers", () => {
    for (const type of ["path", "rect", "ellipse", "text"]) {
      expect(hasStyle(nodes[type]!)).toBe(true);
    }
    expect(hasStyle(nodes.image!)).toBe(false);
    expect(hasStyle(nodes.layer!)).toBe(false);
    expect(hasStyle(nodes.group!)).toBe(false);
  });

  it("the guards partition every node type consistently", () => {
    for (const node of Object.values(nodes)) {
      // A node is exactly one of container or shape.
      expect(isContainer(node)).toBe(!isShape(node));
      // Every styled node is a shape.
      if (hasStyle(node)) {
        expect(isShape(node)).toBe(true);
      }
    }
  });
});
