# Handoff — Lineage Studio v2

_Last updated: 2026-07-26 — as of commit 0e6cf17 (master, pushed)_

## Where things stand

Whole session was **Modeling mode, rebuilt from zero**. The old editor
(`model-app/`, the `AppModel` shape, the layout engine, Graph mode) was deleted
outright — ~27.7k lines — and replaced with a new shape and a custom canvas
modelled on Solidatus. Seven commits, each shipped and pushed to Vercel.
Frontend **132/132 vitest**, `tsc` + `vite build` clean. Tree is level with
origin/master.

Backend was **not touched this session** — see the pre-existing failures below.

## The new Modeling mode

- **Shape** (`frontend/src/model/`) — `Layer > Object > Attribute`, unbounded
  nesting. A **Group is not a type**: it is an Attribute that has children, so
  nesting under an entity never changes that entity's type. Transition
  endpoints are plain `EntityId`s, so any kind connects to any kind. Properties
  live in a **side table keyed by entity id**, not on entities, so values
  outlive a deleted entity (an undo can recover them) and display rules have a
  flat table to read.
- **Persistence** is localStorage behind an **async** `ModelStore` interface
  (`model/store.ts`), so the eventual IndexedDB swap is one file. Versions are a
  linear snapshot list.
- **Renderer** (`frontend/src/modeling/`) — DOM cards/rows virtualized at card
  *and* row level, over one world-sized Canvas 2D layer for transitions. No
  React Flow.
- Features landed: multi-select, delete (+ delete-preserving-transitions),
  connect-by-port, inline rename, Ctrl+Z/Y undo over whole-model snapshots,
  transition (line) selection, in-model search, tabular import/export,
  right-click menus, and copy/paste.

Scoped **out** by the user, deliberately: transaction time (versions are a
single timeline), reference models, and any backend persistence for models.

## In flight / next step

Nothing half-written. We were working **one rail button at a time**; Import and
Export are done. The obvious next targets are the remaining Solidatus rail
surfaces — an **Inspector / properties panel** (there is no way to view or edit
an entity's properties in the UI yet, only to import them), **filters / display
rules**, and **version history** (the store supports snapshots; nothing calls
`saveVersion`).

## Uncommitted work

Clean.

## Decisions & dead ends

- **The layer-band misalignment was NOT a layout bug.** Two sessions' worth of
  guesses went at the geometry; dumping the actual numbers showed a card's
  centre has always equalled its layer's `centerX`. The real cause was that the
  band and edge canvas were positioned from **React scroll state, which lags
  native scrolling by a frame**. Adding a layer made content wider than the
  viewport → horizontal scrolling → visible drift. Fixed by *deleting* the JS
  scroll-sync: the band is `position: sticky` inside the scroller (`top` only —
  **never add `left`**, that re-creates the drift), and the canvas is
  world-sized. If alignment ever looks wrong again, **suspect rendering sync
  before geometry**, and check `bandAlignment.test.ts` still passes first.
- **Band segments must stay contiguous.** An earlier version sized each segment
  to its column only, leaving the inter-column gap owned by no layer — the eye
  reads a column as running divider-to-divider, so every name looked off-centre
  and ~20% of each column was unclickable. Segments now meet mid-gutter and the
  name anchors to `centerX`, not to the segment.
- **Free-panning was rejected** by the user in favour of a normal scroll
  container with real scrollbars.
- **Hiding a layer was replaced by collapsing it in place.** A separate hidden
  list with a restore bar was built and thrown away — the user wanted the strip
  to stay where the layer was, as its own expand affordance.
- **Clipboard payload is deliberately kind-free.** What a pasted node becomes is
  decided by where it lands (canvas → layers, layer → objects, object/attribute
  → attributes). Do not add a `kind` field to `ClipNode`; the conversion
  behaviour falls out of its absence.

## Gotchas still live

- **`PowerShell Set-Content` round-trips mangle UTF-8.** Rewriting a `.tsx` with
  `Get-Content -Raw` + `Set-Content` re-encoded every `…` and `—` and flipped
  line endings — 59 lines changed when 4 should have. **Use the Edit tool for
  source files**, never a shell rewrite.
- **The PowerShell tool cannot pass a here-string to `git commit -m`.** It word-
  splits and fails with `pathspec ... did not match`. Write the message to a
  file and use `git commit -F`.
- **`cd` persists between PowerShell tool calls**, which silently sent a
  `Remove-Item` at the wrong path (`frontend/frontend/...`). Prefer absolute
  paths.
- **`git push` output arrives on stderr**, so the tool reports it as a
  `NativeCommandError` even on success. Check the `a..b master -> master` line,
  not the exit styling.
- **`vitest --reporter=basic` is not a valid reporter** in v4 and console.log is
  suppressed by default; to get diagnostics out, assert against the string.
- **`Inspo/` is gitignored** and holds the user's Solidatus reference images
  plus `fix.jpg`. The product context the user pasted is **not** to be written
  into the repo or pushed.

## Backend — pre-existing failures, untouched this session

`pytest` is **138 passed, 2 failed** (`test_sandbox_spark.py`). These predate
this session and no backend file was modified. Cause is the handoff-documented
one: the Spark child falls back to `engine='stub'` when the pinned
`sandbox/.venv312` does not resolve. **It is also flaky** — the failing set
varied between runs (2 in a full run, 1 in isolation, and a different pair by
the end of the session). Worth a proper look before trusting the sandbox suite.

## Env facts

- App is **pinned to light mode** (`shell/theme.ts`). The dark token values are
  all still there as `light-dark()` pairs — reverting is one line.
- Modeling gets a **full-bleed canvas with a floating rail**, gated on
  `.shell[data-mode="model"]` in `shell.css`. Other modes are untouched.
- Pages claim shell chrome via two small registries: `shell/searchBridge.ts`
  (Cmd+K / rail search) and `shell/railActions.ts` (Import/Export buttons).
- Commands: `cd frontend && npm run dev` (was on **:5175** this session, 5173/4
  were taken); `cd backend && .venv/Scripts/uvicorn app.main:app --port 8000`
  (**no `--reload`** — stale workers have cost time twice).
