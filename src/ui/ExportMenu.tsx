import { useRef, useState } from "react";
import { deserializeDocument, serializeDocument } from "../io/docSerialize";
import { documentToPngBlob } from "../io/pngExport";
import {
  documentToRasterBlob,
  type RasterExportFormat,
} from "../io/rasterExport";
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

type ExportExtension = "svg" | "png" | "jpeg" | "webp" | "json";
type RasterFormat = "png" | RasterExportFormat;

const exportFileName = (name: string, extension: ExportExtension): string => {
  const base = name.trim().length > 0 ? name.trim() : "Untitled";
  return `${base.replace(/[\\/:*?"<>|]+/g, "-")}.${extension}`;
};

export function ExportMenu() {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [scale, setScale] = useState(1);
  const [selectionOnly, setSelectionOnly] = useState(false);
  const [rasterFormat, setRasterFormat] = useState<RasterFormat>("png");
  const [quality, setQuality] = useState(0.9);
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

  const handleRasterExport = (): void => {
    const blobPromise =
      rasterFormat === "png"
        ? documentToPngBlob(doc, exportOptions)
        : documentToRasterBlob(doc, {
            ...exportOptions,
            format: rasterFormat,
            quality,
          });

    void blobPromise
      .then((blob) => {
        downloadBlob(blob, exportFileName(doc.name, rasterFormat));
      })
      .catch((error: unknown) => {
        console.error(`${rasterFormat.toUpperCase()} export failed.`, error);
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

  const handleQualityChange = (event: React.ChangeEvent<HTMLInputElement>): void => {
    const nextQuality = event.currentTarget.valueAsNumber;
    setQuality(Number.isFinite(nextQuality) ? Math.min(1, Math.max(0, nextQuality)) : 0.9);
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
      <label className="export-menu__field">
        <span className="export-menu__label">Raster format</span>
        <select
          className="export-menu__select"
          value={rasterFormat}
          onChange={(event) => setRasterFormat(event.currentTarget.value as RasterFormat)}
        >
          <option value="png">PNG</option>
          <option value="jpeg">JPEG</option>
          <option value="webp">WebP</option>
        </select>
      </label>
      {rasterFormat !== "png" ? (
        <label className="export-menu__field export-menu__quality-field">
          <span className="export-menu__label">Quality</span>
          <span className="export-menu__quality-control">
            <input
              className="export-menu__range-input"
              type="range"
              min="0"
              max="1"
              step="0.01"
              value={quality}
              onChange={handleQualityChange}
            />
            <output>{Math.round(quality * 100)}%</output>
          </span>
        </label>
      ) : null}
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
      <button className="export-menu__button" type="button" onClick={handleRasterExport}>
        Export {rasterFormat === "jpeg" ? "JPEG" : rasterFormat === "webp" ? "WebP" : "PNG"}
      </button>
    </div>
  );
}
