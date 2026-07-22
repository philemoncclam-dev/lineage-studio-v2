---
phase: 02-app-shell-routing-canvas-infrastructure
reviewed: 2026-07-22T00:00:00Z
depth: standard
files_reviewed: 50
files_reviewed_list:
  - frontend/src/main.tsx
  - frontend/src/model/__tests__/adapt.test.ts
  - frontend/src/model/__tests__/domainColor.test.ts
  - frontend/src/model/__tests__/fixtures.ts
  - frontend/src/model/__tests__/graphLayout.test.ts
  - frontend/src/model/__tests__/lineageLayout.test.ts
  - frontend/src/model/adapt.ts
  - frontend/src/model/domainColor.ts
  - frontend/src/model/graphLayout.ts
  - frontend/src/model/ids.ts
  - frontend/src/model/index.tsx
  - frontend/src/model/lineageLayout.ts
  - frontend/src/resolve/__tests__/resolvePathSegments.test.ts
  - frontend/src/resolve/resolvePathSegments.ts
  - frontend/src/router.tsx
  - frontend/src/routes/__root.tsx
  - frontend/src/routes/graph/$workspace.$lakehouse.$table.tsx
  - frontend/src/routes/graph/$workspace.$lakehouse.index.tsx
  - frontend/src/routes/graph/$workspace.index.tsx
  - frontend/src/routes/graph/-GraphRouteView.tsx
  - frontend/src/routes/graph/index.tsx
  - frontend/src/routes/graph/-lineageLink.ts
  - frontend/src/routes/graph/route.tsx
  - frontend/src/routes/index.tsx
  - frontend/src/routes/lineage/$workspace.$lakehouse.$table.tsx
  - frontend/src/routes/lineage/route.tsx
  - frontend/src/routes/purview/data-products.tsx
  - frontend/src/routes/purview/definitions.tsx
  - frontend/src/routes/purview/push.tsx
  - frontend/src/routes/purview/route.tsx
  - frontend/src/selection/__tests__/useSelection.test.ts
  - frontend/src/selection/useSelection.ts
  - frontend/src/shell/__tests__/CommandPalette.test.tsx
  - frontend/src/shell/__tests__/Inspector.test.tsx
  - frontend/src/shell/__tests__/Rail.test.tsx
  - frontend/src/shell/__tests__/search.test.ts
  - frontend/src/shell/AppShell.tsx
  - frontend/src/shell/CommandPalette.tsx
  - frontend/src/shell/Inspector.tsx
  - frontend/src/shell/ModeMenu.tsx
  - frontend/src/shell/Rail.tsx
  - frontend/src/shell/RailBottomCluster.tsx
  - frontend/src/shell/railConfig.ts
  - frontend/src/shell/search.ts
  - frontend/src/shell/theme.ts
  - frontend/src/styles/components.css
  - frontend/src/styles/shell.css
  - frontend/src/views/GraphView.tsx
  - frontend/src/views/LineageView.tsx
  - frontend/vite.config.ts
findings:
  critical: 1
  warning: 6
  info: 1
  total: 8
status: issues_found
---

# Phase 02: Code Review Report

**Reviewed:** 2026-07-22T00:00:00Z
**Depth:** standard
**Files Reviewed:** 50
**Status:** issues_found

## Summary

Reviewed the app-shell/routing/canvas-infrastructure phase: the model-adaptation
layer (`model/*`), the readable-name path resolver (`resolve/*`), the
TanStack Router route tree (`routes/*`), the selection store, the shell chrome
(`AppShell`, `Inspector`, `ModeMenu`, `Rail`, `RailBottomCluster`,
`CommandPalette`, `search.ts`, `theme.ts`), and the two canvas views
(`GraphView`, `LineageView`).

The pure model/layout modules (`adapt.ts`, `graphLayout.ts`, `lineageLayout.ts`,
`domainColor.ts`) are well-factored and their unit tests genuinely exercise the
documented behavior. The bulk of the shell chrome is solid and matches its own
in-file design rationale.

The most consequential issue is a confirmed pre-existing Critical bug already
tracked in `deferred-items.md` (the root route's `pendingComponent` renders
the shell outside router match context and crashes on load) — included below
for completeness since `routes/__root.tsx` is in scope, not re-discovered.

Beyond that, this pass found a real, unmemoized-callback bug that silently
resets the force-directed graph simulation on every canvas-search keystroke
(defeating the `queryRef` mechanism specifically built to avoid that), an
entire readable-name-to-GUID resolution module (`resolve/resolvePathSegments.ts`)
that is fully implemented and unit-tested but never wired into any route, an
id-collision risk in the `tid()`/`nid()` short-id scheme that can silently
merge two distinct Fabric tables, a notebook-search id-resolution bug, a stale
column-selection bug in `LineageView`, and a silently-failing "live vs sample
data" indicator.

## Critical Issues

### CR-01: Root pendingComponent renders the shell outside router match context (pre-existing, already tracked)

**File:** `frontend/src/routes/__root.tsx:36-44`
**Issue:** `RootPending` (the root route's `pendingComponent`, shown while
`fetchGraph()` is in flight) renders `<AppShell>` directly, and `AppShell`
mounts `<Inspector/>` and `<CommandPalette/>`, both of which read router
state (`useSelection()` → `useSearch({ strict: false })`, and
`CommandPalette`'s `getRouteApi('__root__').useLoaderData()`). This is
already documented in
`.planning/phases/02-app-shell-routing-canvas-infrastructure/deferred-items.md`
as a confirmed pre-existing Critical bug — the app blank-screens on load
because the pending-state render happens outside a matched route context.
Included here only for completeness/traceability since `routes/__root.tsx`
was in this review's file list; not being re-investigated from scratch.
**Fix:** See `deferred-items.md` for the tracked remediation (do not
double-fix here — this finding exists so the review record and the deferred
item stay linked).

## Warnings

### WR-01: `resolvePathSegments`/`resolveSegment` are fully built and tested but never called from any route

**File:** `frontend/src/resolve/resolvePathSegments.ts` (whole file);
callers checked: `frontend/src/routes/graph/$workspace.index.tsx`,
`frontend/src/routes/graph/$workspace.$lakehouse.index.tsx`,
`frontend/src/routes/graph/$workspace.$lakehouse.$table.tsx`,
`frontend/src/routes/lineage/$workspace.$lakehouse.$table.tsx`
**Issue:** `resolvePathSegments.ts` implements — and its test file
thoroughly exercises — readable-name→GUID resolution with a "redirect to
nearest resolvable ancestor, bounded `unresolved` notice" fallback (D-07/D-09
per the in-file comments). Grepping the entire `frontend/src` tree shows
`resolveSegment`/`resolvePathSegments` are referenced only inside
`resolve/resolvePathSegments.ts` itself and its own test file — no route
(`beforeLoad`, `loader`, or otherwise) calls either export. The
`/graph/$workspace...` routes pass their raw path params straight through to
`GraphRouteView`, which ignores them entirely (GraphView keeps its own
internal drill state), and `/lineage/$workspace/$lakehouse/$table` does its
own separate, simpler ad hoc id/name matching against `model.tables` instead
of calling this module. The documented "bad pasted URL redirects to the
nearest resolvable ancestor with a bounded notice" behavior described
extensively in this module's comments does not happen anywhere in the running
app.
**Fix:** Either wire `resolvePathSegments` into a `beforeLoad` on the
`/graph/$workspace*` and `/lineage/$workspace/$lakehouse/$table` routes (using
the root-loaded graph from `context`/`Route.useRouteContext()`), or, if this
capability is intentionally deferred to a later phase, delete the module and
its tests (or move them behind an explicit "not yet wired" note) so the
review/test suite doesn't imply working URL-resolution behavior that doesn't
exist.

### WR-02: GraphView's force-simulation effect tears down and resets on every canvas-search keystroke

**File:** `frontend/src/views/GraphView.tsx:18-34` (definition of `drill`),
`87-94` and `194` (`GraphCanvas`'s effect and its dependency array)
**Issue:** `GraphCanvas`'s simulation-setup `useEffect` depends on
`[levelKey, level, onDrill]` (line 194). `onDrill` is `drill`
(`GraphView.tsx:29-33`), a new arrow-function literal created on every render
of `GraphView` — it is not wrapped in `useCallback`. `GraphView` re-renders on
every keystroke in the in-canvas query input (`onChange={(e) =>
setQuery(e.target.value)}`, line 71), so `drill`'s identity changes on every
keystroke too. Because the effect's cleanup/re-run fires whenever any of its
deps change by reference, typing in the query box tears down and
re-initializes the entire force simulation each keystroke: node positions are
re-randomized (`x: (Math.random() - 0.5) * 260, ...`, line 101), zoom resets
to `1`, hover/drag state is dropped, event listeners are removed and
re-attached, and the theme `MutationObserver` is disconnected and
re-created. This directly defeats the `queryRef` pattern the code deliberately
built (see the comment at line 91-92 and the `draw()` closure reading
`queryRef.current`) specifically so the live query could highlight matches
*without* re-running this expensive setup effect.
**Fix:** Memoize the callback so its identity is stable across renders not
caused by an actual level change, e.g.:
```tsx
const drill = useCallback((k: string) => {
  const d = LEVELS[k]
  setPath((p) => [...p, { label: d.crumb || d.level, key: k }])
  setQuery('')
}, [LEVELS])
```

### WR-03: `tid()`/`nid()` short-id scheme can silently collide two distinct Fabric nodes

**File:** `frontend/src/model/ids.ts:4-5`
**Issue:** `tid = (id) => id.replace(/^table\./, '').replace(/[^\w-]/g, '_')`
strips the `table.` prefix and then replaces every remaining non-word,
non-hyphen character (including `.`) with `_`. Two different raw graph node
ids can therefore collapse to the same short id — e.g. `tid('table.raw.orders')`
and `tid('table.raw_orders')` both produce `'raw_orders'`. This short id is
used as the key for `tableById`/`byId` Maps in `adapt.ts` and
`lineageLayout.ts`, as column-edge keys (`${id}.${c.name}`), and as literal
DOM element ids (`id="ls-${t.id}"` and `document.querySelector('#ls-'+s)`) in
`LineageView.tsx`. A collision silently overwrites one table's layout/columns
with another's in the `Map`, and produces two DOM nodes sharing the same
`id` attribute (invalid HTML, `querySelector` only ever finds the first),
mis-rendering lineage for real Fabric data whose table/notebook names contain
punctuation beyond underscores.
**Fix:** Derive the short id from something collision-resistant (e.g. a short
hash of the full raw id) instead of naive character substitution, or keep the
full raw id as the canonical key and only sanitize a *display*-only DOM id
separately.

### WR-04: `notebookIndex()` in the command-palette search index has two id-resolution bugs for graph-only/duplicate-named notebooks

**File:** `frontend/src/shell/search.ts:29-41`
**Issue:**
1. The first loop seeds `seen` (a `Map<name, id>`) from `m.notebooks` (each
   already correctly `nid()`-mapped). The second loop only adds a knowledge-graph
   notebook node if `!seen.has(n.label)` — i.e. it dedupes by *display name*,
   not by node id. If two different notebooks (e.g. in different workspaces)
   share the same name, the second is silently dropped from search entirely
   instead of being indexed under its own id.
2. For any node that *does* reach the fallback branch, the id chosen is
   `n.label in m.notebookCode ? n.label : n.id` (line 36). `m.notebookCode` is
   keyed by `nid()`-mapped short ids (e.g. `nb_clean_orders`), never by
   display label, so `n.label in m.notebookCode` can never be true — the
   branch always falls through to `n.id`, which for a `GNode` built in
   `graphLayout.ts` is the **raw** graph node id (e.g. `notebook.clean_orders`),
   not the `nid()`-mapped id used everywhere else in `AppModel`
   (`model.ops`, `model.notebooks`, `model.notebookCode`). Any search result
   that reaches this path produces a `notebookId` that `firstWrittenTable()`
   (`CommandPalette.tsx:34-37`) and `Inspector`'s `resolveSelected()`
   (`Inspector.tsx:31-36`) cannot resolve, so selecting it either silently
   no-ops or shows "unknown" in the Inspector instead of the notebook's name.
**Fix:** Dedupe `seen` by node id (not name), and always resolve the id via
`nid(n.id)` (matching how `layoutLineage.ts` derives every other notebook id)
rather than the `label in notebookCode` check.

### WR-05: `LineageView` never clears its local column selection when `focusColumn` is cleared

**File:** `frontend/src/views/LineageView.tsx:32-35`
**Issue:** `const [selected, setSelected] = useState<string | null>(focusColumn ?? null)`
sets the initial value once; `useEffect(() => { if (focusColumn) setSelected(focusColumn) }, [focusColumn])`
only ever *sets* `selected` when the new `focusColumn` is truthy — it never
resets `selected` back to `null` when a subsequent navigation clears the `?col`
search param (e.g. `GraphView`'s "View column-level lineage →" button calls
`onOpenLineage(tableId)` with no column, which explicitly sets `search.col =
undefined`). Since `active = hover ?? selected` (line 40) drives which column is
traced/highlighted, a previously-selected column from an earlier navigation
continues to be highlighted after navigating to a different table with no
column focus, even though the URL and the shell Inspector no longer reference
it.
**Fix:**
```tsx
useEffect(() => { setSelected(focusColumn ?? null) }, [focusColumn])
```

### WR-06: No UI indicates when the app has silently fallen back to sample data

**File:** `frontend/src/routes/__root.tsx:16`; dead CSS at
`frontend/src/styles/components.css:131-132`
**Issue:** `loader: async () => ({ graph: await fetchGraph().catch(() => null) })`
swallows every failure mode (network error, non-2xx, malformed JSON) and
silently falls back to the bundled `sampleModel()` with no error surfaced to
the user. The only remaining artifact meant to communicate this state,
`.src-chip`/`.src-chip.err` (`components.css:131-132`), is unused — a
repo-wide search shows no `.tsx` file in the current shell renders it. A user
could be looking at demo/sample lineage data with zero indication that their
real Fabric graph failed to load.
**Fix:** Surface `model.source` somewhere in the always-visible shell chrome
(e.g. a small status chip in `RailBottomCluster`, next to the existing
Purview-connection status dot), or restore/repoint the `.src-chip` styling to
an actual rendered element.

## Info

### IN-01: Canvas node arcs use a literal `7` instead of `Math.PI * 2` for a full circle

**File:** `frontend/src/views/GraphView.tsx:134-135`
**Issue:** `ctx.arc(p.x, p.y, R + 7, 0, 7)` and `ctx.arc(p.x, p.y, R, 0, 7)`
use `7` as the end angle for what is intended to be a full circle. `7` radians
is ~0.72 rad past a full turn (`2 * Math.PI ≈ 6.283`), so the stroked circle
re-traces a small sliver of itself near angle 0, which can visibly
double-apply alpha there when `ctx.globalAlpha < 1` (e.g. dimmed/hovered
nodes, line 133).
**Fix:** Use `Math.PI * 2` instead of the magic number `7`.

---

_Reviewed: 2026-07-22T00:00:00Z_
_Reviewer: Claude (gsd-code-reviewer)_
_Depth: standard_
