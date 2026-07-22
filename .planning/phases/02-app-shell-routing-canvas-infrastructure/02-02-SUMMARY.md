---
phase: 02-app-shell-routing-canvas-infrastructure
plan: 02
subsystem: ui
tags: [refactor, vitest, testing, model-layer]

# Dependency graph
requires:
  - phase: 02-app-shell-routing-canvas-infrastructure
    provides: "Vitest + jsdom + Testing Library runner (plan 02-01)"
provides:
  - "src/model/ decomposed into four pure modules (domainColor, lineageLayout, graphLayout, adapt) plus an index.tsx composition root"
  - "Unpicked ./model import surface — adapt/sampleModel/ModelProvider/useModel/AppModel/TableContext unchanged for all four view consumers"
  - "17 passing parity unit tests proving output-shape equivalence with the deleted model.tsx"
affects: [02-03, 02-04, 02-05, 02-06]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "src/model/ids.ts holds the shared tid/nid element-id helpers so lineageLayout.ts, graphLayout.ts, and adapt.ts import them without a circular adapt.ts<->leaf-module dependency"
    - "Each leaf module (lineageLayout.ts, graphLayout.ts) independently derives its own byId Map / layerOf closure from the LineageGraph it's given, rather than accepting them as parameters — keeps each module callable with just (g, ...) and matches the Shared Patterns 'byId Map built once per traversal site' idiom from 02-PATTERNS.md"
    - "adapt.ts imports AppModel/TableContext as `import type` from ./index — a type-only circular import that erases at compile time, letting index.tsx own the types while adapt.ts implements the function that returns them"

key-files:
  created:
    - "frontend/src/model/domainColor.ts"
    - "frontend/src/model/lineageLayout.ts"
    - "frontend/src/model/graphLayout.ts"
    - "frontend/src/model/ids.ts"
    - "frontend/src/model/adapt.ts"
    - "frontend/src/model/index.tsx"
    - "frontend/src/model/__tests__/fixtures.ts"
    - "frontend/src/model/__tests__/domainColor.test.ts"
    - "frontend/src/model/__tests__/lineageLayout.test.ts"
    - "frontend/src/model/__tests__/graphLayout.test.ts"
    - "frontend/src/model/__tests__/adapt.test.ts"
  modified: []

key-decisions:
  - "Added frontend/src/model/ids.ts (not in the plan's files_modified list) to hold tid/nid, rather than co-locating them in adapt.ts as the plan's second option suggested — co-locating would create a real circular import (adapt.ts imports layoutLineage from lineageLayout.ts, which would need to import tid/nid back from adapt.ts). A tiny leaf ids.ts avoids that entirely and matches the plan's explicit 'or a small local util' alternative."
  - "Added frontend/src/model/__tests__/fixtures.ts (not in the plan's files_modified list) as a single shared LineageGraph fixture reused by all four test files, instead of duplicating an equivalent literal four times — reduces the risk of the parity tests drifting out of sync with each other."
  - "lineageLayout.ts and graphLayout.ts both take the full LineageGraph (plus lineageLayout also takes the already-classified ops) and derive tableNodes/nbNodes/byId/layerOf internally, rather than accepting them as pre-computed parameters from adapt.ts — matches the plan's must_haves.truths wording ('given the sample LineageGraph') and keeps each module's signature small and independently callable in tests."

requirements-completed: [SHELL-07]

coverage:
  - id: D1
    description: "domainColor.ts extracted with colorFor/LAYER_COLOR unchanged, including the 'anything else falls back to workspace' behavior"
    requirement: SHELL-07
    verification:
      - kind: unit
        ref: "frontend/src/model/__tests__/domainColor.test.ts (3 tests)"
        status: pass
    human_judgment: false
  - id: D2
    description: "lineageLayout.ts extracted as a pure DAG depth/place function (x=40+depth*274, 36px gutter), no React import, no pixel math left in adapt.ts"
    requirement: SHELL-07
    verification:
      - kind: unit
        ref: "frontend/src/model/__tests__/lineageLayout.test.ts (3 tests)"
        status: pass
    human_judgment: false
  - id: D3
    description: "graphLayout.ts extracted as a pure knowledge-graph levels/levelTable builder (estate/ws:/lake:/tbl: keys), no force-simulation code"
    requirement: SHELL-07
    verification:
      - kind: unit
        ref: "frontend/src/model/__tests__/graphLayout.test.ts (4 tests)"
        status: pass
    human_judgment: false
  - id: D4
    description: "adapt.ts composes the three leaf modules; adapt(g) output (tables/notebooks/ops/colEdges/xform/levels/levelTable/notebookCode/context) matches hand-traced expected values; model.tsx deleted; ./model import surface (adapt, sampleModel, ModelProvider, useModel, AppModel, TableContext) unchanged for all four view consumers; npm run build exits 0"
    requirement: SHELL-07
    verification:
      - kind: unit
        ref: "frontend/src/model/__tests__/adapt.test.ts (7 tests)"
        status: pass
      - kind: other
        ref: "cd frontend && npm run build (exit 0, tsc -b + vite build)"
        status: pass
      - kind: other
        ref: "test ! -f frontend/src/model.tsx"
        status: pass
    human_judgment: false

duration: 15min
completed: 2026-07-21
status: complete
---

# Phase 02 Plan 02: Model Layer Decomposition Summary

**Decomposed the 228-line `src/model.tsx` monolith into four pure, independently unit-tested modules (`domainColor`, `lineageLayout`, `graphLayout`, `adapt`) plus an `index.tsx` composition root, with the `./model` import surface unchanged for all four view consumers.**

## Performance

- **Duration:** ~15 min
- **Started:** 2026-07-21T22:28:00-07:00
- **Completed:** 2026-07-21T22:32:00-07:00
- **Tasks:** 2
- **Files modified:** 11 (10 created, 1 deleted)

## Accomplishments
- Extracted `domainColor.ts` (`LAYER_COLOR`/`colorFor`), `lineageLayout.ts` (pure layered DAG placement), and `graphLayout.ts` (pure knowledge-graph levels/levelTable builder) as independently testable leaf modules, each with zero React import
- Extracted `adapt.ts` as the orchestrator, composing the three leaf modules plus retaining the object-level ops classification, column-edge/transform resolution, and upstream/downstream context logic
- Built `index.tsx` as the composition root: `AppModel`/`TableContext` types, `sampleModel()`, `ModelContext`/`ModelProvider`/`useModel`, re-exporting `adapt`
- Deleted `src/model.tsx`; confirmed `npm run build` stays green with the four unmodified consumer imports (`LineageView.tsx`, `GraphView.tsx`, `SearchPalette.tsx`, `PurviewPanel.tsx`)
- Wrote 17 unit tests across four `__tests__` files (3 leaf-module test files + `adapt.test.ts`), all passing, verifying parity against a shared hand-traced fixture `LineageGraph`

## Task Commits

Each task was committed atomically:

1. **Task 1: Extract the three pure leaf modules (domainColor, lineageLayout, graphLayout) with parity tests** - `f59770f` (feat)
2. **Task 2: Extract adapt.ts + build index.tsx composition root, delete model.tsx** - `f0fb566` (feat)

**Plan metadata:** pending (this commit)

## Files Created/Modified
- `frontend/src/model/domainColor.ts` - `LAYER_COLOR` record + `colorFor(layer)`, unchanged from model.tsx
- `frontend/src/model/lineageLayout.ts` - `layoutLineage(g, ops)`: pure depth/yCursor/place DAG layout, returns positioned `{ tables, notebooks }`
- `frontend/src/model/graphLayout.ts` - `buildGraphLevels(g)`: pure estate/workspace/lakehouse topology builder, returns `{ levels, levelTable }`
- `frontend/src/model/ids.ts` - Shared `tid`/`nid` element-id helpers (new file, see Decisions)
- `frontend/src/model/adapt.ts` - `adapt(g): AppModel` orchestrator composing the three leaf modules
- `frontend/src/model/index.tsx` - `AppModel`/`TableContext` types, `sampleModel()`, `ModelProvider`/`useModel`, re-exports `adapt`
- `frontend/src/model/__tests__/fixtures.ts` - Shared `sampleGraph()` `LineageGraph` fixture used by all four test files (new file, see Decisions)
- `frontend/src/model/__tests__/domainColor.test.ts` - 3 tests
- `frontend/src/model/__tests__/lineageLayout.test.ts` - 3 tests
- `frontend/src/model/__tests__/graphLayout.test.ts` - 4 tests
- `frontend/src/model/__tests__/adapt.test.ts` - 7 tests
- `frontend/src/model.tsx` - deleted (superseded by `src/model/`)

## Decisions Made
- Added `src/model/ids.ts` for the shared `tid`/`nid` helpers instead of co-locating them in `adapt.ts` — avoids a circular import between `adapt.ts` and the leaf modules that need the same helpers.
- Added `src/model/__tests__/fixtures.ts` as a single shared fixture graph across all four test files, hand-traced once and reused, rather than four independently-authored fixtures that could drift.
- `lineageLayout.ts`/`graphLayout.ts` take the full `LineageGraph` (and, for `lineageLayout`, the pre-classified `ops`) and derive `byId`/`layerOf`/node buckets internally, per module — matches 02-PATTERNS.md's documented "build a `byId` Map once per traversal site" idiom and keeps each function's signature minimal.

## Deviations from Plan

None beyond the two file additions documented above under Decisions (both fall under Rule 2 — the plan explicitly offered "a small local util" as an acceptable form for the tid/nid helpers, and the fixtures file is test infrastructure that reduces risk rather than adding new production behavior). No consumer import paths changed; `AppModel`'s shape is byte-identical to the pre-refactor version.

## Issues Encountered
None. `npx tsc --noEmit`, `npm run build`, and `npm run lint` all passed with no new errors (lint's pre-existing `only-export-components` warning on the model composition root is inherent to the same mixed type/hook/function export shape `model.tsx` already had — not a regression from this refactor).

## User Setup Required
None - no external service configuration required.

## Next Phase Readiness
- `src/model/` gives 02-03 through 02-06 clean, independently testable seams (`layoutLineage`, `buildGraphLevels`, `colorFor`, `adapt`) to consume for the shell/router/canvas rebuild
- The `./model` import surface is unchanged, so no consumer of `AppModel`/`useModel`/`adapt`/`sampleModel` needs any edit in later plans
- No blockers for the remaining Wave 2+ plans in this phase

---
*Phase: 02-app-shell-routing-canvas-infrastructure*
*Completed: 2026-07-21*

## Self-Check: PASSED

All 11 created files verified present on disk; `frontend/src/model.tsx` verified absent (deleted as planned); both commit hashes (`f59770f`, `f0fb566`) verified in `git log`.
