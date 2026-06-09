import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { EDITOR_PREFS_KEY, loadEditorPrefs, saveEditorPrefs, type PersistedEditorPrefs } from "./persist";

type LocalStorageStub = Pick<Storage, "getItem" | "setItem" | "removeItem" | "clear">;

const makePrefs = (): PersistedEditorPrefs => ({
  snapSettings: {
    enabled: true,
    toObjects: true,
    toGuides: false,
    toGrid: true,
    gridSize: 16,
  },
  showGrid: true,
});

const makeStorage = (): LocalStorageStub & { entries: Map<string, string> } => {
  const entries = new Map<string, string>();

  return {
    entries,
    getItem: (key: string) => entries.get(key) ?? null,
    setItem: (key: string, value: string) => {
      entries.set(key, value);
    },
    removeItem: (key: string) => {
      entries.delete(key);
    },
    clear: () => {
      entries.clear();
    },
  };
};

const setLocalStorage = (value: unknown): void => {
  Object.defineProperty(globalThis, "localStorage", {
    configurable: true,
    value,
  });
};

const removeLocalStorage = (): void => {
  Reflect.deleteProperty(globalThis, "localStorage");
};

describe("editor prefs persistence", () => {
  beforeEach(() => {
    setLocalStorage(makeStorage());
  });

  afterEach(() => {
    removeLocalStorage();
  });

  it("round-trips editor preferences through localStorage", () => {
    const prefs = makePrefs();

    saveEditorPrefs(prefs);

    expect(loadEditorPrefs()).toEqual(prefs);
  });

  it("returns null when the key is missing", () => {
    expect(loadEditorPrefs()).toBeNull();
  });

  it("returns null for invalid JSON", () => {
    localStorage.setItem(EDITOR_PREFS_KEY, "{not valid json");

    expect(loadEditorPrefs()).toBeNull();
  });

  it("returns null for garbage preference shapes", () => {
    localStorage.setItem(
      EDITOR_PREFS_KEY,
      JSON.stringify({
        snapSettings: {
          enabled: true,
          toObjects: true,
          toGuides: false,
          toGrid: true,
          gridSize: "16",
        },
        showGrid: true,
      }),
    );

    expect(loadEditorPrefs()).toBeNull();
  });

  it("returns null when localStorage is unavailable", () => {
    removeLocalStorage();

    expect(loadEditorPrefs()).toBeNull();
  });

  it("does not throw when saving without localStorage", () => {
    removeLocalStorage();

    expect(() => saveEditorPrefs(makePrefs())).not.toThrow();
  });

  it("does not throw when localStorage writes fail", () => {
    setLocalStorage({
      getItem: () => null,
      setItem: () => {
        throw new Error("storage blocked");
      },
    });

    expect(() => saveEditorPrefs(makePrefs())).not.toThrow();
  });
});
