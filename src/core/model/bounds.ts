import { EMPTY_BBOX, fromPoints, fromRect, transform as transformBBox, unionAll, type BBox } from "../geometry/bbox";
import { compose, IDENTITY, type Matrix } from "../geometry/matrix";
import type { Document, NodeId, SceneNode } from "./types";

const pathToNode = (doc: Document, id: NodeId): SceneNode[] | null => {
  const visit = (nodeId: NodeId, path: SceneNode[]): SceneNode[] | null => {
    const node = doc.nodes[nodeId];
    if (!node) return null;

    const nextPath = [...path, node];
    if (node.id === id) return nextPath;

    if (node.type === "layer" || node.type === "group") {
      for (const childId of node.children) {
        const childPath = visit(childId, nextPath);
        if (childPath) return childPath;
      }
    }

    return null;
  };

  for (const layerId of doc.layerOrder) {
    const path = visit(layerId, []);
    if (path) return path;
  }

  return null;
};

const worldTransform = (doc: Document, id: NodeId): Matrix | null => {
  const path = pathToNode(doc, id);
  if (!path) return null;

  return path.reduce((acc, node) => compose(acc, node.transform), IDENTITY);
};

export const localBounds = (node: SceneNode): BBox => {
  switch (node.type) {
    case "rect":
    case "image":
      return fromRect(0, 0, node.width, node.height);
    case "ellipse":
      return fromRect(-node.rx, -node.ry, node.rx * 2, node.ry * 2);
    case "path":
      // Approximation: includes anchors and Bezier handles, not the exact curve extrema.
      return fromPoints(
        node.subpaths.flatMap((subpath) =>
          subpath.anchors.flatMap((anchor) => [
            anchor.point,
            ...(anchor.handleIn
              ? [{ x: anchor.point.x + anchor.handleIn.x, y: anchor.point.y + anchor.handleIn.y }]
              : []),
            ...(anchor.handleOut
              ? [{ x: anchor.point.x + anchor.handleOut.x, y: anchor.point.y + anchor.handleOut.y }]
              : []),
          ]),
        ),
      );
    case "text":
      return fromRect(0, 0, node.text.length * node.fontSize * 0.6, node.fontSize * node.lineHeight);
    case "group":
    case "layer":
      return EMPTY_BBOX;
  }
};

export const worldBounds = (doc: Document, id: NodeId): BBox => {
  const node = doc.nodes[id];
  if (!node) return EMPTY_BBOX;

  // Containers have no geometry of their own; their world bounds are the union
  // of their descendants' (each child already composes the full ancestor
  // transform chain). Without this, a selected group reports empty bounds,
  // breaking the selection box, size readout, and zoom-to-selection.
  if (node.type === "layer" || node.type === "group") {
    return unionAll(node.children.map((childId) => worldBounds(doc, childId)));
  }

  const matrix = worldTransform(doc, id);
  if (!matrix) return EMPTY_BBOX;

  return transformBBox(localBounds(node), matrix);
};

export const selectionBounds = (doc: Document, ids: readonly NodeId[]): BBox =>
  unionAll(ids.map((id) => worldBounds(doc, id)));
