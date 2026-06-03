import { EMPTY_BBOX, fromPoints, fromRect, transform as transformBBox, unionAll, type BBox } from "../core/geometry/bbox";
import { compose, IDENTITY, type Matrix } from "../core/geometry/matrix";
import type { Vec2 } from "../core/geometry/vector";
import type { Document, NodeId, SceneNode } from "../core/model/types";
import { isContainer } from "../core/model/types";
import type { EditorState } from "./store";

export const getNode = (state: Pick<EditorState, "doc">, id: NodeId): SceneNode | undefined =>
  state.doc.nodes[id];

export const getSelectedNodes = (state: Pick<EditorState, "doc" | "selection">): SceneNode[] =>
  state.selection.flatMap((id) => {
    const node = state.doc.nodes[id];
    return node ? [node] : [];
  });

export const isSelected = (state: Pick<EditorState, "selection">, id: NodeId): boolean =>
  state.selection.includes(id);

const getLocalBounds = (node: SceneNode): BBox => {
  switch (node.type) {
    case "rect":
      return fromRect(0, 0, node.width, node.height);
    case "ellipse":
      return fromRect(-node.rx, -node.ry, node.rx * 2, node.ry * 2);
    case "image":
      return fromRect(0, 0, node.width, node.height);
    case "text":
      return fromRect(0, -node.fontSize, node.text.length * node.fontSize * 0.6, node.fontSize * node.lineHeight);
    case "path":
      return fromPoints(
        node.subpaths.flatMap((subpath) =>
          subpath.anchors.flatMap((anchor) => {
            const points: Vec2[] = [anchor.point];
            if (anchor.handleIn) {
              points.push({
                x: anchor.point.x + anchor.handleIn.x,
                y: anchor.point.y + anchor.handleIn.y,
              });
            }
            if (anchor.handleOut) {
              points.push({
                x: anchor.point.x + anchor.handleOut.x,
                y: anchor.point.y + anchor.handleOut.y,
              });
            }
            return points;
          }),
        ),
      );
    case "group":
    case "layer":
      return EMPTY_BBOX;
  }
};

const getNodeWorldBounds = (doc: Document, node: SceneNode, parentWorld: Matrix): BBox => {
  const world = compose(parentWorld, node.transform);

  if (isContainer(node)) {
    return unionAll(
      node.children.flatMap((childId) => {
        const child = doc.nodes[childId];
        return child ? [getNodeWorldBounds(doc, child, world)] : [];
      }),
    );
  }

  return transformBBox(getLocalBounds(node), world);
};

export const getDocBounds = (state: Pick<EditorState, "doc">): BBox =>
  unionAll(
    state.doc.layerOrder.flatMap((layerId) => {
      const layer = state.doc.nodes[layerId];
      return layer ? [getNodeWorldBounds(state.doc, layer, IDENTITY)] : [];
    }),
  );
