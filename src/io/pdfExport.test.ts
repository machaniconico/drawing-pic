import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createDocument, createRect } from "../core/model/factory";
import { isContainer } from "../core/model/types";
import { documentToPdfBlob } from "./pdfExport";

describe("PDF export", () => {
  const jpegBytes = new Uint8Array([0xff, 0xd8, 0xff, 0xd9]);
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

  const pdfText = async (blob: Blob): Promise<string> =>
    new TextDecoder("latin1").decode(await blob.arrayBuffer());

  beforeEach(() => {
    vi.stubGlobal("document", {
      createElement: vi.fn(() => canvas),
    });
    toBlob.mockReset();
    toBlob.mockImplementation((callback: BlobCallback, type?: string) => {
      expect(type).toBe("image/jpeg");
      callback(new Blob([jpegBytes], { type: "image/jpeg" }));
    });
    for (const mock of [
      context.save,
      context.restore,
      context.setTransform,
      context.clearRect,
      context.translate,
      context.transform,
      context.beginPath,
      context.rect,
      context.fill,
      context.fillRect,
      context.strokeRect,
    ]) {
      mock.mockClear();
    }
    context.globalAlpha = 1;
    context.globalCompositeOperation = "source-over";
    context.fillStyle = "#000000";
    context.strokeStyle = "#000000";
    canvas.width = 0;
    canvas.height = 0;
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("wraps a canvas JPEG in a valid single-page PDF with byte-accurate xref entries", async () => {
    const blob = await documentToPdfBlob(createDocument(120, 80));
    const bytes = new Uint8Array(await blob.arrayBuffer());
    const text = new TextDecoder("latin1").decode(bytes);

    expect(blob.type).toBe("application/pdf");
    expect(text).toContain("%PDF-1.4");
    expect(text).toContain("/Type /Pages /Kids [3 0 R] /Count 1");
    expect(text).toContain("/MediaBox [0 0 120 80]");
    expect(text).toContain("/Subtype /Image /Width 120 /Height 80");
    expect(text).toContain("/Filter /DCTDecode /Length 4");
    expect(text).toContain("120 0 0 80 0 0 cm");
    expect(text).toContain("trailer\n<< /Size 6 /Root 1 0 R >>");

    const xrefOffset = text.indexOf("xref\n0 6\n");
    expect(xrefOffset).toBeGreaterThan(0);
    expect(text).toContain(`startxref\n${xrefOffset}\n%%EOF`);

    const entries = text
      .slice(xrefOffset)
      .match(/(\d{10}) 00000 n/g)
      ?.map((entry) => Number(entry.slice(0, 10)));
    expect(entries).toEqual([1, 2, 3, 4, 5].map((id) => text.indexOf(`${id} 0 obj\n`)));
  });

  it("uses the scaled active artboard dimensions as page points at 72 dpi", async () => {
    const doc = createDocument(600, 400);
    doc.artboards = [
      { id: "first", name: "First", x: 0, y: 0, width: 600, height: 400 },
      { id: "active", name: "Active", x: 720, y: 25, width: 40, height: 30 },
    ];
    doc.activeArtboardId = "active";

    const blob = await documentToPdfBlob(doc, { scale: 2 });
    const text = await pdfText(blob);

    expect(canvas.width).toBe(80);
    expect(canvas.height).toBe(60);
    expect(text).toContain("/MediaBox [0 0 80 60]");
    expect(text).toContain("/Subtype /Image /Width 80 /Height 60");
    expect(context.setTransform).toHaveBeenCalledWith(2, 0, 0, 2, -1440, -50);
    expect(context.strokeRect).not.toHaveBeenCalled();
  });

  it("uses the existing selection-only crop and scale for the PDF page", async () => {
    const doc = createDocument(200, 150);
    const layerId = doc.layerOrder[0];
    const layer = layerId === undefined ? undefined : doc.nodes[layerId];
    const rect = createRect(10, 20, 30, 40);
    rect.stroke = null;
    if (layer === undefined || !isContainer(layer)) throw new Error("Expected root layer.");
    layer.children.push(rect.id);
    doc.nodes[rect.id] = rect;

    const blob = await documentToPdfBlob(doc, { nodeIds: [rect.id], scale: 2 });
    const text = await pdfText(blob);

    expect(canvas.width).toBe(60);
    expect(canvas.height).toBe(80);
    expect(text).toContain("/MediaBox [0 0 60 80]");
    expect(text).toContain("/Subtype /Image /Width 60 /Height 80");
    expect(context.setTransform).toHaveBeenCalledWith(2, 0, 0, 2, -20, -40);
  });

  it("rejects when canvas JPEG encoding fails", async () => {
    toBlob.mockImplementation((callback: BlobCallback) => callback(null));

    await expect(documentToPdfBlob(createDocument(10, 10))).rejects.toThrow(
      "PDF export failed while encoding JPEG.",
    );
  });
});
