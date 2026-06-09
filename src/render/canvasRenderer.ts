import { toCanvasArgs } from "../core/geometry/matrix";
import type { Vec2 } from "../core/geometry/vector";
import type {
  Document,
  EllipseNode,
  ImageNode,
  Paint,
  PathNode,
  RGBA,
  RectNode,
  SceneNode,
  Stroke,
  TextNode,
} from "../core/model/types";
import { applyFill, applyStroke } from "./paint";

export interface Viewport {
  zoom: number;
  x?: number;
  y?: number;
  pan?: Vec2;
  panX?: number;
  panY?: number;
  onImageLoad?: () => void;
}

interface ImageCacheEntry {
  image: HTMLImageElement;
  loaded: boolean;
}

const imageCache = new Map<string, ImageCacheEntry>();

const viewportPan = (viewport: Viewport): Vec2 => ({
  x: viewport.pan?.x ?? viewport.panX ?? viewport.x ?? 0,
  y: viewport.pan?.y ?? viewport.panY ?? viewport.y ?? 0,
});

const clamp = (value: number, min: number, max: number): number =>
  Math.min(max, Math.max(min, value));

const artboardFill = (background: RGBA | null | undefined): string => {
  if (background === null || background === undefined) return "#ffffff";

  return `rgba(${clamp(Math.round(background.r), 0, 255)}, ${clamp(
    Math.round(background.g),
    0,
    255,
  )}, ${clamp(Math.round(background.b), 0, 255)}, ${clamp(background.a, 0, 1)})`;
};

const drawArtboard = (
  ctx: CanvasRenderingContext2D,
  width: number,
  height: number,
  background: RGBA | null | undefined,
): void => {
  ctx.save();
  ctx.shadowColor = "rgba(15, 23, 42, 0.18)";
  ctx.shadowBlur = 18;
  ctx.shadowOffsetX = 0;
  ctx.shadowOffsetY = 6;
  ctx.fillStyle = artboardFill(background);
  ctx.fillRect(0, 0, width, height);
  ctx.restore();

  ctx.save();
  ctx.strokeStyle = "rgba(15, 23, 42, 0.22)";
  ctx.lineWidth = 1;
  ctx.strokeRect(0.5, 0.5, Math.max(0, width - 1), Math.max(0, height - 1));
  ctx.restore();
};

const roundedRectPath = (ctx: CanvasRenderingContext2D, node: RectNode): void => {
  const width = node.width;
  const height = node.height;
  const rx = Math.min(Math.abs(node.rx), Math.abs(width) / 2);
  const ry = Math.min(Math.abs(node.ry), Math.abs(height) / 2);

  ctx.beginPath();
  if (rx === 0 || ry === 0) {
    ctx.rect(0, 0, width, height);
    return;
  }

  ctx.moveTo(rx, 0);
  ctx.lineTo(width - rx, 0);
  ctx.ellipse(width - rx, ry, rx, ry, 0, -Math.PI / 2, 0);
  ctx.lineTo(width, height - ry);
  ctx.ellipse(width - rx, height - ry, rx, ry, 0, 0, Math.PI / 2);
  ctx.lineTo(rx, height);
  ctx.ellipse(rx, height - ry, rx, ry, 0, Math.PI / 2, Math.PI);
  ctx.lineTo(0, ry);
  ctx.ellipse(rx, ry, rx, ry, 0, Math.PI, (Math.PI * 3) / 2);
  ctx.closePath();
};

const ellipsePath = (ctx: CanvasRenderingContext2D, node: EllipseNode): void => {
  ctx.beginPath();
  ctx.ellipse(0, 0, Math.abs(node.rx), Math.abs(node.ry), 0, 0, Math.PI * 2);
  ctx.closePath();
};

const addPoint = (point: Vec2, handle: Vec2 | null): Vec2 =>
  handle === null ? point : { x: point.x + handle.x, y: point.y + handle.y };

const pathNodePath = (ctx: CanvasRenderingContext2D, node: PathNode): void => {
  ctx.beginPath();

  for (const subpath of node.subpaths) {
    const anchors = subpath.anchors;
    const first = anchors[0];
    if (first === undefined) continue;

    ctx.moveTo(first.point.x, first.point.y);

    for (let index = 0; index < anchors.length - 1; index += 1) {
      const current = anchors[index];
      const next = anchors[index + 1];
      if (current === undefined || next === undefined) continue;

      const cp1 = addPoint(current.point, current.handleOut);
      const cp2 = addPoint(next.point, next.handleIn);
      ctx.bezierCurveTo(cp1.x, cp1.y, cp2.x, cp2.y, next.point.x, next.point.y);
    }

    if (subpath.closed && anchors.length > 1) {
      const last = anchors[anchors.length - 1];
      if (last !== undefined) {
        const cp1 = addPoint(last.point, last.handleOut);
        const cp2 = addPoint(first.point, first.handleIn);
        ctx.bezierCurveTo(cp1.x, cp1.y, cp2.x, cp2.y, first.point.x, first.point.y);
      }
      ctx.closePath();
    }
  }
};

const paintCurrentPath = (
  ctx: CanvasRenderingContext2D,
  fill: Paint,
  stroke: Stroke | null,
): void => {
  if (applyFill(ctx, fill)) {
    ctx.fill();
  }

  // Canvas2D strokes paths on center only; inside/outside stroke alignment is approximated.
  if (applyStroke(ctx, stroke)) {
    ctx.stroke();
  }
};

const drawRect = (ctx: CanvasRenderingContext2D, node: RectNode): void => {
  roundedRectPath(ctx, node);
  paintCurrentPath(ctx, node.fill, node.stroke);
};

const drawEllipse = (ctx: CanvasRenderingContext2D, node: EllipseNode): void => {
  ellipsePath(ctx, node);
  paintCurrentPath(ctx, node.fill, node.stroke);
};

const drawPath = (ctx: CanvasRenderingContext2D, node: PathNode): void => {
  pathNodePath(ctx, node);
  paintCurrentPath(ctx, node.fill, node.stroke);
};

const configureText = (ctx: CanvasRenderingContext2D, node: TextNode): void => {
  const textContext = ctx as CanvasRenderingContext2D & { letterSpacing?: string };
  textContext.letterSpacing = `${node.letterSpacing}px`;
  ctx.font = `${node.fontStyle} ${node.fontWeight} ${node.fontSize}px ${node.fontFamily}`;
  ctx.textAlign = node.textAlign;
  ctx.textBaseline = "alphabetic";
};

const drawText = (ctx: CanvasRenderingContext2D, node: TextNode): void => {
  configureText(ctx, node);

  const lines = node.text.split(/\r\n|\r|\n/);
  const lineAdvance = node.fontSize * node.lineHeight;

  if (applyFill(ctx, node.fill)) {
    lines.forEach((line, index) => {
      ctx.fillText(line, 0, index * lineAdvance);
    });
  }

  if (applyStroke(ctx, node.stroke)) {
    lines.forEach((line, index) => {
      ctx.strokeText(line, 0, index * lineAdvance);
    });
  }
};

const getCachedImage = (node: ImageNode, onImageLoad?: () => void): ImageCacheEntry | null => {
  const cached = imageCache.get(node.src);
  if (cached !== undefined) return cached;
  if (typeof Image === "undefined") return null;

  const image = new Image();
  const entry: ImageCacheEntry = { image, loaded: false };
  image.onload = () => {
    entry.loaded = true;
    onImageLoad?.();
  };
  image.src = node.src;
  imageCache.set(node.src, entry);
  return entry;
};

const drawImage = (
  ctx: CanvasRenderingContext2D,
  node: ImageNode,
  onImageLoad?: () => void,
): void => {
  const entry = getCachedImage(node, onImageLoad);
  if (entry === null || !entry.loaded || entry.image.naturalWidth === 0) return;

  ctx.drawImage(entry.image, 0, 0, node.width, node.height);
};

const applyNodeCompositing = (ctx: CanvasRenderingContext2D, node: SceneNode): void => {
  ctx.globalAlpha *= node.opacity;
  if ("blendMode" in node) {
    ctx.globalCompositeOperation = node.blendMode;
  }
};

const drawNode = (
  ctx: CanvasRenderingContext2D,
  doc: Document,
  node: SceneNode,
  onImageLoad?: () => void,
): void => {
  if (!node.visible) return;

  ctx.save();
  ctx.transform(...toCanvasArgs(node.transform));
  applyNodeCompositing(ctx, node);

  switch (node.type) {
    case "layer":
    case "group":
      for (const childId of node.children) {
        const child = doc.nodes[childId];
        if (child !== undefined) {
          drawNode(ctx, doc, child, onImageLoad);
        }
      }
      break;
    case "rect":
      drawRect(ctx, node);
      break;
    case "ellipse":
      drawEllipse(ctx, node);
      break;
    case "path":
      drawPath(ctx, node);
      break;
    case "text":
      drawText(ctx, node);
      break;
    case "image":
      drawImage(ctx, node, onImageLoad);
      break;
  }

  ctx.restore();
};

export const renderDocument = (
  ctx: CanvasRenderingContext2D,
  doc: Document,
  viewport: Viewport,
): void => {
  const zoom = Number.isFinite(viewport.zoom) && viewport.zoom > 0 ? viewport.zoom : 1;
  const pan = viewportPan(viewport);

  ctx.save();
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.clearRect(0, 0, ctx.canvas.width, ctx.canvas.height);
  ctx.setTransform(zoom, 0, 0, zoom, pan.x, pan.y);

  drawArtboard(ctx, doc.width, doc.height, doc.background);

  for (const layerId of doc.layerOrder) {
    const layer = doc.nodes[layerId];
    if (layer !== undefined) {
      drawNode(ctx, doc, layer, viewport.onImageLoad);
    }
  }

  ctx.restore();
};
