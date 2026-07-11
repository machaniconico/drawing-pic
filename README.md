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
- **Zig Zag** — alternating ridge displacement along each segment (sharp or
  smooth-wave mode)
- **Simplify** — drop redundant near-collinear anchors within a tolerance
- **Smooth** — convert every anchor to a smooth auto-tangent point
- **Pucker & Bloat** — radial handle distortion (bulge out or spike in)
- **Twist** — rotate anchors around the centroid, scaled by distance
- **Reverse Path Direction** — flip winding for compound-path / even-odd fills
- **Boolean** union/subtract/intersect/exclude, convert-to-path, and grouping /
  clipping masks
- **Compound Path** — merge selected shapes into one path (holes via reversing
  an inner subpath under the non-zero fill rule), and **Release** to split a
  compound path back into separate paths

### Layout & workflow

- Alignment (to selection, a key object, or the artboard), distribution (by
  edge and by gap), flip, and rotate
- Z-order controls, grouping, ungrouping, and clip masks
- Rulers, guides (lockable/hideable/colored), grid, and configurable snapping
- Full undo/redo history (capped at 100 snapshots)

### Import / export

- **Export** to SVG and PNG, with a scale factor and an optional
  selection-only crop, plus JSON project save
- **Open** saved JSON documents and **import** raster images
- Snap and grid preferences persist across sessions

### Keyboard shortcuts

`Cmd` on macOS, `Ctrl` on Windows/Linux.

| Keys | Action |
|------|--------|
| `V` `A` `M` `L` `P` `T` `I` `K` `H` | Select / Direct Select / Rectangle / Ellipse / Pen / Type / Eyedropper / Measure / Hand |
| `Cmd+A` / `Cmd+Shift+A` / `Cmd+Shift+I` | Select all / Deselect / Invert selection |
| `Cmd+Z` / `Cmd+Shift+Z` | Undo / Redo |
| `Cmd+C` `Cmd+V` `Cmd+Shift+V` `Cmd+D` | Copy / Paste / Paste in place / Duplicate |
| `Delete` / `Backspace` | Delete selection |
| Arrow keys (`Shift` = 10 px) | Nudge selection |
| `Shift+H` / `Shift+V` | Flip horizontal / vertical |
| `Cmd+G` / `Cmd+Shift+G` | Group / Ungroup |
| `Cmd+]` `Cmd+Shift+]` `Cmd+[` `Cmd+Shift+[` | Forward / To front / Backward / To back |
| `Cmd+8` / `Cmd+Alt+8` | Make compound path / Release |
| `Cmd+2` / `Cmd+Alt+2` | Lock selection / Unlock all |
| `Cmd+3` / `Cmd+Alt+3` | Hide selection / Show all |
| `Cmd+0` `Cmd+1` `Cmd+9` `Cmd++` `Cmd+-` | Fit / 100% / Zoom to selection / Zoom in / out |

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
