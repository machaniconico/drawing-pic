import { isEmpty, transform as transformBBox, unionAll, type BBox } from "../core/geometry/bbox";
import { compose, IDENTITY, type Matrix } from "../core/geometry/matrix";
import { localBounds } from "../core/model/bounds";
import type { Document, NodeId, PatternPaint, SceneNode } from "../core/model/types";
import type { PatternPaintResolver } from "./paint";

export interface PatternTileRect {
  x: number;
  y: number;
  w: number;
  h: number;
}

export type RenderPatternSubtree = (
  ctx: CanvasRenderingContext2D,
  sourceId: NodeId,
  resolvePattern?: PatternPaintResolver,
) => void;

interface NodeWithWorldTransform {
  node: SceneNode;
  worldTransform: Matrix;
}

const findNodeWithWorldTransform = (
  doc: Document,
  sourceId: NodeId,
): NodeWithWorldTransform | null => {
  const visit = (nodeId: NodeId, parentTransform: Matrix): NodeWithWorldTransform | null => {
    const node = doc.nodes[nodeId];
    if (node === undefined) return null;

    const worldTransform = compose(parentTransform, node.transform);
    if (node.id === sourceId) {
      return { node, worldTransform };
    }

    if (node.type === "layer" || node.type === "group") {
      for (const childId of node.children) {
        const found = visit(childId, worldTransform);
        if (found !== null) return found;
      }
    }

    return null;
  };

  for (const layerId of doc.layerOrder) {
    const found = visit(layerId, IDENTITY);
    if (found !== null) return found;
  }

  return null;
};

const subtreeWorldBounds = (
  doc: Document,
  node: SceneNode,
  worldTransform: Matrix,
  isRoot: boolean,
): BBox => {
  if (!isRoot && !node.visible) return unionAll([]);

  if (node.type === "layer") return unionAll([]);

  if (node.type === "group") {
    return unionAll(
      node.children.flatMap((childId) => {
        const child = doc.nodes[childId];
        if (child === undefined || !child.visible) return [];

        return [
          subtreeWorldBounds(doc, child, compose(worldTransform, child.transform), false),
        ];
      }),
    );
  }

  return transformBBox(localBounds(node), worldTransform);
};

const rectFromBounds = (bounds: BBox): PatternTileRect | null => {
  if (isEmpty(bounds)) return null;

  const w = bounds.maxX - bounds.minX;
  const h = bounds.maxY - bounds.minY;
  if (!Number.isFinite(w) || !Number.isFinite(h) || w <= 0 || h <= 0) return null;

  return { x: bounds.minX, y: bounds.minY, w, h };
};

export const patternTileRect = (doc: Document, sourceId: NodeId): PatternTileRect | null => {
  const source = findNodeWithWorldTransform(doc, sourceId);
  if (source === null || source.node.type === "layer") return null;

  return rectFromBounds(subtreeWorldBounds(doc, source.node, source.worldTransform, true));
};

export const patternTileScale = (rect: PatternTileRect, maxSide = 2048): number => {
  const largerSide = Math.max(rect.w, rect.h);
  if (!Number.isFinite(largerSide) || largerSide <= 0) return 1;
  if (!Number.isFinite(maxSide) || maxSide <= 0) return 1;

  return Math.min(1, maxSide / largerSide);
};

const createTileCanvas = (
  width: number,
  height: number,
): HTMLCanvasElement | OffscreenCanvas | null => {
  if (typeof OffscreenCanvas !== "undefined") {
    return new OffscreenCanvas(width, height);
  }

  if (typeof document === "undefined") return null;

  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  return canvas;
};

const patternTransform = (paint: PatternPaint, rect: PatternTileRect): DOMMatrix => {
  const transform = new DOMMatrix();
  transform.translateSelf(rect.x, rect.y);
  transform.rotateSelf((paint.rotation * 180) / Math.PI);
  transform.scaleSelf(paint.scale);
  return transform;
};

export const createPatternResolver = (
  ctx: CanvasRenderingContext2D,
  doc: Document,
  renderSubtree: RenderPatternSubtree,
): PatternPaintResolver => {
  // setTransform 済み CanvasPattern を持つため、キーには scale/rotation も含める。
  const cache = new Map<string, CanvasPattern | null>();

  return (paint) => {
    const cacheKey = `${paint.sourceId}|${paint.scale}|${paint.rotation}`;
    const cached = cache.get(cacheKey);
    if (cached !== undefined) return cached;

    const rect = patternTileRect(doc, paint.sourceId);
    if (rect === null) {
      cache.set(cacheKey, null);
      return null;
    }

    const tileScale = patternTileScale(rect);
    const tileWidth = Math.max(1, Math.ceil(rect.w * tileScale));
    const tileHeight = Math.max(1, Math.ceil(rect.h * tileScale));
    const tile = createTileCanvas(tileWidth, tileHeight);
    if (tile === null) {
      cache.set(cacheKey, null);
      return null;
    }

    const tileCtx = tile.getContext("2d");
    if (tileCtx === null) {
      cache.set(cacheKey, null);
      return null;
    }

    const renderCtx = tileCtx as unknown as CanvasRenderingContext2D;
    renderCtx.save();
    renderCtx.setTransform(tileScale, 0, 0, tileScale, -rect.x * tileScale, -rect.y * tileScale);
    renderSubtree(renderCtx, paint.sourceId, undefined);
    renderCtx.restore();

    const pattern = ctx.createPattern(tile, "repeat");
    if (pattern === null) {
      cache.set(cacheKey, null);
      return null;
    }

    pattern.setTransform(patternTransform(paint, rect));
    cache.set(cacheKey, pattern);
    return pattern;
  };
};
