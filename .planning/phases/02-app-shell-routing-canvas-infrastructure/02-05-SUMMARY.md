---
phase: 02-app-shell-routing-canvas-infrastructure
plan: 05
subsystem: ui
tags: [react, tanstack-router, inspector, selection, overlay]

# Dependency graph
requires:
  - phase: 02-app-shell-routing-canvas-infrastructure
    provides: "02-03's useSelection() ?sel/?col store, 02-04's AppShell mount point for Inspector (stub) and the token-bridged LineageView/GraphView"
provides:
  - "Real non-modal overlay Inspector (D-10/D-12/D-13) showing a graph-derived metadata card: name, kind, location, columns, connected-edge counts"
  - "Canvas selection wiring: LineageView column clicks and GraphView's table-detail header click write through useSelection().select()"
  - "Single shell-level Esc-to-clear listener (scoped to Inspector) plus empty-canvas-click clearing on both bridged canvases"
affects: [phase-3-lineage-dag-rebuild, phase-4-knowledge-graph-rebuild]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Inspector resolves the selected id against AppModel (tables, then notebooks) rather than duplicating selection state — URL is the single source of truth (D-08/D-11)"
    - "Empty-canvas-click-to-clear implemented via `e.target === e.currentTarget` on the canvas/panel wrapper, not a stopPropagation chain"
    - "Esc-to-clear lives in exactly one place (Inspector.tsx's own effect, active only while sel is set) — canvases only add empty-click clearing, never their own Esc handler"

key-files:
  created:
    - frontend/src/shell/__tests__/Inspector.test.tsx
  modified:
    - frontend/src/shell/Inspector.tsx
    - frontend/src/styles/shell.css
    - frontend/src/views/LineageView.tsx
    - frontend/src/views/GraphView.tsx

key-decisions:
  - "Used table.layer (already the lakehouse-name field for live graphs, per model/lineageLayout.ts's layerOf()) as the D-12 'workspace/lakehouse location' field — Table has no separate workspace field, and layer is the same data the old .ls-inspector's insp-crumb already showed for this purpose"
  - "GraphView's selection write is scoped to TableDetail's table header only ('a node click at the table/detail level'), not the force-directed constellation nodes — those already have drill behavior and Phase 3/4 own any further canvas-click redesign"
  - "LineageView's local hover/trace highlight state (selected/hover/traced) is left untouched; column clicks additionally call useSelection().select() so the shell Inspector opens, without touching the DAG's own rendering logic (Phase 3/4 scope)"

patterns-established:
  - "New Inspector chrome uses its own `.inspector-*`-prefixed classes in shell.css (avoiding any name collision with the old `.insp-head`/`.insp-title`/`.insp-crumb` component.css classes, now dead code after LineageView's own inspector was removed), while reusing the generic `.sec`/`.sec-t`/`.col` row treatment verbatim per PATTERNS.md"

requirements-completed: [SHELL-03]

coverage:
  - id: D1
    description: "Inspector renders null when nothing is selected and shows the D-12 metadata card (name, kind, location, columns, connected-edge counts) when a table is selected, omitting missing fields/empty column sections"
    requirement: SHELL-03
    verification:
      - kind: unit
        ref: "frontend/src/shell/__tests__/Inspector.test.tsx#renders null when sel is unset (D-11: visibility == selection)"
        status: pass
      - kind: unit
        ref: "frontend/src/shell/__tests__/Inspector.test.tsx#renders the metadata card for a selected table: name, kind, a column, and edge counts"
        status: pass
      - kind: unit
        ref: "frontend/src/shell/__tests__/Inspector.test.tsx#omits the column section and the Connections row for a table with zero columns and no context entry (partial consideration)"
        status: pass
      - kind: unit
        ref: "frontend/src/shell/__tests__/Inspector.test.tsx#close button carries the accessible name \"Close inspector\" and calls clear()"
        status: pass
    human_judgment: false
  - id: D2
    description: "Inspector is a non-modal overlay (position absolute/fixed, not a docked flex-none aside, not wrapped in Radix Dialog/Popover) that never reflows the canvas when it opens/closes, and Esc/close-button/empty-canvas-click all clear it, verified in both light and dark theme"
    requirement: SHELL-03
    verification: []
    human_judgment: true
    rationale: "No-reflow, focus-non-trapping overlay behavior, and both-theme visual parity are visual/interaction judgments the plan's own verification section marks manual-only (npm run dev + click-through); no headless browser tool was available in this execution environment to substitute a screenshot-based check"
  - id: D3
    description: "Canvas selection writes go only through useSelection().select() (replace:true) — LineageView column clicks and GraphView TableDetail header clicks set ?sel/?col without pushing a history entry"
    requirement: SHELL-03
    verification:
      - kind: unit
        ref: "frontend/src/selection/__tests__/useSelection.test.ts#select() navigates with replace: true (SHELL-06 / D-08) [pre-existing, exercised by the new call sites]"
        status: pass
      - kind: other
        ref: "grep for `useSelection`/`select(`/`navigate({ search` in frontend/src/views/LineageView.tsx and GraphView.tsx confirms no raw navigate({ search calls were added for selection"
        status: pass
    human_judgment: false

duration: 14min
completed: 2026-07-21
status: complete
---

# Phase 02 Plan 05: Contextual Inspector & Canvas Selection Wiring Summary

**Non-modal right-edge Inspector overlay reading useSelection()+useModel() to render a D-12 metadata card, wired to real clicks in the bridged LineageView/GraphView canvases**

## Performance

- **Duration:** 14 min
- **Started:** 2026-07-21T23:23:02-07:00
- **Completed:** 2026-07-21T23:36:48-07:00
- **Tasks:** 2
- **Files modified:** 4 (+1 test file created)

## Accomplishments
- `Inspector.tsx` is now the real D-10/D-12 overlay: renders iff `?sel` is set, resolves the id against `AppModel` (tables, then notebooks), and shows name/kind/location/columns/connected-edge-counts — a missing field omits its row, a zero-column table omits the column section entirely
- Single shell-level Esc-to-clear listener lives inside `Inspector.tsx`, active only while it's visible — no per-canvas Esc handler duplicates it
- `LineageView.tsx` column clicks and `GraphView.tsx`'s table-detail header click now write selection through `useSelection().select()`; both canvases also clear on an empty-canvas click
- `LineageView.tsx`'s own docked `.ls-inspector` is removed — the shell `Inspector` (already mounted once in `AppShell`) supersedes it

## Task Commits

Each task was committed atomically:

1. **Task 1: Build the non-modal overlay Inspector with the D-12 metadata card** - `f607610` (feat)
2. **Task 2: Wire canvas selection + single Esc/empty-click clear into the inspector** - `66abc6f` (feat)

## Files Created/Modified
- `frontend/src/shell/Inspector.tsx` - Real D-10/D-12 overlay implementation, replacing the 02-04 stub
- `frontend/src/shell/__tests__/Inspector.test.tsx` - Renders-null / populated-card / partial-field-omission / close-button coverage
- `frontend/src/styles/shell.css` - `.inspector-overlay` becomes a flex column (fixed header + scrolling body); new `.inspector-head`/`-head-text`/`-kind`/`-title`/`-close`/`-body`/`-location`/`-cols` chrome
- `frontend/src/views/LineageView.tsx` - Column clicks call `useSelection().select(table.id, col.key)`; empty-canvas click calls `clear()`; own docked inspector removed
- `frontend/src/views/GraphView.tsx` - `TableDetail`'s table header calls `useSelection().select(tableId)`; empty click on the table-detail panel calls `clear()`

## Decisions Made
- Used `table.layer` as the D-12 "workspace/lakehouse location" field (no separate workspace field exists on `Table`; `layer` is the live-graph lakehouse name per `model/lineageLayout.ts`'s `layerOf()`, and is what the old inspector's `insp-crumb` already showed for this purpose)
- Scoped GraphView's selection write to `TableDetail`'s table header only, matching the plan's literal "node click at the table/detail level" — the force-directed constellation's own node click handling (drill vs. no-op) was left untouched, in scope for Phase 3/4
- Kept LineageView's local hover/trace highlight state (`selected`/`hover`/`traced`) exactly as it was; column clicks additionally call `select()` so the shell Inspector opens, without touching the DAG's own rendering/highlight logic

## Deviations from Plan

None — plan executed exactly as written. The Esc-to-clear listener's exact home (inside `Inspector.tsx` rather than a separate `AppShell.tsx` change) was an interpretation of Task 1/Task 2's shared "single shell-level Esc listener" requirement — `Inspector.tsx` was already in Task 1's file list and is the correct, already-mounted-once location for it, so no additional file outside the plan's declared `files_modified` was touched.

## Issues Encountered
- No headless browser / Playwright / chromium-cli tooling was available in this Windows execution environment to perform the plan's `<human-check>` visual both-theme verification. The dev server was started and confirmed to respond (HTTP 200, correct HTML shell) as an automated smoke check; the full "click through both themes" verification remains for the user's own manual pass, consistent with this phase's own test map marking SHELL-06/NAV-03-adjacent visual checks as manual-only.

## User Setup Required

None - no external service configuration required.

## Next Phase Readiness
- SHELL-03 is delivered: the contextual inspector opens on selection and closes without disturbing canvas layout, backed by the shared `?sel`/`?col` plumbing from 02-03/02-04
- Manual verification still owed by the user before considering this plan's UI fully signed off: open `npm run dev`, click a lineage column and a graph-mode table header, confirm the inspector opens/closes without canvas reflow in both light and dark theme, and confirm the browser back button isn't flooded by selection clicks
- Phase 3 (Lineage DAG rebuild) inherits an Inspector that currently shows only table-level metadata for a lineage column selection — the plan's own text anticipates Phase 3 deepening this with the transform/evidence detail this plan intentionally dropped from LineageView's old docked inspector

---
*Phase: 02-app-shell-routing-canvas-infrastructure*
*Completed: 2026-07-21*

## Self-Check: PASSED

All created/modified files and both task commit hashes (`f607610`, `66abc6f`) verified present.
