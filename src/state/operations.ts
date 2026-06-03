import { center, isEmpty, unionAll, type BBox } from "../core/geometry/bbox";
import { newId as createNodeId } from "../core/model/factory";
import { worldBounds } from "../core/model/bounds";
import type { Document, NodeId, SceneNode } from "../core/model/types";
import { isContainer } from "../core/model/types";

export type AlignEdge = "left" | "hcenter" | "right" | "top" | "vcenter" | "bottom";
export type DistributeAxis = "horizontal" | "vertical";
export type ZOrderOperation = "bringToFront" | "sendToBack" | "bringForward" | "sendBackward";

export interface TransformPatch {
  e: number;
  f: number;
}

export type TransformPatchMap = Record<NodeId, TransformPatch>;

export interface ZOrderPatch {
  parentId: NodeId | null;
  order: NodeId[];
}

export interface CloneSubtreeResult {
  rootId: NodeId;
  nodes: Record<NodeId, SceneNode>;
}

export interface NodeParentRef {
  parentId: NodeId | null;
  order: readonly NodeId[];
}

const uniqueIds = (ids: readonly NodeId[]): NodeId[] => [...new Set(ids)];

const parentEntries = (doc: Document): Array<[NodeId | null, readonly NodeId[]]> => [
  [null, doc.layerOrder],
  ...Object.values(doc.nodes)
    .filter(isContainer)
    .map((node): [NodeId, readonly NodeId[]] => [node.id, node.children]),
];

export const findNodeParent = (doc: Document, id: NodeId): NodeParentRef | null => {
  for (const [parentId, order] of parentEntries(doc)) {
    if (order.includes(id)) {
      return { parentId, order };
    }
  }

  return null;
};

const hasSelectedAncestor = (doc: Document, id: NodeId, selected: ReadonlySet<NodeId>): boolean => {
  let parent = findNodeParent(doc, id);
  while (parent?.parentId) {
    if (selected.has(parent.parentId)) {
      return true;
    }
    parent = findNodeParent(doc, parent.parentId);
  }

  return false;
};

export const topLevelNodeIds = (doc: Document, ids: readonly NodeId[]): NodeId[] => {
  const selected = new Set(uniqueIds(ids).filter((id) => id in doc.nodes));
  return [...selected].filter((id) => !hasSelectedAncestor(doc, id, selected));
};

const nodeWorldBounds = (doc: Document, id: NodeId): BBox => {
  const node = doc.nodes[id];
  if (!node) {
    return worldBounds(doc, id);
  }

  if (!isContainer(node)) {
    return worldBounds(doc, id);
  }

  return unionAll(node.children.map((childId) => nodeWorldBounds(doc, childId)));
};

const usableBounds = (doc: Document, ids: readonly NodeId[]): Array<{ id: NodeId; bounds: BBox }> =>
  ids
    .map((id) => ({ id, bounds: nodeWorldBounds(doc, id) }))
    .filter(({ bounds }) => !isEmpty(bounds));

const patchWithDelta = (
  doc: Document,
  id: NodeId,
  dx: number,
  dy: number,
  patches: TransformPatchMap,
): void => {
  if (dx === 0 && dy === 0) {
    return;
  }

  const node = doc.nodes[id];
  if (!node) {
    return;
  }

  patches[id] = {
    // Approximation for US-010: apply world-space deltas directly to local translation.
    // Document layers are identity transforms, and this intentionally does not recurse into children.
    e: node.transform.e + dx,
    f: node.transform.f + dy,
  };
};

export const alignNodes = (
  doc: Document,
  ids: readonly NodeId[],
  edge: AlignEdge,
): TransformPatchMap => {
  const targets = usableBounds(doc, topLevelNodeIds(doc, ids));
  if (targets.length === 0) {
    return {};
  }

  const union = unionAll(targets.map(({ bounds }) => bounds));
  if (isEmpty(union)) {
    return {};
  }

  const unionCenter = center(union);
  const patches: TransformPatchMap = {};

  for (const { id, bounds } of targets) {
    const boundsCenter = center(bounds);
    switch (edge) {
      case "left":
        patchWithDelta(doc, id, union.minX - bounds.minX, 0, patches);
        break;
      case "hcenter":
        patchWithDelta(doc, id, unionCenter.x - boundsCenter.x, 0, patches);
        break;
      case "right":
        patchWithDelta(doc, id, union.maxX - bounds.maxX, 0, patches);
        break;
      case "top":
        patchWithDelta(doc, id, 0, union.minY - bounds.minY, patches);
        break;
      case "vcenter":
        patchWithDelta(doc, id, 0, unionCenter.y - boundsCenter.y, patches);
        break;
      case "bottom":
        patchWithDelta(doc, id, 0, union.maxY - bounds.maxY, patches);
        break;
    }
  }

  return patches;
};

export const distributeNodes = (
  doc: Document,
  ids: readonly NodeId[],
  axis: DistributeAxis,
): TransformPatchMap => {
  const targets = usableBounds(doc, topLevelNodeIds(doc, ids));
  if (targets.length < 3) {
    return {};
  }

  const sorted = [...targets].sort((a, b) => {
    const aCenter = center(a.bounds);
    const bCenter = center(b.bounds);
    return axis === "horizontal" ? aCenter.x - bCenter.x : aCenter.y - bCenter.y;
  });

  const firstCenter = center(sorted[0]!.bounds);
  const lastCenter = center(sorted[sorted.length - 1]!.bounds);
  const start = axis === "horizontal" ? firstCenter.x : firstCenter.y;
  const end = axis === "horizontal" ? lastCenter.x : lastCenter.y;
  const interval = (end - start) / (sorted.length - 1);
  const patches: TransformPatchMap = {};

  for (let index = 1; index < sorted.length - 1; index += 1) {
    const target = sorted[index]!;
    const currentCenter = center(target.bounds);
    const targetCenter = start + interval * index;
    if (axis === "horizontal") {
      patchWithDelta(doc, target.id, targetCenter - currentCenter.x, 0, patches);
    } else {
      patchWithDelta(doc, target.id, 0, targetCenter - currentCenter.y, patches);
    }
  }

  return patches;
};

const sameOrder = (a: readonly NodeId[], b: readonly NodeId[]): boolean =>
  a.length === b.length && a.every((id, index) => id === b[index]);

const reorder = (order: readonly NodeId[], selectedIds: ReadonlySet<NodeId>, operation: ZOrderOperation): NodeId[] => {
  switch (operation) {
    case "bringToFront": {
      const selected = order.filter((id) => selectedIds.has(id));
      const rest = order.filter((id) => !selectedIds.has(id));
      return [...rest, ...selected];
    }
    case "sendToBack": {
      const selected = order.filter((id) => selectedIds.has(id));
      const rest = order.filter((id) => !selectedIds.has(id));
      return [...selected, ...rest];
    }
    case "bringForward": {
      const next = [...order];
      for (let index = next.length - 2; index >= 0; index -= 1) {
        if (selectedIds.has(next[index]!) && !selectedIds.has(next[index + 1]!)) {
          [next[index], next[index + 1]] = [next[index + 1]!, next[index]!];
        }
      }
      return next;
    }
    case "sendBackward": {
      const next = [...order];
      for (let index = 1; index < next.length; index += 1) {
        if (selectedIds.has(next[index]!) && !selectedIds.has(next[index - 1]!)) {
          [next[index - 1], next[index]] = [next[index]!, next[index - 1]!];
        }
      }
      return next;
    }
  }
};

export const zOrderNodes = (
  doc: Document,
  ids: readonly NodeId[],
  operation: ZOrderOperation,
): ZOrderPatch[] => {
  const idsByParent = new Map<NodeId | null, Set<NodeId>>();

  for (const id of uniqueIds(ids)) {
    if (!(id in doc.nodes)) {
      continue;
    }

    const parent = findNodeParent(doc, id);
    if (!parent) {
      continue;
    }

    const existing = idsByParent.get(parent.parentId);
    if (existing) {
      existing.add(id);
    } else {
      idsByParent.set(parent.parentId, new Set([id]));
    }
  }

  const patches: ZOrderPatch[] = [];
  for (const [parentId, selected] of idsByParent) {
    const parent = parentId ? doc.nodes[parentId] : null;
    const order = parentId
      ? parent && isContainer(parent)
        ? parent.children
        : []
      : doc.layerOrder;
    const nextOrder = reorder(order, selected, operation);
    if (!sameOrder(order, nextOrder)) {
      patches.push({ parentId, order: nextOrder });
    }
  }

  return patches;
};

export const bringToFront = (doc: Document, ids: readonly NodeId[]): ZOrderPatch[] =>
  zOrderNodes(doc, ids, "bringToFront");

export const sendToBack = (doc: Document, ids: readonly NodeId[]): ZOrderPatch[] =>
  zOrderNodes(doc, ids, "sendToBack");

export const bringForward = (doc: Document, ids: readonly NodeId[]): ZOrderPatch[] =>
  zOrderNodes(doc, ids, "bringForward");

export const sendBackward = (doc: Document, ids: readonly NodeId[]): ZOrderPatch[] =>
  zOrderNodes(doc, ids, "sendBackward");

export const cloneSubtree = (
  doc: Document,
  id: NodeId,
  idFactory: () => NodeId = createNodeId,
  reservedIds: Iterable<NodeId> = [],
): CloneSubtreeResult => {
  const nodes: Record<NodeId, SceneNode> = {};
  const usedIds = new Set<NodeId>(Object.keys(doc.nodes));
  for (const reservedId of reservedIds) {
    usedIds.add(reservedId);
  }

  const nextFreshId = (): NodeId => {
    let idCandidate = idFactory();
    while (usedIds.has(idCandidate)) {
      idCandidate = idFactory();
    }
    usedIds.add(idCandidate);
    return idCandidate;
  };

  const visit = (sourceId: NodeId): NodeId => {
    const source = doc.nodes[sourceId];
    if (!source) {
      throw new Error(`Cannot clone missing node: ${sourceId}`);
    }

    const clonedId = nextFreshId();
    const cloned = structuredClone(source) as SceneNode;
    cloned.id = clonedId;

    if (isContainer(source) && isContainer(cloned)) {
      cloned.children = source.children.map(visit);
    }

    nodes[clonedId] = cloned;
    return clonedId;
  };

  return {
    rootId: visit(id),
    nodes,
  };
};
