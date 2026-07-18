import { describe, expect, it } from "vitest";
import type { RGBA } from "../core/model/types";
import { hexToRgba, hsvaToRgba, rgbaToHex, rgbaToHsva } from "./colorConvert";

describe("RGBA and HSVA conversion", () => {
  it("maps RGB primaries and achromatic boundaries", () => {
    expect(rgbaToHsva({ r: 255, g: 0, b: 0, a: 1 })).toEqual({ h: 0, s: 1, v: 1, a: 1 });
    expect(rgbaToHsva({ r: 0, g: 255, b: 0, a: 0.5 })).toEqual({ h: 120, s: 1, v: 1, a: 0.5 });
    expect(rgbaToHsva({ r: 0, g: 0, b: 255, a: 0 })).toEqual({ h: 240, s: 1, v: 1, a: 0 });
    expect(rgbaToHsva({ r: 0, g: 0, b: 0, a: 1 })).toEqual({ h: 0, s: 0, v: 0, a: 1 });
    expect(rgbaToHsva({ r: 128, g: 128, b: 128, a: 0.25 })).toEqual({
      h: 0,
      s: 0,
      v: 128 / 255,
      a: 0.25,
    });
    expect(rgbaToHsva({ r: 255, g: 255, b: 255, a: 1 })).toEqual({ h: 0, s: 0, v: 1, a: 1 });
    expect(hsvaToRgba({ h: 300, s: 0, v: 128 / 255, a: 0.25 })).toEqual({
      r: 128,
      g: 128,
      b: 128,
      a: 0.25,
    });
  });

  it("normalizes hue and clamps HSVA boundaries", () => {
    expect(hsvaToRgba({ h: 360, s: 1, v: 1, a: 1 })).toEqual({ r: 255, g: 0, b: 0, a: 1 });
    expect(hsvaToRgba({ h: -120, s: 1, v: 1, a: -1 })).toEqual({ r: 0, g: 0, b: 255, a: 0 });
    expect(hsvaToRgba({ h: 60, s: 2, v: 2, a: 2 })).toEqual({ r: 255, g: 255, b: 0, a: 1 });
  });

  it("round-trips representative RGBA values to within one RGB byte", () => {
    const colors: RGBA[] = [
      { r: 0, g: 0, b: 0, a: 0 },
      { r: 255, g: 255, b: 255, a: 1 },
      { r: 12, g: 128, b: 244, a: 0.37 },
      { r: 201, g: 33, b: 99, a: 0.875 },
    ];

    for (const color of colors) {
      const result = hsvaToRgba(rgbaToHsva(color));
      expect(Math.abs(result.r - color.r)).toBeLessThanOrEqual(1);
      expect(Math.abs(result.g - color.g)).toBeLessThanOrEqual(1);
      expect(Math.abs(result.b - color.b)).toBeLessThanOrEqual(1);
      expect(result.a).toBeCloseTo(color.a, 10);
    }
  });
});

describe("RGBA and hex conversion", () => {
  it("formats channel boundaries and optionally omits alpha", () => {
    expect(rgbaToHex({ r: 0, g: 15, b: 255, a: 0 })).toBe("#000fff00");
    expect(rgbaToHex({ r: 255, g: 128, b: 1, a: 1 })).toBe("#ff8001ff");
    expect(rgbaToHex({ r: 255, g: 128, b: 1, a: 0.5 }, false)).toBe("#ff8001");
    expect(rgbaToHex({ r: -10, g: 300, b: 1.4, a: 4 })).toBe("#00ff01ff");
  });

  it("parses long and shorthand hex with optional alpha", () => {
    expect(hexToRgba("#1a80ff")).toEqual({ r: 26, g: 128, b: 255, a: 1 });
    expect(hexToRgba("1a80ff40")).toEqual({ r: 26, g: 128, b: 255, a: 64 / 255 });
    expect(hexToRgba("#0f8")).toEqual({ r: 0, g: 255, b: 136, a: 1 });
    expect(hexToRgba("#0f88")).toEqual({ r: 0, g: 255, b: 136, a: 136 / 255 });
  });

  it("rejects invalid hex without inventing a fallback color", () => {
    expect(hexToRgba("#12")).toBeNull();
    expect(hexToRgba("#gg0000")).toBeNull();
    expect(hexToRgba("#12345")).toBeNull();
  });

  it("round-trips RGBA through eight-digit hex within byte precision", () => {
    const source = { r: 17, g: 91, b: 203, a: 0.42 };
    const result = hexToRgba(rgbaToHex(source));

    expect(result).not.toBeNull();
    expect(result?.r).toBe(source.r);
    expect(result?.g).toBe(source.g);
    expect(result?.b).toBe(source.b);
    expect(result?.a).toBeCloseTo(source.a, 2);
  });
});
