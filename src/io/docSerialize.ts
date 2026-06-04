import type {
  Anchor,
  Document,
  Guide,
  GradientStop,
  Paint,
  SceneNode,
  Stroke,
  SubPath,
} from "../core/model/types";

const DOC_FORMAT_VERSION = 1;

type JsonObject = Record<string, unknown>;

const isObject = (value: unknown): value is JsonObject =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const isFiniteNumber = (value: unknown): value is number =>
  typeof value === "number" && Number.isFinite(value);

const isStringArray = (value: unknown): value is string[] =>
  Array.isArray(value) && value.every((item) => typeof item === "string");

const requireObject = (value: unknown, path: string): JsonObject => {
  if (!isObject(value)) {
    throw new Error(`${path} must be an object.`);
  }
  return value;
};

const requireString = (value: unknown, path: string): string => {
  if (typeof value !== "string") {
    throw new Error(`${path} must be a string.`);
  }
  return value;
};

const requireNumber = (value: unknown, path: string): number => {
  if (!isFiniteNumber(value)) {
    throw new Error(`${path} must be a finite number.`);
  }
  return value;
};

const requireBoolean = (value: unknown, path: string): boolean => {
  if (typeof value !== "boolean") {
    throw new Error(`${path} must be a boolean.`);
  }
  return value;
};

const requireStringArray = (value: unknown, path: string): string[] => {
  if (!isStringArray(value)) {
    throw new Error(`${path} must be an array of strings.`);
  }
  return value;
};

const validateVec2 = (value: unknown, path: string): void => {
  const vec = requireObject(value, path);
  requireNumber(vec.x, `${path}.x`);
  requireNumber(vec.y, `${path}.y`);
};

const validateMatrix = (value: unknown, path: string): void => {
  const matrix = requireObject(value, path);
  for (const key of ["a", "b", "c", "d", "e", "f"] as const) {
    requireNumber(matrix[key], `${path}.${key}`);
  }
};

const validateColor = (value: unknown, path: string): void => {
  const color = requireObject(value, path);
  requireNumber(color.r, `${path}.r`);
  requireNumber(color.g, `${path}.g`);
  requireNumber(color.b, `${path}.b`);
  requireNumber(color.a, `${path}.a`);
};

const validateGradientStop = (value: unknown, path: string): void => {
  const stop = requireObject(value, path);
  requireNumber(stop.offset, `${path}.offset`);
  validateColor(stop.color, `${path}.color`);
};

const validateGradientStops = (value: unknown, path: string): void => {
  if (!Array.isArray(value)) {
    throw new Error(`${path} must be an array.`);
  }

  value.forEach((stop, index) => validateGradientStop(stop, `${path}[${index}]`));
};

const validateGuide = (value: unknown, path: string): Guide => {
  const guide = requireObject(value, path);
  const id = requireString(guide.id, `${path}.id`);
  const axis = requireString(guide.axis, `${path}.axis`);
  if (axis !== "x" && axis !== "y") {
    throw new Error(`${path}.axis has unsupported value "${axis}".`);
  }
  const position = requireNumber(guide.position, `${path}.position`);

  return { id, axis, position };
};

const validateGuides = (value: unknown, path: string): Guide[] => {
  if (!Array.isArray(value)) {
    throw new Error(`${path} must be an array.`);
  }

  return value.map((guide, index) => validateGuide(guide, `${path}[${index}]`));
};

const validatePaint = (value: unknown, path: string): void => {
  const paint = requireObject(value, path);
  const type = requireString(paint.type, `${path}.type`);

  switch (type) {
    case "none":
      return;
    case "solid":
      validateColor(paint.color, `${path}.color`);
      return;
    case "linear":
      validateGradientStops(paint.stops, `${path}.stops`);
      validateVec2(paint.start, `${path}.start`);
      validateVec2(paint.end, `${path}.end`);
      return;
    case "radial":
      validateGradientStops(paint.stops, `${path}.stops`);
      validateVec2(paint.center, `${path}.center`);
      requireNumber(paint.radius, `${path}.radius`);
      return;
    default:
      throw new Error(`${path}.type has unsupported paint type "${type}".`);
  }
};

const validateStroke = (value: unknown, path: string): void => {
  if (value === null) {
    return;
  }

  const stroke = requireObject(value, path);
  validatePaint(stroke.paint, `${path}.paint`);
  requireNumber(stroke.width, `${path}.width`);

  const cap = requireString(stroke.cap, `${path}.cap`);
  if (cap !== "butt" && cap !== "round" && cap !== "square") {
    throw new Error(`${path}.cap has unsupported value "${cap}".`);
  }

  const join = requireString(stroke.join, `${path}.join`);
  if (join !== "miter" && join !== "round" && join !== "bevel") {
    throw new Error(`${path}.join has unsupported value "${join}".`);
  }

  requireNumber(stroke.miterLimit, `${path}.miterLimit`);
  if (!Array.isArray(stroke.dash) || !stroke.dash.every(isFiniteNumber)) {
    throw new Error(`${path}.dash must be an array of finite numbers.`);
  }
  requireNumber(stroke.dashOffset, `${path}.dashOffset`);

  const align = requireString(stroke.align, `${path}.align`);
  if (align !== "center" && align !== "inside" && align !== "outside") {
    throw new Error(`${path}.align has unsupported value "${align}".`);
  }
};

const validateAnchor = (value: unknown, path: string): void => {
  const anchor = requireObject(value, path);
  validateVec2(anchor.point, `${path}.point`);
  if (anchor.handleIn !== null) {
    validateVec2(anchor.handleIn, `${path}.handleIn`);
  }
  if (anchor.handleOut !== null) {
    validateVec2(anchor.handleOut, `${path}.handleOut`);
  }
};

const validateSubpath = (value: unknown, path: string): void => {
  const subpath = requireObject(value, path);
  if (!Array.isArray(subpath.anchors)) {
    throw new Error(`${path}.anchors must be an array.`);
  }
  subpath.anchors.forEach((anchor, index) => validateAnchor(anchor, `${path}.anchors[${index}]`));
  requireBoolean(subpath.closed, `${path}.closed`);
};

const validateNodeBase = (node: JsonObject, path: string): void => {
  requireString(node.id, `${path}.id`);
  requireString(node.name, `${path}.name`);
  validateMatrix(node.transform, `${path}.transform`);
  requireNumber(node.opacity, `${path}.opacity`);
  requireBoolean(node.visible, `${path}.visible`);
  requireBoolean(node.locked, `${path}.locked`);
};

const validateShapeBase = (node: JsonObject, path: string): void => {
  validateNodeBase(node, path);
  validatePaint(node.fill, `${path}.fill`);
  validateStroke(node.stroke, `${path}.stroke`);
  requireString(node.blendMode, `${path}.blendMode`);
};

const validateSceneNode = (value: unknown, path: string): void => {
  const node = requireObject(value, path);
  const type = requireString(node.type, `${path}.type`);

  switch (type) {
    case "layer":
      validateNodeBase(node, path);
      requireStringArray(node.children, `${path}.children`);
      return;
    case "group":
      validateNodeBase(node, path);
      requireStringArray(node.children, `${path}.children`);
      requireBoolean(node.clip, `${path}.clip`);
      return;
    case "path":
      validateShapeBase(node, path);
      if (!Array.isArray(node.subpaths)) {
        throw new Error(`${path}.subpaths must be an array.`);
      }
      node.subpaths.forEach((subpath, index) => validateSubpath(subpath, `${path}.subpaths[${index}]`));
      return;
    case "rect":
      validateShapeBase(node, path);
      requireNumber(node.width, `${path}.width`);
      requireNumber(node.height, `${path}.height`);
      requireNumber(node.rx, `${path}.rx`);
      requireNumber(node.ry, `${path}.ry`);
      return;
    case "ellipse":
      validateShapeBase(node, path);
      requireNumber(node.rx, `${path}.rx`);
      requireNumber(node.ry, `${path}.ry`);
      return;
    case "text":
      validateShapeBase(node, path);
      requireString(node.text, `${path}.text`);
      requireString(node.fontFamily, `${path}.fontFamily`);
      requireNumber(node.fontSize, `${path}.fontSize`);
      requireNumber(node.fontWeight, `${path}.fontWeight`);
      {
        const fontStyle = requireString(node.fontStyle, `${path}.fontStyle`);
        if (fontStyle !== "normal" && fontStyle !== "italic") {
          throw new Error(`${path}.fontStyle has unsupported value "${fontStyle}".`);
        }
      }
      requireNumber(node.letterSpacing, `${path}.letterSpacing`);
      requireNumber(node.lineHeight, `${path}.lineHeight`);
      {
        const textAlign = requireString(node.textAlign, `${path}.textAlign`);
        if (textAlign !== "left" && textAlign !== "center" && textAlign !== "right") {
          throw new Error(`${path}.textAlign has unsupported value "${textAlign}".`);
        }
      }
      return;
    case "image":
      validateNodeBase(node, path);
      requireString(node.src, `${path}.src`);
      requireNumber(node.width, `${path}.width`);
      requireNumber(node.height, `${path}.height`);
      return;
    default:
      throw new Error(`${path}.type has unsupported node type "${type}".`);
  }
};

const validateDocument = (value: unknown): Document => {
  const doc = requireObject(value, "doc");
  requireString(doc.id, "doc.id");
  requireString(doc.name, "doc.name");
  requireNumber(doc.width, "doc.width");
  requireNumber(doc.height, "doc.height");
  const layerOrder = requireStringArray(doc.layerOrder, "doc.layerOrder");
  const guides = validateGuides("guides" in doc ? doc.guides : [], "doc.guides");

  const nodes = requireObject(doc.nodes, "doc.nodes");
  for (const [id, node] of Object.entries(nodes)) {
    validateSceneNode(node, `doc.nodes.${id}`);
    const nodeObject = node as JsonObject;
    if (nodeObject.id !== id) {
      throw new Error(`doc.nodes.${id}.id must match its nodes map key.`);
    }
  }

  for (const layerId of layerOrder) {
    const layer = nodes[layerId];
    if (!isObject(layer)) {
      throw new Error(`doc.layerOrder references missing node "${layerId}".`);
    }
    if (layer.type !== "layer") {
      throw new Error(`doc.layerOrder references non-layer node "${layerId}".`);
    }
  }

  for (const [id, node] of Object.entries(nodes)) {
    if (!isObject(node) || (node.type !== "layer" && node.type !== "group")) {
      continue;
    }

    const children = node.children as string[];
    for (const childId of children) {
      if (!(childId in nodes)) {
        throw new Error(`doc.nodes.${id}.children references missing node "${childId}".`);
      }
    }
  }

  return { ...doc, guides } as unknown as Document;
};

const orderPaint = (paint: Paint): Paint => {
  switch (paint.type) {
    case "none":
      return { type: "none" };
    case "solid":
      return { type: "solid", color: paint.color };
    case "linear":
      return {
        type: "linear",
        stops: paint.stops.map(orderGradientStop),
        start: paint.start,
        end: paint.end,
      };
    case "radial":
      return {
        type: "radial",
        stops: paint.stops.map(orderGradientStop),
        center: paint.center,
        radius: paint.radius,
      };
  }
};

const orderGradientStop = (stop: GradientStop): GradientStop => ({
  offset: stop.offset,
  color: stop.color,
});

const orderGuide = (guide: Guide): Guide => ({
  id: guide.id,
  axis: guide.axis,
  position: guide.position,
});

const orderStroke = (stroke: Stroke | null): Stroke | null =>
  stroke === null
    ? null
    : {
        paint: orderPaint(stroke.paint),
        width: stroke.width,
        cap: stroke.cap,
        join: stroke.join,
        miterLimit: stroke.miterLimit,
        dash: [...stroke.dash],
        dashOffset: stroke.dashOffset,
        align: stroke.align,
      };

const orderAnchor = (anchor: Anchor): Anchor => ({
  point: anchor.point,
  handleIn: anchor.handleIn,
  handleOut: anchor.handleOut,
});

const orderSubpath = (subpath: SubPath): SubPath => ({
  anchors: subpath.anchors.map(orderAnchor),
  closed: subpath.closed,
});

const orderNodeBase = (node: SceneNode) => ({
  id: node.id,
  name: node.name,
  transform: node.transform,
  opacity: node.opacity,
  visible: node.visible,
  locked: node.locked,
});

const orderSceneNode = (node: SceneNode): SceneNode => {
  switch (node.type) {
    case "layer":
      return {
        ...orderNodeBase(node),
        type: "layer",
        children: [...node.children],
      };
    case "group":
      return {
        ...orderNodeBase(node),
        type: "group",
        children: [...node.children],
        clip: node.clip,
      };
    case "path":
      return {
        ...orderNodeBase(node),
        fill: orderPaint(node.fill),
        stroke: orderStroke(node.stroke),
        blendMode: node.blendMode,
        type: "path",
        subpaths: node.subpaths.map(orderSubpath),
      };
    case "rect":
      return {
        ...orderNodeBase(node),
        fill: orderPaint(node.fill),
        stroke: orderStroke(node.stroke),
        blendMode: node.blendMode,
        type: "rect",
        width: node.width,
        height: node.height,
        rx: node.rx,
        ry: node.ry,
      };
    case "ellipse":
      return {
        ...orderNodeBase(node),
        fill: orderPaint(node.fill),
        stroke: orderStroke(node.stroke),
        blendMode: node.blendMode,
        type: "ellipse",
        rx: node.rx,
        ry: node.ry,
      };
    case "text":
      return {
        ...orderNodeBase(node),
        fill: orderPaint(node.fill),
        stroke: orderStroke(node.stroke),
        blendMode: node.blendMode,
        type: "text",
        text: node.text,
        fontFamily: node.fontFamily,
        fontSize: node.fontSize,
        fontWeight: node.fontWeight,
        fontStyle: node.fontStyle,
        letterSpacing: node.letterSpacing,
        lineHeight: node.lineHeight,
        textAlign: node.textAlign,
      };
    case "image":
      return {
        ...orderNodeBase(node),
        type: "image",
        src: node.src,
        width: node.width,
        height: node.height,
      };
  }
};

const orderDocument = (doc: Document): Document => ({
  id: doc.id,
  name: doc.name,
  width: doc.width,
  height: doc.height,
  layerOrder: [...doc.layerOrder],
  guides: doc.guides.map(orderGuide),
  nodes: Object.fromEntries(
    Object.keys(doc.nodes)
      .sort()
      .map((id) => [id, orderSceneNode(doc.nodes[id]!)]),
  ),
});

export const serializeDocument = (doc: Document): string =>
  JSON.stringify({ version: DOC_FORMAT_VERSION, doc: orderDocument(doc) }, null, 2);

export const deserializeDocument = (json: string): Document => {
  let parsed: unknown;
  try {
    parsed = JSON.parse(json);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown parse error";
    throw new Error(`Malformed document JSON: ${message}`);
  }

  const root = requireObject(parsed, "document file");
  if (!("version" in root)) {
    throw new Error("Document JSON is missing version.");
  }
  if (root.version !== DOC_FORMAT_VERSION) {
    throw new Error(`Unsupported document JSON version: ${String(root.version)}.`);
  }

  return validateDocument(root.doc);
};
