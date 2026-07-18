import {
  EMPTY_BBOX,
  fromPoints,
  fromRect,
  intersects,
  transform as transformBBox,
  unionAll,
  type BBox,
} from "../core/geometry/bbox";
import { compose, IDENTITY, type Matrix } from "../core/geometry/matrix";
import type { Vec2 } from "../core/geometry/vector";
import { worldBounds } from "../core/model/bounds";
import type { Document, NodeId, SceneNode } from "../core/model/types";
import { isContainer, isShape } from "../core/model/types";
import type { EditorState } from "./store";

export const isNodeDescendantOf = (
  doc: Document,
  nodeId: NodeId,
  ancestorId: NodeId,
): boolean => {
  if (nodeId === ancestorId || !doc.nodes[nodeId]) {
    return false;
  }

  const ancestor = doc.nodes[ancestorId];
  if (!ancestor || !isContainer(ancestor)) {
    return false;
  }

  const visit = (id: NodeId): boolean => {
    if (id === nodeId) {
      return true;
    }

    const node = doc.nodes[id];
    return Boolean(node && isContainer(node) && node.children.some(visit));
  };

  return ancestor.children.some(visit);
};

export const normalizeIsolationPath = (
  doc: Document,
  path: readonly NodeId[],
): NodeId[] => {
  const normalized: NodeId[] = [];

  for (const id of path) {
    const node = doc.nodes[id];
    const parentId = normalized.at(-1);
    if (
      node?.type !== "group" ||
      (parentId === undefined && !doc.layerOrder.some((layerId) => isNodeDescendantOf(doc, id, layerId))) ||
      (parentId !== undefined && !isNodeDescendantOf(doc, id, parentId))
    ) {
      break;
    }
    normalized.push(id);
  }

  return normalized;
};

export const getActiveIsolationId = (path: readonly NodeId[]): NodeId | null =>
  path.at(-1) ?? null;

export const isNodeInIsolation = (
  doc: Document,
  nodeId: NodeId,
  isolationPath: readonly NodeId[],
): boolean => {
  const isolationId = getActiveIsolationId(normalizeIsolationPath(doc, isolationPath));
  return isolationId === null || isNodeDescendantOf(doc, nodeId, isolationId);
};

export const subtreeWorldBounds = (doc: Document, id: NodeId): BBox => {
  const node = doc.nodes[id];
  if (!node) {
    return EMPTY_BBOX;
  }

  if (!isContainer(node)) {
    return worldBounds(doc, id);
  }

  return unionAll(node.children.map((childId) => subtreeWorldBounds(doc, childId)));
};

export const documentForIsolation = (
  doc: Document,
  isolationPath: readonly NodeId[],
): Document => {
  const isolationId = getActiveIsolationId(normalizeIsolationPath(doc, isolationPath));
  if (isolationId === null) {
    return doc;
  }

  const nodes = { ...doc.nodes };
  const keepBranch = (id: NodeId): boolean => {
    if (id === isolationId) {
      return true;
    }

    const node = doc.nodes[id];
    if (!node || !isContainer(node) || !isNodeDescendantOf(doc, isolationId, id)) {
      return false;
    }

    const children = node.children.filter(keepBranch);
    nodes[id] = { ...node, children };
    return children.length > 0;
  };

  return {
    ...doc,
    layerOrder: doc.layerOrder.filter(keepBranch),
    nodes,
  };
};

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

export const nodesInRect = (
  state: Pick<EditorState, "doc"> & Partial<Pick<EditorState, "isolationPath">>,
  rect: BBox,
): NodeId[] => {
  const hits: NodeId[] = [];

  const visit = (id: NodeId): void => {
    const node = state.doc.nodes[id];
    if (!node || !node.visible || node.locked) {
      return;
    }

    if (isContainer(node)) {
      for (const childId of node.children) {
        visit(childId);
      }
      return;
    }

    if (
      isShape(node) &&
      isNodeInIsolation(state.doc, id, state.isolationPath ?? []) &&
      intersects(worldBounds(state.doc, id), rect)
    ) {
      hits.push(id);
    }
  };

  for (const layerId of state.doc.layerOrder) {
    visit(layerId);
  }

  return hits;
};
