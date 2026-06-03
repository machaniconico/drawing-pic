import type { Document } from "../core/model/types";
import { renderDocument } from "../render/canvasRenderer";

export const documentToPngBlob = (doc: Document): Promise<Blob> =>
  new Promise((resolve, reject) => {
    const canvas = document.createElement("canvas");
    canvas.width = doc.width;
    canvas.height = doc.height;

    const ctx = canvas.getContext("2d");
    if (ctx === null) {
      reject(new Error("Canvas 2D context is unavailable."));
      return;
    }

    renderDocument(ctx, doc, { pan: { x: 0, y: 0 }, zoom: 1 });

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
