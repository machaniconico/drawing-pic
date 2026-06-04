import { original, produce } from "immer";
import { useStore } from "zustand";
import { createStore } from "zustand/vanilla";
import type { BooleanOp } from "../core/geometry/polygonBoolean";
import type { Vec2 } from "../core/geometry/vector";
import { createDocument } from "../core/model/factory";
import type { Document, NodeId, SceneNode } from "../core/model/types";
import { isContainer } from "../core/model/types";
import {
  alignNodes as computeAlignNodes,
  bringForward as computeBringForward,
  bringToFront as computeBringToFront,
  booleanSelection as computeBooleanSelection,
  cloneSubtree,
  distributeNodes as computeDistributeNodes,
  findNodeParent,
  groupSelection as computeGroupSelection,
  sendBackward as computeSendBackward,
  sendToBack as computeSendToBack,
  topLevelNodeIds,
  ungroupSelection as computeUngroupSelection,
  type AlignEdge,
  type DistributeAxis,
  type GroupSelectionResult,
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

export type ToolId = "select" | "rect" | "ellipse" | "pen" | "text" | "hand";

export interface EditorViewport {
  pan: Vec2;
  zoom: number;
}

export interface EditorState {
  doc: Document;
  selection: NodeId[];
  activeTool: ToolId;
  viewport: EditorViewport;
  history: History<Document>;
  clipboard: SceneNode[];
}

export interface EditorActions {
  addNode: (node: SceneNode, parentId?: NodeId) => void;
  removeNodes: (ids: NodeId[]) => void;
  updateNode: (id: NodeId, patch: Partial<SceneNode>) => void;
  moveSelection: (dx: number, dy: number) => void;
  alignNodes: (edge: AlignEdge) => void;
  distributeNodes: (axis: DistributeAxis) => void;
  bringToFront: () => void;
  sendToBack: () => void;
  bringForward: () => void;
  sendBackward: () => void;
  groupSelection: () => void;
  ungroupSelection: () => void;
  booleanOp: (op: BooleanOp) => void;
  copySelection: () => void;
  paste: () => void;
  duplicateSelection: () => void;
  reorderNode: (dragId: NodeId, targetId: NodeId, position: LayerDropPosition) => void;
  setSelection: (ids: NodeId[]) => void;
  addToSelection: (id: NodeId) => void;
  clearSelection: () => void;
  setActiveTool: (tool: ToolId) => void;
  setPan: (pan: Vec2) => void;
  setZoom: (zoom: number) => void;
  loadDocument: (doc: Document) => void;
  undo: () => void;
  redo: () => void;
}

export type EditorStore = EditorState & EditorActions;

const initialState = (): EditorState => ({
  doc: createDocument(),
  selection: [],
  activeTool: "select",
  viewport: {
    pan: { x: 0, y: 0 },
    zoom: 1,
  },
  history: createHistory<Document>(),
  clipboard: [],
});

const dedupeIds = (ids: NodeId[]): NodeId[] => [...new Set(ids)];

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
  nodes: Object.fromEntries(clipboard.map((node) => [node.id, node])) as Record<NodeId, SceneNode>,
});

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

export const editorStore = createStore<EditorStore>()((set) => ({
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

  alignNodes: (edge) => {
    withDocHistory(set, (state) => applyTransformPatches(state.doc, computeAlignNodes(state.doc, state.selection, edge)));
  },

  distributeNodes: (axis) => {
    withDocHistory(set, (state) =>
      applyTransformPatches(state.doc, computeDistributeNodes(state.doc, state.selection, axis)),
    );
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

  setSelection: (ids) => {
    set(
      produce((state: EditorStore) => {
        state.selection = dedupeIds(ids).filter((id) => id in state.doc.nodes);
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

  loadDocument: (doc) => {
    set(
      produce((state: EditorStore) => {
        state.doc = doc;
        state.selection = [];
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
