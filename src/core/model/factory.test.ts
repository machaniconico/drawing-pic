import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { IDENTITY } from "../geometry/matrix";
import {
  BLACK,
  NO_PAINT,
  WHITE,
  corner,
  createDocument,
  createEllipse,
  createGroup,
  createLayer,
  createPath,
  createPolygon,
  createRect,
  createStar,
  createText,
  defaultStroke,
  newId,
  rgba,
  solid,
} from "./factory";

describe("model factory", () => {
  beforeEach(() => {
    let counter = 0;
    vi.stubGlobal("crypto", {
      randomUUID: vi.fn(() => `test-id-${++counter}`),
    });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("creates deterministic unique ids when crypto.randomUUID is available", () => {
    expect(newId()).toBe("test-id-1");
    expect(newId()).toBe("test-id-2");
  });

  it("creates documents with one root layer in layerOrder and nodes", () => {
    const doc = createDocument(800, 600, "Poster");
    const layerId = doc.layerOrder[0];

    expect(doc).toMatchObject({
      id: "test-id-2",
      name: "Poster",
      width: 800,
      height: 600,
      layerOrder: [layerId],
    });
    expect(doc.layerOrder).toHaveLength(1);
    expect(doc.nodes[layerId]).toMatchObject({
      id: layerId,
      name: "Layer 1",
      type: "layer",
      children: [],
    });
    expect(Object.keys(doc.nodes)).toEqual([layerId]);
  });

  it("creates layers with node defaults", () => {
    expect(createLayer("Ink")).toEqual({
      id: "test-id-1",
      name: "Ink",
      type: "layer",
      transform: IDENTITY,
      opacity: 1,
      visible: true,
      locked: false,
      children: [],
    });
  });

  it("creates groups with children and clip disabled by default", () => {
    expect(createGroup("Logo", ["child-a", "child-b"])).toEqual({
      id: "test-id-1",
      name: "Logo",
      type: "group",
      transform: IDENTITY,
      opacity: 1,
      visible: true,
      locked: false,
      children: ["child-a", "child-b"],
      clip: false,
    });
  });

  it("creates rectangles with transform translation, dimensions, corners, and style defaults", () => {
    expect(createRect(10, 20, 30, 40)).toMatchObject({
      id: "test-id-1",
      name: "Rectangle",
      type: "rect",
      transform: { ...IDENTITY, e: 10, f: 20 },
      opacity: 1,
      visible: true,
      locked: false,
      width: 30,
      height: 40,
      rx: 0,
      ry: 0,
      fill: solid({ r: 200, g: 200, b: 200, a: 1 }),
      stroke: defaultStroke(),
      blendMode: "source-over",
    });
  });

  it("creates ellipses centered via transform translation", () => {
    expect(createEllipse(15, 25, 8, 12)).toMatchObject({
      id: "test-id-1",
      name: "Ellipse",
      type: "ellipse",
      transform: { ...IDENTITY, e: 15, f: 25 },
      rx: 8,
      ry: 12,
      fill: solid({ r: 200, g: 200, b: 200, a: 1 }),
      stroke: defaultStroke(),
      blendMode: "source-over",
    });
  });

  it("creates paths with no fill, default stroke, and supplied subpaths", () => {
    const subpath = {
      anchors: [corner({ x: 0, y: 0 }), corner({ x: 10, y: 0 })],
      closed: false,
    };

    expect(createPath([subpath])).toMatchObject({
      id: "test-id-1",
      name: "Path",
      type: "path",
      transform: IDENTITY,
      subpaths: [subpath],
      fill: NO_PAINT,
      stroke: defaultStroke(),
      blendMode: "source-over",
    });
  });

  it("creates text with text styling defaults and black fill", () => {
    expect(createText("Hello", { x: 50, y: 60 })).toMatchObject({
      id: "test-id-1",
      name: "Text",
      type: "text",
      transform: { ...IDENTITY, e: 50, f: 60 },
      text: "Hello",
      fill: solid(BLACK),
      stroke: null,
      fontFamily: "sans-serif",
      fontSize: 24,
      fontWeight: 400,
      fontStyle: "normal",
      letterSpacing: 0,
      lineHeight: 1.2,
      textAlign: "left",
    });
  });

  it("creates color, paint, and stroke defaults", () => {
    expect(rgba(1, 2, 3, 0.5)).toEqual({ r: 1, g: 2, b: 3, a: 0.5 });
    expect(rgba(1, 2, 3)).toEqual({ r: 1, g: 2, b: 3, a: 1 });
    expect(WHITE).toEqual({ r: 255, g: 255, b: 255, a: 1 });
    expect(defaultStroke(WHITE, 3)).toEqual({
      paint: solid(WHITE),
      width: 3,
      cap: "butt",
      join: "miter",
      miterLimit: 10,
      dash: [],
      dashOffset: 0,
      align: "center",
    });
  });

  it("creates corner anchors without handles", () => {
    const point = { x: 7, y: 9 };

    expect(corner(point)).toEqual({
      point,
      handleIn: null,
      handleOut: null,
    });
  });

  it("creates a regular polygon as a closed corner path centred via transform", () => {
    const poly = createPolygon(100, 50, 40, 6);
    expect(poly.type).toBe("path");
    expect(poly.transform.e).toBe(100);
    expect(poly.transform.f).toBe(50);
    expect(poly.subpaths).toHaveLength(1);
    expect(poly.subpaths[0]!.closed).toBe(true);
    expect(poly.subpaths[0]!.anchors).toHaveLength(6);
    // First vertex is the top apex at local (0, -radius).
    expect(poly.subpaths[0]!.anchors[0]!.point.x).toBeCloseTo(0, 9);
    expect(poly.subpaths[0]!.anchors[0]!.point.y).toBeCloseTo(-40, 9);
    // Every vertex sits on the circumscribed circle.
    for (const anchor of poly.subpaths[0]!.anchors) {
      expect(Math.hypot(anchor.point.x, anchor.point.y)).toBeCloseTo(40, 9);
      expect(anchor.handleIn).toBeNull();
      expect(anchor.handleOut).toBeNull();
    }
  });

  it("clamps polygon sides to at least three", () => {
    expect(createPolygon(0, 0, 10, 2).subpaths[0]!.anchors).toHaveLength(3);
    expect(createPolygon(0, 0, 10, 5.9).subpaths[0]!.anchors).toHaveLength(5);
  });

  it("creates a star with alternating outer/inner radii and 2·points vertices", () => {
    const star = createStar(0, 0, 50, 20, 5);
    expect(star.type).toBe("path");
    expect(star.subpaths[0]!.anchors).toHaveLength(10);
    star.subpaths[0]!.anchors.forEach((anchor, index) => {
      const radius = Math.hypot(anchor.point.x, anchor.point.y);
      expect(radius).toBeCloseTo(index % 2 === 0 ? 50 : 20, 9);
    });
    // Apex outer point at the top.
    expect(star.subpaths[0]!.anchors[0]!.point.y).toBeCloseTo(-50, 9);
  });

  it("clamps star points to at least three", () => {
    expect(createStar(0, 0, 10, 4, 1).subpaths[0]!.anchors).toHaveLength(6);
  });
});
