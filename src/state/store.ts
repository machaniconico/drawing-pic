import { original, produce } from "immer";
import { useStore } from "zustand";
import { createStore } from "zustand/vanilla";
import { offsetSubPaths } from "../core/geometry/offsetPath";
import { strokeOutlineSubPaths } from "../core/geometry/outlineStroke";
import type { BBox } from "../core/geometry/bbox";
import { apply, applyVector, compose, IDENTITY, invert, translate } from "../core/geometry/matrix";
import type { BooleanOp } from "../core/geometry/polygonBoolean";
import type { PathfinderOp } from "../core/geometry/pathfinder";
import { shapeBuilderFromRegions, type ShapeBuilderMode } from "../core/geometry/shapeBuilder";
import type { Vec2 } from "../core/geometry/vector";
import { createDocument, newId } from "../core/model/factory";
import { selectionBounds } from "../core/model/bounds";
import type {
  Artboard,
  DefinitionNode,
  Document,
  NodeId,
  Paint,
  PathNode,
  RGBA,
  SceneNode,
  Stroke,
  SymbolDefinition,
  SymbolInstanceNode,
} from "../core/model/types";
import { asSymbolInstance, hasStyle, isContainer } from "../core/model/types";
import {
  alignNodes as computeAlignNodes,
  bringForward as computeBringForward,
  bringToFront as computeBringToFront,
  booleanSelection as computeBooleanSelection,
  cloneSubtree,
  convertShapeToPath as computeConvertShapeToPath,
  distributeByGap as computeDistributeByGap,
  distributeNodes as computeDistributeNodes,
  findNodeParent,
  flipNodes as computeFlipNodes,
  groupSelection as computeGroupSelection,
  moveSelectionTo as computeMoveSelectionTo,
  nodesWithMatchingFill as computeNodesWithMatchingFill,
  nodesWithMatchingStroke as computeNodesWithMatchingStroke,
  parentWorldTransform,
  pathfinderSelection as computePathfinderSelection,
  rotateNodesAround as computeRotateNodesAround,
  rotateNodes90 as computeRotateNodes90,
  resizeSelectionTo as computeResizeSelectionTo,
  sendBackward as computeSendBackward,
  sendToBack as computeSendToBack,
  topLevelNodeIds,
  ungroupSelection as computeUngroupSelection,
  type AlignEdge,
  type DistributeAxis,
  type FlipAxis,
  type GroupSelectionResult,
  type MatrixPatchMap,
  type Rotate90Direction,
  type TransformPatchMap,
  type UngroupSelectionResult,
  type ZOrderPatch,
} from "./operations";
import {
  canRedo,
  canUndo,
  createHistory,
  pushHistory,
  redoHistory,
  undoHistory,
  type History,
} from "./history";
import { moveNode, type LayerDropPosition } from "./layerReorder";
import { loadEditorPrefs, saveEditorPrefs } from "./persist";
import {
  addSwatch as appendSwatch,
  loadSwatches,
  removeSwatch as deleteSwatch,
  saveSwatches,
  type Swatch,
} from "./swatches";
import {
  addGuide as computeAddGuide,
  clearGuides as computeClearGuides,
  moveGuide as computeMoveGuide,
  removeGuide as computeRemoveGuide,
  setAllGuidesHidden as computeSetAllGuidesHidden,
  setAllGuidesLocked as computeSetAllGuidesLocked,
  setGuideColor as computeSetGuideColor,
  setGuideHidden as computeSetGuideHidden,
  setGuideLocked as computeSetGuideLocked,
} from "./guides";
import {
  getActiveIsolationId,
  isNodeDescendantOf,
  isNodeInIsolation,
  normalizeIsolationPath,
} from "./selectors";

export type ToolId =
  | "select"
  | "node"
  | "rect"
  | "ellipse"
  | "pen"
  | "text"
  | "gradient"
  | "shape-builder"
  | "hand"
  | "eyedropper"
  | "measure";

export interface EditorViewport {
  pan: Vec2;
  zoom: number;
}

export type SnapTarget = "objects" | "guides" | "grid";
export type AlignReference = "selection" | "artboard";

export interface SnapSettings {
  enabled: boolean;
  toObjects: boolean;
  toGuides: boolean;
  toGrid: boolean;
  gridSize: number;
}

export interface RecentDuplicate {
  selection: NodeId[];
  delta: Vec2;
}

export interface EditorState {
  doc: Document;
  selection: NodeId[];
  isolationPath: NodeId[];
  keyObjectId: NodeId | null;
  activeTool: ToolId;
  viewport: EditorViewport;
  snapSettings: SnapSettings;
  showGrid: boolean;
  swatches: Swatch[];
  history: History<Document>;
  clipboard: SceneNode[];
  recentDuplicate: RecentDuplicate | null;
}

export interface EditorActions {
  enterIsolation: (groupId: NodeId) => void;
  exitIsolation: () => void;
  addNode: (node: SceneNode, parentId?: NodeId) => void;
  removeNodes: (ids: NodeId[]) => void;
  updateNode: (id: NodeId, patch: Partial<SceneNode>) => void;
  applyStyleToSelection: (patch: { opacity?: number; fill?: Paint; stroke?: Stroke | null }) => void;
  addSwatch: (color: RGBA) => void;
  removeSwatch: (id: string) => void;
  applySwatchToSelection: (id: string) => void;
  moveSelection: (dx: number, dy: number) => void;
  setSelectionPosition: (x: number, y: number) => void;
  setSelectionSize: (width: number, height: number) => void;
  alignNodes: (edge: AlignEdge, reference?: AlignReference) => void;
  distributeNodes: (axis: DistributeAxis, reference?: AlignReference) => void;
  distributeSelectionByGap: (axis: DistributeAxis, gap: number) => void;
  flipSelection: (axis: FlipAxis) => void;
  rotateSelection90: (direction: Rotate90Direction) => void;
  rotateSelectionBy: (deltaRad: number) => void;
  bringToFront: () => void;
  sendToBack: () => void;
  bringForward: () => void;
  sendBackward: () => void;
  groupSelection: () => void;
  ungroupSelection: () => void;
  toggleClipMask: () => void;
  booleanOp: (op: BooleanOp) => void;
  applyPathfinder: (op: PathfinderOp) => void;
  applyShapeBuilder: (point: Vec2, mode?: ShapeBuilderMode | boolean) => void;
  convertSelectionToPaths: () => void;
  outlineSelectedStrokes: () => void;
  offsetSelectedPaths: (distance: number) => void;
  defineSymbolFromSelection: (name?: string) => NodeId | null;
  placeSymbolInstance: (symbolId: NodeId, at: Vec2) => NodeId | null;
  breakSymbolLink: (instanceId?: NodeId) => void;
  updateSymbolDefinition: (symbolId: NodeId, nodes?: DefinitionNode[]) => void;
  copySelection: () => void;
  paste: () => void;
  pasteInPlace: () => void;
  duplicateSelection: () => void;
  recordDuplicateDelta: (dx: number, dy: number) => void;
  repeatDuplicate: () => void;
  reorderNode: (dragId: NodeId, targetId: NodeId, position: LayerDropPosition) => void;
  addGuide: (axis: "x" | "y", position: number) => NodeId | null;
  moveGuide: (id: NodeId, position: number) => void;
  removeGuide: (id: NodeId) => void;
  setGuideColor: (id: NodeId, color: string) => void;
  setGuideLocked: (id: NodeId, locked: boolean) => void;
  setGuideHidden: (id: NodeId, hidden: boolean) => void;
  setAllGuidesLocked: (locked: boolean) => void;
  setAllGuidesHidden: (hidden: boolean) => void;
  setAllObjectsLocked: (locked: boolean) => void;
  setAllObjectsHidden: (hidden: boolean) => void;
  lockSelection: () => void;
  hideSelection: () => void;
  clearGuides: () => void;
  setSelection: (ids: NodeId[]) => void;
  selectSameFill: () => void;
  selectSameStroke: () => void;
  addToSelection: (id: NodeId) => void;
  clearSelection: () => void;
  setKeyObject: (id: NodeId | null) => void;
  setActiveTool: (tool: ToolId) => void;
  setPan: (pan: Vec2) => void;
  setZoom: (zoom: number) => void;
  setSnapEnabled: (on: boolean) => void;
  setSnapTarget: (target: SnapTarget, on: boolean) => void;
  setGridSize: (size: number) => void;
  setShowGrid: (on: boolean) => void;
  setDocumentSize: (width: number, height: number) => void;
  setDocumentName: (name: string) => void;
  setDocumentBackground: (color: RGBA | null) => void;
  addArtboard: () => NodeId;
  removeArtboard: (id: NodeId) => void;
  setActiveArtboard: (id: NodeId) => void;
  renameArtboard: (id: NodeId, name: string) => void;
  loadDocument: (doc: Document) => void;
  undo: () => void;
  redo: () => void;
}

export type EditorStore = EditorState & EditorActions;

const DEFAULT_SNAP_GRID_SIZE = 8;
const MIN_SNAP_GRID_SIZE = 1;
const MAX_SNAP_GRID_SIZE = 1024;
const MIN_DOCUMENT_SIZE = 1;

const defaultSnapSettings = (): SnapSettings => ({
  enabled: true,
  toObjects: true,
  toGuides: true,
  toGrid: true,
  gridSize: DEFAULT_SNAP_GRID_SIZE,
});

const initialState = (): EditorState => {
  const snapSettings = defaultSnapSettings();
  const persistedPrefs = loadEditorPrefs();

  return {
    doc: normalizeDocument(createDocument()),
    selection: [],
    isolationPath: [],
    keyObjectId: null,
    activeTool: "select",
    viewport: {
      pan: { x: 0, y: 0 },
      zoom: 1,
    },
    snapSettings: {
      ...snapSettings,
      ...(persistedPrefs?.snapSettings ?? {}),
    },
    showGrid: persistedPrefs?.showGrid ?? false,
    swatches: loadSwatches(),
    history: createHistory<Document>(),
    clipboard: [],
    recentDuplicate: null,
  };
};

const persistEditorPrefs = (state: EditorStore): void => {
  saveEditorPrefs({
    snapSettings: {
      enabled: state.snapSettings.enabled,
      toObjects: state.snapSettings.toObjects,
      toGuides: state.snapSettings.toGuides,
      toGrid: state.snapSettings.toGrid,
      gridSize: state.snapSettings.gridSize,
    },
    showGrid: state.showGrid,
  });
};

const dedupeIds = (ids: NodeId[]): NodeId[] => [...new Set(ids)];

const createSwatchId = (): string => {
  const randomUuid = globalThis.crypto?.randomUUID;
  if (randomUuid) {
    return randomUuid.call(globalThis.crypto);
  }

  return `swatch-${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
};

const clearMissingKeyObject = (state: EditorStore): void => {
  if (state.keyObjectId !== null && !state.selection.includes(state.keyObjectId)) {
    state.keyObjectId = null;
  }
};

const sanitizeIsolation = (state: EditorStore): void => {
  state.isolationPath = normalizeIsolationPath(state.doc, state.isolationPath);
  state.selection = state.selection.filter((id) => isNodeInIsolation(state.doc, id, state.isolationPath));
  clearMissingKeyObject(state);
};

const getDefaultParentId = (doc: Document): NodeId | undefined => doc.layerOrder.at(-1);

const removeFromParent = (doc: Document, id: NodeId): void => {
  for (const node of Object.values(doc.nodes)) {
    if (isContainer(node)) {
      node.children = node.children.filter((childId) => childId !== id);
    }
  }
  doc.layerOrder = doc.layerOrder.filter((layerId) => layerId !== id);
};

const collectDescendants = (doc: Document, id: NodeId, result: Set<NodeId>): void => {
  if (result.has(id)) {
    return;
  }

  result.add(id);
  const node = doc.nodes[id];
  if (!node || !isContainer(node)) {
    return;
  }

  for (const childId of node.children) {
    collectDescendants(doc, childId, result);
  }
};

const addNodeToParent = (doc: Document, node: SceneNode, parentId: NodeId): boolean => {
  const parent = doc.nodes[parentId];
  if (!parent || !isContainer(parent)) {
    return false;
  }

  removeFromParent(doc, node.id);
  doc.nodes[node.id] = node;
  parent.children.push(node.id);
  return true;
};

const applyTransformPatches = (doc: Document, patches: TransformPatchMap): boolean => {
  let changed = false;

  for (const [id, patch] of Object.entries(patches)) {
    const node = doc.nodes[id];
    if (!node) {
      continue;
    }

    if (node.transform.e === patch.e && node.transform.f === patch.f) {
      continue;
    }

    node.transform = {
      ...node.transform,
      e: patch.e,
      f: patch.f,
    };
    changed = true;
  }

  return changed;
};

const applyMatrixPatches = (doc: Document, patches: MatrixPatchMap): boolean => {
  let changed = false;

  for (const [id, transform] of Object.entries(patches)) {
    const node = doc.nodes[id];
    if (!node) {
      continue;
    }

    node.transform = transform;
    changed = true;
  }

  return changed;
};

const applyZOrderPatches = (doc: Document, patches: readonly ZOrderPatch[]): boolean => {
  let changed = false;

  for (const patch of patches) {
    if (patch.parentId === null) {
      doc.layerOrder = [...patch.order];
      changed = true;
      continue;
    }

    const parent = doc.nodes[patch.parentId];
    if (parent && isContainer(parent)) {
      parent.children = [...patch.order];
      changed = true;
    }
  }

  return changed;
};

const applyGroupSelectionResult = (doc: Document, result: GroupSelectionResult): void => {
  doc.nodes[result.group.id] = result.group;
  // The new group keeps an identity transform in the same parent, so child transforms remain visually unchanged.
  if (result.parentId === null) {
    doc.layerOrder = [...result.order];
    return;
  }

  const parent = doc.nodes[result.parentId];
  if (parent && isContainer(parent)) {
    parent.children = [...result.order];
  }
};

const selectionsEqual = (left: readonly NodeId[], right: readonly NodeId[]): boolean =>
  left.length === right.length && left.every((id, index) => id === right[index]);

const applyUngroupSelectionResults = (doc: Document, results: readonly UngroupSelectionResult[]): NodeId[] => {
  const liftedIds: NodeId[] = [];

  for (const result of results) {
    if (result.parentId === null) {
      doc.layerOrder = [...result.order];
    } else {
      const parent = doc.nodes[result.parentId];
      if (parent && isContainer(parent)) {
        parent.children = [...result.order];
      }
    }

    for (const groupId of result.groupIds) {
      delete doc.nodes[groupId];
    }
    liftedIds.push(...result.liftedIds);
  }

  return liftedIds;
};

const clipboardRootIds = (clipboard: readonly SceneNode[]): NodeId[] => {
  const clipboardIds = new Set(clipboard.map((node) => node.id));
  const childIds = new Set<NodeId>();

  for (const node of clipboard) {
    if (!isContainer(node)) {
      continue;
    }

    for (const childId of node.children) {
      if (clipboardIds.has(childId)) {
        childIds.add(childId);
      }
    }
  }

  return clipboard.filter((node) => !childIds.has(node.id)).map((node) => node.id);
};

const clipboardDocument = (clipboard: readonly SceneNode[]): Document => ({
  id: "clipboard",
  name: "Clipboard",
  width: 0,
  height: 0,
  layerOrder: clipboardRootIds(clipboard),
  guides: [],
  nodes: Object.fromEntries(clipboard.map((node) => [node.id, node])) as Record<NodeId, SceneNode>,
});

const objectNodes = (doc: Document): SceneNode[] => Object.values(doc.nodes).filter((node) => node.type !== "layer");

const fallbackArtboard = (doc: Document): Artboard => ({
  id: `${doc.id}_artboard_1`,
  name: "Artboard 1",
  x: 0,
  y: 0,
  width: Math.max(MIN_DOCUMENT_SIZE, doc.width),
  height: Math.max(MIN_DOCUMENT_SIZE, doc.height),
});

const activeArtboardBounds = (doc: Document): BBox | undefined => {
  const artboard = doc.artboards?.find((candidate) => candidate.id === doc.activeArtboardId);
  if (!artboard) {
    return undefined;
  }

  return {
    minX: artboard.x,
    minY: artboard.y,
    maxX: artboard.x + artboard.width,
    maxY: artboard.y + artboard.height,
  };
};

const rebaseDocumentToArtboard = (doc: Document, id: NodeId | undefined): Vec2 => {
  const artboards = doc.artboards;
  if (!artboards || artboards.length === 0) {
    return { x: 0, y: 0 };
  }
  const activeArtboard = artboards.find((artboard) => artboard.id === id) ?? artboards[0]!;
  const origin = { x: activeArtboard.x, y: activeArtboard.y };

  if (origin.x !== 0 || origin.y !== 0) {
    for (const artboard of artboards) {
      artboard.x -= origin.x;
      artboard.y -= origin.y;
    }
    for (const layerId of doc.layerOrder) {
      const layer = doc.nodes[layerId];
      if (layer?.type === "layer") {
        layer.transform = {
          ...layer.transform,
          e: layer.transform.e - origin.x,
          f: layer.transform.f - origin.y,
        };
      }
    }
    for (const guide of doc.guides) {
      guide.position -= guide.axis === "x" ? origin.x : origin.y;
    }
  }

  doc.activeArtboardId = activeArtboard.id;
  doc.width = activeArtboard.width;
  doc.height = activeArtboard.height;
  return origin;
};

const normalizeDocument = (doc: Document): Document => {
  const normalized = structuredClone(doc);
  const artboards = Array.isArray(normalized.artboards) && normalized.artboards.length > 0
    ? normalized.artboards
    : [fallbackArtboard(normalized)];
  const activeArtboardId = artboards.some((artboard) => artboard.id === doc.activeArtboardId)
    ? doc.activeArtboardId
    : artboards[0]!.id;
  normalized.artboards = artboards;
  normalized.guides = Array.isArray(normalized.guides) ? normalized.guides : [];
  normalized.symbols = normalized.symbols && typeof normalized.symbols === "object" ? normalized.symbols : {};
  rebaseDocumentToArtboard(normalized, activeArtboardId);
  return normalized;
};

const symbolRootNodes = (definition: SymbolDefinition): DefinitionNode[] => {
  const childIds = new Set<NodeId>();
  for (const node of definition.nodes) {
    if (isContainer(node)) {
      node.children.forEach((id) => childIds.add(id));
    }
  }
  return definition.nodes.filter((node) => !childIds.has(node.id));
};

const replaceIdsInOrder = (
  order: NodeId[],
  removedIds: ReadonlySet<NodeId>,
  replacementIds: readonly NodeId[],
): NodeId[] => {
  const result: NodeId[] = [];
  let inserted = false;
  for (const id of order) {
    if (!removedIds.has(id)) {
      result.push(id);
    } else if (!inserted) {
      result.push(...replacementIds);
      inserted = true;
    }
  }
  return result;
};

const nodeDefaultsForSymbolInstance = (id: NodeId, symbolId: NodeId, name: string): SymbolInstanceNode => ({
  id,
  name,
  type: "symbol-instance",
  symbolId,
  transform: IDENTITY,
  opacity: 1,
  visible: true,
  locked: false,
});

const cloneDefinitionNodes = (
  definition: SymbolDefinition,
  reservedIds: readonly NodeId[],
): { nodes: DefinitionNode[]; roots: NodeId[] } => {
  const sourceDefinition = original(definition) ?? definition;
  const reserved = new Set(reservedIds);
  const idMap = new Map<NodeId, NodeId>();
  for (const node of sourceDefinition.nodes) {
    let id = newId();
    while (reserved.has(id)) id = newId();
    reserved.add(id);
    idMap.set(node.id, id);
  }

  const roots = symbolRootNodes(sourceDefinition).map((node) => idMap.get(node.id)!).filter(Boolean);
  const nodes = sourceDefinition.nodes.map((source) => {
    const node = structuredClone(source) as DefinitionNode;
    node.id = idMap.get(source.id)!;
    if (isContainer(node)) {
      node.children = node.children.map((id) => idMap.get(id) ?? id);
    }
    if (hasStyle(node)) {
      if (node.fill.type === "pattern") {
        node.fill.sourceId = idMap.get(node.fill.sourceId) ?? node.fill.sourceId;
      }
      if (node.stroke?.paint.type === "pattern") {
        node.stroke.paint.sourceId = idMap.get(node.stroke.paint.sourceId) ?? node.stroke.paint.sourceId;
      }
    }
    return node;
  });
  return { nodes, roots };
};

interface CapturedSymbolSelection {
  rootIds: NodeId[];
  capturedIds: Set<NodeId>;
  parentId: NodeId;
  parentInverse: NonNullable<ReturnType<typeof invert>>;
  bounds: BBox;
  nodes: DefinitionNode[];
}

const captureSymbolSelection = (
  doc: Document,
  selection: readonly NodeId[],
): CapturedSymbolSelection | null => {
  const rootIds = topLevelNodeIds(doc, selection);
  if (rootIds.length === 0) return null;

  const parent = findNodeParent(doc, rootIds[0]!);
  // A root layer cannot be replaced by a shape instance without corrupting layerOrder.
  if (!parent || parent.parentId === null) return null;
  if (rootIds.some((id) => findNodeParent(doc, id)?.parentId !== parent.parentId)) return null;

  const bounds = selectionBounds(doc, rootIds);
  if (!Number.isFinite(bounds.minX) || !Number.isFinite(bounds.minY)) return null;
  const parentWorld = parentWorldTransform(doc, parent.parentId);
  const parentInverse = invert(parentWorld);
  if (!parentInverse) return null;

  const capturedIds = new Set<NodeId>();
  rootIds.forEach((id) => collectDescendants(doc, id, capturedIds));
  const rootSet = new Set(rootIds);
  const nodes = [...capturedIds]
    .map((id) => doc.nodes[id])
    .filter((node): node is SceneNode => Boolean(node))
    .map((source) => {
      const node = structuredClone(source) as unknown as DefinitionNode;
      if (rootSet.has(node.id)) {
        node.transform = compose(
          translate(-bounds.minX, -bounds.minY),
          compose(parentWorld, node.transform),
        );
      }
      return node;
    });

  return { rootIds, capturedIds, parentId: parent.parentId, parentInverse, bounds, nodes };
};

const preserveActiveArtboard = (doc: Document, preferredId: NodeId | undefined): void => {
  const artboards = doc.artboards;
  if (!artboards || artboards.length === 0) {
    return;
  }
  const activeArtboard = artboards.find((artboard) => artboard.id === preferredId)
    ?? artboards.find((artboard) => artboard.id === doc.activeArtboardId)
    ?? artboards[0]!;
  rebaseDocumentToArtboard(doc, activeArtboard.id);
};

const colorsEqual = (left: RGBA | null | undefined, right: RGBA | null): boolean => {
  if (left == null || right === null) {
    return left == null && right === null;
  }

  return left.r === right.r && left.g === right.g && left.b === right.b && left.a === right.a;
};

const paintEqual = (left: Paint, right: Paint): boolean => {
  if (left.type !== right.type) {
    return false;
  }

  if (left.type === "none" && right.type === "none") {
    return true;
  }

  if (left.type === "solid" && right.type === "solid") {
    return colorsEqual(left.color, right.color);
  }

  if (left.type === "linear" && right.type === "linear") {
    return (
      left.start.x === right.start.x &&
      left.start.y === right.start.y &&
      left.end.x === right.end.x &&
      left.end.y === right.end.y &&
      left.stops.length === right.stops.length &&
      left.stops.every(
        (stop, index) =>
          stop.offset === right.stops[index]?.offset && colorsEqual(stop.color, right.stops[index]?.color ?? null),
      )
    );
  }

  if (left.type === "radial" && right.type === "radial") {
    return (
      left.center.x === right.center.x &&
      left.center.y === right.center.y &&
      left.radius === right.radius &&
      left.stops.length === right.stops.length &&
      left.stops.every(
        (stop, index) =>
          stop.offset === right.stops[index]?.offset && colorsEqual(stop.color, right.stops[index]?.color ?? null),
      )
    );
  }

  return false;
};

const strokeEqual = (left: Stroke | null, right: Stroke | null): boolean => {
  if (left === null || right === null) {
    return left === right;
  }

  return (
    paintEqual(left.paint, right.paint) &&
    left.width === right.width &&
    left.cap === right.cap &&
    left.join === right.join &&
    left.miterLimit === right.miterLimit &&
    left.dashOffset === right.dashOffset &&
    left.align === right.align &&
    left.dash.length === right.dash.length &&
    left.dash.every((dash, index) => dash === right.dash[index])
  );
};

const clampOpacity = (opacity: number): number => Math.min(1, Math.max(0, opacity));

const insertRootAfter = (doc: Document, parentId: NodeId | null, sourceId: NodeId, cloneId: NodeId): void => {
  if (parentId === null) {
    const index = doc.layerOrder.indexOf(sourceId);
    doc.layerOrder.splice(index < 0 ? doc.layerOrder.length : index + 1, 0, cloneId);
    return;
  }

  const parent = doc.nodes[parentId];
  if (!parent || !isContainer(parent)) {
    return;
  }

  const index = parent.children.indexOf(sourceId);
  parent.children.splice(index < 0 ? parent.children.length : index + 1, 0, cloneId);
};

const insertBooleanResult = (doc: Document, parentId: NodeId | null, resultId: NodeId, removeIds: readonly NodeId[]): void => {
  const removed = new Set(removeIds);
  const replaceOrder = (order: NodeId[]): NodeId[] => {
    const next: NodeId[] = [];
    let inserted = false;

    for (const id of order) {
      if (!removed.has(id)) {
        next.push(id);
        continue;
      }

      if (!inserted) {
        next.push(resultId);
        inserted = true;
      }
    }

    if (!inserted) {
      next.push(resultId);
    }
    return next;
  };

  if (parentId === null) {
    doc.layerOrder = replaceOrder(doc.layerOrder);
    return;
  }

  const parent = doc.nodes[parentId];
  if (parent && isContainer(parent)) {
    parent.children = replaceOrder(parent.children);
  }
};

const insertPathfinderResults = (
  doc: Document,
  parentId: NodeId | null,
  resultIds: readonly NodeId[],
  removeIds: readonly NodeId[],
): void => {
  const removed = new Set(removeIds);
  const replaceOrder = (order: NodeId[]): NodeId[] => {
    const next: NodeId[] = [];
    let inserted = false;

    for (const id of order) {
      if (!removed.has(id)) {
        next.push(id);
        continue;
      }
      if (!inserted) {
        next.push(...resultIds);
        inserted = true;
      }
    }

    if (!inserted) {
      next.push(...resultIds);
    }
    return next;
  };

  if (parentId === null) {
    doc.layerOrder = replaceOrder(doc.layerOrder);
    return;
  }

  const parent = doc.nodes[parentId];
  if (parent && isContainer(parent)) {
    parent.children = replaceOrder(parent.children);
  }
};

const withDocHistory = (
  set: (
    partial:
      | EditorStore
      | Partial<EditorStore>
      | ((state: EditorStore) => EditorStore | Partial<EditorStore>),
    replace?: boolean,
  ) => void,
  recipe: (state: EditorStore) => boolean,
): void => {
  set(
    produce((state: EditorStore) => {
      const snapshot = original(state.doc) ?? state.doc;
      if (recipe(state)) {
        state.history = pushHistory(state.history, snapshot);
      }
    }),
  );
};

export const editorStore = createStore<EditorStore>()((set, get) => ({
  ...initialState(),

  addNode: (node, parentId) => {
    withDocHistory(set, (state) => {
      const isolationId = getActiveIsolationId(state.isolationPath);
      const targetParentId = parentId ?? isolationId ?? getDefaultParentId(state.doc);
      if (!targetParentId) {
        return false;
      }
      if (
        isolationId !== null &&
        targetParentId !== isolationId &&
        !isNodeDescendantOf(state.doc, targetParentId, isolationId)
      ) {
        return false;
      }

      if (parentId === undefined && isolationId !== null) {
        const parentInverse = invert(parentWorldTransform(state.doc, isolationId));
        if (!parentInverse) {
          return false;
        }
        return addNodeToParent(
          state.doc,
          { ...node, transform: compose(parentInverse, node.transform) } as SceneNode,
          targetParentId,
        );
      }

      return addNodeToParent(state.doc, node, targetParentId);
    });
  },

  removeNodes: (ids) => {
    const idsToRemove = dedupeIds(ids);
    if (idsToRemove.length === 0) {
      return;
    }

    withDocHistory(set, (state) => {
      const removed = new Set<NodeId>();
      for (const id of idsToRemove.filter((candidate) =>
        isNodeInIsolation(state.doc, candidate, state.isolationPath))) {
        collectDescendants(state.doc, id, removed);
      }
      if (removed.size === 0) {
        return false;
      }

      for (const id of removed) {
        removeFromParent(state.doc, id);
        delete state.doc.nodes[id];
      }

      state.selection = state.selection.filter((id) => !removed.has(id));
      sanitizeIsolation(state);
      return true;
    });
  },

  updateNode: (id, patch) => {
    withDocHistory(set, (state) => {
      const node = state.doc.nodes[id];
      if (!node || !isNodeInIsolation(state.doc, id, state.isolationPath)) {
        return false;
      }

      Object.assign(node, patch);
      return true;
    });
  },

  applyStyleToSelection: (patch) => {
    const hasOpacityPatch = patch.opacity !== undefined;
    const hasFillPatch = patch.fill !== undefined;
    const hasStrokePatch = patch.stroke !== undefined;
    if (!hasOpacityPatch && !hasFillPatch && !hasStrokePatch) {
      return;
    }

    withDocHistory(set, (state) => {
      if (state.selection.length === 0) {
        return false;
      }

      let changed = false;
      const opacity = hasOpacityPatch ? clampOpacity(patch.opacity!) : undefined;

      for (const id of state.selection) {
        const node = state.doc.nodes[id];
        if (!node) {
          continue;
        }

        if (opacity !== undefined && node.opacity !== opacity) {
          node.opacity = opacity;
          changed = true;
        }

        if (!hasStyle(node)) {
          continue;
        }

        if (hasFillPatch && patch.fill !== undefined && !paintEqual(node.fill, patch.fill)) {
          node.fill = structuredClone(patch.fill);
          changed = true;
        }

        if (hasStrokePatch) {
          const stroke = patch.stroke;
          if (stroke !== undefined && !strokeEqual(node.stroke, stroke)) {
            node.stroke = stroke === null ? null : structuredClone(stroke);
            changed = true;
          }
        }
      }

      return changed;
    });
  },

  addSwatch: (color) => {
    const swatches = appendSwatch(get().swatches, { id: createSwatchId(), color });
    set({ swatches });
    saveSwatches(swatches);
  },

  removeSwatch: (id) => {
    const current = get().swatches;
    const swatches = deleteSwatch(current, id);
    if (swatches.length === current.length) {
      return;
    }

    set({ swatches });
    saveSwatches(swatches);
  },

  applySwatchToSelection: (id) => {
    const swatch = get().swatches.find((candidate) => candidate.id === id);
    if (!swatch) {
      return;
    }

    withDocHistory(set, (state) => {
      let changed = false;
      for (const nodeId of state.selection) {
        const node = state.doc.nodes[nodeId];
        if (!node || !hasStyle(node)) {
          continue;
        }

        const fill: Paint = { type: "solid", color: swatch.color };
        if (!paintEqual(node.fill, fill)) {
          node.fill = structuredClone(fill);
          changed = true;
        }
      }
      return changed;
    });
  },

  moveSelection: (dx, dy) => {
    withDocHistory(set, (state) => {
      let moved = false;
      for (const id of state.selection) {
        const node = state.doc.nodes[id];
        if (!node || node.locked) {
          continue;
        }

        const parent = findNodeParent(state.doc, id);
        const parentInverse = invert(parentWorldTransform(state.doc, parent?.parentId ?? null));
        const localDelta = parentInverse === null
          ? { x: dx, y: dy }
          : applyVector(parentInverse, { x: dx, y: dy });

        node.transform = {
          ...node.transform,
          e: node.transform.e + localDelta.x,
          f: node.transform.f + localDelta.y,
        };
        moved = true;
      }

      if (moved && state.recentDuplicate !== null && selectionsEqual(
        state.selection,
        state.recentDuplicate.selection,
      )) {
        state.recentDuplicate.delta = {
          x: state.recentDuplicate.delta.x + dx,
          y: state.recentDuplicate.delta.y + dy,
        };
      }
      return moved;
    });
  },

  setSelectionPosition: (x, y) => {
    withDocHistory(set, (state) => {
      if (state.selection.length === 0 || Number.isNaN(x) || Number.isNaN(y)) {
        return false;
      }

      return applyMatrixPatches(state.doc, computeMoveSelectionTo(state.doc, state.selection, x, y));
    });
  },

  setSelectionSize: (width, height) => {
    withDocHistory(set, (state) => {
      if (state.selection.length === 0 || Number.isNaN(width) || Number.isNaN(height)) {
        return false;
      }

      return applyMatrixPatches(state.doc, computeResizeSelectionTo(state.doc, state.selection, width, height));
    });
  },

  alignNodes: (edge, reference = "selection") => {
    withDocHistory(set, (state) => {
      const referenceBounds = reference === "artboard" ? activeArtboardBounds(state.doc) : undefined;
      if (reference === "artboard" && !referenceBounds) {
        return false;
      }
      return applyTransformPatches(
        state.doc,
        computeAlignNodes(
          state.doc,
          state.selection,
          edge,
          reference === "selection" ? state.keyObjectId : null,
          referenceBounds,
        ),
      );
    });
  },

  distributeNodes: (axis, reference = "selection") => {
    withDocHistory(set, (state) => {
      const referenceBounds = reference === "artboard" ? activeArtboardBounds(state.doc) : undefined;
      if (reference === "artboard" && !referenceBounds) {
        return false;
      }
      return applyTransformPatches(
        state.doc,
        computeDistributeNodes(state.doc, state.selection, axis, referenceBounds),
      );
    });
  },

  distributeSelectionByGap: (axis, gap) => {
    withDocHistory(set, (state) =>
      applyTransformPatches(state.doc, computeDistributeByGap(state.doc, state.selection, axis, gap)),
    );
  },

  flipSelection: (axis) => {
    withDocHistory(set, (state) => {
      if (state.selection.length === 0) {
        return false;
      }

      return applyMatrixPatches(state.doc, computeFlipNodes(state.doc, state.selection, axis));
    });
  },

  rotateSelection90: (direction) => {
    withDocHistory(set, (state) => {
      if (state.selection.length === 0) {
        return false;
      }

      return applyMatrixPatches(state.doc, computeRotateNodes90(state.doc, state.selection, direction));
    });
  },

  rotateSelectionBy: (deltaRad) => {
    withDocHistory(set, (state) => {
      if (state.selection.length === 0 || deltaRad === 0 || !Number.isFinite(deltaRad)) {
        return false;
      }

      return applyMatrixPatches(state.doc, computeRotateNodesAround(state.doc, state.selection, deltaRad));
    });
  },

  bringToFront: () => {
    withDocHistory(set, (state) => applyZOrderPatches(state.doc, computeBringToFront(state.doc, state.selection)));
  },

  sendToBack: () => {
    withDocHistory(set, (state) => applyZOrderPatches(state.doc, computeSendToBack(state.doc, state.selection)));
  },

  bringForward: () => {
    withDocHistory(set, (state) => applyZOrderPatches(state.doc, computeBringForward(state.doc, state.selection)));
  },

  sendBackward: () => {
    withDocHistory(set, (state) => applyZOrderPatches(state.doc, computeSendBackward(state.doc, state.selection)));
  },

  groupSelection: () => {
    withDocHistory(set, (state) => {
      const result = computeGroupSelection(state.doc, state.selection);
      if (!result) {
        return false;
      }

      applyGroupSelectionResult(state.doc, result);
      state.selection = [result.group.id];
      clearMissingKeyObject(state);
      return true;
    });
  },

  ungroupSelection: () => {
    withDocHistory(set, (state) => {
      const results = computeUngroupSelection(state.doc, state.selection);
      if (results.length === 0) {
        return false;
      }

      state.selection = applyUngroupSelectionResults(state.doc, results);
      sanitizeIsolation(state);
      return true;
    });
  },

  toggleClipMask: () => {
    withDocHistory(set, (state) => {
      if (state.selection.length === 1) {
        const node = state.doc.nodes[state.selection[0]!];
        if (!node || node.type !== "group") {
          return false;
        }

        node.clip = !node.clip;
        return true;
      }

      if (state.selection.length < 2) {
        return false;
      }

      const result = computeGroupSelection(state.doc, state.selection);
      if (!result) {
        return false;
      }

      result.group.clip = true;
      applyGroupSelectionResult(state.doc, result);
      state.selection = [result.group.id];
      clearMissingKeyObject(state);
      return true;
    });
  },

  booleanOp: (op) => {
    withDocHistory(set, (state) => {
      const sourceDoc = original(state.doc) ?? state.doc;
      const result = computeBooleanSelection(sourceDoc, state.selection, op);
      if (!result) {
        return false;
      }

      const parent = findNodeParent(state.doc, result.removeIds[0]!);
      if (!parent) {
        return false;
      }

      state.doc.nodes[result.node.id] = result.node;
      insertBooleanResult(state.doc, parent.parentId, result.node.id, result.removeIds);
      for (const id of result.removeIds) {
        removeFromParent(state.doc, id);
        delete state.doc.nodes[id];
      }
      state.selection = [result.node.id];
      clearMissingKeyObject(state);
      return true;
    });
  },

  applyPathfinder: (op) => {
    withDocHistory(set, (state) => {
      const sourceDoc = original(state.doc) ?? state.doc;
      const result = computePathfinderSelection(sourceDoc, state.selection, op);
      if (!result) {
        return false;
      }

      for (const node of result.nodes) {
        state.doc.nodes[node.id] = node;
      }
      insertPathfinderResults(
        state.doc,
        result.parentId,
        result.nodes.map((node) => node.id),
        result.removeIds,
      );
      for (const id of result.removeIds) {
        removeFromParent(state.doc, id);
        delete state.doc.nodes[id];
      }
      state.selection = result.nodes.map((node) => node.id);
      clearMissingKeyObject(state);
      return true;
    });
  },

  applyShapeBuilder: (point, requestedMode = "union") => {
    withDocHistory(set, (state) => {
      const sourceDoc = original(state.doc) ?? state.doc;
      const divided = computePathfinderSelection(sourceDoc, state.selection, "divide");
      if (!divided) {
        return false;
      }

      const parentInverse = invert(parentWorldTransform(sourceDoc, divided.parentId));
      if (!parentInverse) {
        return false;
      }
      const mode: ShapeBuilderMode = requestedMode === true || requestedMode === "delete" ? "delete" : "union";
      const result = shapeBuilderFromRegions(divided.nodes, apply(parentInverse, point), mode);
      if (!result) {
        return false;
      }

      for (const node of result.nodes) {
        state.doc.nodes[node.id] = node;
      }
      insertPathfinderResults(
        state.doc,
        divided.parentId,
        result.nodes.map((node) => node.id),
        divided.removeIds,
      );
      for (const id of divided.removeIds) {
        removeFromParent(state.doc, id);
        delete state.doc.nodes[id];
      }
      state.selection = result.nodes.map((node) => node.id);
      clearMissingKeyObject(state);
      return true;
    });
  },

  convertSelectionToPaths: () => {
    withDocHistory(set, (state) => {
      const sourceDoc = original(state.doc) ?? state.doc;
      let changed = false;

      for (const id of state.selection) {
        const node = sourceDoc.nodes[id];
        if (!node) {
          continue;
        }

        const pathNode = computeConvertShapeToPath(node);
        if (!pathNode) {
          continue;
        }

        state.doc.nodes[id] = pathNode;
        changed = true;
      }

      return changed;
    });
  },

  outlineSelectedStrokes: () => {
    withDocHistory(set, (state) => {
      const sourceDoc = original(state.doc) ?? state.doc;
      let changed = false;

      for (const id of state.selection) {
        const node = sourceDoc.nodes[id];
        if (
          !node ||
          node.locked ||
          (node.type !== "path" && node.type !== "rect" && node.type !== "ellipse") ||
          node.stroke === null ||
          node.stroke.paint.type === "none" ||
          node.stroke.width <= 0
        ) {
          continue;
        }

        const sourcePath = node.type === "path" ? node : computeConvertShapeToPath(node);
        if (!sourcePath) {
          continue;
        }

        const outlineSubpaths = strokeOutlineSubPaths(
          sourcePath.subpaths,
          node.stroke.width,
          node.stroke.cap,
          node.stroke.join,
          node.stroke.miterLimit,
          node.stroke.align,
        );
        if (outlineSubpaths.length === 0) {
          continue;
        }

        const outlineNode: PathNode = {
          id: node.id,
          name: node.name,
          type: "path",
          transform: structuredClone(node.transform),
          opacity: node.opacity,
          visible: node.visible,
          locked: node.locked,
          fill: structuredClone(node.stroke.paint),
          stroke: null,
          blendMode: node.blendMode,
          subpaths: outlineSubpaths,
        };

        state.doc.nodes[id] = outlineNode;
        changed = true;
      }

      return changed;
    });
  },

  offsetSelectedPaths: (distance) => {
    if (distance === 0 || !Number.isFinite(distance)) {
      return;
    }

    withDocHistory(set, (state) => {
      const sourceDoc = original(state.doc) ?? state.doc;
      const cloneSourceDoc = structuredClone(sourceDoc) as Document;
      const offsetIds: NodeId[] = [];

      for (const id of state.selection) {
        const node = sourceDoc.nodes[id];
        if (!node || node.locked) {
          continue;
        }

        const sourcePath = node.type === "path" ? node : computeConvertShapeToPath(node);
        if (!sourcePath) {
          continue;
        }

        const parent = findNodeParent(sourceDoc, id);
        if (!parent) {
          continue;
        }

        const offsetNode: PathNode = {
          id: sourcePath.id,
          name: `${sourcePath.name} offset`,
          type: "path",
          transform: structuredClone(sourcePath.transform),
          opacity: sourcePath.opacity,
          visible: sourcePath.visible,
          locked: sourcePath.locked,
          fill: structuredClone(sourcePath.fill),
          stroke: sourcePath.stroke === null ? null : structuredClone(sourcePath.stroke),
          blendMode: sourcePath.blendMode,
          subpaths: offsetSubPaths(
            sourcePath.subpaths,
            distance,
            sourcePath.stroke?.join ?? "miter",
            sourcePath.stroke?.miterLimit ?? 4,
          ),
        };

        cloneSourceDoc.nodes[offsetNode.id] = offsetNode;
        const clone = cloneSubtree(cloneSourceDoc, offsetNode.id, undefined, Object.keys(state.doc.nodes));
        Object.assign(cloneSourceDoc.nodes, clone.nodes);
        for (const clonedNode of Object.values(clone.nodes)) {
          state.doc.nodes[clonedNode.id] = clonedNode;
        }

        insertRootAfter(state.doc, parent.parentId, id, clone.rootId);
        offsetIds.push(clone.rootId);
      }

      if (offsetIds.length === 0) {
        return false;
      }

      state.selection = offsetIds;
      clearMissingKeyObject(state);
      return true;
    });
  },

  defineSymbolFromSelection: (name) => {
    const symbolId = newId();
    const instanceId = newId();
    let created = false;
    withDocHistory(set, (state) => {
      const sourceDoc = original(state.doc) ?? state.doc;
      const captured = captureSymbolSelection(sourceDoc, state.selection);
      if (!captured) return false;

      const symbolName = name?.trim() || `Symbol ${Object.keys(state.doc.symbols ?? {}).length + 1}`;
      const definition: SymbolDefinition = { id: symbolId, name: symbolName, nodes: captured.nodes };
      (state.doc.symbols ??= {})[symbolId] = definition;

      const instance = nodeDefaultsForSymbolInstance(instanceId, symbolId, symbolName);
      instance.transform = compose(captured.parentInverse, translate(captured.bounds.minX, captured.bounds.minY));
      state.doc.nodes[instanceId] = instance as unknown as SceneNode;
      const parentNode = state.doc.nodes[captured.parentId];
      if (!parentNode || !isContainer(parentNode)) return false;
      parentNode.children = replaceIdsInOrder(parentNode.children, new Set(captured.rootIds), [instanceId]);
      for (const id of captured.capturedIds) delete state.doc.nodes[id];
      state.selection = [instanceId];
      state.keyObjectId = null;
      created = true;
      return true;
    });
    return created ? symbolId : null;
  },

  placeSymbolInstance: (symbolId, at) => {
    const instanceId = newId();
    let placed = false;
    withDocHistory(set, (state) => {
      const definition = state.doc.symbols?.[symbolId];
      const parentId = getActiveIsolationId(state.isolationPath) ?? getDefaultParentId(state.doc);
      if (!definition || !parentId || !Number.isFinite(at.x) || !Number.isFinite(at.y)) return false;

      const parent = state.doc.nodes[parentId];
      if (!parent || !isContainer(parent)) return false;
      const parentInverse = invert(parentWorldTransform(state.doc, parentId));
      if (!parentInverse) return false;

      const instance = nodeDefaultsForSymbolInstance(instanceId, symbolId, definition.name);
      instance.transform = compose(parentInverse, translate(at.x, at.y));
      state.doc.nodes[instanceId] = instance as unknown as SceneNode;
      parent.children.push(instanceId);
      state.selection = [instanceId];
      state.keyObjectId = null;
      placed = true;
      return true;
    });
    return placed ? instanceId : null;
  },

  breakSymbolLink: (instanceId) => {
    withDocHistory(set, (state) => {
      const requestedIds = instanceId === undefined ? state.selection : [instanceId];
      const nextSelection: NodeId[] = [];
      let changed = false;

      for (const id of requestedIds) {
        const sceneNode = state.doc.nodes[id];
        const instance = sceneNode ? asSymbolInstance(sceneNode) : null;
        if (!instance) continue;
        const definition = state.doc.symbols?.[instance.symbolId];
        const parent = findNodeParent(state.doc, id);
        if (!definition || !parent) continue;

        const cloned = cloneDefinitionNodes(definition, Object.keys(state.doc.nodes));
        const rootSet = new Set(cloned.roots);
        for (const node of cloned.nodes) {
          if (rootSet.has(node.id)) node.transform = compose(instance.transform, node.transform);
          state.doc.nodes[node.id] = node as unknown as SceneNode;
        }
        if (parent.parentId === null) {
          state.doc.layerOrder = replaceIdsInOrder(state.doc.layerOrder, new Set([id]), cloned.roots);
        } else {
          const parentNode = state.doc.nodes[parent.parentId];
          if (!parentNode || !isContainer(parentNode)) continue;
          parentNode.children = replaceIdsInOrder(parentNode.children, new Set([id]), cloned.roots);
        }
        delete state.doc.nodes[id];
        nextSelection.push(...cloned.roots);
        changed = true;
      }

      if (!changed) return false;
      state.selection = nextSelection;
      state.keyObjectId = null;
      return true;
    });
  },

  updateSymbolDefinition: (symbolId, nodes) => {
    withDocHistory(set, (state) => {
      const definition = state.doc.symbols?.[symbolId];
      if (!definition) return false;

      let nextNodes = nodes;
      if (nextNodes === undefined) {
        const sourceDoc = original(state.doc) ?? state.doc;
        const captured = captureSymbolSelection(sourceDoc, state.selection);
        if (!captured) return false;
        nextNodes = captured.nodes;
      }
      if (nextNodes.length === 0) return false;
      definition.nodes = nextNodes.map((node) => structuredClone(node) as DefinitionNode);
      return true;
    });
  },

  copySelection: () => {
    set(
      produce((state: EditorStore) => {
        const sourceDoc = original(state.doc) ?? state.doc;
        const copiedIds = new Set<NodeId>();

        for (const id of topLevelNodeIds(sourceDoc, state.selection)) {
          collectDescendants(sourceDoc, id, copiedIds);
        }

        state.clipboard = [...copiedIds]
          .map((id) => sourceDoc.nodes[id])
          .filter((node): node is SceneNode => Boolean(node))
          .map((node) => structuredClone(node) as SceneNode);
      }),
    );
  },

  paste: () => {
    withDocHistory(set, (state) => {
      const targetParentId = getActiveIsolationId(state.isolationPath) ?? getDefaultParentId(state.doc);
      const clipboard = original(state.clipboard) ?? state.clipboard;
      if (!targetParentId || clipboard.length === 0) {
        return false;
      }

      const targetParent = state.doc.nodes[targetParentId];
      if (!targetParent || !isContainer(targetParent)) {
        return false;
      }

      const sourceDoc = clipboardDocument(clipboard);
      const pastedRootIds: NodeId[] = [];

      for (const rootId of clipboardRootIds(clipboard)) {
        const clone = cloneSubtree(sourceDoc, rootId, undefined, Object.keys(state.doc.nodes));
        Object.assign(sourceDoc.nodes, clone.nodes);
        for (const node of Object.values(clone.nodes)) {
          state.doc.nodes[node.id] = node;
        }

        const root = state.doc.nodes[clone.rootId];
        if (root) {
          root.transform = { ...root.transform, e: root.transform.e + 12, f: root.transform.f + 12 };
        }

        targetParent.children.push(clone.rootId);
        pastedRootIds.push(clone.rootId);
      }

      state.selection = pastedRootIds;
      clearMissingKeyObject(state);
      return pastedRootIds.length > 0;
    });
  },

  pasteInPlace: () => {
    withDocHistory(set, (state) => {
      const targetParentId = getActiveIsolationId(state.isolationPath) ?? getDefaultParentId(state.doc);
      const clipboard = original(state.clipboard) ?? state.clipboard;
      if (!targetParentId || clipboard.length === 0) {
        return false;
      }

      const targetParent = state.doc.nodes[targetParentId];
      if (!targetParent || !isContainer(targetParent)) {
        return false;
      }

      const sourceDoc = clipboardDocument(clipboard);
      const pastedRootIds: NodeId[] = [];

      for (const rootId of clipboardRootIds(clipboard)) {
        const clone = cloneSubtree(sourceDoc, rootId, undefined, Object.keys(state.doc.nodes));
        Object.assign(sourceDoc.nodes, clone.nodes);
        for (const node of Object.values(clone.nodes)) {
          state.doc.nodes[node.id] = node;
        }

        targetParent.children.push(clone.rootId);
        pastedRootIds.push(clone.rootId);
      }

      state.selection = pastedRootIds;
      clearMissingKeyObject(state);
      return pastedRootIds.length > 0;
    });
  },

  duplicateSelection: () => {
    withDocHistory(set, (state) => {
      const sourceDoc = original(state.doc) ?? state.doc;
      const sourceIds = topLevelNodeIds(sourceDoc, state.selection);
      if (sourceIds.length === 0) {
        return false;
      }

      const cloneSourceDoc = structuredClone(sourceDoc) as Document;
      const duplicatedRootIds: NodeId[] = [];

      for (const sourceId of sourceIds) {
        const parent = findNodeParent(sourceDoc, sourceId);
        if (!parent) {
          continue;
        }

        const clone = cloneSubtree(cloneSourceDoc, sourceId, undefined, Object.keys(state.doc.nodes));
        Object.assign(cloneSourceDoc.nodes, clone.nodes);
        for (const node of Object.values(clone.nodes)) {
          state.doc.nodes[node.id] = node;
        }

        const root = state.doc.nodes[clone.rootId];
        if (root) {
          root.transform = { ...root.transform, e: root.transform.e + 12, f: root.transform.f + 12 };
        }

        insertRootAfter(state.doc, parent.parentId, sourceId, clone.rootId);
        duplicatedRootIds.push(clone.rootId);
      }

      state.selection = duplicatedRootIds;
      clearMissingKeyObject(state);
      if (duplicatedRootIds.length > 0) {
        state.recentDuplicate = {
          selection: [...duplicatedRootIds],
          delta: { x: 0, y: 0 },
        };
      }
      return duplicatedRootIds.length > 0;
    });
  },

  recordDuplicateDelta: (dx, dy) => {
    if (!Number.isFinite(dx) || !Number.isFinite(dy)) {
      return;
    }

    set(
      produce((state: EditorStore) => {
        if (
          state.recentDuplicate === null ||
          !selectionsEqual(state.selection, state.recentDuplicate.selection)
        ) {
          return;
        }

        state.recentDuplicate.delta = {
          x: state.recentDuplicate.delta.x + dx,
          y: state.recentDuplicate.delta.y + dy,
        };
      }),
    );
  },

  repeatDuplicate: () => {
    const before = get();
    if (
      before.recentDuplicate === null ||
      !selectionsEqual(before.selection, before.recentDuplicate.selection)
    ) {
      before.duplicateSelection();
      return;
    }

    const delta = { ...before.recentDuplicate.delta };
    before.duplicateSelection();
    const afterDuplicate = get();
    if (selectionsEqual(afterDuplicate.selection, before.selection)) {
      return;
    }

    if (delta.x === 0 && delta.y === 0) {
      return;
    }

    afterDuplicate.moveSelection(delta.x, delta.y);
    set({ history: afterDuplicate.history });
  },

  reorderNode: (dragId, targetId, position) => {
    withDocHistory(set, (state) => {
      const isolationId = getActiveIsolationId(state.isolationPath);
      if (
        !isNodeInIsolation(state.doc, dragId, state.isolationPath) ||
        (targetId === isolationId && position !== "inside") ||
        (
          targetId !== isolationId &&
          !isNodeInIsolation(state.doc, targetId, state.isolationPath)
        )
      ) {
        return false;
      }

      const sourceDoc = original(state.doc) ?? state.doc;
      const nextDoc = moveNode(sourceDoc, dragId, targetId, position);
      if (nextDoc === sourceDoc) {
        return false;
      }

      state.doc = nextDoc;
      return true;
    });
  },

  addGuide: (axis, position) => {
    let id: NodeId | null = null;

    withDocHistory(set, (state) => {
      const sourceDoc = original(state.doc) ?? state.doc;
      const result = computeAddGuide(sourceDoc, axis, position);
      id = result.id;
      state.doc = result.doc;
      return true;
    });

    return id;
  },

  moveGuide: (id, position) => {
    withDocHistory(set, (state) => {
      const sourceDoc = original(state.doc) ?? state.doc;
      const nextDoc = computeMoveGuide(sourceDoc, id, position);
      if (nextDoc === sourceDoc) {
        return false;
      }

      state.doc = nextDoc;
      return true;
    });
  },

  removeGuide: (id) => {
    withDocHistory(set, (state) => {
      const sourceDoc = original(state.doc) ?? state.doc;
      const nextDoc = computeRemoveGuide(sourceDoc, id);
      if (nextDoc === sourceDoc) {
        return false;
      }

      state.doc = nextDoc;
      return true;
    });
  },

  setGuideColor: (id, color) => {
    withDocHistory(set, (state) => {
      const sourceDoc = original(state.doc) ?? state.doc;
      const nextDoc = computeSetGuideColor(sourceDoc, id, color);
      if (nextDoc === sourceDoc) {
        return false;
      }

      state.doc = nextDoc;
      return true;
    });
  },

  setGuideLocked: (id, locked) => {
    withDocHistory(set, (state) => {
      const sourceDoc = original(state.doc) ?? state.doc;
      const nextDoc = computeSetGuideLocked(sourceDoc, id, locked);
      if (nextDoc === sourceDoc) {
        return false;
      }

      state.doc = nextDoc;
      return true;
    });
  },

  setGuideHidden: (id, hidden) => {
    withDocHistory(set, (state) => {
      const sourceDoc = original(state.doc) ?? state.doc;
      const nextDoc = computeSetGuideHidden(sourceDoc, id, hidden);
      if (nextDoc === sourceDoc) {
        return false;
      }

      state.doc = nextDoc;
      return true;
    });
  },

  setAllGuidesLocked: (locked) => {
    withDocHistory(set, (state) => {
      const sourceDoc = original(state.doc) ?? state.doc;
      if (sourceDoc.guides.length === 0) {
        return false;
      }

      const nextDoc = computeSetAllGuidesLocked(sourceDoc, locked);
      if (nextDoc === sourceDoc) {
        return false;
      }

      state.doc = nextDoc;
      return true;
    });
  },

  setAllGuidesHidden: (hidden) => {
    withDocHistory(set, (state) => {
      const sourceDoc = original(state.doc) ?? state.doc;
      if (sourceDoc.guides.length === 0) {
        return false;
      }

      const nextDoc = computeSetAllGuidesHidden(sourceDoc, hidden);
      if (nextDoc === sourceDoc) {
        return false;
      }

      state.doc = nextDoc;
      return true;
    });
  },

  setAllObjectsLocked: (locked) => {
    withDocHistory(set, (state) => {
      const objects = objectNodes(state.doc).filter((node) =>
        isNodeInIsolation(state.doc, node.id, state.isolationPath));
      if (objects.length === 0) {
        return false;
      }

      let changed = false;
      for (const node of objects) {
        if (node.locked === locked) {
          continue;
        }

        node.locked = locked;
        changed = true;
      }

      return changed;
    });
  },

  setAllObjectsHidden: (hidden) => {
    withDocHistory(set, (state) => {
      const objects = objectNodes(state.doc).filter((node) =>
        isNodeInIsolation(state.doc, node.id, state.isolationPath));
      if (objects.length === 0) {
        return false;
      }

      const visible = !hidden;
      let changed = false;
      for (const node of objects) {
        if (node.visible === visible) {
          continue;
        }

        node.visible = visible;
        changed = true;
      }

      return changed;
    });
  },

  lockSelection: () => {
    withDocHistory(set, (state) => {
      if (state.selection.length === 0) {
        return false;
      }

      let changed = false;
      for (const id of state.selection) {
        const node = state.doc.nodes[id];
        if (!node || node.locked) {
          continue;
        }

        node.locked = true;
        changed = true;
      }

      return changed;
    });
  },

  hideSelection: () => {
    withDocHistory(set, (state) => {
      if (state.selection.length === 0) {
        return false;
      }

      let changed = false;
      for (const id of state.selection) {
        const node = state.doc.nodes[id];
        if (!node || !node.visible) {
          continue;
        }

        node.visible = false;
        changed = true;
      }

      if (!changed) {
        return false;
      }

      state.selection = [];
      clearMissingKeyObject(state);
      return true;
    });
  },

  clearGuides: () => {
    withDocHistory(set, (state) => {
      const sourceDoc = original(state.doc) ?? state.doc;
      const nextDoc = computeClearGuides(sourceDoc);
      if (nextDoc === sourceDoc) {
        return false;
      }

      state.doc = nextDoc;
      return true;
    });
  },

  setSelection: (ids) => {
    set(
      produce((state: EditorStore) => {
        state.selection = dedupeIds(ids).filter(
          (id) => id in state.doc.nodes && isNodeInIsolation(state.doc, id, state.isolationPath),
        );
        clearMissingKeyObject(state);
      }),
    );
  },

  selectSameFill: () => {
    set(
      produce((state: EditorStore) => {
        const refId = state.selection[0];
        if (!refId) {
          return;
        }

        state.selection = dedupeIds(computeNodesWithMatchingFill(state.doc, refId)).filter(
          (id) => id in state.doc.nodes && isNodeInIsolation(state.doc, id, state.isolationPath),
        );
        clearMissingKeyObject(state);
      }),
    );
  },

  selectSameStroke: () => {
    set(
      produce((state: EditorStore) => {
        const refId = state.selection[0];
        if (!refId) {
          return;
        }

        state.selection = dedupeIds(computeNodesWithMatchingStroke(state.doc, refId)).filter(
          (id) => id in state.doc.nodes && isNodeInIsolation(state.doc, id, state.isolationPath),
        );
        clearMissingKeyObject(state);
      }),
    );
  },

  addToSelection: (id) => {
    set(
      produce((state: EditorStore) => {
        if (
          id in state.doc.nodes &&
          isNodeInIsolation(state.doc, id, state.isolationPath) &&
          !state.selection.includes(id)
        ) {
          state.selection.push(id);
        }
      }),
    );
  },

  clearSelection: () => {
    set(
      produce((state: EditorStore) => {
        state.selection = [];
        state.keyObjectId = null;
      }),
    );
  },

  enterIsolation: (groupId) => {
    set(
      produce((state: EditorStore) => {
        sanitizeIsolation(state);
        const group = state.doc.nodes[groupId];
        const activeId = getActiveIsolationId(state.isolationPath);
        if (
          group?.type !== "group" ||
          groupId === activeId ||
          (activeId !== null && !isNodeDescendantOf(state.doc, groupId, activeId))
        ) {
          return;
        }

        state.isolationPath.push(groupId);
        state.selection = [];
        state.keyObjectId = null;
      }),
    );
  },

  exitIsolation: () => {
    set(
      produce((state: EditorStore) => {
        sanitizeIsolation(state);
        if (state.isolationPath.length === 0) {
          return;
        }
        state.isolationPath.pop();
        state.selection = [];
        state.keyObjectId = null;
      }),
    );
  },

  setKeyObject: (id) => {
    set(
      produce((state: EditorStore) => {
        state.keyObjectId = id !== null && state.selection.includes(id) ? id : null;
      }),
    );
  },

  setActiveTool: (tool) => {
    set(
      produce((state: EditorStore) => {
        state.activeTool = tool;
      }),
    );
  },

  setPan: (pan) => {
    set(
      produce((state: EditorStore) => {
        state.viewport.pan = pan;
      }),
    );
  },

  setZoom: (zoom) => {
    set(
      produce((state: EditorStore) => {
        state.viewport.zoom = zoom;
      }),
    );
  },

  setSnapEnabled: (on) => {
    set(
      produce((state: EditorStore) => {
        state.snapSettings.enabled = on;
        persistEditorPrefs(state);
      }),
    );
  },

  setSnapTarget: (target, on) => {
    set(
      produce((state: EditorStore) => {
        if (target === "objects") {
          state.snapSettings.toObjects = on;
          persistEditorPrefs(state);
          return;
        }

        if (target === "guides") {
          state.snapSettings.toGuides = on;
          persistEditorPrefs(state);
          return;
        }

        state.snapSettings.toGrid = on;
        persistEditorPrefs(state);
      }),
    );
  },

  setGridSize: (size) => {
    if (!Number.isFinite(size) || size <= 0) {
      return;
    }

    set(
      produce((state: EditorStore) => {
        state.snapSettings.gridSize = Math.min(MAX_SNAP_GRID_SIZE, Math.max(MIN_SNAP_GRID_SIZE, size));
        persistEditorPrefs(state);
      }),
    );
  },

  setShowGrid: (on) => {
    set(
      produce((state: EditorStore) => {
        state.showGrid = on;
        persistEditorPrefs(state);
      }),
    );
  },

  setDocumentSize: (width, height) => {
    withDocHistory(set, (state) => {
      const nextWidth = Number.isFinite(width) ? Math.max(MIN_DOCUMENT_SIZE, width) : state.doc.width;
      const nextHeight = Number.isFinite(height) ? Math.max(MIN_DOCUMENT_SIZE, height) : state.doc.height;
      if (state.doc.width === nextWidth && state.doc.height === nextHeight) {
        return false;
      }

      state.doc.width = nextWidth;
      state.doc.height = nextHeight;
      const activeArtboard = state.doc.artboards?.find(
        (artboard) => artboard.id === state.doc.activeArtboardId,
      );
      if (activeArtboard) {
        activeArtboard.width = nextWidth;
        activeArtboard.height = nextHeight;
      }
      return true;
    });
  },

  setDocumentName: (name) => {
    withDocHistory(set, (state) => {
      const nextName = name.trim();
      if (nextName === "" || state.doc.name === nextName) {
        return false;
      }

      state.doc.name = nextName;
      return true;
    });
  },

  setDocumentBackground: (color) => {
    withDocHistory(set, (state) => {
      if (colorsEqual(state.doc.background, color)) {
        return false;
      }

      state.doc.background = color === null ? null : { ...color };
      return true;
    });
  },

  addArtboard: () => {
    const id = newId();
    withDocHistory(set, (state) => {
      const artboards = state.doc.artboards ?? (state.doc.artboards = [fallbackArtboard(state.doc)]);
      const rightEdge = artboards.reduce(
        (maximum, artboard) => Math.max(maximum, artboard.x + artboard.width),
        0,
      );
      const artboard: Artboard = {
        id,
        name: `Artboard ${artboards.length + 1}`,
        x: rightEdge + 64,
        y: 0,
        width: state.doc.width,
        height: state.doc.height,
      };
      artboards.push(artboard);
      return true;
    });
    return id;
  },

  removeArtboard: (id) => {
    withDocHistory(set, (state) => {
      const artboards = state.doc.artboards;
      if (!artboards || artboards.length <= 1) {
        return false;
      }
      const index = artboards.findIndex((artboard) => artboard.id === id);
      if (index < 0) {
        return false;
      }
      artboards.splice(index, 1);
      if (state.doc.activeArtboardId === id) {
        const nextActive = artboards[Math.min(index, artboards.length - 1)]!;
        const origin = rebaseDocumentToArtboard(state.doc, nextActive.id);
        state.viewport.pan = {
          x: state.viewport.pan.x + origin.x * state.viewport.zoom,
          y: state.viewport.pan.y + origin.y * state.viewport.zoom,
        };
      }
      return true;
    });
  },

  setActiveArtboard: (id) => {
    set(
      produce((state: EditorStore) => {
        if (!state.doc.artboards?.some((candidate) => candidate.id === id) || state.doc.activeArtboardId === id) {
          return;
        }
        const origin = rebaseDocumentToArtboard(state.doc, id);
        state.viewport.pan = {
          x: state.viewport.pan.x + origin.x * state.viewport.zoom,
          y: state.viewport.pan.y + origin.y * state.viewport.zoom,
        };
      }),
    );
  },

  renameArtboard: (id, name) => {
    withDocHistory(set, (state) => {
      const artboard = state.doc.artboards?.find((candidate) => candidate.id === id);
      const nextName = name.trim();
      if (!artboard || nextName === "" || artboard.name === nextName) {
        return false;
      }
      artboard.name = nextName;
      return true;
    });
  },

  loadDocument: (doc) => {
    set(
      produce((state: EditorStore) => {
        state.doc = normalizeDocument(doc);
        state.selection = [];
        state.isolationPath = [];
        state.keyObjectId = null;
        state.history = createHistory<Document>();
        state.recentDuplicate = null;
      }),
    );
  },

  undo: () => {
    set(
      produce((state: EditorStore) => {
        if (!canUndo(state.history)) {
          return;
        }

        const step = undoHistory(state.history, state.doc);
        if (!step.snapshot) {
          return;
        }

        const activeArtboardId = state.doc.activeArtboardId;
        state.history = step.history;
        state.doc = step.snapshot;
        preserveActiveArtboard(state.doc, activeArtboardId);
        state.selection = state.selection.filter((id) => id in state.doc.nodes);
        sanitizeIsolation(state);
      }),
    );
  },

  redo: () => {
    set(
      produce((state: EditorStore) => {
        if (!canRedo(state.history)) {
          return;
        }

        const step = redoHistory(state.history, state.doc);
        if (!step.snapshot) {
          return;
        }

        const activeArtboardId = state.doc.activeArtboardId;
        state.history = step.history;
        state.doc = step.snapshot;
        preserveActiveArtboard(state.doc, activeArtboardId);
        state.selection = state.selection.filter((id) => id in state.doc.nodes);
        sanitizeIsolation(state);
      }),
    );
  },
}));

export function useEditorStore(): EditorStore;
export function useEditorStore<T>(selector: (state: EditorStore) => T): T;
export function useEditorStore<T>(selector?: (state: EditorStore) => T): EditorStore | T {
  return useStore(editorStore, selector ?? ((state) => state as T));
}

export const createEditorStateForTest = initialState;
