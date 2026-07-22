---
phase: 02-app-shell-routing-canvas-infrastructure
plan: 06
subsystem: ui
tags: [cmdk, radix-dialog, tanstack-router, react, command-palette, search]

# Dependency graph
requires:
  - phase: 02-app-shell-routing-canvas-infrastructure (02-03)
    provides: TanStack Router route tree, useSelection()/selectionSchema, lineageTarget() helper
  - phase: 02-app-shell-routing-canvas-infrastructure (02-04)
    provides: AppShell-owned palette open-state + global Cmd+K listener, CommandPalette.tsx stub (Command.Dialog scaffold)
provides:
  - "cmdk-based CommandPalette: ranked/grouped/capped search over tables, columns, notebooks, notebook code"
  - "Real navigation on select (table/column results push to /lineage/$workspace/$lakehouse/$table with sel/col)"
  - "src/shell/search.ts: standalone, tested search()/GROUP_ORDER/GROUP_LABEL/MAX_PER_GROUP/hl module"
  - "Retirement of the hand-rolled views/SearchPalette.tsx and its manual keyboard/focus handling (D-17)"
affects: [phase-3-canvas-rebuild, phase-4-graph-canvas-rebuild]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Ranked/grouped search logic lives in a plain .ts module (search.ts), consumed by a cmdk Command.Dialog with shouldFilter={false} so the app's own ranking is never re-sorted"
    - "hl() highlight helper built with React.createElement (not JSX) since the module is .ts not .tsx — keeps output as real React nodes, never an HTML string"
    - "getRouteApi('__root__') used instead of importing the root Route object directly, avoiding a __root.tsx -> AppShell -> CommandPalette -> __root.tsx circular import"

key-files:
  created:
    - frontend/src/shell/search.ts
    - frontend/src/shell/__tests__/search.test.ts
    - frontend/src/shell/__tests__/CommandPalette.test.tsx
    - .planning/phases/02-app-shell-routing-canvas-infrastructure/deferred-items.md
  modified:
    - frontend/src/shell/CommandPalette.tsx
    - frontend/src/styles/shell.css
  deleted:
    - frontend/src/views/SearchPalette.tsx
    - frontend/src/views/search.css

key-decisions:
  - "hl() uses createElement instead of JSX syntax because the plan pins the module path to search.ts (not .tsx), and esbuild/tsc reject JSX in a .ts file"
  - "notebook/code palette results resolve to their written table via model.ops (writes edge) and navigate there; when no ops edge exists (non-DAG sample notebooks), fall back to a selection-only useSelection().select(notebookId) so Inspector can still show the notebook — the plan's truths/acceptance criteria only require real navigation for table/column results, so this is a reasonable, documented interpretation for the unspecified notebook/code case"
  - "Discovered a pre-existing, unrelated bug (Suspense pendingComponent renders AppShell/Inspector outside router match context, crashing the app on nearly every load) that blocks live-browser verification; logged to deferred-items.md rather than fixed, since it predates this plan and lives outside its file scope — added CommandPalette.test.tsx (mocked router) for functional coverage instead"

requirements-completed: [NAV-01, NAV-03]

coverage:
  - id: D1
    description: "search()/GROUP_ORDER/GROUP_LABEL/MAX_PER_GROUP/hl() ported verbatim into src/shell/search.ts with ranking/grouping/cap parity"
    requirement: "NAV-01"
    verification:
      - kind: unit
        ref: "frontend/src/shell/__tests__/search.test.ts"
        status: pass
    human_judgment: false
  - id: D2
    description: "cmdk Command.Dialog CommandPalette: grouped/ranked results, no-query empty state, exact no-match copy, real navigation on table/column select"
    requirement: "NAV-01"
    verification:
      - kind: unit
        ref: "frontend/src/shell/__tests__/CommandPalette.test.tsx"
        status: pass
    human_judgment: false
  - id: D3
    description: "Palette is fully keyboard-operable via cmdk/Radix Dialog (no manual keydown/Arrow handling); focus-trap and focus-restore-on-close come from the primitive"
    requirement: "NAV-03"
    verification:
      - kind: automated_ui
        ref: "grep confirms no document.addEventListener('keydown' or manual ArrowDown/ArrowUp handler in CommandPalette.tsx; npm run build exits 0"
        status: pass
    human_judgment: true
    rationale: "Actual keyboard-operability (tab order, arrow-key loop/wrap, Esc focus-restore) requires driving a real browser, which is currently blocked by the pre-existing, unrelated Suspense/pendingComponent crash documented in deferred-items.md — needs a human/live-browser pass once that blocker is resolved"
  - id: D4
    description: "Hand-rolled views/SearchPalette.tsx (manual ArrowUp/ArrowDown/Enter/Escape + document keydown focus handling) deleted, not left dead in the tree"
    requirement: "NAV-01"
    verification:
      - kind: unit
        ref: "test ! -f frontend/src/views/SearchPalette.tsx (verified in this session)"
        status: pass
    human_judgment: false

duration: 20min
completed: 2026-07-21
status: complete
---

# Phase 2 Plan 6: Command Palette Rebuild (cmdk) Summary

**Cmd+K command palette rebuilt on cmdk's Command.Dialog with a ported, tested ranking module (src/shell/search.ts) and real navigation to the lineage canvas on select, retiring the hand-rolled SearchPalette.tsx.**

## Performance

- **Duration:** ~20 min
- **Started:** 2026-07-21T23:38:37-07:00 (previous plan's completion commit)
- **Completed:** 2026-07-21T23:58:48-07:00
- **Tasks:** 2
- **Files modified:** 6 (2 created new modules + 2 tests + 2 modified/deleted pairs; see key-files)

## Accomplishments
- Ported `SearchResult`/`GROUP_ORDER`/`GROUP_LABEL`/`MAX_PER_GROUP`/`notebookIndex`/`search()`/`hl()` verbatim into a standalone, unit-tested `src/shell/search.ts` module
- Filled the 02-04 `CommandPalette.tsx` stub with a real `Command.Input`/`Command.List` implementation: `shouldFilter={false}`, grouped/capped rendering in `GROUP_ORDER`, exact `No matches for "{query}".` copy, and `query.trim()` guard for the no-query empty state
- Wired real navigation on select: table/column results `navigate()` to `/lineage/$workspace/$lakehouse/$table` with `sel`/`col` search params (reusing the existing `lineageTarget()` helper from `routes/graph/-lineageLink.ts`); notebook/code results resolve to their written table via `model.ops` or fall back to a selection-only update
- Moved the `.sp-*` row/highlight CSS from the retired `search.css` into `shell.css` under the palette tokens; deleted `views/SearchPalette.tsx` and `views/search.css`
- Added `CommandPalette.test.tsx` (mocked-router component test) as functional coverage, given a discovered pre-existing app-wide crash blocking live-browser verification

## Task Commits

Each task was committed atomically:

1. **Task 1: Port search()/ranking into src/shell/search.ts with parity tests** - `b9119cc` (test)
2. **Task 2: Build the cmdk CommandPalette, wire real navigation, retire SearchPalette** - `cb23eac` (feat)

**Plan metadata:** (this commit)

## Files Created/Modified
- `frontend/src/shell/search.ts` - Ported ranked/grouped/capped search over tables/columns/notebooks/code + hl() highlight helper (createElement, not JSX, since the module is `.ts`)
- `frontend/src/shell/__tests__/search.test.ts` - Parity tests: empty query, cross-kind GROUP_ORDER, per-group cap, code-match context, hl() output shape
- `frontend/src/shell/CommandPalette.tsx` - Real Command.Dialog implementation replacing the 02-04 stub; grouped rendering, real navigation on select
- `frontend/src/shell/__tests__/CommandPalette.test.tsx` - Component-level coverage (mocked `@tanstack/react-router`, `useSelection`, `useModel`) for the palette's DOM behavior and navigation calls
- `frontend/src/styles/shell.css` - Added `.sp-input`/`.sp-results`/`.sp-empty`/`[cmdk-group-heading]`/`.sp-row`/`.sp-id`/`.sp-ctx`/`.sp-line`/`.sp-code`/`mark` rules under the palette tokens; `.palette` now `display:flex; flex-direction:column`
- `frontend/src/views/SearchPalette.tsx` - Deleted (retired, D-17)
- `frontend/src/views/search.css` - Deleted (retired, D-17)
- `.planning/phases/02-app-shell-routing-canvas-infrastructure/deferred-items.md` - New: logs the pre-existing Suspense/pendingComponent crash discovered during verification

## Decisions Made
- `hl()` uses `React.createElement('mark', ...)` rather than JSX, since the plan's `files_modified` pins the module to `search.ts` (not `.tsx`) and TypeScript/esbuild reject JSX syntax in a `.ts` file; output is still real React nodes (never an HTML string), satisfying the T-02-06 threat mitigation.
- `getRouteApi('__root__')` (not importing `{ Route as RootRoute } from '../routes/__root'`) is used to read the root loader's `graph` for `lineageTarget()` — avoids a `__root.tsx -> AppShell -> CommandPalette -> __root.tsx` circular import that the two existing precedents (`-GraphRouteView.tsx`, `lineage/$workspace...tsx`) don't have to deal with, since neither of those is itself imported by `__root.tsx`.
- Notebook/code select-navigation behavior (not covered by the plan's truths/acceptance criteria, which only specify table/column) resolves the notebook's written table via `model.ops` (`[source, target, 'writes']`) and navigates there; falls back to a selection-only `useSelection().select(notebookId)` when no `ops` edge exists (true for the sample model's non-DAG notebooks) so Inspector can still surface the notebook.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] Reworded a code comment that literally contained the acceptance-criteria's forbidden substring**
- **Found during:** Task 2, self-check pass
- **Issue:** An explanatory comment in `CommandPalette.tsx` read `// No manual document.addEventListener('keydown') ...` — literally containing the substring `document.addEventListener('keydown'` that the plan's acceptance criteria checks the file does NOT contain, which would false-fail an automated grep-based check despite the code itself having no such handler.
- **Fix:** Reworded the comment to describe the same intent without the literal substring.
- **Files modified:** frontend/src/shell/CommandPalette.tsx
- **Verification:** `grep -n "addEventListener('keydown'\|ArrowDown\|ArrowUp" src/shell/CommandPalette.tsx` returns nothing.
- **Committed in:** cb23eac (Task 2 commit)

---

**Total deviations:** 1 auto-fixed (1 blocking)
**Impact on plan:** Cosmetic-only fix to keep the acceptance-criteria grep check accurate; no behavior change. No scope creep.

## Issues Encountered

**Pre-existing app-crash blocks live-browser verification (not caused by this plan).** While attempting the plan's `<verify><human-check>` step (run `npm run dev`, exercise the palette in both themes), the entire app rendered blank on load, in both `npm run dev` and a production `vite preview` build. Traced to `src/routes/__root.tsx`'s `RootPending()` (the router's Suspense `pendingComponent`) rendering `<AppShell>` — which unconditionally mounts `<Inspector/>`, whose `useSelection()` call throws (`Invariant failed: Could not find a nearest match!`) because the Suspense `fallback` element renders outside the `matchContext.Provider` that `@tanstack/react-router`'s `Matches()` component only wraps around its primary children. Confirmed pre-existing by reproducing the identical crash against a stashed `master` checkout (02-04's stub `CommandPalette`, unmodified `shell.css`) — not introduced by this plan's changes. Logged in full in `deferred-items.md`; not fixed here since the affected files (`__root.tsx`, `AppShell.tsx`, `Inspector.tsx`) are outside 02-06's declared scope and the correct fix is itself a small design decision belonging to whichever plan owns the root loader + shell composition. Worked around by adding a mocked-router component test (`CommandPalette.test.tsx`) so the palette's DOM/navigation behavior is still verified; the plan's automated checks (`npx vitest run src/shell/__tests__/search.test.ts`, `npm run build`) both pass cleanly. The literal both-themes manual click-through is deferred until the blocker is fixed.

## User Setup Required

None - no external service configuration required.

## Next Phase Readiness

- NAV-01/NAV-03 delivered on the new cmdk/Radix-Dialog primitive; `src/shell/search.ts` is a clean, tested module future phases can extend (e.g. adding new result kinds) without touching the palette's rendering code.
- **Blocker for the phase's own standing UAT (#12, both-themes check):** the pre-existing Suspense/pendingComponent crash in `deferred-items.md` must be fixed before ANY live-browser verification (of the palette or anything else in the app) is possible. This should be picked up before phase 02 is signed off, not carried into phase 3/4.

---
*Phase: 02-app-shell-routing-canvas-infrastructure*
*Completed: 2026-07-21*

## Self-Check: PASSED

- FOUND: frontend/src/shell/search.ts
- FOUND: frontend/src/shell/__tests__/search.test.ts
- FOUND: frontend/src/shell/CommandPalette.tsx
- FOUND: frontend/src/shell/__tests__/CommandPalette.test.tsx
- CONFIRMED DELETED: frontend/src/views/SearchPalette.tsx
- CONFIRMED DELETED: frontend/src/views/search.css
- FOUND: .planning/phases/02-app-shell-routing-canvas-infrastructure/deferred-items.md
- FOUND commit: b9119cc
- FOUND commit: cb23eac
