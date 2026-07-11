# drawing-pic

A vector-first drawing tool in the spirit of Adobe Illustrator, built with
React, TypeScript, Zustand, and Immer. Everything is a resolution-independent
vector scene: shapes are paths, effects are pure geometry, and the whole
document is an undoable, serializable data structure.

## Features

### Tools

- **Selection** and **Direct Select** (per-anchor editing)
- **Rectangle**, **Ellipse**, **Pen**, and **Type** creation
- **Eyedropper**, **Measure**, and **Hand** (pan)
- **Polygon** (⬡) and **Star** (★) inserts from the toolbar

### Shapes & styling

- Paths, rectangles (with editable corner radii), ellipses, text (multi-line,
  alignment, letter/line spacing), images, groups, and layers
- Solid, linear-gradient, radial-gradient, and **pattern** fills/strokes
- Stroke width, caps, joins, miter limit, dashes, and inside/center/outside
  alignment
- Per-node opacity and Canvas/CSS blend modes

### Path operations & effects

All effects are pure geometry that rewrite the selected shapes into paths, so
they compose freely with each other, boolean ops, and every exporter:

- **Offset Path** — parallel contour at a signed distance
- **Outline Stroke** — convert a stroke into a filled shape
- **Round Corners** — replace sharp corners with tangent bezier fillets
- **Zig Zag** — alternating ridge displacement along each segment
- **Simplify** — drop redundant near-collinear anchors within a tolerance
- **Reverse Path Direction** — flip winding for compound-path / even-odd fills
- **Boolean** union/subtract/intersect/exclude, convert-to-path, and grouping /
  clipping masks

### Layout & workflow

- Alignment, distribution (by edge and by gap), flip, and rotate
- Z-order controls, grouping, ungrouping, and clip masks
- Rulers, guides (lockable/hideable/colored), grid, and configurable snapping
- Full undo/redo history (capped at 100 snapshots)

### Import / export

- **Export** to SVG, PNG, and JSON project files
- **Import** raster images
- Snap and grid preferences persist across sessions

## Architecture

The code is layered so that geometry and model logic stay pure and testable,
independent of React and the DOM.

```
src/
  core/
    geometry/   Pure math: vectors, matrices, bbox, boolean ops, and the
                path effects (offsetPath, outlineStroke, roundCorners,
                zigzag, simplify).
    model/      Document types, node factory, bounds, hit-testing, snapping,
                measurement, and per-anchor path editing.
  state/        Zustand store (Immer-backed) with the command actions, undo
                history, selection, guides, layer reordering, and selectors.
  io/           Serialization (docSerialize) and exporters (svgExport,
                pngExport, imageImport).
  render/       Canvas renderer and pattern tile resolver.
  ui/           React components: Toolbar, CanvasView, PropertiesPanel,
                LayersPanel, rulers, export/import, and dialogs.
```

Key design choices:

- **Normalized document.** Nodes live in a flat `id → node` map; hierarchy is
  expressed with `children` arrays. This keeps references, updates, and undo
  simple.
- **Pure geometry, thin actions, declarative UI.** A feature is typically a
  pure function in `core/geometry` (fully unit-tested), a store action that
  applies it with history, and a control in the UI — see
  `applyInPlaceSubPathEffect` for the shared effect pipeline.
- **Immer + snapshot history.** Actions mutate a draft; a document snapshot is
  pushed to history only when something actually changed.

## Development

Requires Node 20+ and pnpm.

```bash
pnpm install       # install dependencies
pnpm dev           # start the Vite dev server
pnpm build         # type-check and build for production
pnpm typecheck     # type-check only
pnpm test          # run the Vitest suite
pnpm test:watch    # run tests in watch mode
```

The test suite (Vitest) is the CI gate. Prefer adding a pure function with its
own unit test when introducing new geometry or model behavior.
