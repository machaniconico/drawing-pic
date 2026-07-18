import {
  height as bboxHeight,
  isEmpty,
  unionAll,
  width as bboxWidth,
  type BBox,
} from "../core/geometry/bbox";
import type { Matrix } from "../core/geometry/matrix";
import { compose, IDENTITY } from "../core/geometry/matrix";
import { worldBounds } from "../core/model/bounds";
import type { Document, NodeId, SceneNode } from "../core/model/types";
import { isContainer } from "../core/model/types";
import { renderDocument } from "../render/canvasRenderer";

export interface PngExportOptions {
  scale?: number;
  nodeIds?: readonly NodeId[];
}

export interface RasterCanvasOptions extends PngExportOptions {
  opaqueBackground?: boolean;
}

const clamp = (value: number, min: number, max: number): number =>
  Math.min(max, Math.max(min, value));

const exportScale = (scale: number | undefined): number =>
  scale === undefined || !Number.isFinite(scale) ? 1 : clamp(scale, 0.01, 100);

const documentBounds = (doc: Document): BBox => ({
  minX: 0,
  minY: 0,
  maxX: doc.width,
  maxY: doc.height,
});

interface SelectionRoot {
  node: SceneNode;
  parentWorldTransform: Matrix;
}

interface ExportCrop {
  bounds: BBox;
  isSelection: boolean;
  roots: SelectionRoot[];
}

const resolveSelectionRoots = (
  doc: Document,
  nodeIds: readonly NodeId[] | undefined,
): SelectionRoot[] => {
  if (nodeIds === undefined || nodeIds.length === 0) return [];

  const candidates = new Set(nodeIds.filter((id) => doc.nodes[id] !== undefined));
  if (candidates.size === 0) return [];

  const roots: SelectionRoot[] = [];

  const visit = (
    nodeId: NodeId,
    parentWorldTransform: Matrix,
    hasSelectedAncestor: boolean,
  ): void => {
    const node = doc.nodes[nodeId];
    if (node === undefined) return;

    const isSelected = candidates.has(nodeId);
    if (isSelected && !hasSelectedAncestor) {
      roots.push({ node, parentWorldTransform });
    }

    if (isContainer(node)) {
      const nextParentWorldTransform = compose(parentWorldTransform, node.transform);
      for (const childId of node.children) {
        visit(childId, nextParentWorldTransform, hasSelectedAncestor || isSelected);
      }
    }
  };

  for (const layerId of doc.layerOrder) {
    visit(layerId, IDENTITY, false);
  }

  return roots;
};

const subtreeWorldBounds = (doc: Document, node: SceneNode): BBox => {
  if (!isContainer(node)) return worldBounds(doc, node.id);

  return unionAll(
    node.children
      .map((childId) => doc.nodes[childId])
      .filter((child): child is SceneNode => child !== undefined)
      .map((child) => subtreeWorldBounds(doc, child)),
  );
};

const selectionSubtreeBounds = (doc: Document, roots: readonly SelectionRoot[]): BBox =>
  unionAll(roots.map((root) => subtreeWorldBounds(doc, root.node)));

const exportCrop = (doc: Document, nodeIds: readonly NodeId[] | undefined): ExportCrop => {
  if (nodeIds === undefined || nodeIds.length === 0) {
    return { bounds: documentBounds(doc), isSelection: false, roots: [] };
  }

  const roots = resolveSelectionRoots(doc, nodeIds);
  if (roots.length === 0) {
    return { bounds: documentBounds(doc), isSelection: false, roots };
  }

  const bounds = selectionSubtreeBounds(doc, roots);
  return isEmpty(bounds)
    ? { bounds: documentBounds(doc), isSelection: true, roots }
    : { bounds, isSelection: true, roots };
};

const requireContext = (canvas: HTMLCanvasElement): CanvasRenderingContext2D => {
  const ctx = canvas.getContext("2d");
  if (ctx === null) {
    throw new Error("Canvas 2D context is unavailable.");
  }
  return ctx;
};

const opaqueBackgroundFill = (doc: Document): string => {
  const background = doc.background;
  if (background === null || background === undefined) return "#ffffff";

  return `rgb(${clamp(Math.round(background.r), 0, 255)}, ${clamp(
    Math.round(background.g),
    0,
    255,
  )}, ${clamp(Math.round(background.b), 0, 255)})`;
};

const cloneSubtree = (
  sourceDoc: Document,
  targetNodes: Record<NodeId, SceneNode>,
  nodeId: NodeId,
): NodeId | null => {
  const node = sourceDoc.nodes[nodeId];
  if (node === undefined) return null;

  const clone = structuredClone(node) as SceneNode;
  targetNodes[nodeId] = clone;

  if (isContainer(clone)) {
    clone.children = clone.children.filter(
      (childId) => cloneSubtree(sourceDoc, targetNodes, childId) !== null,
    );
  }

  return nodeId;
};

const uniqueSyntheticLayerId = (
  sourceDoc: Document,
  targetNodes: Record<NodeId, SceneNode>,
  index: number,
): NodeId => {
  let id = `png-export-selection-layer-${index}`;
  let suffix = 1;
  while (sourceDoc.nodes[id] !== undefined || targetNodes[id] !== undefined) {
    id = `png-export-selection-layer-${index}-${suffix}`;
    suffix += 1;
  }
  return id;
};

const isolatedSelectionDocument = (
  doc: Document,
  roots: readonly SelectionRoot[],
): Document => {
  const nodes: Record<NodeId, SceneNode> = {};
  const layerOrder: NodeId[] = [];

  roots.forEach((root, index) => {
    const clonedRootId = cloneSubtree(doc, nodes, root.node.id);
    if (clonedRootId === null) return;

    const layerId = uniqueSyntheticLayerId(doc, nodes, index);
    nodes[layerId] = {
      id: layerId,
      name: "Selection Export",
      type: "layer",
      transform: root.parentWorldTransform,
      opacity: 1,
      visible: true,
      locked: false,
      children: [clonedRootId],
    };
    layerOrder.push(layerId);
  });

  return {
    ...doc,
    layerOrder,
    guides: [],
    nodes,
  };
};

export const renderDocumentToCanvas = (
  doc: Document,
  opts?: RasterCanvasOptions,
): HTMLCanvasElement => {
  const canvas = document.createElement("canvas");
  const crop = exportCrop(doc, opts?.nodeIds);
  const bounds = crop.bounds;
  const scale = exportScale(opts?.scale);
  const cropWidth = bboxWidth(bounds);
  const cropHeight = bboxHeight(bounds);

  canvas.width = cropWidth * scale;
  canvas.height = cropHeight * scale;

  const ctx = requireContext(canvas);

  if (crop.isSelection) {
    renderDocument(
      ctx,
      isolatedSelectionDocument(doc, crop.roots),
      {
        pan: { x: -bounds.minX * scale, y: -bounds.minY * scale },
        zoom: scale,
      },
      { skipEditorChrome: true },
    );
  } else {
    renderDocument(
      ctx,
      doc,
      {
        pan: { x: -bounds.minX * scale, y: -bounds.minY * scale },
        zoom: scale,
      },
      { skipEditorChrome: true },
    );
  }

  if (opts?.opaqueBackground) {
    ctx.save();
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.globalCompositeOperation = "destination-over";
    ctx.fillStyle = opaqueBackgroundFill(doc);
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.restore();
  }

  return canvas;
};

export const documentToPngBlob = (doc: Document, opts?: PngExportOptions): Promise<Blob> =>
  new Promise((resolve, reject) => {
    let canvas: HTMLCanvasElement;

    try {
      canvas = renderDocumentToCanvas(doc, opts);
    } catch (error) {
      reject(error);
      return;
    }

    if (typeof canvas.toBlob !== "function") {
      reject(new Error("PNG export requires HTMLCanvasElement.toBlob."));
      return;
    }

    canvas.toBlob((blob) => {
      if (blob === null) {
        reject(new Error("PNG export failed."));
        return;
      }

      resolve(blob);
    }, "image/png");
  });
