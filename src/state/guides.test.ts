import { describe, expect, it } from "vitest";
import { createDocument } from "../core/model/factory";
import type { Document } from "../core/model/types";
import {
  addGuide,
  clearGuides,
  moveGuide,
  removeGuide,
  setGuideColor,
  setGuideHidden,
  setGuideLocked,
} from "./guides";
import { createEditorStateForTest, editorStore } from "./store";

const createGuideDocument = (): Document => ({
  ...createDocument(),
  guides: [
    { id: "guide-1", axis: "x", position: 100 },
    { id: "guide-2", axis: "y", position: 200 },
  ],
});

describe("guides", () => {
  it("adds a guide and returns its id", () => {
    const doc = createDocument();
    const result = addGuide(doc, "x", 42);

    expect(result.id).toBe(result.doc.guides[0]?.id);
    expect(result.doc.guides).toEqual([{ id: result.id, axis: "x", position: 42 }]);
    expect(result.doc).not.toBe(doc);
  });

  it("moves one guide without changing the others", () => {
    const doc = createGuideDocument();
    const next = moveGuide(doc, "guide-1", 150);

    expect(next.guides).toEqual([
      { id: "guide-1", axis: "x", position: 150 },
      { id: "guide-2", axis: "y", position: 200 },
    ]);
    expect(next.guides[1]).toBe(doc.guides[1]);
  });

  it("removes a guide", () => {
    const doc = createGuideDocument();
    const next = removeGuide(doc, "guide-1");

    expect(next.guides).toEqual([{ id: "guide-2", axis: "y", position: 200 }]);
  });

  it("sets guide preferences immutably", () => {
    const doc = createGuideDocument();

    const colored = setGuideColor(doc, "guide-1", "#00d8ff");
    const locked = setGuideLocked(colored, "guide-1", true);
    const hidden = setGuideHidden(locked, "guide-2", true);

    expect(colored).not.toBe(doc);
    expect(colored.guides).toEqual([
      { id: "guide-1", axis: "x", position: 100, color: "#00d8ff" },
      { id: "guide-2", axis: "y", position: 200 },
    ]);
    expect(locked.guides[0]).toEqual({ id: "guide-1", axis: "x", position: 100, color: "#00d8ff", locked: true });
    expect(hidden.guides[1]).toEqual({ id: "guide-2", axis: "y", position: 200, hidden: true });
    expect(doc.guides).toEqual([
      { id: "guide-1", axis: "x", position: 100 },
      { id: "guide-2", axis: "y", position: 200 },
    ]);
  });

  it("returns the same document when setting preferences for a missing guide", () => {
    const doc = createGuideDocument();

    expect(setGuideColor(doc, "missing-guide", "#00d8ff")).toBe(doc);
    expect(setGuideLocked(doc, "missing-guide", true)).toBe(doc);
    expect(setGuideHidden(doc, "missing-guide", true)).toBe(doc);
  });

  it("does not move or remove locked guides", () => {
    const doc: Document = {
      ...createGuideDocument(),
      guides: [
        { id: "guide-1", axis: "x", position: 100, locked: true },
        { id: "guide-2", axis: "y", position: 200 },
      ],
    };

    expect(moveGuide(doc, "guide-1", 150)).toBe(doc);
    expect(removeGuide(doc, "guide-1")).toBe(doc);
    expect(moveGuide(doc, "guide-2", 250).guides[1]).toEqual({ id: "guide-2", axis: "y", position: 250 });
  });

  it("clears all guides", () => {
    const doc = createGuideDocument();
    const next = clearGuides(doc);

    expect(next.guides).toEqual([]);
  });

  it("does not mutate the input document or guides array", () => {
    const doc = createGuideDocument();
    const originalGuides = doc.guides;
    const originalSnapshot = structuredClone(doc) as Document;

    addGuide(doc, "x", 300);
    moveGuide(doc, "guide-1", 125);
    removeGuide(doc, "guide-1");
    setGuideColor(doc, "guide-1", "#00d8ff");
    setGuideLocked(doc, "guide-1", true);
    setGuideHidden(doc, "guide-1", true);
    clearGuides(doc);

    expect(doc).toEqual(originalSnapshot);
    expect(doc.guides).toBe(originalGuides);
  });
});

describe("editorStore guide actions", () => {
  it("adds guides through undoable document history", () => {
    editorStore.setState(createEditorStateForTest());
    const before = editorStore.getState().doc;

    const id = editorStore.getState().addGuide("x", 80);

    expect(id).not.toBeNull();
    expect(editorStore.getState().doc.guides).toEqual([{ id, axis: "x", position: 80 }]);

    editorStore.getState().undo();
    expect(editorStore.getState().doc).toBe(before);
    expect(editorStore.getState().doc.guides).toEqual([]);

    editorStore.getState().redo();
    expect(editorStore.getState().doc.guides).toEqual([{ id, axis: "x", position: 80 }]);
  });

  it("moves, removes, and clears guides through undoable document history", () => {
    editorStore.setState(createEditorStateForTest());
    const firstId = editorStore.getState().addGuide("x", 100);
    const secondId = editorStore.getState().addGuide("y", 200);
    expect(firstId).not.toBeNull();
    expect(secondId).not.toBeNull();
    const firstGuideId = firstId ?? "";
    const secondGuideId = secondId ?? "";

    editorStore.getState().moveGuide(firstGuideId, 125);
    expect(editorStore.getState().doc.guides).toEqual([
      { id: firstGuideId, axis: "x", position: 125 },
      { id: secondGuideId, axis: "y", position: 200 },
    ]);

    editorStore.getState().undo();
    expect(editorStore.getState().doc.guides[0]?.position).toBe(100);

    editorStore.getState().redo();
    editorStore.getState().removeGuide(firstGuideId);
    expect(editorStore.getState().doc.guides).toEqual([{ id: secondGuideId, axis: "y", position: 200 }]);

    editorStore.getState().undo();
    expect(editorStore.getState().doc.guides).toHaveLength(2);

    editorStore.getState().clearGuides();
    expect(editorStore.getState().doc.guides).toEqual([]);

    editorStore.getState().undo();
    expect(editorStore.getState().doc.guides).toHaveLength(2);
  });

  it("normalizes loaded legacy documents without guides", () => {
    editorStore.setState(createEditorStateForTest());
    const legacyDoc: Omit<Document, "guides"> & { guides?: Document["guides"] } = { ...createDocument() };
    delete legacyDoc.guides;

    editorStore.getState().loadDocument(legacyDoc as Document);

    expect(editorStore.getState().doc.guides).toEqual([]);
  });
});
