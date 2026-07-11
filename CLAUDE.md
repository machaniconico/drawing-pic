# CLAUDE.md

Guidance for working in this repository.

## What this is

`drawing-pic` — an Illustrator-style vector drawing tool (React + TypeScript +
Zustand + Immer + Vite). See `README.md` for the user-facing feature list and
the architecture overview.

## Commands

```bash
pnpm dev           # Vite dev server
pnpm build         # tsc -b && vite build
pnpm typecheck     # tsc -b --noEmit
pnpm test          # vitest run  (the CI gate)
pnpm test:watch    # vitest watch
```

If a `pnpm <script>` invocation fails locally with an `ERR_PNPM_IGNORED_BUILDS`
/ `runDepsStatusCheck` error (an environment quirk around esbuild's build
script), run the tools directly instead: `./node_modules/.bin/vitest run`,
`./node_modules/.bin/tsc -b --noEmit`, `./node_modules/.bin/vite build`. CI is
unaffected.

## Architecture & layering

Keep logic pure and testable, independent of React and the DOM:

- `src/core/geometry/` — pure math and path effects (vectors, matrices, bbox,
  boolean ops, offsetPath, outlineStroke, roundCorners, zigzag, simplify).
- `src/core/model/` — document types, node factory, bounds, hit-testing,
  snapping, measurement, per-anchor path editing (`pathEdit.ts`).
- `src/state/` — the Zustand store (`store.ts`), pure command helpers
  (`operations.ts`), undo history, selectors.
- `src/io/` — serialization and SVG/PNG exporters, image import.
- `src/render/` — canvas renderer and pattern resolver.
- `src/ui/` — React components.

The document is **normalized**: nodes live in a flat `id → node` map and
hierarchy is expressed via `children` arrays.

## The standard way to add a feature

Most features (especially path operations) follow one shape:

1. **Pure function** in `core/geometry` or `core/model`/`operations`, with a
   colocated `*.test.ts`. This holds all the real logic and is exhaustively
   unit-tested (edge cases: empty/degenerate input, open vs closed subpaths,
   zero-length segments, non-invertible transforms, NaN/Infinity params).
2. **Store action** in `state/store.ts` that applies it inside
   `withDocHistory`, returning `true` only when something actually changed so
   undo history is gated correctly. For in-place subpath effects on the
   selection, reuse `applyInPlaceSubPathEffect`.
3. **UI control** in the relevant `src/ui` panel (PropertiesPanel for
   path effects, AlignPanel for arrange/compound, Toolbar for inserts).
4. **A store/operations integration test** covering the wiring and the
   no-op/history-gating paths.

Run `pnpm typecheck` and `pnpm test` before committing.

## Conventions

- Pure functions return new objects; never mutate inputs (deep-clone points and
  handles). Store actions mutate the Immer draft only.
- Commits use a `feat:`/`docs:`/etc. prefix and, for user stories, a trailing
  `(US-NNN)` tag continuing the existing sequence.
- Prefer adding a small pure function with its own unit test over logic embedded
  in a component or action.
