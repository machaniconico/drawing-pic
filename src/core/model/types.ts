import type { Matrix } from "../geometry/matrix";
import type { Vec2 } from "../geometry/vector";

export type NodeId = string;

export interface Guide {
  id: NodeId;
  axis: "x" | "y";
  position: number;
  color?: string;
  locked?: boolean;
  hidden?: boolean;
}

// ─────────────────────────────────────────────
// 色・塗り
// ─────────────────────────────────────────────

/** 0–255 の RGB と 0–1 のアルファ */
export interface RGBA {
  r: number;
  g: number;
  b: number;
  a: number;
}

export interface GradientStop {
  offset: number; // 0–1
  color: RGBA;
}

export interface LinearGradient {
  type: "linear";
  stops: GradientStop[];
  /** ローカル座標での開始/終了点 */
  start: Vec2;
  end: Vec2;
}

export interface RadialGradient {
  type: "radial";
  stops: GradientStop[];
  center: Vec2;
  radius: number;
}

export interface PatternPaint {
  type: "pattern";
  /** タイルとして描く既存ノードの id */
  sourceId: NodeId;
  /** タイル変換: 等倍スケール */
  scale: number;
  /** ラジアン */
  rotation: number;
}

export type Paint =
  | { type: "none" }
  | { type: "solid"; color: RGBA }
  | LinearGradient
  | RadialGradient
  | PatternPaint;

export type LineCap = "butt" | "round" | "square";
export type LineJoin = "miter" | "round" | "bevel";

export interface Stroke {
  paint: Paint;
  width: number;
  cap: LineCap;
  join: LineJoin;
  miterLimit: number;
  /** 破線パターン（空配列で実線） */
  dash: number[];
  dashOffset: number;
  /** ストロークの位置。Illustrator準拠: center / inside / outside */
  align: "center" | "inside" | "outside";
}

// ─────────────────────────────────────────────
// パスジオメトリ
// ─────────────────────────────────────────────

/**
 * パスのアンカーポイント。
 * handleIn / handleOut はアンカーからの相対オフセット（ローカル座標）。
 * null の場合はコーナーポイント（ハンドルなし）。
 */
export interface Anchor {
  point: Vec2;
  handleIn: Vec2 | null;
  handleOut: Vec2 | null;
}

export interface SubPath {
  anchors: Anchor[];
  closed: boolean;
}

// ─────────────────────────────────────────────
// ノード階層
// ─────────────────────────────────────────────

interface NodeBase {
  id: NodeId;
  name: string;
  /** ローカル変換（親座標系へのマッピング） */
  transform: Matrix;
  opacity: number; // 0–1
  visible: boolean;
  locked: boolean;
}

/** 塗り・線を持つ図形ノードの共通プロパティ */
interface ShapeBase extends NodeBase {
  fill: Paint;
  stroke: Stroke | null;
  /** ブレンドモード（CSS/Canvas互換の文字列） */
  blendMode: GlobalCompositeOperation;
}

export interface PathNode extends ShapeBase {
  type: "path";
  subpaths: SubPath[];
}

export interface RectNode extends ShapeBase {
  type: "rect";
  /** ローカル原点からのサイズ */
  width: number;
  height: number;
  /** 角丸半径（x, y 個別） */
  rx: number;
  ry: number;
}

export interface EllipseNode extends ShapeBase {
  type: "ellipse";
  /** 中心はローカル原点。半径で表現 */
  rx: number;
  ry: number;
}

export interface TextNode extends ShapeBase {
  type: "text";
  text: string;
  fontFamily: string;
  fontSize: number;
  fontWeight: number;
  fontStyle: "normal" | "italic";
  letterSpacing: number;
  lineHeight: number;
  textAlign: "left" | "center" | "right";
}

export interface ImageNode extends NodeBase {
  type: "image";
  /** 画像ソース（data URL or asset id） */
  src: string;
  width: number;
  height: number;
}

export interface SymbolInstanceNode extends NodeBase {
  type: "symbol-instance";
  symbolId: NodeId;
}

export interface GroupNode extends NodeBase {
  type: "group";
  children: NodeId[];
  /** クリッピンググループか（先頭子をマスクに使う） */
  clip: boolean;
}

export interface LayerNode extends NodeBase {
  type: "layer";
  children: NodeId[];
}

export type ShapeNode = PathNode | RectNode | EllipseNode | TextNode | ImageNode | SymbolInstanceNode;
export type ContainerNode = LayerNode | GroupNode;
/** Full node union used by detached definition graphs. */
export type DefinitionNode = ShapeNode | ContainerNode;
/**
 * Nodes known to legacy scene consumers. Symbol instances are stored in this map at runtime,
 * but are intentionally opaque here so existing exhaustive consumers remain source-compatible.
 */
export type SceneNode = Exclude<ShapeNode, SymbolInstanceNode> | ContainerNode;

export type NodeType = DefinitionNode["type"];

export interface Artboard {
  id: NodeId;
  name: string;
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface SymbolDefinition {
  id: NodeId;
  name: string;
  /** Definition-local, self-contained node graph. Root nodes are those not referenced by a container. */
  nodes: DefinitionNode[];
}

// ─────────────────────────────────────────────
// ドキュメント
// ─────────────────────────────────────────────

/**
 * ドキュメント全体。ノードは id→node のフラットマップで保持し（正規化）、
 * 階層は children 配列で表現する。これにより参照・更新・Undoが扱いやすい。
 */
export interface Document {
  id: NodeId;
  name: string;
  /** アートボードサイズ（px） */
  width: number;
  height: number;
  /** 複数アートボード。未指定は旧形式として width/height から移行する。 */
  artboards?: Artboard[];
  /** 現在のアートボード。未指定時は先頭を使用する。 */
  activeArtboardId?: NodeId;
  /** 明示的なアートボード背景色。undefined/null は背景指定なし。 */
  background?: RGBA | null;
  /** ルート直下のレイヤー（描画は配列順 = 下→上） */
  layerOrder: NodeId[];
  guides: Guide[];
  nodes: Record<NodeId, SceneNode>;
  /** Optional on legacy in-memory documents; loaders normalize it to an empty record. */
  symbols?: Record<NodeId, SymbolDefinition>;
}

/** 型ガード群 */
export const isContainer = (n: DefinitionNode): n is ContainerNode =>
  n.type === "layer" || n.type === "group";

export const isShape = (n: DefinitionNode): n is ShapeNode =>
  n.type === "path" ||
  n.type === "rect" ||
  n.type === "ellipse" ||
  n.type === "text" ||
  n.type === "image" ||
  n.type === "symbol-instance";

export const hasStyle = (n: DefinitionNode): n is PathNode | RectNode | EllipseNode | TextNode =>
  n.type === "path" || n.type === "rect" || n.type === "ellipse" || n.type === "text";

/** Recover the runtime-only symbol branch from a legacy scene-map value. */
export const asSymbolInstance = (n: SceneNode | DefinitionNode): SymbolInstanceNode | null =>
  (n as { type: string }).type === "symbol-instance" ? n as SymbolInstanceNode : null;
