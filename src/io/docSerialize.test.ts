import { describe, expect, it } from "vitest";
import { IDENTITY } from "../core/geometry/matrix";
import {
  createDocument,
  createGroup,
  createPath,
  createRect,
  defaultStroke,
} from "../core/model/factory";
import type { Document, NodeId, SceneNode } from "../core/model/types";
import { deserializeDocument, serializeDocument } from "./docSerialize";

const firstLayerId = (doc: Document): NodeId => doc.layerOrder[0]!;

const addNode = (doc: Document, node: SceneNode, parentId = firstLayerId(doc)): void => {
  doc.nodes[node.id] = node;
  const parent = doc.nodes[parentId];
  if (parent?.type === "layer" || parent?.type === "group") {
    parent.children.push(node.id);
  }
};

const createRichDocument = (): Document => {
  const doc = createDocument(640, 480, "Persistence Test");
  doc.id = "doc_serialize_test";
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

  it("loads legacy v1 documents without guides as an empty guide list", () => {
    const doc = createRichDocument();
    const legacyDoc: Omit<Document, "guides"> & { guides?: Document["guides"] } = { ...doc };
    delete legacyDoc.guides;

    expect(deserializeDocument(JSON.stringify({ version: 1, doc: legacyDoc })).guides).toEqual([]);
  });

  it("rejects malformed document shape", () => {
    const doc = createRichDocument();

    expect(() => deserializeDocument(JSON.stringify({ version: 1, doc: { ...doc, width: "wide" } }))).toThrow(
      /doc.width must be a finite number/,
    );
  });
});
