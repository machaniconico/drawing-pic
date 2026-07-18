import { describe, expect, it } from "vitest";
import richDocNoPatternFixture from "./__fixtures__/rich-doc-no-pattern.v1.json";
import { IDENTITY } from "../core/geometry/matrix";
import {
  createDocument,
  createGroup,
  createPath,
  createRect,
  defaultStroke,
} from "../core/model/factory";
import type { DefinitionNode, Document, NodeId, SceneNode } from "../core/model/types";
import { editorStore } from "../state/store";
import { deserializeDocument, serializeDocument } from "./docSerialize";
import { documentToSvg } from "./svgExport";

const firstLayerId = (doc: Document): NodeId => doc.layerOrder[0]!;

const addNode = (doc: Document, node: DefinitionNode, parentId = firstLayerId(doc)): void => {
  doc.nodes[node.id] = node as SceneNode;
  const parent = doc.nodes[parentId];
  if (parent?.type === "layer" || parent?.type === "group") {
    parent.children.push(node.id);
  }
};

const createRichDocument = (): Document => {
  const doc = createDocument(640, 480, "Persistence Test");
  doc.symbols = {};
  doc.id = "doc_serialize_test";
  doc.artboards = [
    { id: "artboard_1", name: "Artboard 1", x: 0, y: 0, width: 640, height: 480 },
  ];
  doc.activeArtboardId = "artboard_1";
  const layerId = firstLayerId(doc);
  const layer = doc.nodes[layerId];
  if (layer?.type === "layer") {
    layer.id = "layer_1";
    layer.name = "Layer 1";
    doc.nodes = { layer_1: layer };
    doc.layerOrder = ["layer_1"];
  }

  const group = createGroup("Outer Group", []);
  group.id = "group_outer";
  group.transform = { ...IDENTITY, e: 12, f: 24 };
  addNode(doc, group, "layer_1");

  const nestedGroup = createGroup("Nested Group", []);
  nestedGroup.id = "group_nested";
  nestedGroup.clip = true;
  nestedGroup.transform = { ...IDENTITY, e: 4, f: 8 };
  addNode(doc, nestedGroup, group.id);

  const path = createPath([
    {
      anchors: [
        { point: { x: 0, y: 0 }, handleIn: null, handleOut: { x: 20, y: 0 } },
        { point: { x: 70, y: 12 }, handleIn: { x: -12, y: -18 }, handleOut: { x: 8, y: 22 } },
        { point: { x: 20, y: 80 }, handleIn: { x: 14, y: -10 }, handleOut: null },
      ],
      closed: true,
    },
  ]);
  path.id = "bezier_path";
  path.name = "Gradient Bezier";
  path.fill = {
    type: "linear",
    stops: [
      { offset: 0, color: { r: 255, g: 64, b: 32, a: 1 } },
      { offset: 0.5, color: { r: 64, g: 128, b: 255, a: 0.7 } },
      { offset: 1, color: { r: 20, g: 20, b: 40, a: 1 } },
    ],
    start: { x: 0, y: 0 },
    end: { x: 100, y: 80 },
  };
  path.stroke = {
    ...defaultStroke({ r: 255, g: 255, b: 255, a: 0.9 }, 2),
    cap: "round",
    join: "round",
  };
  addNode(doc, path, nestedGroup.id);

  const rect = createRect(120, 40, 90, 50);
  rect.id = "sibling_rect";
  rect.fill = { type: "none" };
  addNode(doc, rect, group.id);

  return doc;
};

describe("docSerialize", () => {
  it("round-trips a nested group with a bezier path and gradient fill", () => {
    const doc = createRichDocument();

    expect(deserializeDocument(serializeDocument(doc))).toEqual(doc);
  });

  it("round-trips symbol definitions and instances", () => {
    const doc = createRichDocument();
    const symbolNode = createRect(0, 0, 32, 24);
    symbolNode.id = "symbol_rect";
    doc.symbols = {
      symbol_badge: {
        id: "symbol_badge",
        name: "Badge",
        nodes: [symbolNode],
      },
    };
    addNode(doc, {
      id: "badge_instance",
      name: "Badge",
      type: "symbol-instance",
      symbolId: "symbol_badge",
      transform: { ...IDENTITY, e: 120, f: 80 },
      opacity: 1,
      visible: true,
      locked: false,
    });

    const serialized = serializeDocument(doc);
    const result = deserializeDocument(serialized);

    expect(result).toEqual(doc);
    expect(serializeDocument(result)).toBe(serialized);
  });

  it("defaults legacy documents without symbols to an empty symbol map", () => {
    const doc = createRichDocument();
    delete doc.symbols;

    expect(deserializeDocument(JSON.stringify({ version: 1, doc })).symbols).toEqual({});
  });

  it("rejects container child cycles inside symbol definitions", () => {
    const doc = createRichDocument();
    const first = createGroup("First", ["cycle_second"]);
    first.id = "cycle_first";
    const second = createGroup("Second", ["cycle_first"]);
    second.id = "cycle_second";
    doc.symbols = {
      cyclic: {
        id: "cyclic",
        name: "Cyclic",
        nodes: [first, second],
      },
    };

    expect(() => serializeDocument(doc)).toThrow(/container child cycle/);
    expect(() => deserializeDocument(JSON.stringify({ version: 1, doc }))).toThrow(/container child cycle/);
  });

  it("round-trips pattern paints byte-for-byte with stable key order", () => {
    const doc = createRichDocument();
    const rect = doc.nodes.sibling_rect;
    if (rect?.type !== "rect") {
      throw new Error("Expected sibling_rect fixture node.");
    }
    rect.fill = {
      rotation: Math.PI / 4,
      scale: 2,
      sourceId: "missing_pattern_source",
      type: "pattern",
    };

    const serialized = serializeDocument(doc);

    expect(serializeDocument(deserializeDocument(serialized))).toBe(serialized);
    expect(serialized).toContain(
      [
        '        "fill": {',
        '          "type": "pattern",',
        '          "sourceId": "missing_pattern_source",',
        '          "scale": 2,',
        '          "rotation": 0.7853981633974483',
        "        }",
      ].join("\n"),
    );
  });

  it("includes the version wrapper field", () => {
    const parsed = JSON.parse(serializeDocument(createRichDocument())) as unknown;

    expect(parsed).toMatchObject({ version: 1 });
  });

  it("rejects malformed JSON", () => {
    expect(() => deserializeDocument("{ nope")).toThrow(/Malformed document JSON/);
  });

  it("rejects wrong and missing versions", () => {
    const doc = createRichDocument();

    expect(() => deserializeDocument(JSON.stringify({ version: 2, doc }))).toThrow(/Unsupported document JSON version/);
    expect(() => deserializeDocument(JSON.stringify({ doc }))).toThrow(/missing version/i);
  });

  it("preserves layerOrder and the nodes map", () => {
    const doc = createRichDocument();
    const result = deserializeDocument(serializeDocument(doc));

    expect(result.layerOrder).toEqual(["layer_1"]);
    expect(Object.keys(result.nodes).sort()).toEqual(["bezier_path", "group_nested", "group_outer", "layer_1", "sibling_rect"]);
    expect(result.nodes.group_outer).toEqual(doc.nodes.group_outer);
  });

  it("round-trips guides", () => {
    const doc = createRichDocument();
    doc.guides = [
      { id: "guide_vertical", axis: "x", position: 120 },
      { id: "guide_horizontal", axis: "y", position: 240 },
    ];

    expect(deserializeDocument(serializeDocument(doc)).guides).toEqual(doc.guides);
  });

  it("round-trips multiple artboards and the active artboard", () => {
    const doc = createRichDocument();
    doc.artboards = [
      { id: "artboard_1", name: "Cover", x: 0, y: 0, width: 640, height: 480 },
      { id: "artboard_2", name: "Back", x: 704, y: 20, width: 320, height: 240 },
    ];
    doc.activeArtboardId = "artboard_2";
    doc.width = 320;
    doc.height = 240;

    expect(deserializeDocument(serializeDocument(doc))).toEqual(doc);
  });

  it("rebases a non-origin active artboard for active-size SVG export", () => {
    const doc = createRichDocument();
    doc.artboards = [
      { id: "artboard_1", name: "Cover", x: 0, y: 0, width: 640, height: 480 },
      { id: "artboard_2", name: "Back", x: 704, y: 20, width: 320, height: 240 },
    ];
    const backRect = createRect(720, 30, 80, 40);
    backRect.id = "back_rect";
    addNode(doc, backRect, "layer_1");

    editorStore.getState().loadDocument(doc);
    editorStore.getState().setActiveArtboard("artboard_2");
    const activeDoc = editorStore.getState().doc;

    expect(activeDoc.artboards?.find((artboard) => artboard.id === "artboard_2")).toMatchObject({
      x: 0,
      y: 0,
      width: 320,
      height: 240,
    });
    expect(activeDoc.nodes.layer_1?.transform).toMatchObject({ e: -704, f: -20 });
    expect(documentToSvg(activeDoc)).toContain('viewBox="0 0 320 240"');
  });

  it("migrates legacy single-size documents to one artboard", () => {
    const doc = createRichDocument();
    const legacyDoc = { ...doc };
    delete legacyDoc.artboards;
    delete legacyDoc.activeArtboardId;

    const result = deserializeDocument(JSON.stringify({ version: 1, doc: legacyDoc }));

    expect(result.artboards).toEqual([
      {
        id: "doc_serialize_test_artboard_1",
        name: "Artboard 1",
        x: 0,
        y: 0,
        width: 640,
        height: 480,
      },
    ]);
    expect(result.activeArtboardId).toBe("doc_serialize_test_artboard_1");
  });

  it("round-trips guide preferences", () => {
    const doc = createRichDocument();
    doc.guides = [
      { id: "guide_vertical", axis: "x", position: 120, color: "#00d8ff", locked: true, hidden: true },
      { id: "guide_horizontal", axis: "y", position: 240, locked: false, hidden: false },
    ];

    expect(deserializeDocument(serializeDocument(doc)).guides).toEqual(doc.guides);
  });

  it("round-trips an explicit background color", () => {
    const doc = createRichDocument();
    doc.background = { r: 24, g: 48, b: 96, a: 0.75 };

    expect(deserializeDocument(serializeDocument(doc)).background).toEqual(doc.background);
  });

  it("omits background when it is not defined", () => {
    const serialized = serializeDocument(createRichDocument());
    const parsed = JSON.parse(serialized) as { doc: Record<string, unknown> };

    expect(parsed.doc).not.toHaveProperty("background");
    expect(serialized).not.toContain('"background"');
  });

  it("loads legacy v1 documents without background", () => {
    const doc = createRichDocument();
    const legacyDoc: Omit<Document, "background"> & { background?: Document["background"] } = { ...doc };
    delete legacyDoc.background;

    const result = deserializeDocument(JSON.stringify({ version: 1, doc: legacyDoc }));

    expect(result).not.toHaveProperty("background");
  });

  it("rejects invalid background colors", () => {
    const doc = createRichDocument();

    expect(() =>
      deserializeDocument(JSON.stringify({ version: 1, doc: { ...doc, background: { r: 24, g: 48, b: "blue", a: 1 } } })),
    ).toThrow(/doc.background.b must be a finite number/);
  });

  it("loads legacy v1 documents without guides as an empty guide list", () => {
    const doc = createRichDocument();
    const legacyDoc: Omit<Document, "guides"> & { guides?: Document["guides"] } = { ...doc };
    delete legacyDoc.guides;

    expect(deserializeDocument(JSON.stringify({ version: 1, doc: legacyDoc })).guides).toEqual([]);
  });

  it("legacy docs without pattern paints still load", () => {
    const doc = createRichDocument();

    expect(deserializeDocument(JSON.stringify({ version: 1, doc }))).toEqual(doc);
  });

  it("keeps the legacy document payload byte-for-byte after removing additive artboard fields", () => {
    // fixture は PatternPaint 導入時点の serializeDocument 出力をピン留めしたもの。
    // serializeDocument は JSON.stringify(…, null, 2) なので再 stringify でバイト列が再現できる。
    const fixture = JSON.stringify(richDocNoPatternFixture, null, 2);

    const serialized = JSON.parse(serializeDocument(createRichDocument())) as {
      version: number;
      doc: Record<string, unknown>;
    };
    delete serialized.doc.artboards;
    delete serialized.doc.activeArtboardId;

    expect(JSON.stringify(serialized, null, 2)).toBe(fixture);
  });

  it("loads legacy guides without preference fields unchanged", () => {
    const doc = createRichDocument();
    doc.guides = [{ id: "legacy_guide", axis: "x", position: 120 }];

    expect(deserializeDocument(JSON.stringify({ version: 1, doc })).guides).toEqual([
      { id: "legacy_guide", axis: "x", position: 120 },
    ]);
  });

  it("rejects malformed document shape", () => {
    const doc = createRichDocument();

    expect(() => deserializeDocument(JSON.stringify({ version: 1, doc: { ...doc, width: "wide" } }))).toThrow(
      /doc.width must be a finite number/,
    );
  });

  it("rejects malformed and duplicate artboards", () => {
    const doc = createRichDocument();

    expect(() =>
      deserializeDocument(JSON.stringify({ version: 1, doc: { ...doc, artboards: [] } })),
    ).toThrow(/non-empty array/);
    expect(() =>
      deserializeDocument(JSON.stringify({
        version: 1,
        doc: {
          ...doc,
          artboards: [{ id: "bad", name: "Bad", x: 0, y: 0, width: 0, height: 100 }],
        },
      })),
    ).toThrow(/dimensions must be greater than 0/);
    expect(() =>
      deserializeDocument(JSON.stringify({
        version: 1,
        doc: {
          ...doc,
          artboards: [
            { id: "same", name: "One", x: 0, y: 0, width: 100, height: 100 },
            { id: "same", name: "Two", x: 164, y: 0, width: 100, height: 100 },
          ],
        },
      })),
    ).toThrow(/ids must be unique/);
  });

  it("rejects malformed pattern paints with path-prefixed errors", () => {
    const doc = createRichDocument();
    const rect = doc.nodes.sibling_rect;
    if (rect?.type !== "rect") {
      throw new Error("Expected sibling_rect fixture node.");
    }

    rect.fill = { type: "pattern", scale: 1, rotation: 0 } as typeof rect.fill;
    expect(() => deserializeDocument(JSON.stringify({ version: 1, doc }))).toThrow(
      /doc.nodes.sibling_rect.fill.sourceId must be a string/,
    );

    rect.fill = { type: "pattern", sourceId: "pattern_tile", scale: 0, rotation: 0 };
    expect(() => deserializeDocument(JSON.stringify({ version: 1, doc }))).toThrow(
      /doc.nodes.sibling_rect.fill.scale must be greater than 0/,
    );

    rect.fill = { type: "pattern", sourceId: "pattern_tile", scale: 1, rotation: Number.POSITIVE_INFINITY };
    expect(() => deserializeDocument(JSON.stringify({ version: 1, doc }))).toThrow(
      /doc.nodes.sibling_rect.fill.rotation must be a finite number/,
    );
  });
});
