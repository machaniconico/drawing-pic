import type { Document } from "../core/model/types";
import {
  renderDocumentToCanvas,
  type PngExportOptions,
} from "./pngExport";

export type RasterExportFormat = "jpeg" | "webp";

export interface RasterExportOptions extends PngExportOptions {
  format: RasterExportFormat;
  quality?: number;
}

const mimeTypes: Record<RasterExportFormat, string> = {
  jpeg: "image/jpeg",
  webp: "image/webp",
};

const normalizedQuality = (quality: number | undefined): number | undefined => {
  if (quality === undefined || !Number.isFinite(quality)) return undefined;
  return Math.min(1, Math.max(0, quality));
};

export const documentToRasterBlob = (
  doc: Document,
  opts: RasterExportOptions,
): Promise<Blob> =>
  new Promise((resolve, reject) => {
    let canvas: HTMLCanvasElement;

    try {
      canvas = renderDocumentToCanvas(doc, {
        scale: opts.scale,
        nodeIds: opts.nodeIds,
        opaqueBackground: opts.format === "jpeg",
      });
    } catch (error) {
      reject(error);
      return;
    }

    if (typeof canvas.toBlob !== "function") {
      reject(new Error(`${opts.format.toUpperCase()} export requires HTMLCanvasElement.toBlob.`));
      return;
    }

    const mimeType = mimeTypes[opts.format];
    canvas.toBlob(
      (blob) => {
        if (blob === null) {
          reject(new Error(`${opts.format.toUpperCase()} export failed.`));
          return;
        }

        resolve(blob);
      },
      mimeType,
      normalizedQuality(opts.quality),
    );
  });

export const documentToJpegBlob = (
  doc: Document,
  opts?: Omit<RasterExportOptions, "format">,
): Promise<Blob> => documentToRasterBlob(doc, { ...opts, format: "jpeg" });

export const documentToWebpBlob = (
  doc: Document,
  opts?: Omit<RasterExportOptions, "format">,
): Promise<Blob> => documentToRasterBlob(doc, { ...opts, format: "webp" });
