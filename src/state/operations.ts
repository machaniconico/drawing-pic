import { center, height, isEmpty, unionAll, width, type BBox } from "../core/geometry/bbox";
import { apply, compose, IDENTITY, invert, rotationAround, scaling, translate, type Matrix } from "../core/geometry/matrix";
import { type BooleanOp, flattenNodeToPolygons, polygonBoolean } from "../core/geometry/polygonBoolean";
import type { Vec2 } from "../core/geometry/vector";
import { createGroup, newId as createNodeId } from "../core/model/factory";
import { selectionBounds, worldBounds } from "../core/model/bounds";
import { hitTest, type HitTestOptions } from "../core/model/hittest";
import type { Document, GroupNode, NodeId, Paint, PathNode, SceneNode, Stroke, SubPath } from "../core/model/types";
import { hasStyle, isContainer } from "../core/model/types";

export type AlignEdge = "left" | "hcenter" | "right" | "top" | "vcenter" | "bottom";
export type DistributeAxis = "horizontal" | "vertical";
export type FlipAxis = "horizontal" | "vertical";
export type Rotate90Direction = "cw" | "ccw";
export type ZOrderOperation = "bringToFront" | "sendToBack" | "bringForward" | "sendBackward";

export interface TransformPatch {
  e: number;
  f: number;
}

export type TransformPatchMap = Record<NodeId, TransformPatch>;
export type MatrixPatchMap = Record<NodeId, Matrix>;

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

export interface GroupSelectionResult {
  parentId: NodeId | null;
  group: GroupNode;
  order: NodeId[];
  groupedIds: NodeId[];
}

export interface UngroupSelectionResult {
  parentId: NodeId | null;
  groupIds: NodeId[];
  order: NodeId[];
  liftedIds: NodeId[];
}

export interface BooleanSelectionResult {
  node: PathNode;
  removeIds: NodeId[];
}

export interface SampledStyle {
  fill: Paint;
  stroke: Stroke | null;
}

const NUMERIC_TRANSFORM_EPSILON = 1e-9;

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

export const sampleStyleAt = (
  doc: Document,
  worldPoint: Vec2,
  opts?: HitTestOptions,
): SampledStyle | null => {
  const hitId = hitTest(doc, worldPoint, opts);
  if (!hitId) {
    return null;
  }

  const node = doc.nodes[hitId];
  if (!node || !hasStyle(node)) {
    return null;
  }

  return {
    fill: node.fill,
    stroke: node.stroke,
  };
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
  keyId?: NodeId | null,
): TransformPatchMap => {
  const targets = usableBounds(doc, topLevelNodeIds(doc, ids));
  if (targets.length === 0) {
    return {};
  }

  const keyTarget = keyId ? targets.find(({ id }) => id === keyId) : undefined;
  const referenceBounds = keyTarget?.bounds ?? unionAll(targets.map(({ bounds }) => bounds));
  if (isEmpty(referenceBounds)) {
    return {};
  }

  const referenceCenter = center(referenceBounds);
  const patches: TransformPatchMap = {};

  for (const { id, bounds } of targets) {
    if (id === keyTarget?.id) {
      continue;
    }

    const boundsCenter = center(bounds);
    switch (edge) {
      case "left":
        patchWithDelta(doc, id, referenceBounds.minX - bounds.minX, 0, patches);
        break;
      case "hcenter":
        patchWithDelta(doc, id, referenceCenter.x - boundsCenter.x, 0, patches);
        break;
      case "right":
        patchWithDelta(doc, id, referenceBounds.maxX - bounds.maxX, 0, patches);
        break;
      case "top":
        patchWithDelta(doc, id, 0, referenceBounds.minY - bounds.minY, patches);
        break;
      case "vcenter":
        patchWithDelta(doc, id, 0, referenceCenter.y - boundsCenter.y, patches);
        break;
      case "bottom":
        patchWithDelta(doc, id, 0, referenceBounds.maxY - bounds.maxY, patches);
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

export const distributeByGap = (
  doc: Document,
  ids: readonly NodeId[],
  axis: DistributeAxis,
  gap: number,
): TransformPatchMap => {
  if (!Number.isFinite(gap)) {
    return {};
  }

  const targets = usableBounds(doc, topLevelNodeIds(doc, ids));
  if (targets.length < 2) {
    return {};
  }

  const sorted = [...targets].sort((a, b) =>
    axis === "horizontal" ? a.bounds.minX - b.bounds.minX : a.bounds.minY - b.bounds.minY,
  );
  const patches: TransformPatchMap = {};
  let runningPrevMax = axis === "horizontal" ? sorted[0]!.bounds.maxX : sorted[0]!.bounds.maxY;

  for (let index = 1; index < sorted.length; index += 1) {
    const target = sorted[index]!;
    const currentMin = axis === "horizontal" ? target.bounds.minX : target.bounds.minY;
    const currentMax = axis === "horizontal" ? target.bounds.maxX : target.bounds.maxY;
    const size = currentMax - currentMin;
    const newMin = runningPrevMax + gap;
    const delta = newMin - currentMin;

    if (axis === "horizontal") {
      patchWithDelta(doc, target.id, delta, 0, patches);
    } else {
      patchWithDelta(doc, target.id, 0, delta, patches);
    }

    runningPrevMax = newMin + size;
  }

  return patches;
};

const flipAround = (axis: FlipAxis, cx: number, cy: number): Matrix => {
  const scale = axis === "horizontal" ? scaling(-1, 1) : scaling(1, -1);
  return compose(translate(cx, cy), compose(scale, translate(-cx, -cy)));
};

const selectionTransformPatches = (
  doc: Document,
  ids: readonly NodeId[],
  worldOperation: Matrix,
): MatrixPatchMap => {
  const patches: MatrixPatchMap = {};

  for (const id of ids) {
    const node = doc.nodes[id];
    const parent = findNodeParent(doc, id);
    if (!node || !parent) {
      continue;
    }

    const parentWorld = parentWorldTransform(doc, parent.parentId);
    const parentInverse = invert(parentWorld);
    if (!parentInverse) {
      continue;
    }

    patches[id] = compose(
      parentInverse,
      compose(worldOperation, compose(parentWorld, node.transform)),
    );
  }

  return patches;
};

export const flipNodes = (
  doc: Document,
  ids: readonly NodeId[],
  axis: FlipAxis,
): MatrixPatchMap => {
  const targets = usableBounds(doc, topLevelNodeIds(doc, ids));
  if (targets.length === 0) {
    return {};
  }

  const bounds = unionAll(targets.map((target) => target.bounds));
  if (isEmpty(bounds)) {
    return {};
  }

  const pivot = center(bounds);
  return selectionTransformPatches(
    doc,
    targets.map((target) => target.id),
    flipAround(axis, pivot.x, pivot.y),
  );
};

export const rotateNodes90 = (
  doc: Document,
  ids: readonly NodeId[],
  direction: Rotate90Direction,
): MatrixPatchMap => {
  const targets = usableBounds(doc, topLevelNodeIds(doc, ids));
  if (targets.length === 0) {
    return {};
  }

  const bounds = unionAll(targets.map((target) => target.bounds));
  if (isEmpty(bounds)) {
    return {};
  }

  const pivot = center(bounds);
  const angle = direction === "cw" ? Math.PI / 2 : -Math.PI / 2;
  return selectionTransformPatches(
    doc,
    targets.map((target) => target.id),
    rotationAround(angle, pivot.x, pivot.y),
  );
};

export const rotateNodesAround = (
  doc: Document,
  ids: readonly NodeId[],
  angleRad: number,
): MatrixPatchMap => {
  const targets = usableBounds(doc, topLevelNodeIds(doc, ids));
  if (targets.length === 0) {
    return {};
  }

  const bounds = unionAll(targets.map((target) => target.bounds));
  if (
    isEmpty(bounds) ||
    width(bounds) < NUMERIC_TRANSFORM_EPSILON ||
    height(bounds) < NUMERIC_TRANSFORM_EPSILON
  ) {
    return {};
  }

  const pivot = center(bounds);
  return selectionTransformPatches(
    doc,
    targets.map((target) => target.id),
    rotationAround(angleRad, pivot.x, pivot.y),
  );
};

const normalizeRotationAngle = (angle: number): number => {
  let normalized = angle;
  while (normalized <= -Math.PI) {
    normalized += Math.PI * 2;
  }
  while (normalized > Math.PI) {
    normalized -= Math.PI * 2;
  }
  return Object.is(normalized, -0) ? 0 : normalized;
};

export const nodeRotationAngle = (node: SceneNode): number =>
  normalizeRotationAngle(Math.atan2(node.transform.b, node.transform.a));

export const moveSelectionTo = (
  doc: Document,
  ids: readonly NodeId[],
  x: number,
  y: number,
): MatrixPatchMap => {
  const targets = topLevelNodeIds(doc, ids);
  if (targets.length === 0) {
    return {};
  }

  const bounds = selectionBounds(doc, ids);
  if (isEmpty(bounds)) {
    return {};
  }

  return selectionTransformPatches(
    doc,
    targets,
    translate(x - bounds.minX, y - bounds.minY),
  );
};

export const resizeSelectionTo = (
  doc: Document,
  ids: readonly NodeId[],
  targetWidth: number,
  targetHeight: number,
): MatrixPatchMap => {
  const targets = topLevelNodeIds(doc, ids);
  if (targets.length === 0) {
    return {};
  }

  const bounds = selectionBounds(doc, ids);
  if (isEmpty(bounds)) {
    return {};
  }

  const currentWidth = width(bounds);
  const currentHeight = height(bounds);
  const scaleX =
    currentWidth < NUMERIC_TRANSFORM_EPSILON || targetWidth <= 0
      ? 1
      : targetWidth / currentWidth;
  const scaleY =
    currentHeight < NUMERIC_TRANSFORM_EPSILON || targetHeight <= 0
      ? 1
      : targetHeight / currentHeight;

  return selectionTransformPatches(
    doc,
    targets,
    compose(
      translate(bounds.minX, bounds.minY),
      compose(scaling(scaleX, scaleY), translate(-bounds.minX, -bounds.minY)),
    ),
  );
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

const isBooleanShape = (node: SceneNode | undefined): node is PathNode | Extract<SceneNode, { type: "rect" | "ellipse" }> =>
  node?.type === "path" || node?.type === "rect" || node?.type === "ellipse";

const pathToNode = (doc: Document, targetId: NodeId): SceneNode[] | null => {
  const visit = (id: NodeId, path: SceneNode[]): SceneNode[] | null => {
    const node = doc.nodes[id];
    if (!node) {
      return null;
    }

    const nextPath = [...path, node];
    if (id === targetId) {
      return nextPath;
    }

    if (!isContainer(node)) {
      return null;
    }

    for (const childId of node.children) {
      const result = visit(childId, nextPath);
      if (result) {
        return result;
      }
    }

    return null;
  };

  for (const layerId of doc.layerOrder) {
    const result = visit(layerId, []);
    if (result) {
      return result;
    }
  }

  return null;
};

const parentWorldTransform = (doc: Document, parentId: NodeId | null): Matrix => {
  if (parentId === null) {
    return IDENTITY;
  }

  const path = pathToNode(doc, parentId);
  if (!path) {
    return IDENTITY;
  }

  return path.reduce((acc, node) => compose(acc, node.transform), IDENTITY);
};

export const booleanSelection = (
  doc: Document,
  ids: readonly NodeId[],
  op: BooleanOp,
): BooleanSelectionResult | null => {
  const candidates = topLevelNodeIds(doc, ids).filter((id) => isBooleanShape(doc.nodes[id]));
  if (candidates.length < 2) {
    return null;
  }

  const firstParent = findNodeParent(doc, candidates[0]!);
  if (!firstParent) {
    return null;
  }

  let result = flattenNodeToPolygons(doc, doc.nodes[candidates[0]!]!);
  for (const id of candidates.slice(1)) {
    result = polygonBoolean(result, flattenNodeToPolygons(doc, doc.nodes[id]!), op);
  }

  const parentInverse = invert(parentWorldTransform(doc, firstParent.parentId));
  if (!parentInverse) {
    return null;
  }

  const subpaths: SubPath[] = result.map((ring) => ({
    anchors: ring.map((point) => ({
      point: apply(parentInverse, point),
      handleIn: null,
      handleOut: null,
    })),
    closed: true,
  }));
  const source = doc.nodes[candidates[0]!] as PathNode | Extract<SceneNode, { type: "rect" | "ellipse" }>;

  return {
    node: {
      id: createNodeId(),
      name: "Boolean Path",
      type: "path",
      transform: IDENTITY,
      opacity: source.opacity,
      visible: source.visible,
      locked: false,
      fill: source.fill,
      stroke: source.stroke,
      blendMode: source.blendMode,
      subpaths,
    },
    removeIds: candidates,
  };
};

export const groupSelection = (doc: Document, ids: readonly NodeId[]): GroupSelectionResult | null => {
  const topLevelIds = topLevelNodeIds(doc, ids);
  const firstParent = topLevelIds.length > 0 ? findNodeParent(doc, topLevelIds[0]!) : null;
  if (!firstParent) {
    return null;
  }

  const selected = new Set(topLevelIds);
  const groupedIds = firstParent.order.filter((id) => selected.has(id));
  if (groupedIds.length < 2) {
    return null;
  }

  const frontmostIndex = Math.max(...groupedIds.map((id) => firstParent.order.indexOf(id)));
  const group = createGroup("Group", groupedIds);
  const order: NodeId[] = [];
  let inserted = false;

  for (let index = 0; index < firstParent.order.length; index += 1) {
    const id = firstParent.order[index]!;
    if (!selected.has(id)) {
      order.push(id);
    }

    if (index === frontmostIndex) {
      order.push(group.id);
      inserted = true;
    }
  }

  if (!inserted) {
    order.push(group.id);
  }

  return {
    parentId: firstParent.parentId,
    group,
    order,
    groupedIds,
  };
};

export const ungroupSelection = (doc: Document, ids: readonly NodeId[]): UngroupSelectionResult[] => {
  const groupsByParent = new Map<NodeId | null, Map<NodeId, GroupNode>>();

  for (const id of topLevelNodeIds(doc, ids)) {
    const node = doc.nodes[id];
    if (!node || node.type !== "group") {
      continue;
    }

    const parent = findNodeParent(doc, id);
    if (!parent) {
      continue;
    }

    const groups = groupsByParent.get(parent.parentId);
    if (groups) {
      groups.set(id, node);
    } else {
      groupsByParent.set(parent.parentId, new Map([[id, node]]));
    }
  }

  return [...groupsByParent].map(([parentId, groups]) => {
    const parent = parentId ? doc.nodes[parentId] : null;
    const order = parentId
      ? parent && isContainer(parent)
        ? parent.children
        : []
      : doc.layerOrder;
    const liftedIds: NodeId[] = [];

    return {
      parentId,
      groupIds: [...groups.keys()],
      order: order.flatMap((childId) => {
        const group = groups.get(childId);
        if (!group) {
          return [childId];
        }
        liftedIds.push(...group.children);
        return group.children;
      }),
      liftedIds,
    };
  });
};

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
