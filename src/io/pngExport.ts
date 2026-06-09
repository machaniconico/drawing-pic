import {
  height as bboxHeight,
  isEmpty,
  width as bboxWidth,
  type BBox,
} from "../core/geometry/bbox";
import { selectionBounds } from "../core/model/bounds";
import type { Document, NodeId } from "../core/model/types";
import { renderDocument } from "../render/canvasRenderer";

export interface PngExportOptions {
  scale?: number;
  nodeIds?: readonly NodeId[];
}

const clamp = (value: number, min: number, max: number): number =>
  Math.min(max, Math.max(min, value));

const exportScale = (scale: number | undefined): number =>
  scale === undefined || !Number.isFinite(scale) ? 1 : clamp(scale, 0.01, 100);

const documentBounds = (doc: Document): BBox => ({
  minX: 0,
  minY: 0,
  maxX: doc.width,
  maxY: doc.height,
});

interface ExportCrop {
  bounds: BBox;
  isSelection: boolean;
}

const exportCrop = (doc: Document, nodeIds: readonly NodeId[] | undefined): ExportCrop => {
  if (nodeIds === undefined || nodeIds.length === 0) {
    return { bounds: documentBounds(doc), isSelection: false };
  }

  const bounds = selectionBounds(doc, nodeIds);
  return isEmpty(bounds)
    ? { bounds: documentBounds(doc), isSelection: false }
    : { bounds, isSelection: true };
};

const requireContext = (canvas: HTMLCanvasElement): CanvasRenderingContext2D => {
  const ctx = canvas.getContext("2d");
  if (ctx === null) {
    throw new Error("Canvas 2D context is unavailable.");
  }
  return ctx;
};

export const documentToPngBlob = (doc: Document, opts?: PngExportOptions): Promise<Blob> =>
  new Promise((resolve, reject) => {
    const canvas = document.createElement("canvas");
    const crop = exportCrop(doc, opts?.nodeIds);
    const bounds = crop.bounds;
    const scale = exportScale(opts?.scale);
    const cropWidth = bboxWidth(bounds);
    const cropHeight = bboxHeight(bounds);

    canvas.width = cropWidth * scale;
    canvas.height = cropHeight * scale;

    try {
      const ctx = requireContext(canvas);

      if (crop.isSelection) {
        const fullCanvas = document.createElement("canvas");
        fullCanvas.width = doc.width * scale;
        fullCanvas.height = doc.height * scale;
        const fullCtx = requireContext(fullCanvas);

        renderDocument(fullCtx, doc, { pan: { x: 0, y: 0 }, zoom: scale });
        ctx.drawImage(
          fullCanvas,
          bounds.minX * scale,
          bounds.minY * scale,
          cropWidth * scale,
          cropHeight * scale,
          0,
          0,
          cropWidth * scale,
          cropHeight * scale,
        );
      } else {
        renderDocument(ctx, doc, {
          pan: { x: -bounds.minX * scale, y: -bounds.minY * scale },
          zoom: scale,
        });
      }
    } catch (error) {
      reject(error);
      return;
    }

    if (typeof canvas.toBlob !== "function") {
      reject(new Error("PNG export requires HTMLCanvasElement.toBlob."));
      return;
    }

    canvas.toBlob((blob) => {
      if (blob === null) {
        reject(new Error("PNG export failed."));
        return;
      }

      resolve(blob);
    }, "image/png");
  });
