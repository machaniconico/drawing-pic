import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { IDENTITY } from "../core/geometry/matrix";
import { fileToImageNode, dataUrlDimensions } from "./imageImport";

const encodedPng = "data:image/png;base64,ZmFrZS1pbWFnZQ==";

class MockFileReader {
  result: string | ArrayBuffer | null = null;
  error: DOMException | null = null;
  onload: ((event: ProgressEvent<FileReader>) => void) | null = null;
  onerror: ((event: ProgressEvent<FileReader>) => void) | null = null;

  readAsDataURL(file: Blob): void {
    void file.text().then((text) => {
      this.result = `data:${file.type};base64,${btoa(text)}`;
      this.onload?.({} as ProgressEvent<FileReader>);
    });
  }
}

class MockImage {
  onload: (() => void) | null = null;
  onerror: (() => void) | null = null;
  naturalWidth = 0;
  naturalHeight = 0;
  private currentSrc = "";

  get src(): string {
    return this.currentSrc;
  }

  set src(value: string) {
    this.currentSrc = value;
    const dimensions = imageDimensionsBySrc.get(value);

    if (!dimensions) {
      queueMicrotask(() => this.onerror?.());
      return;
    }

    this.naturalWidth = dimensions.width;
    this.naturalHeight = dimensions.height;
    queueMicrotask(() => this.onload?.());
  }
}

const imageDimensionsBySrc = new Map<string, { width: number; height: number }>();

describe("image import", () => {
  beforeEach(() => {
    imageDimensionsBySrc.clear();
    vi.stubGlobal("FileReader", MockFileReader);
    vi.stubGlobal("Image", MockImage);
    vi.stubGlobal("crypto", {
      randomUUID: vi.fn(() => "image-id-1"),
    });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("reads a file as a data URL before creating the image node", async () => {
    const file = new File(["fake-image"], "fake.png", { type: "image/png" });
    imageDimensionsBySrc.set(encodedPng, { width: 640, height: 480 });

    await expect(fileToImageNode(file)).resolves.toMatchObject({
      src: encodedPng,
      width: 640,
      height: 480,
    });
  });

  it("parses dimensions from a data URL with Image natural size", async () => {
    imageDimensionsBySrc.set(encodedPng, { width: 320, height: 240 });

    await expect(dataUrlDimensions(encodedPng)).resolves.toEqual({
      width: 320,
      height: 240,
    });
  });

  it("returns an ImageNode with factory defaults and imported dimensions", async () => {
    const file = new File(["fake-image"], "fake.png", { type: "image/png" });
    imageDimensionsBySrc.set(encodedPng, { width: 1024, height: 768 });

    await expect(fileToImageNode(file)).resolves.toEqual({
      id: "image-id-1",
      name: "Image",
      type: "image",
      transform: IDENTITY,
      opacity: 1,
      visible: true,
      locked: false,
      src: encodedPng,
      width: 1024,
      height: 768,
    });
  });
});
