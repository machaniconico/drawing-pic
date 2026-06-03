import { documentToPngBlob } from "../io/pngExport";
import { documentToSvg } from "../io/svgExport";
import { useEditorStore } from "../state/store";
import "./ExportMenu.css";

const downloadBlob = (blob: Blob, filename: string): void => {
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  document.body.append(link);
  link.click();
  link.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 0);
};

const exportFileName = (name: string, extension: "svg" | "png"): string => {
  const base = name.trim().length > 0 ? name.trim() : "Untitled";
  return `${base.replace(/[\\/:*?"<>|]+/g, "-")}.${extension}`;
};

export function ExportMenu() {
  const doc = useEditorStore((state) => state.doc);

  const handleSvgExport = (): void => {
    const svg = documentToSvg(doc);
    const blob = new Blob([svg], { type: "image/svg+xml" });
    downloadBlob(blob, exportFileName(doc.name, "svg"));
  };

  const handlePngExport = (): void => {
    void documentToPngBlob(doc)
      .then((blob) => {
        downloadBlob(blob, exportFileName(doc.name, "png"));
      })
      .catch((error: unknown) => {
        console.error("PNG export failed.", error);
      });
  };

  return (
    <div className="export-menu">
      <button className="export-menu__button" type="button" onClick={handleSvgExport}>
        Export SVG
      </button>
      <button className="export-menu__button" type="button" onClick={handlePngExport}>
        Export PNG
      </button>
    </div>
  );
}
