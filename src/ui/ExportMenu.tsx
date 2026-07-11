import { useRef, useState } from "react";
import { deserializeDocument, serializeDocument } from "../io/docSerialize";
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

const exportFileName = (name: string, extension: "svg" | "png" | "json"): string => {
  const base = name.trim().length > 0 ? name.trim() : "Untitled";
  return `${base.replace(/[\\/:*?"<>|]+/g, "-")}.${extension}`;
};

export function ExportMenu() {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [scale, setScale] = useState(1);
  const [selectionOnly, setSelectionOnly] = useState(false);
  const doc = useEditorStore((state) => state.doc);
  const selection = useEditorStore((state) => state.selection);
  const loadDocument = useEditorStore((state) => state.loadDocument);
  const selectedNodeIds = selectionOnly && selection.length > 0 ? selection : undefined;
  const exportOptions = { scale, nodeIds: selectedNodeIds };

  const handleSvgExport = (): void => {
    const svg = documentToSvg(doc, exportOptions);
    const blob = new Blob([svg], { type: "image/svg+xml" });
    downloadBlob(blob, exportFileName(doc.name, "svg"));
  };

  const handleCopySvg = (): void => {
    const svg = documentToSvg(doc, exportOptions);
    void navigator.clipboard?.writeText(svg).catch((error: unknown) => {
      console.error("Copy SVG to clipboard failed.", error);
      window.alert("Could not copy SVG to the clipboard.");
    });
  };

  const handlePngExport = (): void => {
    void documentToPngBlob(doc, exportOptions)
      .then((blob) => {
        downloadBlob(blob, exportFileName(doc.name, "png"));
      })
      .catch((error: unknown) => {
        console.error("PNG export failed.", error);
      });
  };

  const handleJsonSave = (): void => {
    const json = serializeDocument(doc);
    const blob = new Blob([json], { type: "application/json" });
    downloadBlob(blob, exportFileName(doc.name, "json"));
  };

  const handleJsonOpen = (): void => {
    fileInputRef.current?.click();
  };

  const handleScaleChange = (event: React.ChangeEvent<HTMLInputElement>): void => {
    const nextScale = event.currentTarget.valueAsNumber;
    setScale(Number.isFinite(nextScale) ? Math.max(0.1, nextScale) : 1);
  };

  const handleJsonFileChange = (event: React.ChangeEvent<HTMLInputElement>): void => {
    const file = event.currentTarget.files?.[0];
    event.currentTarget.value = "";
    if (!file) {
      return;
    }

    void file
      .text()
      .then((text) => {
        loadDocument(deserializeDocument(text));
      })
      .catch((error: unknown) => {
        const message = error instanceof Error ? error.message : "Unknown file error";
        window.alert(`Could not open document JSON: ${message}`);
        console.error("JSON document open failed.", error);
      });
  };

  return (
    <div className="export-menu">
      <button className="export-menu__button" type="button" onClick={handleJsonSave}>
        Save (.json)
      </button>
      <button className="export-menu__button" type="button" onClick={handleJsonOpen}>
        Open (.json)
      </button>
      <label className="export-menu__field">
        <span className="export-menu__label">Scale</span>
        <input
          className="export-menu__number-input"
          type="number"
          min="0.1"
          step="0.25"
          value={scale}
          onChange={handleScaleChange}
        />
      </label>
      <label className="export-menu__checkbox">
        <input
          type="checkbox"
          checked={selectionOnly && selection.length > 0}
          disabled={selection.length === 0}
          onChange={(event) => setSelectionOnly(event.currentTarget.checked)}
        />
        <span>Selection only</span>
      </label>
      <input
        ref={fileInputRef}
        className="export-menu__file-input"
        type="file"
        accept=".json,application/json"
        onChange={handleJsonFileChange}
      />
      <button className="export-menu__button" type="button" onClick={handleSvgExport}>
        Export SVG
      </button>
      <button className="export-menu__button" type="button" onClick={handleCopySvg}>
        Copy SVG
      </button>
      <button className="export-menu__button" type="button" onClick={handlePngExport}>
        Export PNG
      </button>
    </div>
  );
}
