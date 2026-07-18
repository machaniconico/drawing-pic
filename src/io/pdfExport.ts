import type { Document } from "../core/model/types";
import {
  renderDocumentToCanvas,
  type PngExportOptions,
} from "./pngExport";

export type PdfExportOptions = PngExportOptions;

const encoder = new TextEncoder();

const encode = (value: string): Uint8Array => encoder.encode(value);

const concatBytes = (parts: readonly Uint8Array[]): Uint8Array => {
  const length = parts.reduce((total, part) => total + part.byteLength, 0);
  const result = new Uint8Array(length);
  let offset = 0;

  for (const part of parts) {
    result.set(part, offset);
    offset += part.byteLength;
  }

  return result;
};

const pdfNumber = (value: number): string => {
  const rounded = Math.round(value * 1_000_000) / 1_000_000;
  return Number.isInteger(rounded)
    ? rounded.toString()
    : rounded.toFixed(6).replace(/0+$/, "");
};

const canvasToJpegBlob = (canvas: HTMLCanvasElement): Promise<Blob> =>
  new Promise((resolve, reject) => {
    if (typeof canvas.toBlob !== "function") {
      reject(new Error("PDF export requires HTMLCanvasElement.toBlob."));
      return;
    }

    try {
      canvas.toBlob((blob) => {
        if (blob === null) {
          reject(new Error("PDF export failed while encoding JPEG."));
          return;
        }

        resolve(blob);
      }, "image/jpeg");
    } catch (error) {
      reject(error);
    }
  });

const indirectObject = (id: number, body: Uint8Array): Uint8Array =>
  concatBytes([
    encode(`${id} 0 obj\n`),
    body,
    encode("\nendobj\n"),
  ]);

const buildSinglePagePdf = (
  jpegBytes: Uint8Array,
  pixelWidth: number,
  pixelHeight: number,
  pageWidth: number,
  pageHeight: number,
): Uint8Array => {
  const width = pdfNumber(pageWidth);
  const height = pdfNumber(pageHeight);
  const content = encode(`q\n${width} 0 0 ${height} 0 0 cm\n/Im0 Do\nQ`);
  const objects = [
    indirectObject(1, encode("<< /Type /Catalog /Pages 2 0 R >>")),
    indirectObject(2, encode("<< /Type /Pages /Kids [3 0 R] /Count 1 >>")),
    indirectObject(
      3,
      encode(
        `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${width} ${height}] `
          + "/Resources << /XObject << /Im0 5 0 R >> >> /Contents 4 0 R >>",
      ),
    ),
    indirectObject(
      4,
      concatBytes([
        encode(`<< /Length ${content.byteLength} >>\nstream\n`),
        content,
        encode("\nendstream"),
      ]),
    ),
    indirectObject(
      5,
      concatBytes([
        encode(
          `<< /Type /XObject /Subtype /Image /Width ${pixelWidth} /Height ${pixelHeight} `
            + `/ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length ${jpegBytes.byteLength} >>\nstream\n`,
        ),
        jpegBytes,
        encode("\nendstream"),
      ]),
    ),
  ];

  const header = concatBytes([
    encode("%PDF-1.4\n%"),
    new Uint8Array([0xe2, 0xe3, 0xcf, 0xd3]),
    encode("\n"),
  ]);
  const offsets: number[] = [];
  let nextOffset = header.byteLength;

  for (const object of objects) {
    offsets.push(nextOffset);
    nextOffset += object.byteLength;
  }

  const xrefOffset = nextOffset;
  const xrefEntries = offsets
    .map((offset) => `${offset.toString().padStart(10, "0")} 00000 n \n`)
    .join("");
  const trailer = encode(
    "xref\n0 6\n"
      + "0000000000 65535 f \n"
      + xrefEntries
      + "trailer\n<< /Size 6 /Root 1 0 R >>\n"
      + `startxref\n${xrefOffset}\n%%EOF\n`,
  );

  return concatBytes([header, ...objects, trailer]);
};

/**
 * Produces a raster-backed, single-page PDF. Vector PDF output is intentionally
 * out of scope; the shared canvas renderer remains the source of visual parity.
 */
export const documentToPdfBlob = async (
  doc: Document,
  opts?: PdfExportOptions,
): Promise<Blob> => {
  const canvas = renderDocumentToCanvas(doc, {
    scale: opts?.scale,
    nodeIds: opts?.nodeIds,
    opaqueBackground: true,
  });
  const jpegBlob = await canvasToJpegBlob(canvas);
  const jpegBytes = new Uint8Array(await jpegBlob.arrayBuffer());
  const pdfBytes = buildSinglePagePdf(
    jpegBytes,
    canvas.width,
    canvas.height,
    canvas.width,
    canvas.height,
  );

  return new Blob([new Uint8Array(pdfBytes).buffer], { type: "application/pdf" });
};
