import { useRef, type ChangeEvent } from "react";
import { fileToImageNode } from "../io/imageImport";
import { editorStore } from "../state/store";
import "./ImportButton.css";

export function ImportButton() {
  const inputRef = useRef<HTMLInputElement>(null);

  const handleChange = (event: ChangeEvent<HTMLInputElement>): void => {
    const file = event.currentTarget.files?.[0];
    event.currentTarget.value = "";

    if (!file) {
      return;
    }

    void fileToImageNode(file)
      .then((node) => {
        const state = editorStore.getState();
        state.addNode(node);
        state.setSelection([node.id]);
      })
      .catch((error: unknown) => {
        console.error("Image import failed.", error);
      });
  };

  return (
    <label className="import-button">
      <span className="import-button__label">Import Image</span>
      <input
        ref={inputRef}
        className="import-button__input"
        type="file"
        accept="image/*"
        onChange={handleChange}
      />
    </label>
  );
}
