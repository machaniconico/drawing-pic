import type { Matrix } from "../core/geometry/matrix";
import type { Vec2 } from "../core/geometry/vector";
import {
  height as bboxHeight,
  isEmpty,
  width as bboxWidth,
  type BBox,
} from "../core/geometry/bbox";
import { selectionBounds } from "../core/model/bounds";
import type {
  Anchor,
  Document,
  GradientStop,
  NodeId,
  Paint,
  PathNode,
  RGBA,
  SceneNode,
  Stroke,
  SubPath,
} from "../core/model/types";
import { isContainer } from "../core/model/types";

type GradientPaint = Extract<Paint, { type: "linear" | "radial" }>;

export interface SvgExportOptions {
  scale?: number;
  nodeIds?: readonly NodeId[];
}

interface GradientReference {
  id: string;
  paint: GradientPaint;
}

interface SvgContext {
  gradients: GradientReference[];
  nextGradientId: number;
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

const gradientId = (ctx: SvgContext, paint: GradientPaint): string => {
  const id = `svg-export-gradient-${ctx.nextGradientId}`;
  ctx.nextGradientId += 1;
  ctx.gradients.push({ id, paint });
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
    case "solid":
      return attr(property, colorToHex(paint.color)) + attr(opacityProperty, alpha(paint.color));
    case "linear":
    case "radial":
      return attr(property, `url(#${gradientId(ctx, paint)})`);
  }
};

const strokeAttrs = (stroke: Stroke | null, ctx: SvgContext): string => {
  if (stroke === null || stroke.paint.type === "none") return attr("stroke", "none");

  let output =
    paintAttrs(stroke.paint, "stroke", "stroke-opacity", ctx) +
    numericAttr("stroke-width", stroke.width) +
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
  transformAttr(node.transform) + numericAttr("opacity", clamp(node.opacity, 0, 1));

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

const renderNode = (doc: Document, node: SceneNode, ctx: SvgContext): string => {
  if (!node.visible) return "";

  if (isContainer(node)) {
    const children = node.children
      .map((childId) => doc.nodes[childId])
      .filter((child): child is SceneNode => child !== undefined)
      .map((child) => renderNode(doc, child, ctx))
      .join("");

    return `<g${nodeCommonAttrs(node)}>${children}</g>`;
  }

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

const exportBounds = (doc: Document, nodeIds: readonly NodeId[] | undefined): BBox => {
  if (nodeIds === undefined || nodeIds.length === 0) return documentBounds(doc);

  const bounds = selectionBounds(doc, nodeIds);
  return isEmpty(bounds) ? documentBounds(doc) : bounds;
};

export const documentToSvg = (doc: Document, opts?: SvgExportOptions): string => {
  const ctx: SvgContext = { gradients: [], nextGradientId: 1 };
  const body = doc.layerOrder
    .map((layerId) => doc.nodes[layerId])
    .filter((layer): layer is SceneNode => layer !== undefined)
    .map((layer) => renderNode(doc, layer, ctx))
    .join("");
  const defs = gradientDefs(ctx.gradients);
  const bounds = exportBounds(doc, opts?.nodeIds);
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
