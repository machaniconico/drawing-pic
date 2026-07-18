import { EMPTY_BBOX, fromPoints, fromRect, transform as transformBBox, unionAll, type BBox } from "../geometry/bbox";
import { compose, IDENTITY, type Matrix } from "../geometry/matrix";
import { asSymbolInstance } from "./types";
import type { DefinitionNode, Document, NodeId, SceneNode, SymbolDefinition } from "./types";

const definitionRoots = (definition: SymbolDefinition): DefinitionNode[] => {
  const childIds = new Set<NodeId>();
  for (const node of definition.nodes) {
    if (node.type === "layer" || node.type === "group") {
      node.children.forEach((id) => childIds.add(id));
    }
  }
  return definition.nodes.filter((node) => !childIds.has(node.id));
};

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

export const localBounds = (node: DefinitionNode): BBox => {
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
    case "symbol-instance":
    case "group":
    case "layer":
      return EMPTY_BBOX;
  }
};

const definitionNodeBounds = (
  doc: Document,
  nodes: ReadonlyMap<NodeId, DefinitionNode>,
  node: DefinitionNode,
  resolving: ReadonlySet<NodeId>,
  visitingNodes: ReadonlySet<NodeId> = new Set(),
): BBox => {
  if (visitingNodes.has(node.id)) return EMPTY_BBOX;
  const nextVisitingNodes = new Set(visitingNodes);
  nextVisitingNodes.add(node.id);
  if (node.type === "group" || node.type === "layer") {
    return unionAll(node.children.flatMap((id) => {
      const child = nodes.get(id);
      return child
        ? [transformBBox(
            definitionNodeBounds(doc, nodes, child, resolving, nextVisitingNodes),
            child.transform,
          )]
        : [];
    }));
  }
  if (node.type === "symbol-instance") {
    return symbolDefinitionBounds(doc, node.symbolId, resolving);
  }
  return localBounds(node);
};

/** Bounds of a symbol in its definition-local coordinate system. */
export const symbolDefinitionBounds = (
  doc: Document,
  symbolId: NodeId,
  resolving: ReadonlySet<NodeId> = new Set(),
): BBox => {
  const definition = doc.symbols?.[symbolId];
  if (!definition || resolving.has(symbolId)) return EMPTY_BBOX;

  const nextResolving = new Set(resolving);
  nextResolving.add(symbolId);
  const nodes = new Map(definition.nodes.map((node) => [node.id, node]));
  return unionAll(definitionRoots(definition).map((root) =>
    transformBBox(definitionNodeBounds(doc, nodes, root, nextResolving), root.transform),
  ));
};

export const worldBounds = (doc: Document, id: NodeId): BBox => {
  const node = doc.nodes[id];
  const matrix = worldTransform(doc, id);
  if (!node || !matrix) return EMPTY_BBOX;

  const instance = asSymbolInstance(node);
  const bounds = instance
    ? symbolDefinitionBounds(doc, instance.symbolId)
    : node.type === "group" || node.type === "layer"
      ? definitionNodeBounds(
          doc,
          new Map<NodeId, DefinitionNode>(Object.entries(doc.nodes)),
          node,
          new Set(),
        )
      : localBounds(node);
  return transformBBox(bounds, matrix);
};

export const selectionBounds = (doc: Document, ids: readonly NodeId[]): BBox =>
  unionAll(ids.map((id) => worldBounds(doc, id)));
