import { original, produce } from "immer";
import { useStore } from "zustand";
import { createStore } from "zustand/vanilla";
import type { Vec2 } from "../core/geometry/vector";
import { createDocument } from "../core/model/factory";
import type { Document, NodeId, SceneNode } from "../core/model/types";
import { isContainer } from "../core/model/types";
import {
  canRedo,
  canUndo,
  createHistory,
  pushHistory,
  redoHistory,
  undoHistory,
  type History,
} from "./history";

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
}

export interface EditorActions {
  addNode: (node: SceneNode, parentId?: NodeId) => void;
  removeNodes: (ids: NodeId[]) => void;
  updateNode: (id: NodeId, patch: Partial<SceneNode>) => void;
  moveSelection: (dx: number, dy: number) => void;
  setSelection: (ids: NodeId[]) => void;
  addToSelection: (id: NodeId) => void;
  clearSelection: () => void;
  setActiveTool: (tool: ToolId) => void;
  setPan: (pan: Vec2) => void;
  setZoom: (zoom: number) => void;
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

      const parent = state.doc.nodes[targetParentId];
      if (!parent || !isContainer(parent)) {
        return false;
      }

      removeFromParent(state.doc, node.id);
      state.doc.nodes[node.id] = node;
      parent.children.push(node.id);
      return true;
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
