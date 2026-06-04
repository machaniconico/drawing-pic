import type { ContainerNode, Document, NodeId } from "../core/model/types";
import { isContainer } from "../core/model/types";

export type LayerDropPosition = "before" | "after" | "inside";

interface ParentCollection {
  parentId: NodeId | null;
  ids: NodeId[];
}

const topLevelCollection = (doc: Document): ParentCollection => ({
  parentId: null,
  ids: doc.layerOrder,
});

const childCollection = (parent: ContainerNode): ParentCollection => ({
  parentId: parent.id,
  ids: parent.children,
});

const findParentCollection = (doc: Document, id: NodeId): ParentCollection | null => {
  if (doc.layerOrder.includes(id)) {
    return topLevelCollection(doc);
  }

  for (const node of Object.values(doc.nodes)) {
    if (isContainer(node) && node.children.includes(id)) {
      return childCollection(node);
    }
  }

  return null;
};

const hasDescendant = (doc: Document, ancestorId: NodeId, descendantId: NodeId): boolean => {
  const ancestor = doc.nodes[ancestorId];
  if (!ancestor || !isContainer(ancestor)) {
    return false;
  }

  for (const childId of ancestor.children) {
    if (childId === descendantId || hasDescendant(doc, childId, descendantId)) {
      return true;
    }
  }

  return false;
};

const sameDocumentOrder = (a: Document, b: Document): boolean => {
  if (a.layerOrder.length !== b.layerOrder.length) {
    return false;
  }

  for (let index = 0; index < a.layerOrder.length; index += 1) {
    if (a.layerOrder[index] !== b.layerOrder[index]) {
      return false;
    }
  }

  for (const [id, node] of Object.entries(a.nodes)) {
    const nextNode = b.nodes[id];
    if (!nextNode || isContainer(node) !== isContainer(nextNode)) {
      return false;
    }

    if (!isContainer(node) || !isContainer(nextNode)) {
      continue;
    }

    if (node.children.length !== nextNode.children.length) {
      return false;
    }

    for (let index = 0; index < node.children.length; index += 1) {
      if (node.children[index] !== nextNode.children[index]) {
        return false;
      }
    }
  }

  return true;
};

export const moveNode = (
  doc: Document,
  dragId: NodeId,
  targetId: NodeId,
  position: LayerDropPosition,
): Document => {
  if (dragId === targetId || !doc.nodes[dragId] || !doc.nodes[targetId]) {
    return doc;
  }

  if (hasDescendant(doc, dragId, targetId)) {
    return doc;
  }

  if (position === "inside" && !isContainer(doc.nodes[targetId])) {
    return doc;
  }

  const next = structuredClone(doc) as Document;
  const dragParent = findParentCollection(next, dragId);
  if (!dragParent) {
    return doc;
  }

  const dragIndex = dragParent.ids.indexOf(dragId);
  if (dragIndex < 0) {
    return doc;
  }
  dragParent.ids.splice(dragIndex, 1);

  if (position === "inside") {
    const target = next.nodes[targetId];
    if (!target || !isContainer(target)) {
      return doc;
    }

    target.children.push(dragId);
    return sameDocumentOrder(doc, next) ? doc : next;
  }

  const targetParent = findParentCollection(next, targetId);
  if (!targetParent) {
    return doc;
  }

  const targetIndex = targetParent.ids.indexOf(targetId);
  if (targetIndex < 0) {
    return doc;
  }

  targetParent.ids.splice(position === "before" ? targetIndex : targetIndex + 1, 0, dragId);
  return sameDocumentOrder(doc, next) ? doc : next;
};
