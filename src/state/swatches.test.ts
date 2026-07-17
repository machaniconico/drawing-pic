import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { RGBA } from "../core/model/types";
import {
  SWATCHES_STORAGE_KEY,
  addSwatch,
  loadSwatches,
  removeSwatch,
  reorderSwatches,
  saveSwatches,
  type Swatch,
} from "./swatches";

type LocalStorageStub = Pick<Storage, "getItem" | "setItem" | "removeItem" | "clear">;

const red: RGBA = { r: 255, g: 0, b: 0, a: 1 };
const blue: RGBA = { r: 0, g: 80, b: 255, a: 0.75 };

const makeStorage = (): LocalStorageStub & { entries: Map<string, string> } => {
  const entries = new Map<string, string>();
  return {
    entries,
    getItem: (key) => entries.get(key) ?? null,
    setItem: (key, value) => entries.set(key, value),
    removeItem: (key) => entries.delete(key),
    clear: () => entries.clear(),
  };
};

const setLocalStorage = (value: unknown): void => {
  Object.defineProperty(globalThis, "localStorage", { configurable: true, value });
};

const removeLocalStorage = (): void => {
  Reflect.deleteProperty(globalThis, "localStorage");
};

describe("swatch operations", () => {
  const first: Swatch = { id: "red", color: red };
  const second: Swatch = { id: "blue", color: blue };

  it("adds without mutating the source or retaining the input color object", () => {
    const source = [first];
    const result = addSwatch(source, second);

    expect(result).toEqual([first, second]);
    expect(source).toEqual([first]);
    expect(result).not.toBe(source);
    expect(result[1]!.color).not.toBe(second.color);
  });

  it("removes by id without mutating the source", () => {
    const source = [first, second];
    const result = removeSwatch(source, first.id);

    expect(result).toEqual([second]);
    expect(source).toEqual([first, second]);
  });

  it("reorders by index without mutating the source", () => {
    const third: Swatch = { id: "green", color: { r: 0, g: 180, b: 80, a: 1 } };
    const source = [first, second, third];

    expect(reorderSwatches(source, 0, 2)).toEqual([second, third, first]);
    expect(source).toEqual([first, second, third]);
    expect(reorderSwatches(source, -1, 2)).toEqual(source);
  });
});

describe("swatch persistence", () => {
  beforeEach(() => setLocalStorage(makeStorage()));
  afterEach(removeLocalStorage);

  it("round-trips swatches through localStorage", () => {
    const swatches: Swatch[] = [
      { id: "red", color: red },
      { id: "blue", color: blue },
    ];

    saveSwatches(swatches);

    expect(loadSwatches()).toEqual(swatches);
    expect(localStorage.getItem(SWATCHES_STORAGE_KEY)).toBe(JSON.stringify(swatches));
  });

  it("falls back safely for missing, invalid, or unavailable storage", () => {
    expect(loadSwatches()).toEqual([]);
    localStorage.setItem(SWATCHES_STORAGE_KEY, "{invalid");
    expect(loadSwatches()).toEqual([]);
    localStorage.setItem(SWATCHES_STORAGE_KEY, JSON.stringify([{ id: "bad", color: { r: -1 } }]));
    expect(loadSwatches()).toEqual([]);

    removeLocalStorage();
    expect(loadSwatches()).toEqual([]);
    expect(() => saveSwatches([])).not.toThrow();
  });
});
