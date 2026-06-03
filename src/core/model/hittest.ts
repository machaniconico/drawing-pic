import { contains, inflate } from "../geometry/bbox";
import type { Vec2 } from "../geometry/vector";
import { worldBounds } from "./bounds";
import type { Document, NodeId } from "./types";

export interface HitTestOptions {
  tolerance?: number;
}

export const hitTest = (
  doc: Document,
  worldPoint: Vec2,
  opts: HitTestOptions = {},
): NodeId | null => {
  const tolerance = opts.tolerance ?? 0;

  const visit = (id: NodeId): NodeId | null => {
    const node = doc.nodes[id];
    if (!node || !node.visible || node.locked) return null;

    if (node.type === "layer" || node.type === "group") {
      for (let i = node.children.length - 1; i >= 0; i -= 1) {
        const hit = visit(node.children[i]);
        if (hit) return hit;
      }

      return null;
    }

    const bounds = tolerance > 0 ? inflate(worldBounds(doc, id), tolerance) : worldBounds(doc, id);
    return contains(bounds, worldPoint) ? id : null;
  };

  for (let i = doc.layerOrder.length - 1; i >= 0; i -= 1) {
    const hit = visit(doc.layerOrder[i]);
    if (hit) return hit;
  }

  return null;
};
