import { describe, expect, it } from "vitest";
import { translate } from "./matrix";
import { flattenNodeToPolygons, polygonBoolean } from "./polygonBoolean";
import type { Vec2 } from "./vector";
import { corner, createDocument, createGroup, createPath, createRect } from "../model/factory";
import type { SubPath } from "../model/types";
import { isContainer } from "../model/types";

const rect = (x: number, y: number, width: number, height: number): Vec2[] => [
  { x, y },
  { x: x + width, y },
  { x: x + width, y: y + height },
  { x, y: y + height },
];

const triangle = (a: Vec2, b: Vec2, c: Vec2): Vec2[] => [a, b, c];

const ringArea = (ring: readonly Vec2[]): number => {
  let area = 0;
  for (let index = 0; index < ring.length; index += 1) {
    const a = ring[index]!;
    const b = ring[(index + 1) % ring.length]!;
    area += a.x * b.y - b.x * a.y;
  }
  return area / 2;
};

const totalArea = (rings: readonly Vec2[][]): number =>
  rings.reduce((area, ring) => area + ringArea(ring), 0);

const closedSubpath = (points: readonly Vec2[]): SubPath => ({
  anchors: points.map(corner),
  closed: true,
});

describe("polygonBoolean", () => {
  it("unions two overlapping unit squares into one exact-area ring", () => {
    const result = polygonBoolean([rect(0, 0, 1, 1)], [rect(0.5, 0, 1, 1)], "union");

    expect(result).toHaveLength(1);
    expect(totalArea(result)).toBeCloseTo(1.5, 10);
  });

  it("intersects two overlapping unit squares into the shared rectangle", () => {
    const result = polygonBoolean([rect(0, 0, 1, 1)], [rect(0.5, 0, 1, 1)], "intersect");

    expect(result).toHaveLength(1);
    expect(totalArea(result)).toBeCloseTo(0.5, 10);
  });

  it("subtracts the overlap from the subject square", () => {
    const result = polygonBoolean([rect(0, 0, 1, 1)], [rect(0.5, 0, 1, 1)], "subtract");

    expect(result).toHaveLength(1);
    expect(totalArea(result)).toBeCloseTo(0.5, 10);
  });

  it("excludes the overlap as two disjoint remainder rings", () => {
    const result = polygonBoolean([rect(0, 0, 1, 1)], [rect(0.5, 0, 1, 1)], "exclude");

    expect(result).toHaveLength(2);
    expect(totalArea(result)).toBeCloseTo(1, 10);
  });

  it("keeps two disjoint squares as two rings on union", () => {
    const result = polygonBoolean([rect(0, 0, 1, 1)], [rect(2, 0, 1, 1)], "union");

    expect(result).toHaveLength(2);
    expect(totalArea(result)).toBeCloseTo(2, 10);
  });

  it("represents fully-contained subtract as an outer ring plus reversed hole ring", () => {
    const result = polygonBoolean([rect(0, 0, 2, 2)], [rect(0.5, 0.5, 1, 1)], "subtract");

    expect(result).toHaveLength(2);
    expect(result.map(ringArea).sort((a, b) => a - b)).toEqual([-1, 4]);
    expect(totalArea(result)).toBeCloseTo(3, 10);
  });

  it("intersects two triangles with exactly computable area", () => {
    const left = triangle({ x: 0, y: 0 }, { x: 2, y: 0 }, { x: 0, y: 2 });
    const right = triangle({ x: 0, y: 0 }, { x: 2, y: 0 }, { x: 2, y: 2 });

    const result = polygonBoolean([left], [right], "intersect");

    expect(result).toHaveLength(1);
    expect(totalArea(result)).toBeCloseTo(1, 10);
  });
});

describe("flattenNodeToPolygons", () => {
  it("applies the full parent world transform chain to flattened nodes", () => {
    const doc = createDocument();
    const layer = doc.nodes[doc.layerOrder[0]!];
    const group = createGroup("Group");
    group.transform = translate(10, 20);
    const child = createRect(1, 2, 3, 4);

    if (!layer || !isContainer(layer)) {
      throw new Error("missing layer");
    }

    doc.nodes[group.id] = group;
    doc.nodes[child.id] = child;
    layer.children.push(group.id);
    group.children.push(child.id);

    const result = flattenNodeToPolygons(doc, child);

    expect(result).toHaveLength(1);
    expect(result[0]).toEqual([
      { x: 11, y: 22 },
      { x: 14, y: 22 },
      { x: 14, y: 26 },
      { x: 11, y: 26 },
    ]);
  });

  it("orients compound path holes opposite to exterior rings by sibling nesting", () => {
    const doc = createDocument();
    const layer = doc.nodes[doc.layerOrder[0]!];
    const path = createPath([
      closedSubpath(rect(0, 0, 4, 4)),
      closedSubpath(rect(1, 1, 2, 2)),
    ]);

    if (!layer || !isContainer(layer)) {
      throw new Error("missing layer");
    }

    doc.nodes[path.id] = path;
    layer.children.push(path.id);

    const result = flattenNodeToPolygons(doc, path);

    expect(result).toHaveLength(2);
    expect(result.map(ringArea).sort((a, b) => a - b)).toEqual([-4, 16]);
    expect(totalArea(result)).toBe(12);
  });

  it("preserves compound path holes through subtract and union against rectangles", () => {
    const doc = createDocument();
    const layer = doc.nodes[doc.layerOrder[0]!];
    const path = createPath([
      closedSubpath(rect(0, 0, 4, 4)),
      closedSubpath(rect(1, 1, 2, 2)),
    ]);
    const disjointRect = createRect(5, 0, 1, 1);

    if (!layer || !isContainer(layer)) {
      throw new Error("missing layer");
    }

    doc.nodes[path.id] = path;
    doc.nodes[disjointRect.id] = disjointRect;
    layer.children.push(path.id, disjointRect.id);

    const compound = flattenNodeToPolygons(doc, path);
    const clip = flattenNodeToPolygons(doc, disjointRect);
    const subtracted = polygonBoolean(compound, clip, "subtract");
    const unioned = polygonBoolean(compound, clip, "union");

    expect(subtracted).toHaveLength(2);
    expect(subtracted.map(ringArea).sort((a, b) => a - b)).toEqual([-4, 16]);
    expect(totalArea(subtracted)).toBe(12);
    expect(unioned).toHaveLength(3);
    expect(unioned.map(ringArea).sort((a, b) => a - b)).toEqual([-4, 1, 16]);
    expect(totalArea(unioned)).toBe(13);
  });
});
