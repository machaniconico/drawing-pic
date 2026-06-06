import { newId } from "../core/model/factory";
import type { Document, Guide, NodeId } from "../core/model/types";

export interface AddGuideResult {
  doc: Document;
  id: NodeId;
}

export const addGuide = (doc: Document, axis: Guide["axis"], position: number): AddGuideResult => {
  const id = newId();

  return {
    doc: {
      ...doc,
      guides: [...doc.guides, { id, axis, position }],
    },
    id,
  };
};

export const moveGuide = (doc: Document, id: NodeId, position: number): Document => {
  const index = doc.guides.findIndex((guide) => guide.id === id);
  if (index < 0) {
    return doc;
  }
  if (doc.guides[index]?.locked === true) {
    return doc;
  }

  return {
    ...doc,
    guides: doc.guides.map((guide) => (guide.id === id ? { ...guide, position } : guide)),
  };
};

export const removeGuide = (doc: Document, id: NodeId): Document => {
  const target = doc.guides.find((guide) => guide.id === id);
  if (!target || target.locked === true) {
    return doc;
  }

  return {
    ...doc,
    guides: doc.guides.filter((guide) => guide.id !== id),
  };
};

export const setGuideColor = (doc: Document, id: NodeId, color: string): Document => {
  if (!doc.guides.some((guide) => guide.id === id)) {
    return doc;
  }

  return {
    ...doc,
    guides: doc.guides.map((guide) => (guide.id === id ? { ...guide, color } : guide)),
  };
};

export const setGuideLocked = (doc: Document, id: NodeId, locked: boolean): Document => {
  if (!doc.guides.some((guide) => guide.id === id)) {
    return doc;
  }

  return {
    ...doc,
    guides: doc.guides.map((guide) => (guide.id === id ? { ...guide, locked } : guide)),
  };
};

export const setGuideHidden = (doc: Document, id: NodeId, hidden: boolean): Document => {
  if (!doc.guides.some((guide) => guide.id === id)) {
    return doc;
  }

  return {
    ...doc,
    guides: doc.guides.map((guide) => (guide.id === id ? { ...guide, hidden } : guide)),
  };
};

export const clearGuides = (doc: Document): Document => {
  if (doc.guides.length === 0) {
    return doc;
  }

  return {
    ...doc,
    guides: [],
  };
};
