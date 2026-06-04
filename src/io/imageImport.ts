import { createImage } from "../core/model/factory";
import type { ImageNode } from "../core/model/types";

export const dataUrlDimensions = (dataUrl: string): Promise<{ width: number; height: number }> =>
  new Promise((resolve, reject) => {
    const image = new Image();

    image.onload = () => {
      resolve({ width: image.naturalWidth, height: image.naturalHeight });
    };

    image.onerror = () => {
      reject(new Error("Failed to load image data URL."));
    };

    image.src = dataUrl;
  });

const fileToDataUrl = (file: File): Promise<string> =>
  new Promise((resolve, reject) => {
    const reader = new FileReader();

    reader.onload = () => {
      if (typeof reader.result === "string") {
        resolve(reader.result);
        return;
      }

      reject(new Error("FileReader did not produce a data URL."));
    };

    reader.onerror = () => {
      reject(reader.error ?? new Error("Failed to read image file."));
    };

    reader.readAsDataURL(file);
  });

export const fileToImageNode = async (file: File): Promise<ImageNode> => {
  const dataUrl = await fileToDataUrl(file);
  const { width, height } = await dataUrlDimensions(dataUrl);

  return createImage(dataUrl, width, height);
};
