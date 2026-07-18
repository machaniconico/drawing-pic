import type { RGBA } from "../core/model/types";

export interface HSVA {
  /** Hue in degrees. */
  readonly h: number;
  /** Saturation from 0 to 1. */
  readonly s: number;
  /** Value from 0 to 1. */
  readonly v: number;
  /** Alpha from 0 to 1. */
  readonly a: number;
}

const clamp = (value: number, min: number, max: number): number =>
  Number.isFinite(value) ? Math.min(max, Math.max(min, value)) : min;

const normalizeHue = (hue: number): number => {
  if (!Number.isFinite(hue)) {
    return 0;
  }

  return ((hue % 360) + 360) % 360;
};

export const rgbaToHsva = (color: RGBA): HSVA => {
  const red = clamp(color.r, 0, 255) / 255;
  const green = clamp(color.g, 0, 255) / 255;
  const blue = clamp(color.b, 0, 255) / 255;
  const max = Math.max(red, green, blue);
  const min = Math.min(red, green, blue);
  const delta = max - min;
  let hue = 0;

  if (delta !== 0) {
    if (max === red) {
      hue = 60 * (((green - blue) / delta) % 6);
    } else if (max === green) {
      hue = 60 * ((blue - red) / delta + 2);
    } else {
      hue = 60 * ((red - green) / delta + 4);
    }
  }

  return {
    h: normalizeHue(hue),
    s: max === 0 ? 0 : delta / max,
    v: max,
    a: clamp(color.a, 0, 1),
  };
};

export const hsvaToRgba = (color: HSVA): RGBA => {
  const hue = normalizeHue(color.h);
  const saturation = clamp(color.s, 0, 1);
  const value = clamp(color.v, 0, 1);
  const chroma = value * saturation;
  const hueSection = hue / 60;
  const intermediate = chroma * (1 - Math.abs((hueSection % 2) - 1));
  const offset = value - chroma;
  let red = 0;
  let green = 0;
  let blue = 0;

  if (hueSection < 1) {
    red = chroma;
    green = intermediate;
  } else if (hueSection < 2) {
    red = intermediate;
    green = chroma;
  } else if (hueSection < 3) {
    green = chroma;
    blue = intermediate;
  } else if (hueSection < 4) {
    green = intermediate;
    blue = chroma;
  } else if (hueSection < 5) {
    red = intermediate;
    blue = chroma;
  } else {
    red = chroma;
    blue = intermediate;
  }

  return {
    r: Math.round((red + offset) * 255),
    g: Math.round((green + offset) * 255),
    b: Math.round((blue + offset) * 255),
    a: clamp(color.a, 0, 1),
  };
};

const toHexByte = (value: number): string =>
  Math.round(clamp(value, 0, 255)).toString(16).padStart(2, "0");

/** Converts RGBA to #rrggbbaa, or #rrggbb when includeAlpha is false. */
export const rgbaToHex = (color: RGBA, includeAlpha = true): string => {
  const rgb = `${toHexByte(color.r)}${toHexByte(color.g)}${toHexByte(color.b)}`;
  return `#${rgb}${includeAlpha ? toHexByte(clamp(color.a, 0, 1) * 255) : ""}`;
};

/** Parses #rgb, #rgba, #rrggbb, or #rrggbbaa. Invalid values return null. */
export const hexToRgba = (hex: string): RGBA | null => {
  const normalized = hex.trim().replace(/^#/, "");
  if (!/^(?:[0-9a-fA-F]{3,4}|[0-9a-fA-F]{6}|[0-9a-fA-F]{8})$/.test(normalized)) {
    return null;
  }

  const expanded =
    normalized.length <= 4
      ? [...normalized].map((digit) => `${digit}${digit}`).join("")
      : normalized;
  const hasAlpha = expanded.length === 8;

  return {
    r: Number.parseInt(expanded.slice(0, 2), 16),
    g: Number.parseInt(expanded.slice(2, 4), 16),
    b: Number.parseInt(expanded.slice(4, 6), 16),
    a: hasAlpha ? Number.parseInt(expanded.slice(6, 8), 16) / 255 : 1,
  };
};
