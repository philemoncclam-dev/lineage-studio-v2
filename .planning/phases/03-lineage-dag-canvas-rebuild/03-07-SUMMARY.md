---
phase: 03-lineage-dag-canvas-rebuild
plan: 07
subsystem: ui
tags: [react, xyflow, dagre, tanstack-router, accessibility, lineage]

# Dependency graph
requires:
  - phase: 03-lineage-dag-canvas-rebuild
    provides: "03-03 pure layout/mapping core (useDagreLayout, toXyflow, trace, types); 03-05 custom nodes/edges (TableNode, NotebookNode, LineageEdge, lineage-dag.css); 03-06 keyboard/freshness (useLineageKeyboardNav, FreshnessIndicator)"
provides:
  - "LineageDagView — the assembled DAG canvas mounting a single <ReactFlow> with hover-trace, persistent selection, global Table/Column toggle, roving-tabindex keyboard model, sr-only edge alternative, and freshness indicator"
  - "RouterContext.fetchedAt: number | null, threaded from the root loader"
  - "Lineage route now renders LineageDagView; the retired hand-rolled SVG lineage view is deleted"
affects: [03-08, phase-04, phase-05]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Roving-tabindex bootstrap: TableNode/NotebookNode always mount focus targets at tabIndex=-1; the owning view imperatively sets exactly one to tabIndex=0 on mount/mode-change (WAI-ARIA pattern, React won't fight this since the JSX prop value never changes)"
    - "Trace-derived visual state flows through node/edge data injected per-render by the composing view (traced/active/onHoverColumn/dim on TableNodeData/NotebookNodeData; traced 'on'|'dim'|null on edge data), not through xyflow's own selection API"
    - "id-based (not object-identity-based) TanStack Router route resolution: Route.useLoaderData()/useMatch() resolve via the route's string id ('__root__'), but only when that exact route object is actually part of the rendered router's own tree — a same-id standalone test router does not satisfy a cross-module singleton's bound methods"

key-files:
  created:
    - frontend/src/views/LineageDagView.tsx
    - frontend/src/views/LineageDagView.test.tsx
  modified:
    - frontend/src/routes/__root.tsx
    - frontend/src/router.tsx
    - frontend/src/routes/__tests__/rootPending.test.tsx
    - frontend/src/routes/lineage/$workspace.$lakehouse.$table.tsx
    - frontend/src/views/lineage-dag/types.ts
    - frontend/src/views/lineage-dag/TableNode.tsx
    - frontend/src/views/lineage-dag/NotebookNode.tsx
    - frontend/src/views/lineage-dag/lineage-dag.css
    - frontend/src/shell/Inspector.tsx
    - frontend/src/views/lineage-dag/LineageEdge.tsx
    - frontend/src/views/lineage-dag/trace.ts
  deleted:
    - frontend/src/views/LineageView.tsx

key-decisions:
  - "TableNodeData/NotebookNodeData extended with optional traced/active/onHoverColumn/dim fields so TableNode/NotebookNode can render .ls-node.dim/.col.dim/.col.hot/.col.sel and fire hover callbacks — 03-05 explicitly deferred this wiring to 03-07, and it cannot be done from outside those components since the classes live on elements they render internally"
  - "Whole-card dim (.ls-node.dim) applies when a trace is active and the card owns zero traced columns; a notebook never owns a column, so it always whole-dims while any column trace is active (no separate 'object-level trace endpoint' concept exists this phase, since colEdges never include notebook ids)"
  - "Route-deep-link focusTable renders as a CSS-only ring (Node.className -> .react-flow__node.lineage-focus .ls-node) — a direct, low-risk port of the retired view's `.ls-node.focus`, not an auto-select-on-mount behavior (which would be an undiscussed interaction change)"
  - "sr-only edge summary list covers column-level (colEdges) edges only, matching the literal '{sourceCol} -> {targetCol}, {kind}, {provenance} via {notebook}' template; the canvas's overall aria-label 'N connections' count includes both column and object-level (ops) edges"
  - "Edge->notebook attribution for the sr-only list prefers model.evidence[toKey].notebook (D-12, real parsed data) and falls back to the table-level 'writes' op feeding the target table (covers the bundled sample model, which has no structured evidence)"

patterns-established:
  - "Composing view owns trace-derived decoration: buildDagreLayout + toXyflow produce structural nodes/edges; the view injects transient/derived per-render state (trace Set, active key, dim flags, hover callback) rather than baking it into the pure layout/mapping layer"

requirements-completed: [DAG-01, DAG-03, DAG-04, DAG-06, DAG-08, TRUST-01, TRUST-03]

coverage:
  - id: D1
    description: "LineageDagView mounts a single <ReactFlow> composing buildDagreLayout + toXyflow + TableNode/NotebookNode/LineageEdge for the current toggle mode, importing only the xyflow base layout reset"
    requirement: "DAG-01"
    verification:
      - kind: unit
        ref: "frontend/src/views/LineageDagView.test.tsx#renders a role=group canvas with an accessible name reporting counts, and an sr-only entry per edge (DAG-08)"
        status: pass
      - kind: other
        ref: "grep -n 'dist/style.css' frontend/src/views/LineageDagView.tsx (no match)"
        status: pass
    human_judgment: false
  - id: D2
    description: "xyflow's default keyboard/drag model is fully replaced: nodesFocusable={false}, edgesFocusable={false}, disableKeyboardA11y, nodesDraggable={false} all set on <ReactFlow>"
    requirement: "DAG-06"
    verification:
      - kind: other
        ref: "grep -n 'nodesFocusable\\|edgesFocusable\\|disableKeyboardA11y\\|nodesDraggable' frontend/src/views/LineageDagView.tsx"
        status: pass
    human_judgment: false
  - id: D3
    description: "Hovering a column previews its trace transiently (sel on the anchor, hot on traced peers, whole-card dim on unrelated cards); hover ends and reverts; the persisted selection uses the identical treatment via the single useSelection().select() write path"
    requirement: "DAG-03"
    verification:
      - kind: unit
        ref: "frontend/src/views/LineageDagView.test.tsx#hovering a column previews the trace: sel on the anchor, hot on the traced peer, dim on unrelated cards/edges (DAG-03/DAG-04/D-05/D-06)"
        status: pass
      - kind: unit
        ref: "frontend/src/views/lineage-dag/trace.test.ts (trace() algorithm, ported verbatim from the retired view)"
        status: pass
    human_judgment: false
  - id: D4
    description: "Clicking a column freezes the trace as the persistent ?sel/?col selection; hovering a different column while one is selected overrides the render transiently without mutating the URL"
    requirement: "DAG-04"
    verification: []
    human_judgment: true
    rationale: "The click-freezes-selection and hover-overrides-without-mutating-URL interaction is wired (active = hover ?? selectedCol, select()/clear() as the sole write path per D-07) but not exercised by an automated multi-step hover+click+re-hover test in this plan's suite — useSelection()'s own contract is covered elsewhere (Phase 2), and this plan's automated coverage stops at the single-hover case (D3)."
  - id: D5
    description: "Global Table/Column toggle (default Column) flips every card's mode and calls useUpdateNodeInternals() for every table node so handles re-measure and edges do not detach"
    requirement: "DAG-06"
    verification:
      - kind: unit
        ref: "frontend/src/views/LineageDagView.test.tsx#toggling to Table calls useUpdateNodeInternals for every table node (handle re-measure, RESEARCH Pitfall 2)"
        status: pass
      - kind: unit
        ref: "frontend/src/views/LineageDagView.test.tsx#renders the lineage-toolbar with a Table/Column toggle defaulting to Column, and a FreshnessIndicator"
        status: pass
    human_judgment: false
  - id: D6
    description: "The canvas exposes a role=group wrapper with the DAG-08 accessible name and an sr-only edge summary list as the accessible alternative for edges"
    requirement: "DAG-08"
    verification:
      - kind: unit
        ref: "frontend/src/views/LineageDagView.test.tsx#renders a role=group canvas with an accessible name reporting counts, and an sr-only entry per edge (DAG-08)"
        status: pass
    human_judgment: false
  - id: D7
    description: "Full keyboard/AT walk (Tab into canvas, roving-tabindex row/rank navigation, path-walk, focus-visible rings, AT announcements) works end-to-end in a real browser"
    requirement: "DAG-08"
    verification: []
    human_judgment: true
    rationale: "useLineageKeyboardNav's resolver and DOM focus-movement are unit-tested in isolation (03-06); this plan wires the roving-tabindex bootstrap and the hook into LineageDagView, but a full keyboard/AT walk against the real rendered canvas is the plan's own standing manual verification item (non-blocking, phase-gate) — not something jsdom can substitute for."
  - id: D8
    description: "Every edge is visually differentiated by provenance (declared=solid/inferred=dashed) independent of edge-type hue, and reflects trace state (on/dim)"
    requirement: "TRUST-01"
    verification:
      - kind: unit
        ref: "frontend/src/views/lineage-dag/LineageEdge.test.tsx (lineageEdgeClass — provenance/kind/traced composition, all pairs)"
        status: pass
    human_judgment: false
  - id: D9
    description: "Lineage-toolbar renders the FreshnessIndicator fed by AppModel.source and the new root-loader fetchedAt"
    requirement: "TRUST-03"
    verification:
      - kind: unit
        ref: "frontend/src/views/LineageDagView.test.tsx#renders the lineage-toolbar with a Table/Column toggle defaulting to Column, and a FreshnessIndicator"
        status: pass
      - kind: unit
        ref: "frontend/src/routes/__tests__/rootPending.test.tsx#renders the pending fallback without throwing the router match-context invariant"
        status: pass
    human_judgment: false

duration: 25min
completed: 2026-07-23
status: complete
---

# Phase 3 Plan 7: Assemble LineageDagView Summary

**LineageDagView composes 03-03/03-05/03-06's pieces into one `<ReactFlow>` canvas — hover-trace dim/hot/sel, persistent selection, global Table/Column toggle with handle re-measure, roving-tabindex keyboard model, sr-only edge alternative, and freshness — and the lineage route now renders it in place of the retired hand-rolled SVG view.**

## Performance

- **Duration:** ~25 min
- **Started:** 2026-07-24T00:05Z (approx, from prior plan's commit)
- **Completed:** 2026-07-24T00:30Z
- **Tasks:** 3
- **Files modified:** 12 (2 created, 9 modified, 1 deleted)

## Accomplishments
- `LineageDagView.tsx` mounts a single `<ReactFlow>` composing `buildDagreLayout`/`toXyflow` (03-03), `TableNode`/`NotebookNode`/`LineageEdge` (03-05), and `useLineageKeyboardNav`/`FreshnessIndicator` (03-06) — with xyflow's default keyboard/drag model fully replaced (`nodesFocusable={false}`, `edgesFocusable={false}`, `disableKeyboardA11y`, `nodesDraggable={false}`)
- Hover-trace (transient) vs click-selection (persistent, single `useSelection().select()`/`clear()` write path) fully wired end-to-end, including the dim/hot/sel visual classes on `TableNode`/`NotebookNode` that 03-05 explicitly deferred to this plan
- Global Table/Column toggle (default Column) flips every card and calls `useUpdateNodeInternals()` for every table node so handles re-measure and edges stay attached across the flip (RESEARCH.md Pitfall 2)
- `role="group"` canvas wrapper with the DAG-08 accessible name template and an `sr-only` edge summary list; freshness indicator fed by a new in-memory `RouterContext.fetchedAt` threaded from the root loader (D-14, no new persistence)
- Lineage route swapped onto `LineageDagView`; `LineageView.tsx` deleted, with every historical comment reference to it reworded so no stale mention of the retired file remains in `src`

## Task Commits

Each task was committed atomically:

1. **Task 1: Thread fetchedAt through the root loader** - `5a631cb` (feat)
2. **Task 2: LineageDagView — compose the canvas** - `ddd7684` (feat)
3. **Task 3: Swap the lineage route; delete LineageView.tsx** - `b48c7a5` (feat)
4. **Follow-up: strengthen hover-trace test coverage** - `307f0ef` (test)

**Plan metadata:** (this commit)

## Files Created/Modified
- `frontend/src/views/LineageDagView.tsx` - New default-exported view; composes layout/mapping/nodes/edges/keyboard/freshness/a11y into the assembled DAG canvas
- `frontend/src/views/LineageDagView.test.tsx` - Smoke tests: toolbar/toggle/freshness, role=group + sr-only edge list, empty state (no canvas mount), toggle→useUpdateNodeInternals, hover-trace dim/hot/sel
- `frontend/src/routes/__root.tsx` - Root loader now returns `fetchedAt: graph ? Date.now() : null`; `RouterContext` gains `fetchedAt: number | null`
- `frontend/src/router.tsx`, `frontend/src/routes/__tests__/rootPending.test.tsx` - Widened context literals to match the new `RouterContext` shape (Rule 3)
- `frontend/src/routes/lineage/$workspace.$lakehouse.$table.tsx` - Renders `LineageDagView` (was `LineageView`), identical `focusTable`/`focusColumn` prop contract
- `frontend/src/views/lineage-dag/types.ts` - `TableNodeData`/`NotebookNodeData` gain optional `traced`/`active`/`onHoverColumn`/`dim` fields (Rule 2)
- `frontend/src/views/lineage-dag/TableNode.tsx`, `NotebookNode.tsx` - Apply `.ls-node.dim`/`.col.dim`/`.col.hot`/`.col.sel` from the injected trace state; column rows fire `onHoverColumn` on mouseenter/mouseleave (Rule 2)
- `frontend/src/views/lineage-dag/lineage-dag.css` - New toolbar/canvas/empty-state/sr-only/focus-ring chrome; fixed a pre-existing comment-termination bug (Rule 1, see Deviations)
- `frontend/src/shell/Inspector.tsx`, `frontend/src/views/lineage-dag/LineageEdge.tsx`, `frontend/src/views/lineage-dag/trace.ts` - Reworded historical comments referencing the retired `LineageView.tsx` by name
- `frontend/src/views/LineageView.tsx` - Deleted (retired hand-rolled SVG lineage canvas)

## Decisions Made
- Extended `TableNodeData`/`NotebookNodeData` with trace-wiring fields rather than adding a new prop channel — the dim/hot/sel classes live on elements those components render internally, so there's no way to satisfy DAG-03/D-05/D-06 without touching them (03-05's SUMMARY explicitly flagged this as 03-07's job)
- `focusTable` renders as a CSS-only ring (`Node.className` → `.react-flow__node.lineage-focus .ls-node`) rather than auto-selecting/opening the Inspector on mount — a direct, low-risk port of the retired view's `.ls-node.focus`, avoiding an undiscussed interaction change
- The sr-only edge list covers column-level edges only (matches the literal UI-SPEC template); the canvas's overall "N connections" count in the aria-label includes both column and object-level edges
- Edge→notebook attribution for the sr-only list prefers `model.evidence[toKey].notebook` (D-12, real parsed data), falling back to the table-level `writes` op — covers both real backend data and the bundled sample model (which has no structured evidence)
- Test harness mounts through the real `../routes/__root` singleton (mirroring `rootPending.test.tsx`) with `sampleModel`/`adapt`/`fetchGraph` mocked, rather than a standalone test router — empirically confirmed that TanStack Router's `Route.useLoaderData()` only resolves for a route object that is actually part of the rendered router's own tree, not any same-id object

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] Widened RouterContext shape at every construction site**
- **Found during:** Task 1
- **Issue:** Adding `fetchedAt` to `RouterContext` broke `router.tsx`'s initial context literal and `rootPending.test.tsx`'s test-router context literal (both missing the new required field)
- **Fix:** Added `fetchedAt: null` to both literals
- **Files modified:** `frontend/src/router.tsx`, `frontend/src/routes/__tests__/rootPending.test.tsx`
- **Verification:** `tsc -b --noEmit` clean; `rootPending.test.tsx` still green
- **Committed in:** `5a631cb` (Task 1 commit)

**2. [Rule 2 - Missing Critical] Wired trace-driven dim/hot/sel classes and hover callbacks into TableNode/NotebookNode**
- **Found during:** Task 2
- **Issue:** 03-05 built `TableNode`/`NotebookNode` with no hover handlers and no dim/hot/sel class logic — DAG-03/D-05/D-06 (hover-trace preview, whole-card dim, per-row hot/sel) cannot be satisfied without this, and the classes live on elements only those components render
- **Fix:** Extended `TableNodeData`/`NotebookNodeData` with optional `traced`/`active`/`onHoverColumn`/`dim` fields (`types.ts`); `TableNode` computes and applies `.ls-node.dim`/`.col.hot`/`.col.sel`/`.col.dim` and fires `onHoverColumn` on column-row mouseenter/mouseleave; `NotebookNode` applies `.ls-node.dim`
- **Files modified:** `frontend/src/views/lineage-dag/types.ts`, `TableNode.tsx`, `NotebookNode.tsx`
- **Verification:** New `LineageDagView.test.tsx` case exercises hover→sel/hot/dim end-to-end through real DOM events
- **Committed in:** `ddd7684` (Task 2 commit)

**3. [Rule 1 - Bug] Fixed a pre-existing CSS comment-termination bug that broke the production build**
- **Found during:** Task 3 (`npm run build` verification)
- **Issue:** `lineage-dag.css`'s header comment (written in 03-05) contained a literal `*/` mid-sentence (`--color-*/--card-*`), prematurely closing the comment; the following `xyflow's` apostrophe then read as an unterminated CSS string. The defect existed since 03-05 but was invisible until this task's route swap made `LineageDagView` (and its CSS import) reachable from the production bundle for the first time — `LineageDagView.tsx` was dead code (unimported) at the end of Task 2.
- **Fix:** Inserted a space (`--color-* / --card-*`) so the `*/` sequence no longer forms
- **Files modified:** `frontend/src/views/lineage-dag/lineage-dag.css`
- **Verification:** `npm run build` succeeds; comment-marker count balanced (16 `/*` / 16 `*/`)
- **Committed in:** `b48c7a5` (Task 3 commit)

---

**Total deviations:** 3 auto-fixed (1 blocking type error, 1 missing critical functionality, 1 pre-existing bug newly surfaced)
**Impact on plan:** All three were necessary for correctness (Rule 3), the phase's own locked requirements (Rule 2 — DAG-03/D-05/D-06 have no other implementation path), or the plan's own acceptance criteria (Rule 1 — `npm run build` must succeed). No scope creep beyond what DAG-08/DAG-03/DAG-04/build-green already required.

## Issues Encountered
- Initial `LineageDagView.test.tsx` harness tried a standalone test router reusing only the root route's string id (`'__root__'`); this does not work — `Route.useLoaderData()` bound to the real `../routes/__root` singleton only resolves when that exact object is part of the rendered router's tree, not any same-id substitute. Resolved by mounting through the real singleton with `sampleModel`/`adapt`/`fetchGraph` mocked (same pattern as `rootPending.test.tsx`).
- xyflow only renders `<path>` elements for edges whose endpoint nodes have been measured via `ResizeObserver`, which jsdom's no-op mock (`test/setup.ts`) never fires — `.react-flow__edges` stays empty under this test harness regardless of trace state. Dropped the edge-level `on`/`dim` assertions from the hover-trace test; that composition is already covered by `LineageEdge.test.tsx`'s `lineageEdgeClass` unit tests (component tested in isolation, not through a full `<ReactFlow>` mount — same constraint 03-05 already worked around).

## User Setup Required
None - no external service configuration required.

## Next Phase Readiness
- Phase 3's full DAG canvas rebuild is functionally complete: layout, custom nodes/edges, provenance channel, trace/selection, toggle, keyboard/AT model, freshness, and the route swap all land in this plan
- Standing phase-gate manual verification items remain open (non-blocking, tracked in the plan's own `<verification>` block): light-mode visual review, deuteranopia/protanopia provenance-distinguishability check, and a full keyboard/AT walk in a real browser — none of these can be substituted by jsdom and should be run before `/gsd-verify-work` closes the phase
- `focusTable`'s route-deep-link behavior is a CSS-only ring by design this phase (not auto-select/auto-open-Inspector) — worth confirming this matches user expectation during the manual pass, since it's a narrower interpretation than the retired view's affordance implied

## Self-Check: PASSED
