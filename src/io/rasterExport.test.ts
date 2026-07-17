import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createDocument, createRect } from "../core/model/factory";
import { isContainer } from "../core/model/types";
import { renderDocument } from "../render/canvasRenderer";
import { documentToPngBlob } from "./pngExport";
import {
  documentToJpegBlob,
  documentToRasterBlob,
  documentToWebpBlob,
} from "./rasterExport";

vi.mock("../render/canvasRenderer", () => ({
  renderDocument: vi.fn(),
}));

describe("raster export", () => {
  const toBlob = vi.fn();
  const context = {
    save: vi.fn(),
    restore: vi.fn(),
    setTransform: vi.fn(),
    fillRect: vi.fn(),
    globalCompositeOperation: "source-over",
    fillStyle: "#000000",
  };
  const canvas = {
    width: 0,
    height: 0,
    getContext: vi.fn(() => context),
    toBlob,
  };

  beforeEach(() => {
    vi.stubGlobal("document", {
      createElement: vi.fn(() => canvas),
    });
    vi.mocked(renderDocument).mockClear();
    toBlob.mockReset();
    context.save.mockClear();
    context.restore.mockClear();
    context.setTransform.mockClear();
    context.fillRect.mockClear();
    context.globalCompositeOperation = "source-over";
    context.fillStyle = "#000000";
    canvas.width = 0;
    canvas.height = 0;
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("encodes JPEG with quality and an opaque white background", async () => {
    const doc = createDocument(120, 80);
    const blob = new Blob([], { type: "image/jpeg" });
    toBlob.mockImplementation((callback: BlobCallback, type?: string, quality?: number) => {
      expect(type).toBe("image/jpeg");
      expect(quality).toBe(0.75);
      callback(blob);
    });

    await expect(documentToJpegBlob(doc, { quality: 0.75 })).resolves.toBe(blob);
    expect(context.globalCompositeOperation).toBe("destination-over");
    expect(context.fillStyle).toBe("#ffffff");
    expect(context.fillRect).toHaveBeenCalledWith(0, 0, 120, 80);
  });

  it("uses the document background color when flattening JPEG transparency", async () => {
    const doc = createDocument(40, 30);
    doc.background = { r: 12, g: 34, b: 56, a: 0.25 };
    toBlob.mockImplementation((callback: BlobCallback) => callback(new Blob([])));

    await documentToRasterBlob(doc, { format: "jpeg", quality: 1 });

    expect(context.fillStyle).toBe("rgb(12, 34, 56)");
  });

  it("encodes WebP with quality without forcing an opaque background", async () => {
    const doc = createDocument(60, 50);
    const blob = new Blob([], { type: "image/webp" });
    toBlob.mockImplementation((callback: BlobCallback, type?: string, quality?: number) => {
      expect(type).toBe("image/webp");
      expect(quality).toBe(0.6);
      callback(blob);
    });

    await expect(documentToWebpBlob(doc, { quality: 0.6, scale: 2 })).resolves.toBe(blob);
    expect(canvas.width).toBe(120);
    expect(canvas.height).toBe(100);
    expect(context.fillRect).not.toHaveBeenCalled();
  });

  it("clamps quality to the canvas-supported range", async () => {
    const doc = createDocument(10, 10);
    toBlob.mockImplementation((callback: BlobCallback, _type?: string, quality?: number) => {
      expect(quality).toBe(1);
      callback(new Blob([]));
    });

    await documentToRasterBlob(doc, { format: "webp", quality: 2 });
  });

  it("keeps PNG selection-only cropping and scale on the shared canvas path", async () => {
    const doc = createDocument(200, 150);
    const layerId = doc.layerOrder[0];
    if (layerId === undefined) throw new Error("Expected a root layer id.");
    const layer = doc.nodes[layerId];
    const rect = createRect(10, 20, 30, 40);
    rect.stroke = null;
    if (layer === undefined || !isContainer(layer)) throw new Error("Expected root layer.");
    layer.children.push(rect.id);
    doc.nodes[rect.id] = rect;

    const blob = new Blob([], { type: "image/png" });
    toBlob.mockImplementation((callback: BlobCallback, type?: string) => {
      expect(type).toBe("image/png");
      callback(blob);
    });

    await expect(
      documentToPngBlob(doc, { nodeIds: [rect.id], scale: 2 }),
    ).resolves.toBe(blob);
    expect(canvas.width).toBe(60);
    expect(canvas.height).toBe(80);
    expect(renderDocument).toHaveBeenCalledWith(
      context,
      expect.objectContaining({ layerOrder: expect.any(Array) }),
      { pan: { x: -20, y: -40 }, zoom: 2 },
    );
    expect(context.fillRect).not.toHaveBeenCalled();
  });
});
