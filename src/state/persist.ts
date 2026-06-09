import type { SnapSettings } from "./store";

export const EDITOR_PREFS_KEY = "drawing-pic.editorPrefs.v1";

export type PersistedEditorPrefs = {
  snapSettings: SnapSettings;
  showGrid: boolean;
};

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const isBoolean = (value: unknown): value is boolean => typeof value === "boolean";

const isFiniteNumber = (value: unknown): value is number =>
  typeof value === "number" && Number.isFinite(value);

const parseSnapSettings = (value: unknown): SnapSettings | null => {
  if (!isRecord(value)) {
    return null;
  }

  const { enabled, toObjects, toGuides, toGrid, gridSize } = value;
  if (
    !isBoolean(enabled) ||
    !isBoolean(toObjects) ||
    !isBoolean(toGuides) ||
    !isBoolean(toGrid) ||
    !isFiniteNumber(gridSize)
  ) {
    return null;
  }

  return { enabled, toObjects, toGuides, toGrid, gridSize };
};

const parseEditorPrefs = (value: unknown): PersistedEditorPrefs | null => {
  if (!isRecord(value) || !isBoolean(value.showGrid)) {
    return null;
  }

  const snapSettings = parseSnapSettings(value.snapSettings);
  if (!snapSettings) {
    return null;
  }

  return {
    snapSettings,
    showGrid: value.showGrid,
  };
};

export const loadEditorPrefs = (): Partial<PersistedEditorPrefs> | null => {
  try {
    if (typeof localStorage === "undefined") {
      return null;
    }

    const rawPrefs = localStorage.getItem(EDITOR_PREFS_KEY);
    if (rawPrefs === null) {
      return null;
    }

    return parseEditorPrefs(JSON.parse(rawPrefs));
  } catch {
    return null;
  }
};

export const saveEditorPrefs = (prefs: PersistedEditorPrefs): void => {
  try {
    if (typeof localStorage === "undefined") {
      return;
    }

    localStorage.setItem(EDITOR_PREFS_KEY, JSON.stringify(prefs));
  } catch {
    // Persistence is best-effort and must never break editor startup.
  }
};
