import { original, produce } from "immer";
import { useStore } from "zustand";
import { createStore } from "zustand/vanilla";
import { offsetSubPaths } from "../core/geometry/offsetPath";
import { strokeOutlineSubPaths } from "../core/geometry/outlineStroke";
import type { BooleanOp } from "../core/geometry/polygonBoolean";
import type { PathfinderOp } from "../core/geometry/pathfinder";
import type { Vec2 } from "../core/geometry/vector";
import { createDocument } from "../core/model/factory";
import type { Document, NodeId, Paint, PathNode, RGBA, SceneNode, Stroke } from "../core/model/types";
import { hasStyle, isContainer } from "../core/model/types";
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

export type ToolId =
  | "select"
  | "node"
  | "rect"
  | "ellipse"
  | "pen"
  | "text"
  | "hand"
  | "eyedropper"
  | "measure";

export interface EditorViewport {
  pan: Vec2;
  zoom: number;
}

export type SnapTarget = "objects" | "guides" | "grid";

export interface SnapSettings {
  enabled: boolean;
  toObjects: boolean;
  toGuides: boolean;
  toGrid: boolean;
  gridSize: number;
}

export interface EditorState {
  doc: Document;
  selection: NodeId[];
  keyObjectId: NodeId | null;
  activeTool: ToolId;
  viewport: EditorViewport;
  snapSettings: SnapSettings;
  showGrid: boolean;
  swatches: Swatch[];
  history: History<Document>;
  clipboard: SceneNode[];
}

export interface EditorActions {
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
  alignNodes: (edge: AlignEdge) => void;
  distributeNodes: (axis: DistributeAxis) => void;
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
  convertSelectionToPaths: () => void;
  outlineSelectedStrokes: () => void;
  offsetSelectedPaths: (distance: number) => void;
  copySelection: () => void;
  paste: () => void;
  pasteInPlace: () => void;
  duplicateSelection: () => void;
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
    doc: createDocument(),
    selection: [],
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

const normalizeDocument = (doc: Document): Document => ({
  ...doc,
  guides: Array.isArray(doc.guides) ? doc.guides : [],
});

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
      const targetParentId = parentId ?? getDefaultParentId(state.doc);
      if (!targetParentId) {
        return false;
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
      for (const id of idsToRemove) {
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
      clearMissingKeyObject(state);
      return true;
    });
  },

  updateNode: (id, patch) => {
    withDocHistory(set, (state) => {
      const node = state.doc.nodes[id];
      if (!node) {
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

        node.transform = {
          ...node.transform,
          e: node.transform.e + dx,
          f: node.transform.f + dy,
        };
        moved = true;
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

  alignNodes: (edge) => {
    withDocHistory(set, (state) =>
      applyTransformPatches(state.doc, computeAlignNodes(state.doc, state.selection, edge, state.keyObjectId)),
    );
  },

  distributeNodes: (axis) => {
    withDocHistory(set, (state) =>
      applyTransformPatches(state.doc, computeDistributeNodes(state.doc, state.selection, axis)),
    );
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
      clearMissingKeyObject(state);
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
      const targetParentId = getDefaultParentId(state.doc);
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
      const targetParentId = getDefaultParentId(state.doc);
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
      return duplicatedRootIds.length > 0;
    });
  },

  reorderNode: (dragId, targetId, position) => {
    withDocHistory(set, (state) => {
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
      const objects = objectNodes(state.doc);
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
      const objects = objectNodes(state.doc);
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
        state.selection = dedupeIds(ids).filter((id) => id in state.doc.nodes);
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
          (id) => id in state.doc.nodes,
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
          (id) => id in state.doc.nodes,
        );
        clearMissingKeyObject(state);
      }),
    );
  },

  addToSelection: (id) => {
    set(
      produce((state: EditorStore) => {
        if (id in state.doc.nodes && !state.selection.includes(id)) {
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

  loadDocument: (doc) => {
    set(
      produce((state: EditorStore) => {
        state.doc = normalizeDocument(doc);
        state.selection = [];
        state.keyObjectId = null;
        state.history = createHistory<Document>();
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

        state.history = step.history;
        state.doc = step.snapshot;
        state.selection = state.selection.filter((id) => id in state.doc.nodes);
        clearMissingKeyObject(state);
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

        state.history = step.history;
        state.doc = step.snapshot;
        state.selection = state.selection.filter((id) => id in state.doc.nodes);
        clearMissingKeyObject(state);
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
