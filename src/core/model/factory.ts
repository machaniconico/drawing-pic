import { IDENTITY } from "../geometry/matrix";
import type { Vec2 } from "../geometry/vector";
import type {
  Document,
  EllipseNode,
  GroupNode,
  LayerNode,
  NodeId,
  Paint,
  PathNode,
  RectNode,
  RGBA,
  Stroke,
  SubPath,
  TextNode,
} from "./types";

/** 一意なノードIDを生成 */
export const newId = (): NodeId =>
  typeof crypto !== "undefined" && "randomUUID" in crypto
    ? crypto.randomUUID()
    : `n_${Math.random().toString(36).slice(2)}${Date.now().toString(36)}`;

export const rgba = (r: number, g: number, b: number, a = 1): RGBA => ({ r, g, b, a });
export const BLACK: RGBA = { r: 0, g: 0, b: 0, a: 1 };
export const WHITE: RGBA = { r: 255, g: 255, b: 255, a: 1 };

export const solid = (color: RGBA): Paint => ({ type: "solid", color });
export const NO_PAINT: Paint = { type: "none" };

export const defaultStroke = (color: RGBA = BLACK, width = 1): Stroke => ({
  paint: solid(color),
  width,
  cap: "butt",
  join: "miter",
  miterLimit: 10,
  dash: [],
  dashOffset: 0,
  align: "center",
});

const styleDefaults = () => ({
  fill: solid({ r: 200, g: 200, b: 200, a: 1 }),
  stroke: defaultStroke(),
  blendMode: "source-over" as GlobalCompositeOperation,
});

const nodeDefaults = (name: string) => ({
  id: newId(),
  name,
  transform: IDENTITY,
  opacity: 1,
  visible: true,
  locked: false,
});

export const createDocument = (
  width = 1280,
  height = 720,
  name = "Untitled",
): Document => {
  const layer = createLayer("Layer 1");
  return {
    id: newId(),
    name,
    width,
    height,
    layerOrder: [layer.id],
    nodes: { [layer.id]: layer },
  };
};

export const createLayer = (name = "Layer"): LayerNode => ({
  ...nodeDefaults(name),
  type: "layer",
  children: [],
});

export const createGroup = (name = "Group", children: NodeId[] = []): GroupNode => ({
  ...nodeDefaults(name),
  type: "group",
  children,
  clip: false,
});

export const createRect = (
  x: number,
  y: number,
  width: number,
  height: number,
): RectNode => ({
  ...nodeDefaults("Rectangle"),
  ...styleDefaults(),
  type: "rect",
  transform: { ...IDENTITY, e: x, f: y },
  width,
  height,
  rx: 0,
  ry: 0,
});

export const createEllipse = (
  cx: number,
  cy: number,
  rx: number,
  ry: number,
): EllipseNode => ({
  ...nodeDefaults("Ellipse"),
  ...styleDefaults(),
  type: "ellipse",
  transform: { ...IDENTITY, e: cx, f: cy },
  rx,
  ry,
});

export const createPath = (subpaths: SubPath[] = []): PathNode => ({
  ...nodeDefaults("Path"),
  ...styleDefaults(),
  fill: NO_PAINT,
  stroke: defaultStroke(),
  type: "path",
  subpaths,
});

export const createText = (text: string, at: Vec2): TextNode => ({
  ...nodeDefaults("Text"),
  ...styleDefaults(),
  fill: solid(BLACK),
  stroke: null,
  type: "text",
  transform: { ...IDENTITY, e: at.x, f: at.y },
  text,
  fontFamily: "sans-serif",
  fontSize: 24,
  fontWeight: 400,
  fontStyle: "normal",
  letterSpacing: 0,
  lineHeight: 1.2,
  textAlign: "left",
});

/** コーナーアンカー（ハンドルなし）を作るヘルパ */
export const corner = (point: Vec2): SubPath["anchors"][number] => ({
  point,
  handleIn: null,
  handleOut: null,
});
