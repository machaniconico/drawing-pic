import type { RGBA } from "../core/model/types";

export const SWATCHES_STORAGE_KEY = "drawing-pic.swatches.v1";

export interface Swatch {
  readonly id: string;
  readonly color: RGBA;
}

const cloneColor = (color: RGBA): RGBA => ({ ...color });

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const isFiniteNumber = (value: unknown): value is number =>
  typeof value === "number" && Number.isFinite(value);

const parseColor = (value: unknown): RGBA | null => {
  if (!isRecord(value)) {
    return null;
  }

  const { r, g, b, a } = value;
  if (
    !isFiniteNumber(r) ||
    !isFiniteNumber(g) ||
    !isFiniteNumber(b) ||
    !isFiniteNumber(a) ||
    r < 0 ||
    r > 255 ||
    g < 0 ||
    g > 255 ||
    b < 0 ||
    b > 255 ||
    a < 0 ||
    a > 1
  ) {
    return null;
  }

  return { r, g, b, a };
};

const parseSwatch = (value: unknown): Swatch | null => {
  if (!isRecord(value) || typeof value.id !== "string" || value.id.length === 0) {
    return null;
  }

  const color = parseColor(value.color);
  return color ? { id: value.id, color } : null;
};

export const addSwatch = (swatches: readonly Swatch[], swatch: Swatch): Swatch[] => [
  ...swatches,
  { id: swatch.id, color: cloneColor(swatch.color) },
];

export const removeSwatch = (swatches: readonly Swatch[], id: string): Swatch[] =>
  swatches.filter((swatch) => swatch.id !== id);

export const reorderSwatches = (
  swatches: readonly Swatch[],
  fromIndex: number,
  toIndex: number,
): Swatch[] => {
  if (
    !Number.isInteger(fromIndex) ||
    !Number.isInteger(toIndex) ||
    fromIndex < 0 ||
    fromIndex >= swatches.length ||
    toIndex < 0 ||
    toIndex >= swatches.length ||
    fromIndex === toIndex
  ) {
    return [...swatches];
  }

  const reordered = [...swatches];
  const [moved] = reordered.splice(fromIndex, 1);
  reordered.splice(toIndex, 0, moved!);
  return reordered;
};

export const loadSwatches = (): Swatch[] => {
  try {
    if (typeof localStorage === "undefined") {
      return [];
    }

    const raw = localStorage.getItem(SWATCHES_STORAGE_KEY);
    if (raw === null) {
      return [];
    }

    const value: unknown = JSON.parse(raw);
    if (!Array.isArray(value)) {
      return [];
    }

    const parsed = value.map(parseSwatch);
    return parsed.every((swatch): swatch is Swatch => swatch !== null) ? parsed : [];
  } catch {
    return [];
  }
};

export const saveSwatches = (swatches: readonly Swatch[]): void => {
  try {
    if (typeof localStorage === "undefined") {
      return;
    }

    localStorage.setItem(SWATCHES_STORAGE_KEY, JSON.stringify(swatches));
  } catch {
    // Persistence is best-effort and must never break editor actions.
  }
};
