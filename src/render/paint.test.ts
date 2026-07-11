import { describe, expect, it, vi } from "vitest";
import type { Paint, Stroke } from "../core/model/types";
import { applyFill, applyStroke, canvasStyleFromPaint, rgbaToCss } from "./paint";

interface GradientStub {
  stops: Array<[number, string]>;
  addColorStop: (offset: number, color: string) => void;
}

const makeGradient = (): GradientStub => {
  const stops: Array<[number, string]> = [];
  return { stops, addColorStop: (offset, color) => stops.push([offset, color]) };
};

// Minimal CanvasRenderingContext2D stand-in: records assigned style props and
// hands back gradient stubs. Only the members paint.ts touches are present.
const makeCtx = () => {
  const ctx = {
    fillStyle: "" as unknown,
    strokeStyle: "" as unknown,
    lineWidth: 0,
    lineCap: "" as CanvasLineCap,
    lineJoin: "" as CanvasLineJoin,
    miterLimit: 0,
    lineDashOffset: 0,
    dash: [] as number[],
    setLineDash: vi.fn((dash: number[]) => {
      ctx.dash = dash;
    }),
    createLinearGradient: vi.fn(() => makeGradient()),
    createRadialGradient: vi.fn(() => makeGradient()),
  };
  return ctx;
};

const solid = (r: number, g: number, b: number, a = 1): Paint => ({
  type: "solid",
  color: { r, g, b, a },
});

describe("rgbaToCss", () => {
  it("clamps and rounds channels to a valid rgba() string", () => {
    expect(rgbaToCss({ r: 10, g: 20, b: 30, a: 0.5 })).toBe("rgba(10, 20, 30, 0.5)");
    expect(rgbaToCss({ r: 300, g: -5, b: 128.6, a: 2 })).toBe("rgba(255, 0, 129, 1)");
    expect(rgbaToCss({ r: 0, g: 0, b: 0, a: -1 })).toBe("rgba(0, 0, 0, 0)");
  });
});

describe("canvasStyleFromPaint", () => {
  it("returns null for none, and a css string for solid", () => {
    const ctx = makeCtx() as unknown as CanvasRenderingContext2D;
    expect(canvasStyleFromPaint(ctx, { type: "none" })).toBeNull();
    expect(canvasStyleFromPaint(ctx, solid(255, 0, 0))).toBe("rgba(255, 0, 0, 1)");
  });

  it("resolves pattern paints through the resolver, or null without one", () => {
    const ctx = makeCtx() as unknown as CanvasRenderingContext2D;
    const pattern = {} as CanvasPattern;
    const paint: Paint = { type: "pattern", sourceId: "n1", scale: 1, rotation: 0 };
    expect(canvasStyleFromPaint(ctx, paint, () => pattern)).toBe(pattern);
    expect(canvasStyleFromPaint(ctx, paint)).toBeNull();
  });

  it("builds a linear gradient with its stops", () => {
    const ctx = makeCtx();
    const paint: Paint = {
      type: "linear",
      start: { x: 0, y: 0 },
      end: { x: 10, y: 10 },
      stops: [
        { offset: 0, color: { r: 0, g: 0, b: 0, a: 1 } },
        { offset: 1, color: { r: 255, g: 255, b: 255, a: 1 } },
      ],
    };
    const result = canvasStyleFromPaint(ctx as unknown as CanvasRenderingContext2D, paint) as unknown as GradientStub;
    expect(ctx.createLinearGradient).toHaveBeenCalledWith(0, 0, 10, 10);
    expect(result.stops).toEqual([
      [0, "rgba(0, 0, 0, 1)"],
      [1, "rgba(255, 255, 255, 1)"],
    ]);
  });

  it("clamps a negative radial radius to zero", () => {
    const ctx = makeCtx();
    const paint: Paint = {
      type: "radial",
      center: { x: 5, y: 5 },
      radius: -3,
      stops: [{ offset: 0, color: { r: 1, g: 2, b: 3, a: 1 } }],
    };
    canvasStyleFromPaint(ctx as unknown as CanvasRenderingContext2D, paint);
    expect(ctx.createRadialGradient).toHaveBeenCalledWith(5, 5, 0, 5, 5, 0);
  });
});

describe("applyFill", () => {
  it("sets fillStyle and returns true for a paintable fill", () => {
    const ctx = makeCtx();
    expect(applyFill(ctx as unknown as CanvasRenderingContext2D, solid(1, 2, 3))).toBe(true);
    expect(ctx.fillStyle).toBe("rgba(1, 2, 3, 1)");
  });

  it("returns false and leaves fillStyle untouched for none", () => {
    const ctx = makeCtx();
    ctx.fillStyle = "sentinel";
    expect(applyFill(ctx as unknown as CanvasRenderingContext2D, { type: "none" })).toBe(false);
    expect(ctx.fillStyle).toBe("sentinel");
  });
});

describe("applyStroke", () => {
  const stroke = (paint: Paint): Stroke => ({
    paint,
    width: 4,
    cap: "round",
    join: "bevel",
    miterLimit: 8,
    dash: [2, 3],
    dashOffset: 1,
    align: "center",
  });

  it("returns false for a null stroke", () => {
    const ctx = makeCtx();
    expect(applyStroke(ctx as unknown as CanvasRenderingContext2D, null)).toBe(false);
  });

  it("applies width, cap, join, dash, and style for a Stroke object", () => {
    const ctx = makeCtx();
    expect(applyStroke(ctx as unknown as CanvasRenderingContext2D, stroke(solid(9, 9, 9)))).toBe(true);
    expect(ctx.lineWidth).toBe(4);
    expect(ctx.lineCap).toBe("round");
    expect(ctx.lineJoin).toBe("bevel");
    expect(ctx.miterLimit).toBe(8);
    expect(ctx.setLineDash).toHaveBeenCalledWith([2, 3]);
    expect(ctx.lineDashOffset).toBe(1);
    expect(ctx.strokeStyle).toBe("rgba(9, 9, 9, 1)");
  });

  it("sets only strokeStyle for a bare Paint overload", () => {
    const ctx = makeCtx();
    expect(applyStroke(ctx as unknown as CanvasRenderingContext2D, solid(5, 6, 7))).toBe(true);
    expect(ctx.strokeStyle).toBe("rgba(5, 6, 7, 1)");
    // Line properties are left at their defaults (not touched by the Paint overload).
    expect(ctx.setLineDash).not.toHaveBeenCalled();
    expect(ctx.lineWidth).toBe(0);
  });

  it("returns false when the stroke paint is none", () => {
    const ctx = makeCtx();
    expect(applyStroke(ctx as unknown as CanvasRenderingContext2D, stroke({ type: "none" }))).toBe(false);
  });
});
