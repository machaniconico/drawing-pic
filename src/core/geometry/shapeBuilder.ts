import { newId } from "../model/factory";
import type { Document, PathNode, SceneNode, SubPath } from "../model/types";
import { pathfinder } from "./pathfinder";
import type { Vec2 } from "./vector";

export type ShapeBuilderMode = "union" | "delete";

export interface ShapeBuilderResult {
  nodes: PathNode[];
  hitRegion: PathNode;
}

const ringArea = (subpath: SubPath): number => {
  let area = 0;
  for (let index = 0; index < subpath.anchors.length; index += 1) {
    const a = subpath.anchors[index]!.point;
    const b = subpath.anchors[(index + 1) % subpath.anchors.length]!.point;
    area += a.x * b.y - b.x * a.y;
  }
  return area / 2;
};

const pointOnSegment = (point: Vec2, a: Vec2, b: Vec2): boolean => {
  const cross = (point.x - a.x) * (b.y - a.y) - (point.y - a.y) * (b.x - a.x);
  if (Math.abs(cross) > 1e-9) {
    return false;
  }
  const dot = (point.x - a.x) * (point.x - b.x) + (point.y - a.y) * (point.y - b.y);
  return dot <= 1e-9;
};

const pointInRing = (point: Vec2, subpath: SubPath): boolean => {
  let inside = false;
  const anchors = subpath.anchors;
  for (let index = 0, previous = anchors.length - 1; index < anchors.length; previous = index, index += 1) {
    const a = anchors[index]!.point;
    const b = anchors[previous]!.point;
    if (pointOnSegment(point, a, b)) {
      return true;
    }
    if (a.y > point.y !== b.y > point.y) {
      const x = ((b.x - a.x) * (point.y - a.y)) / (b.y - a.y) + a.x;
      if (point.x < x) {
        inside = !inside;
      }
    }
  }
  return inside;
};

const containsPoint = (node: PathNode, point: Vec2): boolean => {
  let winding = 0;
  for (const subpath of node.subpaths) {
    if (subpath.closed && subpath.anchors.length >= 3 && pointInRing(point, subpath)) {
      winding += ringArea(subpath) >= 0 ? 1 : -1;
    }
  }
  return winding !== 0;
};

const cloneWithSubpaths = (source: PathNode, subpaths: SubPath[], name: string): PathNode => ({
  ...source,
  id: newId(),
  name,
  transform: { ...source.transform },
  fill: structuredClone(source.fill),
  stroke: source.stroke === null ? null : structuredClone(source.stroke),
  subpaths: structuredClone(subpaths),
});

/** Splits divide output into click-safe atomic exterior components, retaining their holes. */
export const splitShapeBuilderRegions = (divided: readonly PathNode[]): PathNode[] => {
  const result: PathNode[] = [];
  for (const node of divided) {
    const exteriors = node.subpaths.filter((subpath) => ringArea(subpath) > 0);
    const holes = node.subpaths.filter((subpath) => ringArea(subpath) < 0);
    if (exteriors.length === 0) {
      result.push(cloneWithSubpaths(node, node.subpaths, "Shape Builder Region"));
      continue;
    }

    const components = exteriors.map((outer) => ({ outer, holes: [] as SubPath[] }));
    for (const hole of holes) {
      const sample = hole.anchors[0]?.point;
      if (!sample) continue;
      const owner = components
        .filter(({ outer }) => pointInRing(sample, outer))
        .sort((left, right) => Math.abs(ringArea(left.outer)) - Math.abs(ringArea(right.outer)))[0];
      owner?.holes.push(hole);
    }
    for (const component of components) {
      result.push(cloneWithSubpaths(node, [component.outer, ...component.holes], "Shape Builder Region"));
    }
  }
  return result;
};

export const findShapeBuilderRegion = (
  regions: readonly PathNode[],
  point: Vec2,
): PathNode | null => regions.find((region) => containsPoint(region, point)) ?? null;

/** Applies Shape Builder semantics to pathfinder-divided paths in one coordinate space. */
export const shapeBuilderFromRegions = (
  divided: readonly PathNode[],
  point: Vec2,
  mode: ShapeBuilderMode,
): ShapeBuilderResult | null => {
  const regions = splitShapeBuilderRegions(divided);
  const hitRegion = findShapeBuilderRegion(regions, point);
  if (!hitRegion) {
    return null;
  }

  const united = regions.length === 1
    ? [cloneWithSubpaths(regions[0]!, regions[0]!.subpaths, "Shape Builder")]
    : pathfinder(regions, "unite");
  const nodes = mode === "delete" && united[0]
    ? pathfinder([united[0], hitRegion], "minus-front")
    : united;
  for (const node of nodes) {
    node.name = "Shape Builder";
  }
  return { nodes, hitRegion };
};

/** Divides selected shapes for atomic hit detection, then unions or deletes the hit region. */
export const shapeBuilder = (
  nodes: readonly SceneNode[],
  point: Vec2,
  mode: ShapeBuilderMode,
  doc?: Document,
): ShapeBuilderResult | null => shapeBuilderFromRegions(pathfinder(nodes, "divide", doc), point, mode);
