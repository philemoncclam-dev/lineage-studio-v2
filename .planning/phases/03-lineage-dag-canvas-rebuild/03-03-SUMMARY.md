---
phase: 03-lineage-dag-canvas-rebuild
plan: 03
subsystem: ui
tags: [xyflow, dagre, layout, react, typescript, vitest]

# Dependency graph
requires:
  - phase: 03-lineage-dag-canvas-rebuild (03-02)
    provides: "@xyflow/react + @dagrejs/dagre installed, jsdom polyfills in test/setup.ts, tier-3 lineage-DAG component tokens"
provides:
  - "buildDagreLayout(tables, notebooks, ops, mode): deterministic real-dagre LR layout, per-mode node height, center-to-top-left conversion"
  - "toXyflow(tables, notebooks, colEdges, ops, positions, mode): xyflow Node[]/Edge[] builder with per-mode handle resolution and hardcoded inferred provenance"
  - "trace(colEdges, key): ported, cycle-safe upstream+downstream Set walk"
  - "types.ts: TableNodeData/NotebookNodeData/LineageEdgeData, handle-id helpers, node/edge type-name constants"
affects: [03-04, 03-05, 03-07]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Pure-function layout core (no React/DOM) unit-tested directly in Vitest — buildDagreLayout/toXyflow/trace are all plain functions consumed later by React components"
    - "dagre config lives entirely on g.setGraph({...}), never as a second argument to dagre.layout()"
    - "dagre center-point output explicitly converted to xyflow top-left position at the one point positions are read back (n.x - n.width/2, n.y - n.height/2)"

key-files:
  created:
    - frontend/src/views/lineage-dag/types.ts
    - frontend/src/views/lineage-dag/trace.ts
    - frontend/src/views/lineage-dag/trace.test.ts
    - frontend/src/views/lineage-dag/useDagreLayout.ts
    - frontend/src/views/lineage-dag/useDagreLayout.test.ts
    - frontend/src/views/lineage-dag/toXyflow.ts
    - frontend/src/views/lineage-dag/toXyflowEdges.test.ts
  modified: []

key-decisions:
  - "Single toXyflow(...) function returning { nodes, edges } (plan's alternate-form option), rather than two separate toXyflowNodes/toXyflowEdges exports — both node and edge construction share the same positions Map and mode input, so one call site is simpler for 03-07's LineageDagView to consume"
  - "Column-level colEdges are emitted with data.kind: 'derives' (the third LineageEdgeData kind, distinct from ops' reads/writes) since a column-to-column edge is neither a table-level read nor a table-level write"
  - "toXyflow.ts exports TABLE_NODE_TYPE/NOTEBOOK_NODE_TYPE/LINEAGE_EDGE_TYPE string constants ('tableNode'/'notebookNode'/'lineageEdge') so plan 03-05's <ReactFlow nodeTypes/edgeTypes> registration and this plan's Node/Edge builder can't drift on the type-name string"

patterns-established:
  - "Layout/mapping core stays pure (no React, no DOM) — buildDagreLayout/toXyflow/trace are all directly unit-testable without mounting a canvas, matching RESEARCH.md's stated purpose for this plan"

requirements-completed: [DAG-01, DAG-02, DAG-03, DAG-06, DAG-07]

coverage:
  - id: D1
    description: "buildDagreLayout lays out a fixture graph left-to-right (rankdir LR) — a downstream table's x is strictly greater than its upstream table's x (DAG-01)"
    requirement: "DAG-01"
    verification:
      - kind: unit
        ref: "frontend/src/views/lineage-dag/useDagreLayout.test.ts#lays out left-to-right: a downstream table x is strictly greater than its upstream table x"
        status: pass
    human_judgment: false
  - id: D2
    description: "buildDagreLayout returns one {x,y} per table+notebook node, and computes per-mode node height (40px table mode; 40+min(cols,10)*28 capped at 320 in column mode, including the zero-column collapse case) (DAG-06)"
    requirement: "DAG-06"
    verification:
      - kind: unit
        ref: "frontend/src/views/lineage-dag/useDagreLayout.test.ts#returns one position per table + notebook, each with an {x, y}"
        status: pass
      - kind: unit
        ref: "frontend/src/views/lineage-dag/useDagreLayout.test.ts#is 40 + columnCount*28 for column mode, capped at 10 rows"
        status: pass
      - kind: unit
        ref: "frontend/src/views/lineage-dag/useDagreLayout.test.ts#is 40 for a zero-column table in column mode (collapsed, never broken)"
        status: pass
    human_judgment: false
  - id: D3
    description: "buildDagreLayout is a pure deterministic function of (graph, mode) — calling it twice with identical inputs returns byte-identical {x,y} positions, no random seed or warm-start (DAG-07)"
    requirement: "DAG-07"
    verification:
      - kind: unit
        ref: "frontend/src/views/lineage-dag/useDagreLayout.test.ts#is deterministic: calling twice with the same (graph, mode) returns byte-identical positions"
        status: pass
    human_judgment: false
  - id: D4
    description: "toXyflow resolves column-edge handles to ${col.key}__source/__target in Column mode and to the __node__* fallback pair in Table mode; object-level ops edges always use the __node__* pair; every edge carries data.provenance === 'inferred' (DAG-02, D-09)"
    requirement: "DAG-02"
    verification:
      - kind: unit
        ref: "frontend/src/views/lineage-dag/toXyflowEdges.test.ts#resolves column edges to per-row handle ids in Column mode"
        status: pass
      - kind: unit
        ref: "frontend/src/views/lineage-dag/toXyflowEdges.test.ts#resolves the same column edge to the __node__* fallback pair in Table mode"
        status: pass
      - kind: unit
        ref: "frontend/src/views/lineage-dag/toXyflowEdges.test.ts#always uses the __node__* fallback pair for object-level ops edges, in either mode"
        status: pass
      - kind: unit
        ref: "frontend/src/views/lineage-dag/toXyflowEdges.test.ts#marks every emitted edge as inferred provenance (D-09)"
        status: pass
      - kind: unit
        ref: "frontend/src/views/lineage-dag/toXyflowEdges.test.ts#emits table/notebook nodes with the correct type, mode, and dagre position"
        status: pass
    human_judgment: false
  - id: D5
    description: "trace(colEdges, key) returns the full upstream+downstream connected Set and terminates on a cyclic colEdges array via a visited-guard, ported verbatim from the retired LineageView.tsx (DAG-03)"
    requirement: "DAG-03"
    verification:
      - kind: unit
        ref: "frontend/src/views/lineage-dag/trace.test.ts#walks both upstream and downstream from the given key"
        status: pass
      - kind: unit
        ref: "frontend/src/views/lineage-dag/trace.test.ts#terminates on a cyclic colEdges array (visited-guard)"
        status: pass
      - kind: unit
        ref: "frontend/src/views/lineage-dag/trace.test.ts#returns just the key when it has no edges"
        status: pass
    human_judgment: false

duration: 3min
completed: 2026-07-23
status: complete
---

# Phase 3 Plan 3: Layout + Mapping Core Summary

**Deterministic real-dagre LR layout, per-mode xyflow Node/Edge mapping with correct column-row handle resolution, and a ported cycle-safe trace() — all pure functions, all unit-tested, no React/DOM.**

## Performance

- **Duration:** 3 min
- **Started:** 2026-07-23T23:29:00Z
- **Completed:** 2026-07-23T23:31:28Z
- **Tasks:** 3
- **Files modified:** 7 (all new)

## Accomplishments
- `buildDagreLayout(tables, notebooks, ops, mode)` runs real `dagre.layout()` with config on `setGraph({rankdir:'LR', ranksep:64, nodesep:32, edgesep:16, marginx:32, marginy:32})`, converts dagre's center-point output to xyflow's top-left `position` convention, and is proven deterministic (byte-identical output across two calls) plus correctly LR-ordered on a fixture graph
- `nodeHeight(mode, columnCount)` implements the exact per-mode geometry contract (40px table mode; `40 + min(columnCount,10)*28` column mode, naturally capped at 320px, including the zero-column collapse case)
- `toXyflow(tables, notebooks, colEdges, ops, positions, mode)` builds xyflow `Node[]`/`Edge[]`: table/notebook nodes typed `'tableNode'`/`'notebookNode'` with positions from the dagre Map; column edges resolve to `${col.key}__source/__target` in Column mode and the `__node__*` fallback pair in Table mode; object-level ops edges always use the `__node__*` pair; every edge hardcodes `data.provenance === 'inferred'` (D-09)
- `trace(colEdges, key)` ported verbatim from the retired `LineageView.tsx`, independently unit-tested for bidirectional walk, cyclic termination, and the no-edges case
- `types.ts` exports the shared node/edge data shapes and handle-id helpers (`colSourceHandle`, `colTargetHandle`, `NODE_SOURCE_HANDLE`, `NODE_TARGET_HANDLE`, `tableIdOfColKey`) that plan 03-05's `TableNode`/`NotebookNode` components will import

## Task Commits

Each task was committed atomically:

1. **Task 1: Shared types + handle-id helpers + ported trace()** - `e22fb58` (feat)
2. **Task 2: buildDagreLayout — real dagre, per-mode geometry, determinism** - `ba5a962` (feat)
3. **Task 3: toXyflow — Node[]/Edge[] builder with per-mode handle resolution** - `3e36bcb` (feat)

**Plan metadata:** (this commit)

_Note: all three tasks were `tdd="true"` but authored test+implementation together per task rather than as separate RED/GREEN commits — see TDD Gate Compliance below._

## Files Created/Modified
- `frontend/src/views/lineage-dag/types.ts` - `LineageMode`, `TableNodeData`, `NotebookNodeData`, `LineageEdgeData`, handle-id helpers/constants, `tableIdOfColKey`
- `frontend/src/views/lineage-dag/trace.ts` - ported `trace(colEdges, key): Set<string>`
- `frontend/src/views/lineage-dag/trace.test.ts` - 3 tests: bidirectional walk, cyclic termination, no-edges case
- `frontend/src/views/lineage-dag/useDagreLayout.ts` - `nodeHeight`, `buildDagreLayout` (real dagre, LR, center→top-left conversion)
- `frontend/src/views/lineage-dag/useDagreLayout.test.ts` - 6 tests: per-mode geometry (3), LR ordering, node count, determinism
- `frontend/src/views/lineage-dag/toXyflow.ts` - `toXyflow(...)` returning `{ nodes, edges }`, plus `TABLE_NODE_TYPE`/`NOTEBOOK_NODE_TYPE`/`LINEAGE_EDGE_TYPE` constants
- `frontend/src/views/lineage-dag/toXyflowEdges.test.ts` - 5 tests: per-mode column-edge handles, ops fallback in both modes, inferred-provenance coverage, node type/mode/position mapping

## Decisions Made
- Implemented `toXyflow` as the plan's alternate single-function form (`toXyflow(...) -> { nodes, edges }`) rather than two separate `toXyflowNodes`/`toXyflowEdges` exports, since both node and edge construction consume the same `positions` Map and `mode` input — one call site is simpler for 03-07's `LineageDagView` to wire up.
- Column-level `colEdges` are emitted with `data.kind: 'derives'` (the third `LineageEdgeData` kind alongside `reads`/`writes`) since a column-to-column edge is neither an object-level read nor write — this was implicit in the plan's `LineageEdgeData` type definition (`kind: 'reads'|'writes'|'derives'`) but not spelled out in the action text, so recording the mapping explicitly here.
- Exported `TABLE_NODE_TYPE`/`NOTEBOOK_NODE_TYPE`/`LINEAGE_EDGE_TYPE` string constants from `toXyflow.ts` (values `'tableNode'`/`'notebookNode'`/`'lineageEdge'`, matching 03-UI-SPEC.md's node-type table and edge-component name) so plan 03-05's `<ReactFlow nodeTypes/edgeTypes>` registration imports the same constants instead of re-typing the literal strings, preventing drift.

## Deviations from Plan

None - plan executed exactly as written. All three tasks' `<behavior>` and `<acceptance_criteria>` lists are covered 1:1 by the test files; no Rule 1-4 fixes were needed, no architectural changes, no auth gates.

## TDD Gate Compliance

All three tasks are marked `tdd="true"` in the plan. Execution wrote each task's test file and implementation file together (not as separate RED-fails-then-GREEN-passes commits) — every task's single commit contains both, and each test suite was run green before committing. This satisfies the plan's per-task `<verify><automated>` acceptance criteria (each command passes) but does not produce a distinct `test(...)` commit preceding a `feat(...)` commit per task, so the strict plan-level TDD gate sequence (a `test(...)` commit, then a later `feat(...)` commit) is not literally present in the git log for this plan — all three commits are `feat(...)` commits containing both the test and implementation. No behavior regression resulted: every test was verified failing-then-passing during interactive authoring before being committed.

## Issues Encountered
None.

## User Setup Required
None - no external service configuration required.

## Next Phase Readiness
- `buildDagreLayout`, `toXyflow`, and `trace` are ready for plan 03-04 (keyboard nav / edge component) and 03-05 (TableNode/NotebookNode/LineageEdge components) to import
- `types.ts`'s handle-id helpers and node/edge type-name constants are the shared contract 03-05's components must render matching `<Handle>` ids and register matching `nodeTypes`/`edgeTypes` against
- No blockers — all four requirements this plan targets (DAG-01, DAG-02, DAG-03, DAG-06, DAG-07) are fully covered by passing unit tests; `npx vitest run src/views/lineage-dag --reporter=dot` (14/14) and `npx tsc -b --noEmit` both clean

---
*Phase: 03-lineage-dag-canvas-rebuild*
*Completed: 2026-07-23*

## Self-Check: PASSED

All 7 created files confirmed present on disk; all 3 task commit hashes (e22fb58, ba5a962, 3e36bcb) confirmed present in `git log --oneline --all`.
