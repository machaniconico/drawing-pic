import { IDENTITY } from "./matrix";
import { flattenNodeToPolygons, polygonBoolean } from "./polygonBoolean";
import { createPath } from "../model/factory";
import type { Document, PathNode, SceneNode, SubPath } from "../model/types";

export type PathfinderOp =
  | "unite"
  | "minus-front"
  | "minus-back"
  | "intersect"
  | "exclude"
  | "divide";

type PathfinderShape = Extract<SceneNode, { type: "path" | "rect" | "ellipse" }>;
type PolygonRegion = ReturnType<typeof flattenNodeToPolygons>;

const isPathfinderShape = (node: SceneNode): node is PathfinderShape =>
  node.type === "path" || node.type === "rect" || node.type === "ellipse";

const standaloneDocument = (nodes: readonly PathfinderShape[]): Document => ({
  id: "pathfinder-document",
  name: "Pathfinder",
  width: 0,
  height: 0,
  layerOrder: nodes.map((node) => node.id),
  guides: [],
  nodes: Object.fromEntries(nodes.map((node) => [node.id, node])),
});

const ringsToSubpaths = (rings: PolygonRegion): SubPath[] =>
  rings.map((ring) => ({
    anchors: ring.map((point) => ({
      point: { ...point },
      handleIn: null,
      handleOut: null,
    })),
    closed: true,
  }));

const unionAll = (regions: readonly PolygonRegion[]): PolygonRegion => {
  const [first, ...rest] = regions;
  if (!first) {
    return [];
  }
  return rest.reduce((result, region) => polygonBoolean(result, region, "union"), first);
};

const divideRegions = (regions: readonly PolygonRegion[]): PolygonRegion[] => {
  const [first, ...rest] = regions;
  if (!first || first.length === 0) {
    return [];
  }

  let pieces: PolygonRegion[] = [first];
  for (const region of rest) {
    if (region.length === 0) {
      continue;
    }

    let uncovered = region;
    const nextPieces: PolygonRegion[] = [];
    for (const piece of pieces) {
      const outside = polygonBoolean(piece, region, "subtract");
      const overlap = polygonBoolean(piece, region, "intersect");
      if (outside.length > 0) {
        nextPieces.push(outside);
      }
      if (overlap.length > 0) {
        nextPieces.push(overlap);
      }
      uncovered = polygonBoolean(uncovered, piece, "subtract");
    }
    if (uncovered.length > 0) {
      nextPieces.push(uncovered);
    }
    pieces = nextPieces;
  }

  return pieces;
};

const computeRegions = (regions: readonly PolygonRegion[], op: PathfinderOp): PolygonRegion[] => {
  const [backmost, ...rest] = regions;
  const frontmost = regions.at(-1);
  if (!backmost || !frontmost) {
    return [];
  }

  switch (op) {
    case "unite":
      return [unionAll(regions)];
    case "minus-front":
      return [polygonBoolean(backmost, unionAll(rest), "subtract")];
    case "minus-back":
      return [polygonBoolean(frontmost, unionAll(regions.slice(0, -1)), "subtract")];
    case "intersect":
      return [rest.reduce((result, region) => polygonBoolean(result, region, "intersect"), backmost)];
    case "exclude":
      return [rest.reduce((result, region) => polygonBoolean(result, region, "exclude"), backmost)];
    case "divide":
      return divideRegions(regions);
  }
};

/**
 * Applies an Illustrator-style Pathfinder operation to nodes ordered back-to-front.
 * Returned path geometry is expressed in document/world coordinates and never mutates
 * the input nodes. Pass the source document when nodes may have parent transforms.
 */
export const pathfinder = (
  nodes: readonly SceneNode[],
  op: PathfinderOp,
  doc?: Document,
): PathNode[] => {
  const shapes = nodes.filter(isPathfinderShape);
  if (shapes.length < 2) {
    return [];
  }

  const sourceDoc = doc ?? standaloneDocument(shapes);
  const regions = shapes.map((node) => flattenNodeToPolygons(sourceDoc, node));
  const styleSource = op === "minus-front" ? shapes[0]! : shapes.at(-1)!;

  return computeRegions(regions, op)
    .filter((region) => region.length > 0)
    .map((region, index): PathNode => {
      const node = createPath(ringsToSubpaths(region));
      return {
        ...node,
        name: op === "divide" ? `Pathfinder Divide ${index + 1}` : `Pathfinder ${op}`,
        transform: { ...IDENTITY },
        opacity: styleSource.opacity,
        visible: styleSource.visible,
        locked: false,
        fill: structuredClone(styleSource.fill),
        stroke: styleSource.stroke === null ? null : structuredClone(styleSource.stroke),
        blendMode: styleSource.blendMode,
      };
    });
};
