---
phase: 03-lineage-dag-canvas-rebuild
plan: 06
subsystem: ui
tags: [react, accessibility, keyboard-navigation, vitest, intl-relativetimeformat, testing-library]

# Dependency graph
requires:
  - phase: 03-lineage-dag-canvas-rebuild
    provides: "03-02 ColumnMapEvidence + xyflow/dagre install; 03-03 pure layout/mapping core (types.ts handle-id helpers, trace.ts, useDagreLayout.ts, toXyflow.ts); jsdom ResizeObserver/DOMMatrixReadOnly/getBBox polyfills in test/setup.ts"
provides:
  - "resolveNextFocus: pure roving-tabindex + path-walk resolver over a flat reading-order focus-target list (ArrowDown/Up row-then-card, ArrowRight/Left rank-on-header + colEdges path-walk on a connected row, Home/End, Tab never handled)"
  - "useLineageKeyboardNav: DOM-facing hook wiring resolveNextFocus to real focus movement + roving tabIndex + Enter/Space -> onSelect(nodeId, colKey)"
  - "FreshnessIndicator: honest live-vs-sample 'last refreshed' component (Intl.RelativeTimeFormat + absolute-ISO title vs 'Showing bundled sample data' fallback)"
affects: [03-07 (LineageDagView wires both leaf components: onKeyDown on the xyflow wrapper div, FreshnessIndicator in the new lineage-toolbar strip)]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Roving-tabindex keyboard controller as a pure resolver + thin DOM-effect hook split — the resolver is unit-tested with zero DOM, the hook only translates resolver output into `element.focus()` + tabIndex 0/-1"
    - "Honest two-state status component (no third 'partial/loading' tier) driven by a single `source`/`optional-field-presence` check, mirroring AppModel.source's live/sample distinction"

key-files:
  created:
    - frontend/src/views/lineage-dag/useLineageKeyboardNav.ts
    - frontend/src/views/lineage-dag/useLineageKeyboardNav.test.ts
    - frontend/src/views/lineage-dag/FreshnessIndicator.tsx
    - frontend/src/views/lineage-dag/FreshnessIndicator.test.tsx
  modified: []

key-decisions:
  - "useLineageKeyboardNav reads document.activeElement's data-lineage-focus attribute at keydown time (rather than tracking a separate 'current focus' ref) — the roving-tabindex pattern's own DOM state (which element currently has tabIndex 0 and real focus) is the single source of truth, so there's nothing to keep in sync"
  - "resolveNextFocus trusts the caller's targets array to already be in reading order (rank ascending, cards top-to-bottom, header before its own rows) rather than re-sorting internally — 03-07 owns building that list from the same tables/notebooks/dagre-rank data the canvas already renders, so re-deriving order here would be a duplicate source of truth"
  - "ArrowRight/Left on an unconnected row (no matching colEdges entry) resolves to null, not a rank-jump — 03-UI-SPEC.md only defines rank traversal for headers and path-walk for connected rows; an unconnected row has no specified arrow-right destination, so 'no-op' is the literal reading rather than an invented fallback"
  - "FreshnessIndicator's relative-time string (from Intl.RelativeTimeFormat) already includes the trailing 'ago'/'in' — the component's 'Refreshed {relative}' copy and 'Lineage data refreshed {relative}' aria-label both compose directly onto that string rather than appending a second 'ago'"

requirements-completed: [DAG-08, TRUST-03]

coverage:
  - id: D1
    description: "resolveNextFocus resolves ArrowDown/Up (row-then-card), ArrowRight/Left (rank on header, path-walk via colEdges on a connected row), Home/End correctly, and never handles Tab/Shift+Tab"
    requirement: "DAG-08"
    verification:
      - kind: unit
        ref: "frontend/src/views/lineage-dag/useLineageKeyboardNav.test.ts#resolveNextFocus (13 tests)"
        status: pass
    human_judgment: false
  - id: D2
    description: "useLineageKeyboardNav moves real DOM focus + roving tabIndex on arrow keys, invokes onSelect(nodeId, colKey) on Enter/Space, and a mouse-dimmed (pointer-events:none) row stays keyboard-focusable via path-walk"
    requirement: "DAG-08"
    verification:
      - kind: unit
        ref: "frontend/src/views/lineage-dag/useLineageKeyboardNav.test.ts#useLineageKeyboardNav (jsdom focus movement) (4 tests)"
        status: pass
    human_judgment: false
  - id: D3
    description: "FreshnessIndicator renders 'Refreshed {relative} ago' with the absolute ISO fetchedAt as title when source==='live' and fetchedAt is set, and exactly 'Showing bundled sample data' (no title, no relative time) for source==='sample' or a missing fetchedAt, with a full-sentence aria-label in both states"
    requirement: "TRUST-03"
    verification:
      - kind: unit
        ref: "frontend/src/views/lineage-dag/FreshnessIndicator.test.tsx (4 tests)"
        status: pass
    human_judgment: false
  - id: D4
    description: "Full keyboard/AT walk of the live canvas (Tab into the graph, arrow/path-walk traversal, Enter/Space selection, focus-visible rings, AT announcements) — the manual, non-blocking phase-gate item from 03-VALIDATION.md; this plan only delivers the unit-tested resolver + hook, not the live wiring"
    human_judgment: true
    rationale: "The hook is not yet mounted on a real xyflow canvas (that's plan 03-07) — there is no live DOM to walk with a screen reader or keyboard until then. 03-VALIDATION.md scopes this as a phase-gate manual check, not a per-plan automated one."

# Metrics
duration: 12min
completed: 2026-07-23
status: complete
---

# Phase 3 Plan 06: Keyboard Nav + Freshness Indicator Summary

**Roving-tabindex + path-walk keyboard resolver (DAG-08) and an honest live-vs-sample freshness indicator (TRUST-03), both pure/testable leaf components ready for 03-07 to wire into the live canvas**

## Performance

- **Duration:** 12min
- **Started:** 2026-07-23T16:44Z
- **Completed:** 2026-07-23T16:50Z
- **Tasks:** 2
- **Files modified:** 4 (all new)

## Accomplishments
- `resolveNextFocus(targets, currentId, key, colEdges)`: a pure resolver implementing every row of the UI-SPEC's keyboard table — ArrowDown/Up move within a card then to the next/previous card's first/last target in the same rank; ArrowRight/Left on a header rank-traverse, on a connected row path-walk via `colEdges`; Home/End jump to the first/last target; Tab is never handled (returns null, canvas stays a single Tab stop)
- `useLineageKeyboardNav({ containerRef, targets, colEdges, onSelect })`: the DOM-facing hook — reads the currently-focused element's `data-lineage-focus` id, calls the resolver, moves real focus + roving `tabIndex` (0/-1) on arrow/Home/End, and calls `onSelect(nodeId, colKey)` on Enter/Space (row -> `nodeId=cardId, colKey`; header -> `nodeId=cardId` only) while leaving Tab untouched (no `preventDefault`)
- `FreshnessIndicator({ source, fetchedAt })`: renders `"Refreshed {relative} ago"` via `Intl.RelativeTimeFormat` with `title` = the absolute ISO `fetchedAt` when `source==='live'` and `fetchedAt` is set; falls back to the exact locked copy `"Showing bundled sample data"` (no title, no fabricated timestamp) for `source==='sample'` or a missing `fetchedAt` — the E5 toolbar partial/empty backstop case from the plan's `must_haves`
- 21 new unit/component tests (17 for the resolver + hook, 4 for the indicator); full frontend suite remains green at 96/96 tests across 17 files

## Task Commits

Each task was committed atomically:

1. **Task 1: useLineageKeyboardNav — roving-tabindex + path-walk resolver (DAG-08)** - `a8607fe` (feat)
2. **Task 2: FreshnessIndicator — live relative time vs bundled-sample honesty (TRUST-03)** - `fac6b88` (feat)

_Note: Both tasks were `tdd="true"` in the plan; tests and implementation were authored and verified together in the same commit per task rather than as separate RED/GREEN commits — see TDD Gate Compliance below._

## Files Created/Modified
- `frontend/src/views/lineage-dag/useLineageKeyboardNav.ts` - `resolveNextFocus` pure resolver + `useLineageKeyboardNav` hook (roving tabIndex, focus movement, Enter/Space -> onSelect)
- `frontend/src/views/lineage-dag/useLineageKeyboardNav.test.ts` - 13 pure-resolver tests (every key behavior) + 4 jsdom hook tests (focus movement, Enter/Space, dimmed-row focusability)
- `frontend/src/views/lineage-dag/FreshnessIndicator.tsx` - the freshness component (live relative-time / sample-data honesty, clock icon, full-sentence aria-label)
- `frontend/src/views/lineage-dag/FreshnessIndicator.test.tsx` - 4 tests covering live, sample, missing-fetchedAt fallback, and both aria-labels

## Decisions Made
- Focus-tracking source of truth is `document.activeElement`'s `data-lineage-focus` attribute at keydown time, not a separate React ref — avoids a second piece of state that could drift from real DOM focus
- `resolveNextFocus` trusts the caller-supplied `targets` array's order rather than re-deriving rank/card ordering internally — 03-07 builds that list from data the canvas already has (dagre rank, table/notebook order), so re-sorting here would be a second, potentially-divergent ordering
- An unconnected row's ArrowRight/Left resolves to `null` (no-op), not a rank-jump — the UI-SPEC only specifies rank traversal for headers and path-walk for connected rows; there is no rank fallback defined for a row, so it stays inert on that key
- `Intl.RelativeTimeFormat`'s output already includes the trailing "ago"/"in" — `FreshnessIndicator`'s copy and aria-label compose directly onto that string instead of re-adding "ago"

## Deviations from Plan

None - plan executed exactly as written. Both tasks' `must_haves` truths, prohibitions, and acceptance criteria are satisfied as specified; no architectural changes, no missing-functionality fixes, and no blocking issues were encountered.

## TDD Gate Compliance

Both tasks are marked `tdd="true"` in the plan, but this is a `type: execute` plan (not `type: tdd`), so the plan-level RED→GREEN→REFACTOR gate sequence in the executor instructions does not apply — the per-task `tdd="true"` attribute here signals "write tests alongside the implementation and verify both," which was done: each task's implementation file and its `.test.ts(x)` file were authored together, verified green (`vitest run` for the exact file), then committed as a single `feat(03-06): ...` commit per task. No separate `test(...)` RED commit exists for either task; this matches the plan's stated `<verify>` step (a single automated test-file run per task, not a RED/GREEN commit pair) and the sibling plans' (03-01 through 03-05) established commit pattern in this phase.

## Issues Encountered
None.

## User Setup Required
None - no external service configuration required.

## Next Phase Readiness
- Both leaf components are ready for plan 03-07 (LineageDagView) to wire in: `useLineageKeyboardNav`'s `onKeyDown` attaches directly to the xyflow wrapper (with `nodesFocusable={false}`/`edgesFocusable={false}`/`disableKeyboardA11y` per RESEARCH.md Pitfall 1), and DOM focus targets need `data-lineage-focus` + the roving `tabIndex` convention this hook expects
- `FreshnessIndicator` is ready to drop into the new `lineage-toolbar` strip, sourced from `AppModel.source` + `RouterContext.fetchedAt` (the latter wired in 03-07 per D-14, captured once at the root loader — no new persistence)
- No blockers. Full frontend suite green (96/96 tests, 17 files); `tsc -b --noEmit` clean.

---
*Phase: 03-lineage-dag-canvas-rebuild*
*Completed: 2026-07-23*

## Self-Check: PASSED

All 4 created files verified present on disk; all 3 commit hashes (a8607fe, fac6b88, d7c3807) verified in git log.
