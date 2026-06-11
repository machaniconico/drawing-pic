import type { Paint, RGBA, Stroke } from "../core/model/types";

const clamp = (value: number, min: number, max: number): number =>
  Math.min(max, Math.max(min, value));

const clampByte = (value: number): number => Math.round(clamp(value, 0, 255));

const clampAlpha = (value: number): number => clamp(value, 0, 1);

const clampOffset = (value: number): number => clamp(value, 0, 1);

export const rgbaToCss = ({ r, g, b, a }: RGBA): string =>
  `rgba(${clampByte(r)}, ${clampByte(g)}, ${clampByte(b)}, ${clampAlpha(a)})`;

const addStops = (gradient: CanvasGradient, paint: Extract<Paint, { stops: unknown }>): void => {
  for (const stop of paint.stops) {
    gradient.addColorStop(clampOffset(stop.offset), rgbaToCss(stop.color));
  }
};

const canvasStyleFromPaint = (
  ctx: CanvasRenderingContext2D,
  paint: Paint,
): CanvasGradient | string | null => {
  switch (paint.type) {
    case "none":
      return null;
    case "pattern":
      // パターン描画は US-116 で実装。未対応の間は none 扱い。
      return null;
    case "solid":
      return rgbaToCss(paint.color);
    case "linear": {
      const gradient = ctx.createLinearGradient(
        paint.start.x,
        paint.start.y,
        paint.end.x,
        paint.end.y,
      );
      addStops(gradient, paint);
      return gradient;
    }
    case "radial": {
      const gradient = ctx.createRadialGradient(
        paint.center.x,
        paint.center.y,
        0,
        paint.center.x,
        paint.center.y,
        Math.max(0, paint.radius),
      );
      addStops(gradient, paint);
      return gradient;
    }
  }
};

export const applyFill = (ctx: CanvasRenderingContext2D, paint: Paint): boolean => {
  const style = canvasStyleFromPaint(ctx, paint);
  if (style === null) return false;

  ctx.fillStyle = style;
  return true;
};

export function applyStroke(ctx: CanvasRenderingContext2D, stroke: Stroke | null): boolean;
export function applyStroke(ctx: CanvasRenderingContext2D, paint: Paint): boolean;
export function applyStroke(
  ctx: CanvasRenderingContext2D,
  strokeOrPaint: Stroke | Paint | null,
): boolean {
  if (strokeOrPaint === null) return false;

  const paint = "paint" in strokeOrPaint ? strokeOrPaint.paint : strokeOrPaint;
  const style = canvasStyleFromPaint(ctx, paint);
  if (style === null) return false;

  if ("paint" in strokeOrPaint) {
    ctx.lineWidth = strokeOrPaint.width;
    ctx.lineCap = strokeOrPaint.cap;
    ctx.lineJoin = strokeOrPaint.join;
    ctx.miterLimit = strokeOrPaint.miterLimit;
    ctx.setLineDash(strokeOrPaint.dash);
    ctx.lineDashOffset = strokeOrPaint.dashOffset;
  }

  ctx.strokeStyle = style;
  return true;
}
