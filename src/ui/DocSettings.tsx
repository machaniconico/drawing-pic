import { useEffect, useState, type KeyboardEvent as ReactKeyboardEvent } from "react";
import { editorStore, useEditorStore } from "../state/store";
import "./DocSettings.css";

const formatDimension = (value: number): string =>
  Number.isFinite(value) ? String(Math.round(value * 100) / 100) : "";

interface CommitTextInputProps {
  readonly ariaLabel: string;
  readonly onCommit: (value: string) => void;
  readonly value: string;
}

function CommitTextInput({ ariaLabel, onCommit, value }: CommitTextInputProps) {
  const [draft, setDraft] = useState(value);

  useEffect(() => {
    setDraft(value);
  }, [value]);

  const commitDraft = (): void => {
    const nextValue = draft.trim();
    if (nextValue === "") {
      setDraft(value);
      return;
    }

    onCommit(nextValue);
    setDraft(nextValue);
  };

  const commitOnEnter = (event: ReactKeyboardEvent<HTMLInputElement>): void => {
    if (event.key === "Enter") {
      event.currentTarget.blur();
    }
  };

  return (
    <input
      aria-label={ariaLabel}
      className="doc-settings__input"
      onBlur={commitDraft}
      onChange={(event) => setDraft(event.currentTarget.value)}
      onKeyDown={commitOnEnter}
      type="text"
      value={draft}
    />
  );
}

interface CommitNumberInputProps {
  readonly ariaLabel: string;
  readonly onCommit: (value: number) => void;
  readonly value: number;
}

function CommitNumberInput({ ariaLabel, onCommit, value }: CommitNumberInputProps) {
  const formattedValue = formatDimension(value);
  const [draft, setDraft] = useState(formattedValue);

  useEffect(() => {
    setDraft(formattedValue);
  }, [formattedValue]);

  const commitDraft = (): void => {
    const trimmedDraft = draft.trim();
    if (trimmedDraft === "") {
      setDraft(formattedValue);
      return;
    }

    const nextValue = Number(trimmedDraft);
    // Dimensions must be >= 1; invalid or sub-minimum entries fall back to the current
    // value rather than silently clamping to 1.
    if (!Number.isFinite(nextValue) || nextValue < 1) {
      setDraft(formattedValue);
      return;
    }

    onCommit(nextValue);
    setDraft(formatDimension(nextValue));
  };

  const commitOnEnter = (event: ReactKeyboardEvent<HTMLInputElement>): void => {
    if (event.key === "Enter") {
      event.currentTarget.blur();
    }
  };

  return (
    <input
      aria-label={ariaLabel}
      className="doc-settings__input doc-settings__input--number"
      min={1}
      onBlur={commitDraft}
      onChange={(event) => setDraft(event.currentTarget.value)}
      onKeyDown={commitOnEnter}
      step={1}
      type="number"
      value={draft}
    />
  );
}

export function DocSettings() {
  const doc = useEditorStore((state) => state.doc);
  const setDocumentName = useEditorStore((state) => state.setDocumentName);
  const setDocumentSize = useEditorStore((state) => state.setDocumentSize);

  const commitWidth = (width: number): void => {
    setDocumentSize(width, editorStore.getState().doc.height);
  };

  const commitHeight = (height: number): void => {
    setDocumentSize(editorStore.getState().doc.width, height);
  };

  return (
    <div className="doc-settings" aria-label="Document settings">
      <label className="doc-settings__field doc-settings__field--name">
        <span className="doc-settings__label">Name</span>
        <CommitTextInput
          ariaLabel="Document name"
          value={doc.name}
          onCommit={setDocumentName}
        />
      </label>

      <div className="doc-settings__size-grid" aria-label="Document size">
        <label className="doc-settings__field">
          <span className="doc-settings__label">Width</span>
          <CommitNumberInput
            ariaLabel="Document width"
            value={doc.width}
            onCommit={commitWidth}
          />
        </label>
        <label className="doc-settings__field">
          <span className="doc-settings__label">Height</span>
          <CommitNumberInput
            ariaLabel="Document height"
            value={doc.height}
            onCommit={commitHeight}
          />
        </label>
      </div>
    </div>
  );
}
