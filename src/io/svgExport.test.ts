import { describe, expect, it } from "vitest";
import { IDENTITY } from "../core/geometry/matrix";
import {
  NO_PAINT,
  createDocument,
  createEllipse,
  createGroup,
  createPath,
  createRect,
  createText,
  defaultStroke,
  solid,
} from "../core/model/factory";
import type { Document, NodeId, SceneNode } from "../core/model/types";
import { documentToSvg } from "./svgExport";

const firstLayerId = (doc: Document): NodeId => doc.layerOrder[0]!;

const addNode = (doc: Document, node: SceneNode, parentId = firstLayerId(doc)): void => {
  doc.nodes[node.id] = node;
  const parent = doc.nodes[parentId];
  if (parent?.type === "layer" || parent?.type === "group") {
    parent.children.push(node.id);
  }
};

describe("documentToSvg", () => {
  it("exports a rect with transform, opacity, rounded corners, fill, and stroke", () => {
    const doc = createDocument(320, 240, "Rect");
    const rect = createRect(10, 20, 80, 40);
    rect.rx = 6;
    rect.ry = 8;
    rect.opacity = 0.5;
    rect.fill = solid({ r: 17, g: 34, b: 51, a: 0.75 });
    rect.stroke = {
      ...defaultStroke({ r: 255, g: 128, b: 0, a: 0.6 }, 3),
      cap: "round",
      join: "bevel",
      dash: [4, 2],
    };
    addNode(doc, rect);

    const svg = documentToSvg(doc);

    expect(svg).toContain('<svg xmlns="http://www.w3.org/2000/svg" width="320" height="240"');
    expect(svg).toContain('<rect transform="matrix(1 0 0 1 10 20)" opacity="0.5"');
    expect(svg).toContain('width="80" height="40" rx="6" ry="8"');
    expect(svg).toContain('fill="#112233" fill-opacity="0.75"');
    expect(svg).toContain('stroke="#ff8000" stroke-opacity="0.6" stroke-width="3"');
    expect(svg).toContain('stroke-linecap="round" stroke-linejoin="bevel"');
    expect(svg).toContain('stroke-dasharray="4 2"');
  });

  it("exports an ellipse centered on local origin", () => {
    const doc = createDocument(200, 100, "Ellipse");
    const ellipse = createEllipse(40, 50, 12, 18);
    ellipse.stroke = null;
    addNode(doc, ellipse);

    const svg = documentToSvg(doc);

    expect(svg).toContain('<ellipse transform="matrix(1 0 0 1 40 50)" opacity="1"');
    expect(svg).toContain('cx="0" cy="0" rx="12" ry="18"');
    expect(svg).toContain('stroke="none"');
  });

  it("exports closed bezier paths with curve and close commands", () => {
    const doc = createDocument(120, 120, "Path");
    const path = createPath([
      {
        anchors: [
          { point: { x: 0, y: 0 }, handleIn: { x: -10, y: 0 }, handleOut: { x: 10, y: 0 } },
          { point: { x: 40, y: 0 }, handleIn: { x: -10, y: 0 }, handleOut: null },
          { point: { x: 20, y: 30 }, handleIn: null, handleOut: { x: -5, y: -10 } },
        ],
        closed: true,
      },
    ]);
    path.transform = { ...IDENTITY, e: 5, f: 7 };
    addNode(doc, path);

    const svg = documentToSvg(doc);

    expect(svg).toContain(
      'd="M 0 0 C 10 0 30 0 40 0 L 20 30 C 15 20 -10 0 0 0 Z"',
    );
  });

  it("escapes text content and attribute values", () => {
    const doc = createDocument(160, 90, "Text");
    const text = createText('A&B <C> "D"', { x: 12, y: 34 });
    text.fontFamily = 'Inter & "Display"';
    text.fill = solid({ r: 0, g: 0, b: 0, a: 1 });
    addNode(doc, text);

    const svg = documentToSvg(doc);

    expect(svg).toContain('font-family="Inter &amp; &quot;Display&quot;"');
    expect(svg).toContain(">A&amp;B &lt;C&gt; &quot;D&quot;</text>");
  });

  it("maps solid and none fills", () => {
    const doc = createDocument(200, 200, "Fill");
    const solidRect = createRect(0, 0, 10, 10);
    solidRect.fill = solid({ r: 12, g: 34, b: 56, a: 0.25 });
    solidRect.stroke = null;
    const noneRect = createRect(20, 0, 10, 10);
    noneRect.fill = NO_PAINT;
    noneRect.stroke = null;
    addNode(doc, solidRect);
    addNode(doc, noneRect);

    const svg = documentToSvg(doc);

    expect(svg).toContain('fill="#0c2238" fill-opacity="0.25"');
    expect(svg).toContain('fill="none" stroke="none"');
  });

  it("emits linear gradient defs and fill references", () => {
    const doc = createDocument(200, 100, "Gradient");
    const rect = createRect(0, 0, 100, 40);
    rect.fill = {
      type: "linear",
      start: { x: 0, y: 0 },
      end: { x: 100, y: 0 },
      stops: [
        { offset: 0, color: { r: 255, g: 0, b: 0, a: 1 } },
        { offset: 1, color: { r: 0, g: 0, b: 255, a: 0.5 } },
      ],
    };
    rect.stroke = null;
    addNode(doc, rect);

    const svg = documentToSvg(doc);

    expect(svg).toContain("<defs>");
    expect(svg).toContain(
      '<linearGradient id="svg-export-gradient-1" gradientUnits="userSpaceOnUse" x1="0" y1="0" x2="100" y2="0">',
    );
    expect(svg).toContain('<stop offset="0" stop-color="#ff0000" stop-opacity="1" />');
    expect(svg).toContain('<stop offset="1" stop-color="#0000ff" stop-opacity="0.5" />');
    expect(svg).toContain('fill="url(#svg-export-gradient-1)"');
  });

  it("emits radial gradient defs using local user-space coordinates", () => {
    const doc = createDocument(120, 120, "Radial Gradient");
    const ellipse = createEllipse(20, 30, 40, 25);
    ellipse.fill = {
      type: "radial",
      center: { x: 10, y: 12 },
      radius: 35,
      stops: [
        { offset: 0, color: { r: 255, g: 255, b: 255, a: 1 } },
        { offset: 1, color: { r: 0, g: 0, b: 0, a: 1 } },
      ],
    };
    ellipse.stroke = null;
    addNode(doc, ellipse);

    const svg = documentToSvg(doc);

    expect(svg).toContain(
      '<radialGradient id="svg-export-gradient-1" gradientUnits="userSpaceOnUse" cx="10" cy="12" r="35">',
    );
    expect(svg).toContain('fill="url(#svg-export-gradient-1)"');
  });

  it("skips hidden nodes and preserves group recursion", () => {
    const doc = createDocument(200, 200, "Group");
    const group = createGroup("Group");
    group.transform = { ...IDENTITY, e: 4, f: 5 };
    const hidden = createRect(0, 0, 20, 20);
    hidden.visible = false;
    const visible = createRect(1, 2, 3, 4);
    addNode(doc, group);
    addNode(doc, hidden, group.id);
    addNode(doc, visible, group.id);

    const svg = documentToSvg(doc);

    expect(svg).toContain('<g transform="matrix(1 0 0 1 4 5)" opacity="1">');
    expect(svg).toContain('width="3" height="4"');
    expect(svg).not.toContain('width="20" height="20"');
  });
});
