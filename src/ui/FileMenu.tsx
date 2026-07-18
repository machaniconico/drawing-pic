import { useRef, useState, type ChangeEvent } from "react";
import { deserializeDocument, serializeDocument } from "../io/docSerialize";
import { useEditorStore } from "../state/store";
import "./FileMenu.css";

const documentFileName = (name: string): string => {
  const base = name.trim() || "Untitled";
  return `${base.replace(/[\\/:*?"<>|]+/g, "-")}.json`;
};

const errorMessage = (error: unknown): string =>
  error instanceof Error ? error.message : "Unknown file error";

export function FileMenu() {
  const inputRef = useRef<HTMLInputElement>(null);
  const [openError, setOpenError] = useState<string | null>(null);
  const doc = useEditorStore((state) => state.doc);
  const loadDocument = useEditorStore((state) => state.loadDocument);

  const handleSave = (): void => {
    setOpenError(null);
    const blob = new Blob([serializeDocument(doc)], {
      type: "application/json",
    });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = documentFileName(doc.name);
    document.body.append(link);
    link.click();
    link.remove();
    window.setTimeout(() => URL.revokeObjectURL(url), 0);
  };

  const handleOpen = (): void => {
    setOpenError(null);
    inputRef.current?.click();
  };

  const handleFileChange = (event: ChangeEvent<HTMLInputElement>): void => {
    const file = event.currentTarget.files?.[0];
    event.currentTarget.value = "";
    if (!file) {
      return;
    }

    const reader = new FileReader();
    reader.onerror = () => {
      setOpenError(`Could not open document: ${errorMessage(reader.error)}`);
    };
    reader.onload = () => {
      try {
        if (typeof reader.result !== "string") {
          throw new Error("The selected file could not be read as text.");
        }

        const nextDocument = deserializeDocument(reader.result);
        loadDocument(nextDocument);
        setOpenError(null);
      } catch (error: unknown) {
        setOpenError(`Could not open document: ${errorMessage(error)}`);
      }
    };
    reader.readAsText(file);
  };

  return (
    <div className="file-menu" aria-label="Document file actions">
      <button className="file-menu__button" type="button" onClick={handleOpen}>
        Open
      </button>
      <button className="file-menu__button" type="button" onClick={handleSave}>
        Save
      </button>
      <input
        ref={inputRef}
        className="file-menu__input"
        type="file"
        accept=".json,application/json"
        onChange={handleFileChange}
      />
      {openError !== null ? (
        <span className="file-menu__error" role="alert" title={openError}>
          {openError}
        </span>
      ) : null}
    </div>
  );
}

export default FileMenu;
