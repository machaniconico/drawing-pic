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

describe("raster export", () => {
  const toBlob = vi.fn();
  const context = {
    save: vi.fn(),
    restore: vi.fn(),
    setTransform: vi.fn(),
    clearRect: vi.fn(),
    translate: vi.fn(),
    transform: vi.fn(),
    beginPath: vi.fn(),
    rect: vi.fn(),
    fill: vi.fn(),
    fillRect: vi.fn(),
    strokeRect: vi.fn(),
    globalAlpha: 1,
    globalCompositeOperation: "source-over",
    fillStyle: "#000000",
    strokeStyle: "#000000",
    lineWidth: 1,
    shadowColor: "rgba(0, 0, 0, 0)",
    shadowBlur: 0,
    shadowOffsetX: 0,
    shadowOffsetY: 0,
  };
  const canvas = {
    width: 0,
    height: 0,
    style: { width: "", height: "" },
    getContext: vi.fn(() => context),
    toBlob,
  };
  Object.assign(context, { canvas });

  beforeEach(() => {
    vi.stubGlobal("document", {
      createElement: vi.fn(() => canvas),
    });
    toBlob.mockReset();
    context.save.mockClear();
    context.restore.mockClear();
    context.setTransform.mockClear();
    context.clearRect.mockClear();
    context.translate.mockClear();
    context.transform.mockClear();
    context.beginPath.mockClear();
    context.rect.mockClear();
    context.fill.mockClear();
    context.fillRect.mockClear();
    context.strokeRect.mockClear();
    context.globalAlpha = 1;
    context.globalCompositeOperation = "source-over";
    context.fillStyle = "#000000";
    context.strokeStyle = "#000000";
    context.lineWidth = 1;
    context.shadowColor = "rgba(0, 0, 0, 0)";
    context.shadowBlur = 0;
    context.shadowOffsetX = 0;
    context.shadowOffsetY = 0;
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
    expect(context.fillRect).toHaveBeenCalledTimes(1);
    expect(context.globalCompositeOperation).toBe("source-over");
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
    expect(context.setTransform).toHaveBeenCalledWith(2, 0, 0, 2, -20, -40);
    expect(context.globalCompositeOperation).toBe("source-over");
  });

  it("keeps active-artboard rebasing on the shared canvas path", async () => {
    const doc = createDocument(40, 30);
    doc.artboards = [
      { id: "first", name: "First", x: 0, y: 0, width: 100, height: 80 },
      { id: "active", name: "Active", x: 120, y: 25, width: 40, height: 30 },
    ];
    doc.activeArtboardId = "active";
    toBlob.mockImplementation((callback: BlobCallback) => callback(new Blob([])));

    await documentToPngBlob(doc);

    expect(canvas.width).toBe(40);
    expect(canvas.height).toBe(30);
    expect(context.setTransform).toHaveBeenCalledWith(1, 0, 0, 1, -120, -25);
    expect(context.translate).toHaveBeenCalledWith(120, 25);
    expect(context.translate).not.toHaveBeenCalledWith(0, 0);
  });

  it("skips artboard chrome during export without changing editor canvas rendering", async () => {
    const doc = createDocument(100, 80);
    toBlob.mockImplementation((callback: BlobCallback) => callback(new Blob([])));

    await documentToPngBlob(doc);

    expect(context.fillRect).toHaveBeenCalledWith(0, 0, 100, 80);
    expect(context.strokeRect).not.toHaveBeenCalled();
    expect(context.shadowBlur).toBe(0);

    renderDocument(context as unknown as CanvasRenderingContext2D, doc, { zoom: 1 });

    expect(context.strokeRect).toHaveBeenCalledTimes(1);
    expect(context.shadowBlur).toBe(18);
  });
});
