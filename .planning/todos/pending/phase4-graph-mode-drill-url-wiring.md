---
created: 2026-07-22T00:00:00.000Z
title: Wire graph-mode drill URL resolution and navigation for Phase 4
area: routing
resolves_phase: 04
status: pending
files:
  - frontend/src/resolve/resolvePathSegments.ts
  - frontend/src/resolve/__tests__/resolvePathSegments.test.ts
  - frontend/src/routes/graph/-GraphRouteView.tsx
  - frontend/src/views/GraphView.tsx
---

## Problem

Phase 2 (`02-03-PLAN.md`) built and unit-tested `resolvePathSegments` (name→GUID
resolution + D-09 nearest-ancestor `redirect({ replace: true })` + bounded
`unresolved` notice) but never wired it into any route. Verified in
`02-VERIFICATION.md` Gap #2/#3 and `02-REVIEW.md` WR-01:

- `GraphRouteView` ignores the `$workspace`/`$lakehouse`/`$table` path params
  entirely — it passes nothing from the URL into `GraphView` besides
  `onOpenLineage`.
- `GraphView`'s drill state (`path`/`setPath`) is local-only React state;
  `drill()` never calls `navigate()`, so drilling in the knowledge-graph
  canvas never changes the URL, and browser back/forward has nothing to walk
  for graph-mode drill levels.
- `resolvePathSegments.ts` is grep-confirmed to have zero callers outside
  itself and its own test file — it is fully built (9 passing unit tests) but
  dead code at the application level.

This is scope decision B (locked, see `02-09-PLAN.md`): Phase 2 explicitly
scoped `GraphView`-internal edits out (D-14/D-15), because Phase 4 rebuilds
`GraphView` entirely on sigma.js + graphology with Estate→Workspace→
Lakehouse→Table drill-down as a core success criterion (GRAPH-02). Wiring the
current throwaway canvas's internal drill state to the URL now would be
discardable work. `.planning/REQUIREMENTS.md` SHELL-05/SHELL-06 and
`.planning/ROADMAP.md` Phase 2 SC#3 have been re-scoped to "Partial" to
reflect this deferral rather than continuing to claim unqualified "Complete".

`frontend/src/resolve/resolvePathSegments.ts` and
`frontend/src/resolve/__tests__/resolvePathSegments.test.ts` are
**intentionally staged** for this todo — they were deliberately NOT deleted
in Phase 2 and should not be touched again until this work starts.

## Solution

Two wiring actions, both scoped to Phase 4's `GraphView` rebuild:

1. **Wire `resolvePathSegments` into a `beforeLoad`** on the
   `/graph/$workspace*` routes: resolve readable name segments to
   Purview-GUID node ids against the root-loaded graph, and implement the
   D-09 nearest-ancestor `redirect({ replace: true })` with the bounded
   `unresolved` notice for segments that don't resolve (no redirect loop, no
   hard error — Pitfall 4).
2. **Drive the rebuilt (sigma.js + graphology) graph drill-down from the
   URL:** the resolved path segments select the drill level, and drilling by
   clicking a node calls `navigate()` so drill levels are URL-addressable and
   back/forward walks them (SHELL-05/SHELL-06 graph-mode; GRAPH-02).

### Known-deferred, do not lose

Carried over from `02-REVIEW.md`'s independent code-review pass (WR-02
through WR-06), spot-checked directly against source by `02-VERIFICATION.md`:

- **WR-02** — `GraphView.tsx`'s `drill`/`onDrill` callback is not memoized;
  it is re-created every render, and `GraphCanvas`'s simulation effect
  depends on it, so typing in the canvas-search box tears down and
  re-initializes the force simulation every keystroke. The Phase 3/4 canvas
  rebuilds should absorb this fix rather than patching the throwaway
  implementation.
- **WR-05** — `LineageView.tsx`'s `useEffect` only sets `selected` when
  `focusColumn` is truthy and never resets it to `null`, so a previously
  selected column stays highlighted after navigating to a table with no
  column focus. The Phase 3/4 canvas rebuilds should absorb this fix.
- **WR-06** — (separately deferred UX item, not a canvas-rebuild concern)
  `__root.tsx`'s loader silently swallows every `fetchGraph()` failure with
  no UI indicator of sample-vs-live data (`.src-chip` dead CSS, unused). A
  user could be viewing demo data with zero indication their real Fabric
  graph failed to load.

## Source

`02-09-PLAN.md` (gap-closure, phase 02-app-shell-routing-canvas-infrastructure)
`.planning/phases/02-app-shell-routing-canvas-infrastructure/02-VERIFICATION.md`
Gap #2/#3, and `02-REVIEW.md` WR-01.
