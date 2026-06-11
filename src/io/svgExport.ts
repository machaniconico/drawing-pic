import type { Matrix } from "../core/geometry/matrix";
import { compose, IDENTITY } from "../core/geometry/matrix";
import type { Vec2 } from "../core/geometry/vector";
import {
  height as bboxHeight,
  isEmpty,
  unionAll,
  width as bboxWidth,
  type BBox,
} from "../core/geometry/bbox";
import { worldBounds } from "../core/model/bounds";
import type {
  Anchor,
  Document,
  GradientStop,
  NodeId,
  Paint,
  EllipseNode,
  PathNode,
  RectNode,
  RGBA,
  SceneNode,
  Stroke,
  SubPath,
} from "../core/model/types";
import { isContainer } from "../core/model/types";

type GradientPaint = Extract<Paint, { type: "linear" | "radial" }>;
type AlignedStrokeNode = RectNode | EllipseNode | PathNode;

export interface SvgExportOptions {
  scale?: number;
  nodeIds?: readonly NodeId[];
}

interface GradientReference {
  id: string;
  paint: GradientPaint;
}

interface ClipPathReference {
  id: string;
  content: string;
}

interface SvgContext {
  gradients: GradientReference[];
  clipPaths: ClipPathReference[];
  nextGradientId: number;
  nextClipPathId: number;
}

interface SelectionRoot {
  node: SceneNode;
  parentWorldTransform: Matrix;
}

const clamp = (value: number, min: number, max: number): number =>
  Math.min(max, Math.max(min, value));

const exportScale = (scale: number | undefined): number =>
  scale === undefined || !Number.isFinite(scale) ? 1 : clamp(scale, 0.01, 100);

const escapeXml = (value: string): string =>
  value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&apos;");

const attr = (name: string, value: string | number): string =>
  ` ${name}="${escapeXml(String(value))}"`;

const numericAttr = (name: string, value: number): string => attr(name, formatNumber(value));

const formatNumber = (value: number): string => {
  if (!Number.isFinite(value)) return "0";
  const normalized = Object.is(value, -0) ? 0 : value;
  return Number.parseFloat(normalized.toFixed(6)).toString();
};

const byteToHex = (value: number): string =>
  clamp(Math.round(value), 0, 255).toString(16).padStart(2, "0");

const colorToHex = (color: RGBA): string =>
  `#${byteToHex(color.r)}${byteToHex(color.g)}${byteToHex(color.b)}`;

const alpha = (color: RGBA): string => formatNumber(clamp(color.a, 0, 1));

const transformAttr = ({ a, b, c, d, e, f }: Matrix): string =>
  attr(
    "transform",
    `matrix(${[
      formatNumber(a),
      formatNumber(b),
      formatNumber(c),
      formatNumber(d),
      formatNumber(e),
      formatNumber(f),
    ].join(" ")})`,
  );

const CSS_BLEND_MODES: Partial<Record<GlobalCompositeOperation, string>> = {
  "source-over": "normal",
  multiply: "multiply",
  screen: "screen",
  overlay: "overlay",
  darken: "darken",
  lighten: "lighten",
  "color-dodge": "color-dodge",
  "color-burn": "color-burn",
  "hard-light": "hard-light",
  "soft-light": "soft-light",
  difference: "difference",
  exclusion: "exclusion",
  hue: "hue",
  saturation: "saturation",
  color: "color",
  luminosity: "luminosity",
};

const blendModeAttr = (blendMode: GlobalCompositeOperation | undefined): string => {
  if (blendMode === undefined) return "";

  const cssBlendMode = CSS_BLEND_MODES[blendMode];
  return cssBlendMode === undefined || cssBlendMode === "normal"
    ? ""
    : attr("style", `mix-blend-mode:${cssBlendMode}`);
};

const nodeBlendMode = (node: SceneNode): GlobalCompositeOperation | undefined =>
  (node as { blendMode?: GlobalCompositeOperation }).blendMode;

const pointWithHandle = (point: Vec2, handle: Vec2 | null): Vec2 =>
  handle === null ? point : { x: point.x + handle.x, y: point.y + handle.y };

const moveCommand = (anchor: Anchor): string =>
  `M ${formatNumber(anchor.point.x)} ${formatNumber(anchor.point.y)}`;

const lineCommand = (anchor: Anchor): string =>
  `L ${formatNumber(anchor.point.x)} ${formatNumber(anchor.point.y)}`;

const curveCommand = (current: Anchor, next: Anchor): string => {
  const cp1 = pointWithHandle(current.point, current.handleOut);
  const cp2 = pointWithHandle(next.point, next.handleIn);
  return [
    "C",
    formatNumber(cp1.x),
    formatNumber(cp1.y),
    formatNumber(cp2.x),
    formatNumber(cp2.y),
    formatNumber(next.point.x),
    formatNumber(next.point.y),
  ].join(" ");
};

const segmentCommand = (current: Anchor, next: Anchor): string =>
  current.handleOut === null && next.handleIn === null
    ? lineCommand(next)
    : curveCommand(current, next);

const subpathToD = (subpath: SubPath): string => {
  const first = subpath.anchors[0];
  if (first === undefined) return "";

  const commands = [moveCommand(first)];
  for (let index = 0; index < subpath.anchors.length - 1; index += 1) {
    const current = subpath.anchors[index];
    const next = subpath.anchors[index + 1];
    if (current !== undefined && next !== undefined) {
      commands.push(segmentCommand(current, next));
    }
  }

  if (subpath.closed && subpath.anchors.length > 1) {
    const last = subpath.anchors[subpath.anchors.length - 1];
    if (last !== undefined) {
      commands.push(segmentCommand(last, first));
    }
    commands.push("Z");
  }

  return commands.join(" ");
};

const pathToD = (node: PathNode): string =>
  node.subpaths.map(subpathToD).filter((d) => d.length > 0).join(" ");

const rectGeometryAttrs = (node: RectNode): string => {
  const radiusAttrs =
    node.rx > 0 || node.ry > 0
      ? numericAttr("rx", Math.max(0, node.rx)) + numericAttr("ry", Math.max(0, node.ry))
      : "";

  return `${numericAttr("x", 0)}${numericAttr("y", 0)}${numericAttr(
    "width",
    node.width,
  )}${numericAttr("height", node.height)}${radiusAttrs}`;
};

const ellipseGeometryAttrs = (node: EllipseNode): string =>
  `${numericAttr("cx", 0)}${numericAttr("cy", 0)}${numericAttr(
    "rx",
    Math.abs(node.rx),
  )}${numericAttr("ry", Math.abs(node.ry))}`;

const pathGeometryAttrs = (node: PathNode): string => attr("d", pathToD(node));

const renderLocalGeometry = (node: AlignedStrokeNode): string => {
  switch (node.type) {
    case "rect":
      return `<rect${rectGeometryAttrs(node)} />`;
    case "ellipse":
      return `<ellipse${ellipseGeometryAttrs(node)} />`;
    case "path":
      return `<path${pathGeometryAttrs(node)} />`;
  }
};

const HUGE_CLIP_COORD = 10000000;

const hugeClipRectPath = (): string =>
  [
    "M",
    formatNumber(-HUGE_CLIP_COORD),
    formatNumber(-HUGE_CLIP_COORD),
    "H",
    formatNumber(HUGE_CLIP_COORD),
    "V",
    formatNumber(HUGE_CLIP_COORD),
    "H",
    formatNumber(-HUGE_CLIP_COORD),
    "Z",
  ].join(" ");

const rectToPathD = (node: RectNode): string => {
  const width = node.width;
  const height = node.height;
  const rx = Math.min(Math.max(0, node.rx), Math.abs(width) / 2);
  const ry = Math.min(Math.max(0, node.ry), Math.abs(height) / 2);

  if (rx === 0 || ry === 0) {
    return [
      "M",
      formatNumber(0),
      formatNumber(0),
      "H",
      formatNumber(width),
      "V",
      formatNumber(height),
      "H",
      formatNumber(0),
      "Z",
    ].join(" ");
  }

  return [
    "M",
    formatNumber(rx),
    formatNumber(0),
    "H",
    formatNumber(width - rx),
    "A",
    formatNumber(rx),
    formatNumber(ry),
    "0 0 1",
    formatNumber(width),
    formatNumber(ry),
    "V",
    formatNumber(height - ry),
    "A",
    formatNumber(rx),
    formatNumber(ry),
    "0 0 1",
    formatNumber(width - rx),
    formatNumber(height),
    "H",
    formatNumber(rx),
    "A",
    formatNumber(rx),
    formatNumber(ry),
    "0 0 1",
    formatNumber(0),
    formatNumber(height - ry),
    "V",
    formatNumber(ry),
    "A",
    formatNumber(rx),
    formatNumber(ry),
    "0 0 1",
    formatNumber(rx),
    formatNumber(0),
    "Z",
  ].join(" ");
};

const ellipseToPathD = (node: EllipseNode): string => {
  const rx = Math.abs(node.rx);
  const ry = Math.abs(node.ry);

  return [
    "M",
    formatNumber(-rx),
    formatNumber(0),
    "A",
    formatNumber(rx),
    formatNumber(ry),
    "0 1 0",
    formatNumber(rx),
    formatNumber(0),
    "A",
    formatNumber(rx),
    formatNumber(ry),
    "0 1 0",
    formatNumber(-rx),
    formatNumber(0),
    "Z",
  ].join(" ");
};

const geometryToPathD = (node: AlignedStrokeNode): string => {
  switch (node.type) {
    case "rect":
      return rectToPathD(node);
    case "ellipse":
      return ellipseToPathD(node);
    case "path":
      return pathToD(node);
  }
};

const strokeAlignmentClipContent = (node: AlignedStrokeNode, align: Stroke["align"]): string =>
  align === "inside"
    ? renderLocalGeometry(node)
    : `<path${attr("clip-rule", "evenodd")}${attr(
        "d",
        `${hugeClipRectPath()} ${geometryToPathD(node)}`,
      )} />`;

const gradientId = (ctx: SvgContext, paint: GradientPaint): string => {
  const id = `svg-export-gradient-${ctx.nextGradientId}`;
  ctx.nextGradientId += 1;
  ctx.gradients.push({ id, paint });
  return id;
};

const clipPathId = (ctx: SvgContext, content: string): string => {
  const id = `svg-export-clip-${ctx.nextClipPathId}`;
  ctx.nextClipPathId += 1;
  ctx.clipPaths.push({ id, content });
  return id;
};

const paintAttrs = (
  paint: Paint,
  property: "fill" | "stroke",
  opacityProperty: "fill-opacity" | "stroke-opacity",
  ctx: SvgContext,
): string => {
  switch (paint.type) {
    case "none":
      return attr(property, "none");
    case "pattern":
      // パターン出力は US-117 で実装。未対応の間は none 扱い。
      return attr(property, "none");
    case "solid":
      return attr(property, colorToHex(paint.color)) + attr(opacityProperty, alpha(paint.color));
    case "linear":
    case "radial":
      return attr(property, `url(#${gradientId(ctx, paint)})`);
  }
};

const strokeAttrs = (stroke: Stroke | null, ctx: SvgContext, width = stroke?.width ?? 0): string => {
  if (stroke === null || stroke.paint.type === "none") return attr("stroke", "none");

  let output =
    paintAttrs(stroke.paint, "stroke", "stroke-opacity", ctx) +
    numericAttr("stroke-width", width) +
    attr("stroke-linecap", stroke.cap) +
    attr("stroke-linejoin", stroke.join) +
    numericAttr("stroke-miterlimit", stroke.miterLimit);

  if (stroke.dash.length > 0) {
    output += attr("stroke-dasharray", stroke.dash.map(formatNumber).join(" "));
  }
  if (stroke.dashOffset !== 0) {
    output += numericAttr("stroke-dashoffset", stroke.dashOffset);
  }

  return output;
};

const nodeCommonAttrs = (node: SceneNode): string =>
  transformAttr(node.transform) +
  numericAttr("opacity", clamp(node.opacity, 0, 1)) +
  blendModeAttr(nodeBlendMode(node));

const gradientStopAttrs = (stop: GradientStop): string =>
  numericAttr("offset", clamp(stop.offset, 0, 1)) +
  attr("stop-color", colorToHex(stop.color)) +
  attr("stop-opacity", alpha(stop.color));

const gradientDefs = (gradients: readonly GradientReference[]): string => {
  if (gradients.length === 0) return "";

  const defs = gradients
    .map(({ id, paint }) => {
      const stops = paint.stops
        .map((stop) => `<stop${gradientStopAttrs(stop)} />`)
        .join("");

      if (paint.type === "linear") {
        return `<linearGradient${attr("id", id)}${attr(
          "gradientUnits",
          "userSpaceOnUse",
        )}${numericAttr("x1", paint.start.x)}${numericAttr("y1", paint.start.y)}${numericAttr(
          "x2",
          paint.end.x,
        )}${numericAttr("y2", paint.end.y)}>${stops}</linearGradient>`;
      }

      return `<radialGradient${attr("id", id)}${attr(
        "gradientUnits",
        "userSpaceOnUse",
      )}${numericAttr("cx", paint.center.x)}${numericAttr("cy", paint.center.y)}${numericAttr(
        "r",
        Math.max(0, paint.radius),
      )}>${stops}</radialGradient>`;
    })
    .join("");

  return `<defs>${defs}</defs>`;
};

const clipPathDefs = (clipPaths: readonly ClipPathReference[]): string =>
  clipPaths.map(({ id, content }) => `<clipPath${attr("id", id)}>${content}</clipPath>`).join("");

const documentDefs = (ctx: SvgContext): string => {
  if (ctx.clipPaths.length === 0) return gradientDefs(ctx.gradients);

  const gradients = gradientDefs(ctx.gradients);
  const clips = clipPathDefs(ctx.clipPaths);

  if (gradients.length === 0) return `<defs>${clips}</defs>`;

  return gradients.replace("</defs>", `${clips}</defs>`);
};

const renderBackground = (doc: Document): string => {
  if (doc.background === null || doc.background === undefined) return "";

  return `<rect${numericAttr("x", 0)}${numericAttr("y", 0)}${numericAttr(
    "width",
    doc.width,
  )}${numericAttr("height", doc.height)}${attr("fill", colorToHex(doc.background))}${attr(
    "fill-opacity",
    alpha(doc.background),
  )} />`;
};

const renderClipGeometryNode = (doc: Document, node: SceneNode): string => {
  if (!node.visible) return "";

  if (isContainer(node)) {
    const children = node.children
      .map((childId) => doc.nodes[childId])
      .filter((child): child is SceneNode => child !== undefined)
      .map((child) => renderClipGeometryNode(doc, child))
      .join("");

    return `<g${transformAttr(node.transform)}>${children}</g>`;
  }

  switch (node.type) {
    case "rect": {
      const radiusAttrs =
        node.rx > 0 || node.ry > 0
          ? numericAttr("rx", Math.max(0, node.rx)) + numericAttr("ry", Math.max(0, node.ry))
          : "";
      return `<rect${transformAttr(node.transform)}${numericAttr("x", 0)}${numericAttr(
        "y",
        0,
      )}${numericAttr("width", node.width)}${numericAttr("height", node.height)}${radiusAttrs} />`;
    }
    case "ellipse":
      return `<ellipse${transformAttr(node.transform)}${numericAttr("cx", 0)}${numericAttr(
        "cy",
        0,
      )}${numericAttr("rx", Math.abs(node.rx))}${numericAttr("ry", Math.abs(node.ry))} />`;
    case "path":
      return `<path${transformAttr(node.transform)}${attr("d", pathToD(node))} />`;
    case "text":
      return `<text${transformAttr(node.transform)}${attr("font-family", node.fontFamily)}${numericAttr(
        "font-size",
        node.fontSize,
      )}${numericAttr("font-weight", node.fontWeight)}${attr("font-style", node.fontStyle)}${numericAttr(
        "letter-spacing",
        node.letterSpacing,
      )}${attr("text-anchor", textAnchor(node.textAlign))}>${escapeXml(node.text)}</text>`;
    case "image":
      return `<rect${transformAttr(node.transform)}${numericAttr("x", 0)}${numericAttr(
        "y",
        0,
      )}${numericAttr("width", node.width)}${numericAttr("height", node.height)} />`;
  }
};

const hasVisibleStroke = (stroke: Stroke | null): stroke is Stroke =>
  stroke !== null && stroke.paint.type !== "none";

const isFullyClosedPath = (node: PathNode): boolean =>
  node.subpaths.length > 0 && node.subpaths.every((subpath) => subpath.closed);

const alignedStrokeNode = (node: SceneNode): AlignedStrokeNode | null => {
  if (node.type === "rect" || node.type === "ellipse") return node;
  if (node.type === "path" && isFullyClosedPath(node)) return node;
  return null;
};

const renderAlignedStrokeNode = (
  node: SceneNode,
  ctx: SvgContext,
): string | null => {
  const alignedNode = alignedStrokeNode(node);
  if (alignedNode === null || !hasVisibleStroke(alignedNode.stroke)) return null;

  const stroke = alignedNode.stroke;
  if (stroke.align !== "inside" && stroke.align !== "outside") return null;

  const clipPath = clipPathId(ctx, strokeAlignmentClipContent(alignedNode, stroke.align));
  const common = nodeCommonAttrs(alignedNode);
  const geometry = renderGeometryAttrs(alignedNode);

  return (
    `<${alignedNode.type}${common}${geometry}${paintAttrs(
      alignedNode.fill,
      "fill",
      "fill-opacity",
      ctx,
    )}${attr("stroke", "none")} />` +
    `<${alignedNode.type}${common}${geometry}${attr("fill", "none")}${strokeAttrs(
      stroke,
      ctx,
      stroke.width * 2,
    )}${attr("clip-path", `url(#${clipPath})`)} />`
  );
};

const renderGeometryAttrs = (node: AlignedStrokeNode): string => {
  switch (node.type) {
    case "rect":
      return rectGeometryAttrs(node);
    case "ellipse":
      return ellipseGeometryAttrs(node);
    case "path":
      return pathGeometryAttrs(node);
  }
};

const renderNode = (doc: Document, node: SceneNode, ctx: SvgContext): string => {
  if (!node.visible) return "";

  if (isContainer(node)) {
    const childNodes = node.children
      .map((childId) => doc.nodes[childId])
      .filter((child): child is SceneNode => child !== undefined);
    const isClipGroup = node.type === "group" && node.clip && childNodes.length >= 2;
    const renderedChildren = isClipGroup ? childNodes.slice(0, -1) : childNodes;
    const children = renderedChildren
      .map((child) => renderNode(doc, child, ctx))
      .join("");
    const mask = childNodes[childNodes.length - 1];
    const clipPath =
      isClipGroup && mask !== undefined
        ? attr("clip-path", `url(#${clipPathId(ctx, renderClipGeometryNode(doc, mask))})`)
        : "";

    return `<g${nodeCommonAttrs(node)}${clipPath}>${children}</g>`;
  }

  const alignedStroke = renderAlignedStrokeNode(node, ctx);
  if (alignedStroke !== null) return alignedStroke;

  switch (node.type) {
    case "rect": {
      const radiusAttrs =
        node.rx > 0 || node.ry > 0
          ? numericAttr("rx", Math.max(0, node.rx)) + numericAttr("ry", Math.max(0, node.ry))
          : "";
      return `<rect${nodeCommonAttrs(node)}${numericAttr("x", 0)}${numericAttr(
        "y",
        0,
      )}${numericAttr("width", node.width)}${numericAttr("height", node.height)}${radiusAttrs}${paintAttrs(
        node.fill,
        "fill",
        "fill-opacity",
        ctx,
      )}${strokeAttrs(node.stroke, ctx)} />`;
    }
    case "ellipse":
      return `<ellipse${nodeCommonAttrs(node)}${numericAttr("cx", 0)}${numericAttr(
        "cy",
        0,
      )}${numericAttr("rx", Math.abs(node.rx))}${numericAttr("ry", Math.abs(node.ry))}${paintAttrs(
        node.fill,
        "fill",
        "fill-opacity",
        ctx,
      )}${strokeAttrs(node.stroke, ctx)} />`;
    case "path":
      return `<path${nodeCommonAttrs(node)}${attr("d", pathToD(node))}${paintAttrs(
        node.fill,
        "fill",
        "fill-opacity",
        ctx,
      )}${strokeAttrs(node.stroke, ctx)} />`;
    case "text":
      return `<text${nodeCommonAttrs(node)}${attr("font-family", node.fontFamily)}${numericAttr(
        "font-size",
        node.fontSize,
      )}${numericAttr("font-weight", node.fontWeight)}${attr("font-style", node.fontStyle)}${numericAttr(
        "letter-spacing",
        node.letterSpacing,
      )}${attr("text-anchor", textAnchor(node.textAlign))}${paintAttrs(
        node.fill,
        "fill",
        "fill-opacity",
        ctx,
      )}${strokeAttrs(node.stroke, ctx)}>${escapeXml(node.text)}</text>`;
    case "image":
      return `<image${nodeCommonAttrs(node)}${attr("href", node.src)}${numericAttr(
        "width",
        node.width,
      )}${numericAttr("height", node.height)} />`;
  }
};

const textAnchor = (align: "left" | "center" | "right"): "start" | "middle" | "end" => {
  switch (align) {
    case "left":
      return "start";
    case "center":
      return "middle";
    case "right":
      return "end";
  }
};

const documentBounds = (doc: Document): BBox => ({
  minX: 0,
  minY: 0,
  maxX: doc.width,
  maxY: doc.height,
});

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

const exportBounds = (doc: Document, roots: readonly SelectionRoot[]): BBox => {
  if (roots.length === 0) return documentBounds(doc);

  const bounds = selectionSubtreeBounds(doc, roots);
  return isEmpty(bounds) ? documentBounds(doc) : bounds;
};

export const documentToSvg = (doc: Document, opts?: SvgExportOptions): string => {
  const ctx: SvgContext = { gradients: [], clipPaths: [], nextGradientId: 1, nextClipPathId: 1 };
  const selectionRoots = resolveSelectionRoots(doc, opts?.nodeIds);
  const layers =
    opts?.nodeIds !== undefined && opts.nodeIds.length > 0 && selectionRoots.length > 0
      ? selectionRoots
          .map(
            (root) =>
              `<g${transformAttr(root.parentWorldTransform)}>${renderNode(doc, root.node, ctx)}</g>`,
          )
          .join("")
      : doc.layerOrder
          .map((layerId) => doc.nodes[layerId])
          .filter((layer): layer is SceneNode => layer !== undefined)
          .map((layer) => renderNode(doc, layer, ctx))
          .join("");
  const body = renderBackground(doc) + layers;
  const defs = documentDefs(ctx);
  const bounds = exportBounds(doc, selectionRoots);
  const scale = exportScale(opts?.scale);
  const outputWidth = bboxWidth(bounds);
  const outputHeight = bboxHeight(bounds);

  return `<svg${attr("xmlns", "http://www.w3.org/2000/svg")}${numericAttr(
    "width",
    outputWidth * scale,
  )}${numericAttr("height", outputHeight * scale)}${attr(
    "viewBox",
    `${formatNumber(bounds.minX)} ${formatNumber(bounds.minY)} ${formatNumber(
      outputWidth,
    )} ${formatNumber(outputHeight)}`,
  )}>${defs}${body}</svg>`;
};
