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

const setBlendMode = <T extends SceneNode>(node: T, blendMode: GlobalCompositeOperation): T =>
  Object.assign(node, { blendMode });

describe("documentToSvg", () => {
  it("emits the document background as the first body element when present", () => {
    const doc = createDocument(320, 240, "Background");
    doc.background = { r: 12, g: 34, b: 56, a: 0.4 };
    const rect = createRect(10, 20, 80, 40);
    addNode(doc, rect);

    const svg = documentToSvg(doc);
    const background = '<rect x="0" y="0" width="320" height="240" fill="#0c2238" fill-opacity="0.4" />';

    expect(svg).toContain(`viewBox="0 0 320 240">${background}<g`);
    expect(svg.indexOf(background)).toBeLessThan(svg.indexOf("<g"));
    expect(svg).toContain('<rect transform="matrix(1 0 0 1 10 20)" opacity="1"');
  });

  it("keeps transparent export output unchanged when the document background is absent", () => {
    const doc = createDocument(100, 80, "No background");
    doc.background = null;

    expect(documentToSvg(doc)).toBe(
      '<svg xmlns="http://www.w3.org/2000/svg" width="100" height="80" viewBox="0 0 100 80"><g transform="matrix(1 0 0 1 0 0)" opacity="1"></g></svg>',
    );
  });

  it("keeps empty options byte-for-byte equivalent to the default export", () => {
    const doc = createDocument(320, 240, "Back compat");
    const rect = createRect(10, 20, 80, 40);
    addNode(doc, rect);

    const svg = documentToSvg(doc);

    expect(documentToSvg(doc, undefined)).toBe(svg);
    expect(documentToSvg(doc, {})).toBe(svg);
  });

  it("omits mix-blend-mode for default and source-over blend modes", () => {
    const doc = createDocument(320, 240, "Normal blend");
    const defaultRect = createRect(10, 20, 80, 40);
    const sourceOverRect = createRect(100, 20, 80, 40);
    sourceOverRect.blendMode = "source-over";
    addNode(doc, defaultRect);
    addNode(doc, sourceOverRect);

    const svg = documentToSvg(doc);

    expect(svg).not.toContain("mix-blend-mode");
    expect(svg).not.toContain('style="');
  });

  it("scales root width and height without changing the document viewBox", () => {
    const doc = createDocument(320, 240, "Scaled");
    const rect = createRect(10, 20, 80, 40);
    addNode(doc, rect);

    const svg = documentToSvg(doc, { scale: 2 });

    expect(svg).toContain(
      '<svg xmlns="http://www.w3.org/2000/svg" width="640" height="480" viewBox="0 0 320 240">',
    );
  });

  it("isolates selected subtrees and crops the SVG viewBox to selected node world bounds", () => {
    const doc = createDocument(320, 240, "Selection");
    const group = createGroup("Translated group");
    group.transform = { ...IDENTITY, e: 100, f: 200 };
    const unselected = createRect(5, 6, 10, 12);
    const overlappingUnselected = createRect(140, 250, 99, 99);
    overlappingUnselected.fill = solid({ r: 255, g: 0, b: 0, a: 1 });
    const selected = createRect(40, 50, 20, 30);
    selected.fill = solid({ r: 0, g: 170, b: 0, a: 1 });
    addNode(doc, unselected);
    addNode(doc, overlappingUnselected);
    addNode(doc, group);
    addNode(doc, selected, group.id);

    const svg = documentToSvg(doc, { nodeIds: [selected.id] });

    expect(svg).toContain(
      '<svg xmlns="http://www.w3.org/2000/svg" width="20" height="30" viewBox="140 250 20 30">',
    );
    expect(svg).toContain('<g transform="matrix(1 0 0 1 100 200)">');
    expect(svg).toContain('transform="matrix(1 0 0 1 40 50)"');
    expect(svg).toContain('fill="#00aa00"');
    expect(svg).not.toContain('transform="matrix(1 0 0 1 5 6)"');
    expect(svg).not.toContain('transform="matrix(1 0 0 1 140 250)"');
    expect(svg).not.toContain('fill="#ff0000"');
    expect(svg).not.toContain('width="99" height="99"');
  });

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

  it("exports inside-aligned rect strokes as clipped double-width stroke-only copies above fill", () => {
    const doc = createDocument(100, 80, "Inside stroke");
    const rect = createRect(10, 20, 30, 40);
    rect.fill = solid({ r: 255, g: 0, b: 0, a: 1 });
    rect.stroke = {
      ...defaultStroke({ r: 0, g: 0, b: 255, a: 1 }, 3),
      align: "inside",
      dash: [5, 2],
    };
    addNode(doc, rect);

    const svg = documentToSvg(doc);
    const fillOnly =
      '<rect transform="matrix(1 0 0 1 10 20)" opacity="1" x="0" y="0" width="30" height="40" fill="#ff0000" fill-opacity="1" stroke="none" />';
    const strokeOnly =
      '<rect transform="matrix(1 0 0 1 10 20)" opacity="1" x="0" y="0" width="30" height="40" fill="none" stroke="#0000ff" stroke-opacity="1" stroke-width="6" stroke-linecap="butt" stroke-linejoin="miter" stroke-miterlimit="10" stroke-dasharray="5 2" clip-path="url(#svg-export-clip-1)" />';

    expect(svg).toContain(
      '<defs><clipPath id="svg-export-clip-1"><rect x="0" y="0" width="30" height="40" /></clipPath></defs>',
    );
    expect(svg).toContain(fillOnly + strokeOnly);
    expect(svg.indexOf(fillOnly)).toBeLessThan(svg.indexOf(strokeOnly));
    expect(svg).not.toContain('stroke-width="3"');
  });

  it("exports outside-aligned ellipse strokes with an evenodd complement clipPath", () => {
    const doc = createDocument(100, 80, "Outside stroke");
    const ellipse = createEllipse(25, 30, 12, 8);
    ellipse.stroke = {
      ...defaultStroke({ r: 255, g: 128, b: 0, a: 1 }, 4),
      align: "outside",
    };
    addNode(doc, ellipse);

    const svg = documentToSvg(doc);

    expect(svg).toContain(
      '<clipPath id="svg-export-clip-1"><path clip-rule="evenodd" d="M -10000000 -10000000 H 10000000 V 10000000 H -10000000 Z M -12 0 A 12 8 0 1 0 12 0 A 12 8 0 1 0 -12 0 Z" /></clipPath>',
    );
    expect(svg).toContain(
      '<ellipse transform="matrix(1 0 0 1 25 30)" opacity="1" cx="0" cy="0" rx="12" ry="8" fill="none" stroke="#ff8000" stroke-opacity="1" stroke-width="8" stroke-linecap="butt" stroke-linejoin="miter" stroke-miterlimit="10" clip-path="url(#svg-export-clip-1)" />',
    );
  });

  it("keeps center-aligned stroke output byte-for-byte unchanged", () => {
    const doc = createDocument(100, 80, "Center stroke");
    const rect = createRect(1, 2, 10, 20);
    rect.stroke = {
      ...defaultStroke({ r: 0, g: 0, b: 0, a: 1 }, 2),
      align: "center",
    };
    addNode(doc, rect);

    expect(documentToSvg(doc)).toBe(
      '<svg xmlns="http://www.w3.org/2000/svg" width="100" height="80" viewBox="0 0 100 80"><g transform="matrix(1 0 0 1 0 0)" opacity="1"><rect transform="matrix(1 0 0 1 1 2)" opacity="1" x="0" y="0" width="10" height="20" fill="#c8c8c8" fill-opacity="1" stroke="#000000" stroke-opacity="1" stroke-width="2" stroke-linecap="butt" stroke-linejoin="miter" stroke-miterlimit="10" /></g></svg>',
    );
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

  it("emits a clipPath for clip groups and does not paint the frontmost mask child", () => {
    const doc = createDocument(120, 90, "Clip Group");
    const group = createGroup("Clipped");
    group.clip = true;
    group.transform = { ...IDENTITY, e: 10, f: 20 };
    const clipped = createRect(0, 0, 80, 60);
    clipped.fill = {
      type: "linear",
      start: { x: 0, y: 0 },
      end: { x: 80, y: 0 },
      stops: [
        { offset: 0, color: { r: 255, g: 0, b: 0, a: 1 } },
        { offset: 1, color: { r: 0, g: 0, b: 255, a: 1 } },
      ],
    };
    clipped.stroke = null;
    const mask = createRect(5, 6, 20, 30);
    mask.fill = solid({ r: 0, g: 255, b: 0, a: 0.25 });
    mask.opacity = 0.4;
    mask.stroke = defaultStroke({ r: 255, g: 0, b: 0, a: 1 }, 8);
    addNode(doc, group);
    addNode(doc, clipped, group.id);
    addNode(doc, mask, group.id);

    const svg = documentToSvg(doc);

    expect(svg).toContain("<defs>");
    expect(svg).toContain('<linearGradient id="svg-export-gradient-1"');
    expect(svg).toContain(
      '<clipPath id="svg-export-clip-1"><rect transform="matrix(1 0 0 1 5 6)" x="0" y="0" width="20" height="30" /></clipPath>',
    );
    expect(svg).toContain(
      '<g transform="matrix(1 0 0 1 10 20)" opacity="1" clip-path="url(#svg-export-clip-1)">',
    );
    expect(svg).toContain(
      '<rect transform="matrix(1 0 0 1 0 0)" opacity="1" x="0" y="0" width="80" height="60" fill="url(#svg-export-gradient-1)" stroke="none" />',
    );
    expect(svg).not.toContain('opacity="0.4" x="0" y="0" width="20" height="30"');
    expect(svg).not.toContain('fill="#00ff00" fill-opacity="0.25"');
    expect(svg).not.toContain('stroke-width="8"');
    expect(svg.indexOf('id="svg-export-gradient-1"')).toBeLessThan(
      svg.indexOf('id="svg-export-clip-1"'),
    );
  });

  it("keeps non-clip group export byte-for-byte unchanged", () => {
    const doc = createDocument(100, 80, "Non Clip Group");
    const group = createGroup("Plain group");
    const bottom = createRect(1, 2, 10, 20);
    const front = createRect(3, 4, 5, 6);
    addNode(doc, group);
    addNode(doc, bottom, group.id);
    addNode(doc, front, group.id);

    expect(documentToSvg(doc)).toBe(
      '<svg xmlns="http://www.w3.org/2000/svg" width="100" height="80" viewBox="0 0 100 80"><g transform="matrix(1 0 0 1 0 0)" opacity="1"><g transform="matrix(1 0 0 1 0 0)" opacity="1"><rect transform="matrix(1 0 0 1 1 2)" opacity="1" x="0" y="0" width="10" height="20" fill="#c8c8c8" fill-opacity="1" stroke="#000000" stroke-opacity="1" stroke-width="1" stroke-linecap="butt" stroke-linejoin="miter" stroke-miterlimit="10" /><rect transform="matrix(1 0 0 1 3 4)" opacity="1" x="0" y="0" width="5" height="6" fill="#c8c8c8" fill-opacity="1" stroke="#000000" stroke-opacity="1" stroke-width="1" stroke-linecap="butt" stroke-linejoin="miter" stroke-miterlimit="10" /></g></g></svg>',
    );
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

  it("emits CSS mix-blend-mode for compatible blend modes on elements and containers", () => {
    const doc = createDocument(200, 200, "Blend");
    const group = createGroup("Blending group");
    group.transform = { ...IDENTITY, e: 4, f: 5 };
    setBlendMode(group, "screen");
    const rect = createRect(1, 2, 3, 4);
    rect.blendMode = "multiply";
    addNode(doc, group);
    addNode(doc, rect, group.id);

    const svg = documentToSvg(doc);

    expect(svg).toContain(
      '<g transform="matrix(1 0 0 1 4 5)" opacity="1" style="mix-blend-mode:screen">',
    );
    expect(svg).toContain(
      '<rect transform="matrix(1 0 0 1 1 2)" opacity="1" style="mix-blend-mode:multiply"',
    );
  });

  it("omits mix-blend-mode for Canvas-only composite operations", () => {
    const doc = createDocument(200, 200, "Canvas-only blends");
    const lighter = createRect(0, 0, 10, 10);
    lighter.blendMode = "lighter";
    const copy = createRect(20, 0, 10, 10);
    copy.blendMode = "copy";
    const xor = createRect(40, 0, 10, 10);
    xor.blendMode = "xor";
    addNode(doc, lighter);
    addNode(doc, copy);
    addNode(doc, xor);

    const svg = documentToSvg(doc);

    expect(svg).not.toContain("mix-blend-mode");
    expect(svg).not.toContain('style="');
  });
});
