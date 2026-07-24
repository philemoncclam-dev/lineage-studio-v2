---
phase: 03-lineage-dag-canvas-rebuild
plan: 05
subsystem: ui
tags: [xyflow, react, typescript, vitest, css]

# Dependency graph
requires:
  - phase: 03-lineage-dag-canvas-rebuild (03-02)
    provides: "@xyflow/react + @dagrejs/dagre installed, jsdom polyfills in test/setup.ts, tier-3 lineage-DAG component tokens (--dag-*)"
  - phase: 03-lineage-dag-canvas-rebuild (03-03)
    provides: "types.ts (TableNodeData/NotebookNodeData/LineageEdgeData, handle-id helpers, node/edge type-name constants), toXyflow.ts, useDagreLayout.ts"
provides:
  - "TableNode: xyflow custom node ('tableNode') — ported .ls-node/.head/.cols/.col card, per-row Handle pairs anchored at exact row center, always-present __node__* fallback pair, UI-SPEC aria-labels + data-lineage-focus/data-node/data-col attributes"
  - "NotebookNode: xyflow custom node ('notebookNode') — header-only ported card, never expandable, __node__* fallback pair only"
  - "LineageEdge: xyflow custom edge ('lineageEdge') — BaseEdge + getBezierPath, exported pure lineageEdgeClass(data) helper composing kind/provenance/traced as independent class channels"
  - "lineage-dag.css — .ls-node/.head/.cols/.col/.tick/.lineage-edge rules bound to tier-3 --dag-* tokens + existing tier-2 --color-*/--card-* semantics"
affects: [03-07]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "xyflow custom node/edge data types declared via `interface` (types.ts) need a local `& Record<string, unknown>` intersection when passed to NodeProps<Node<...>>/EdgeProps<Edge<...>> — TS's generic constraint (NodeData extends Record<string, unknown>) isn't structurally satisfied by a plain interface without an index signature, even though every field is fully typed"
    - "View-level render state (edge trace on/dim) that isn't part of the static toXyflow() mapping is layered on locally via a component-scoped type extension (TracedLineageEdgeData extends LineageEdgeData), keeping the shared types.ts contract untouched"
    - "Handle absolute positioning resolves against xyflow's .react-flow__node wrapper (position:absolute, set by base.css), not against whatever DOM element the <Handle> happens to be nested inside in React — so lineage-dag.css must never set `position` on .ls-node/.cols/.col or the row-center math (headerHeight + i*rowHeight + rowHeight/2) silently misaligns"

key-files:
  created:
    - frontend/src/views/lineage-dag/TableNode.tsx
    - frontend/src/views/lineage-dag/NotebookNode.tsx
    - frontend/src/views/lineage-dag/LineageEdge.tsx
    - frontend/src/views/lineage-dag/LineageEdge.test.tsx
    - frontend/src/views/lineage-dag/lineage-dag.css
  modified: []

key-decisions:
  - "Both TableNode and NotebookNode header clicks wire directly to useSelection().select(data.id) (no toggle, per D-03) — applied symmetrically to NotebookNode even though the plan's action text only spelled this out for TableNode, since 03-UI-SPEC.md's keyboard model requires Enter/Space on a notebook header to select it too, and mouse parity with keyboard is the obvious read"
  - "data-lineage-focus value = data.id for headers, col.key for rows — both are already-unique flat ids (col.key = `${tableId}.${colName}` per types.ts), giving 03-07's flat FocusTarget list a collision-free id without needing a synthesized compound id"
  - "TableNode's .tick domain-colour class reads data.colorKey (the enumerated ColorKey union) rather than the free-form data.layer string, since colorFor()'s fallback-to-'workspace' logic for unrecognised layer strings only round-trips correctly through colorKey — layer stays used for the .sub label text only"
  - "The always-present __node__source/__node__target fallback Handle pair renders unconditionally on both node types regardless of table/column mode (not gated behind `mode === 'table'` as RESEARCH.md's illustrative code example showed) — object-level reads/writes edges always target this pair even while a table is expanded in Column mode, per the plan's must_haves truths"
  - "TracedLineageEdgeData (LineageEdgeData + optional `traced`) is declared locally in LineageEdge.tsx rather than added to types.ts — trace state is a per-render view concern 03-07 will inject when building the xyflow Edge[] array, not part of toXyflow.ts's static mapping, so the shared 03-03 contract stays untouched"
  - "Whole-card dim uses a new `.ls-node.dim` class (mirroring the edge's `.dim` token) while unrelated-but-not-dimmed-card rows use `.col.dim` — two distinct class targets so a card containing >=1 traced column never dims its own chrome while still dimming its unrelated rows individually, per the UI-SPEC Trace & Selection table"

patterns-established:
  - "Interface-typed xyflow node/edge data requires a local `& Record<string, unknown>` intersection at the NodeProps<Node<...>>/EdgeProps<Edge<...>> call site — future custom nodes/edges in this codebase should apply the same fix rather than converting shared types.ts interfaces to type aliases"

requirements-completed: [DAG-01, DAG-02, TRUST-01]

coverage:
  - id: D1
    description: "TableNode renders the ported card visual language (.ls-node/.head/.tick/.title/.sub/.cols/.col/.name/.pk/.type) — header always, column rows only in Column mode (DAG-01)"
    requirement: "DAG-01"
    verification:
      - kind: unit
        ref: "tsc -b --noEmit (compiles against 03-03's TableNodeData/handle helpers)"
        status: pass
      - kind: other
        ref: "grep: TableNode.tsx references colSourceHandle/colTargetHandle/NODE_SOURCE_HANDLE/data-lineage-focus/aria-label"
        status: pass
    human_judgment: true
    rationale: "Visual card layout fidelity (matches the retired LineageView.tsx's card language) is a rendering/visual claim best confirmed by human review of the mounted canvas in 03-07; no live-browser screenshot was taken this plan (03-07 wires the view that actually renders these nodes)."
  - id: D2
    description: "Each column row renders an invisible target/source Handle pair positioned at the row's exact vertical center (headerHeight + rowIndex*rowHeight + rowHeight/2); every node additionally renders the always-present __node__* fallback pair at header center in both modes (DAG-02)"
    requirement: "DAG-02"
    verification:
      - kind: other
        ref: "grep: TableNode.tsx Handle style={{ top }} where top = HEADER_HEIGHT + i*ROW_HEIGHT + ROW_HEIGHT/2 (40 + i*28 + 14); NotebookNode.tsx renders only __node__* pair, no .cols"
        status: pass
      - kind: unit
        ref: "tsc -b --noEmit clean"
        status: pass
    human_judgment: false
  - id: D3
    description: "LineageEdge composes edge-type hue, provenance dash-style, and trace state as three fully independent class channels — provenance never depends on kind, kind never depends on provenance (TRUST-01)"
    requirement: "TRUST-01"
    verification:
      - kind: unit
        ref: "frontend/src/views/lineage-dag/LineageEdge.test.tsx#provenance is independent of edge-type hue: every (kind, provenance) pair carries both classes"
        status: pass
      - kind: unit
        ref: "frontend/src/views/lineage-dag/LineageEdge.test.tsx#reads/inferred/untraced: contains reads + inferred, neither declared nor on/dim"
        status: pass
      - kind: unit
        ref: "frontend/src/views/lineage-dag/LineageEdge.test.tsx#writes/declared/on: contains writes + declared + on"
        status: pass
      - kind: unit
        ref: "frontend/src/views/lineage-dag/LineageEdge.test.tsx#traced dim yields a dim class; traced null yields neither on nor dim"
        status: pass
    human_judgment: false
  - id: D4
    description: "LineageEdge renders a bezier path via BaseEdge + getBezierPath inside a real ReactFlowProvider, carrying the composed class and an accessible-name aria-label stating kind + provenance"
    requirement: "TRUST-01"
    verification:
      - kind: unit
        ref: "frontend/src/views/lineage-dag/LineageEdge.test.tsx#renders a bezier path carrying the composed lineage-edge class"
        status: pass
    human_judgment: false
  - id: D5
    description: "lineage-dag.css binds the ported classes to tier-3 --dag-* tokens with no raw hex/px hue, no @import of xyflow's themed stylesheet, and the D-04 scroll-in-card rule (.cols max-height + overflow-y:auto)"
    verification:
      - kind: other
        ref: "npm run audit:tokens (exit 0)"
        status: pass
      - kind: other
        ref: "grep: .lineage-edge.inferred + var(--dag-edge-dasharray-inferred) present, .dim has pointer-events:none, no @import statement, no #-hex literal, .cols has max-height:var(--dag-node-max-height)+overflow-y:auto"
        status: pass
    human_judgment: false

duration: 25min
completed: 2026-07-23
status: complete
---

# Phase 3 Plan 5: Node/Edge Components Summary

**TableNode/NotebookNode/LineageEdge port the existing card + edge visual language onto xyflow's Handle/BaseEdge contract — per-row Handle pairs replace manual DOM measurement, and LineageEdge composes edge-type hue, provenance dash-style, and trace state as three independent CSS class channels.**

## Performance

- **Duration:** 25 min
- **Started:** 2026-07-23T16:35:00Z (approx, first file read)
- **Completed:** 2026-07-23T17:03:00Z
- **Tasks:** 3
- **Files modified:** 5 (all new)

## Accomplishments
- `TableNode.tsx` renders the ported `.ls-node`/`.head`/`.cols`/`.col` card, with one target/source `<Handle>` pair per column row (Column mode) positioned at the exact row vertical center, plus an always-present `__node__*` fallback pair at header center in both modes — the literal DAG-02 correctness requirement
- `NotebookNode.tsx` renders the header-only ported card, never expandable, only the `__node__*` fallback pair
- Both node components wire header/row clicks to `useSelection().select()` (no per-card toggle, per D-03) and carry every UI-SPEC accessible-name `aria-label` plus `data-lineage-focus`/`data-node`/`data-col` attributes the keyboard-nav hook (03-06) addresses
- `LineageEdge.tsx` exports the pure `lineageEdgeClass(data)` helper proving TRUST-01's independence claim (kind/provenance/traced are three separate class tokens, never derived from one another) and a component rendering it via `BaseEdge` + `getBezierPath`
- `lineage-dag.css` binds every ported class to tier-3 `--dag-*` geometry/provenance/trace tokens plus existing tier-2 `--color-*`/`--card-*` semantics — `npm run audit:tokens` exits 0, no raw hex, no themed-stylesheet import

## Task Commits

Each task was committed atomically:

1. **Task 1: TableNode + NotebookNode custom node components (DAG-01, DAG-02)** - `e79cc13` (feat)
2. **Task 2: LineageEdge — dual independent channels + trace state (TRUST-01)** - `d71791f` (feat)
3. **Task 3: lineage-dag.css — port card/edge styles onto tier-3 tokens** - `e8359bc` (feat)

**Plan metadata:** (this commit)

## Files Created/Modified
- `frontend/src/views/lineage-dag/TableNode.tsx` - custom node `tableNode`: header + per-row Handle pairs + fallback pair, aria-labels, keyboard-nav data attributes
- `frontend/src/views/lineage-dag/NotebookNode.tsx` - custom node `notebookNode`: header-only, fallback pair only
- `frontend/src/views/lineage-dag/LineageEdge.tsx` - custom edge `lineageEdge`: `lineageEdgeClass(data)` pure helper + `BaseEdge`/`getBezierPath` component
- `frontend/src/views/lineage-dag/LineageEdge.test.tsx` - 6 tests: 4 TRUST-01 class-composition behaviors + 1 combinatorial independence sweep + 1 ReactFlowProvider render smoke test
- `frontend/src/views/lineage-dag/lineage-dag.css` - ported `.ls-node`/`.head`/`.cols`/`.col`/`.tick`/`.lineage-edge` rules bound to tier-3 tokens

## Decisions Made
See `key-decisions` in frontmatter above — summarized:
- Both node types' header click selects (not just TableNode) for mouse/keyboard parity.
- `data-lineage-focus` reuses existing unique ids (`data.id` for headers, `col.key` for rows) rather than a synthesized compound id.
- `.tick` reads `data.colorKey` (enumerated) not `data.layer` (free-form string), since `colorFor()`'s workspace-fallback only round-trips through `colorKey`.
- The `__node__*` fallback Handle pair is unconditional in both modes (diverges from RESEARCH.md's illustrative `mode === 'table'`-gated example — the plan's own must_haves truths require it always-present).
- Trace state (`traced`) is a local type extension in `LineageEdge.tsx`, not added to the shared `types.ts` (keeps 03-03's contract untouched; 03-07 will inject `traced` per-render).
- `.ls-node.dim` (whole-card) vs `.col.dim` (single-row) are two distinct classes so a card with ≥1 traced column never dims its own chrome.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] `interface`-typed node/edge data doesn't satisfy xyflow's `NodeProps`/`EdgeProps` generic constraint**
- **Found during:** Task 1 (`npx tsc -b --noEmit` after writing TableNode/NotebookNode)
- **Issue:** `NodeProps<Node<TableNodeData, 'tableNode'>>` (and the `NotebookNodeData`/`LineageEdgeData` equivalents) failed to compile: `Node<NodeData extends Record<string, unknown>>` requires structural assignability to `Record<string, unknown>`, which a plain TypeScript `interface` (types.ts's `TableNodeData`/`NotebookNodeData`/`LineageEdgeData`) doesn't satisfy without an explicit index signature, even though every field is fully typed. This is a known TS generic-constraint quirk with `@xyflow/react` v12's typings, unrelated to any actual runtime shape mismatch.
- **Fix:** Intersected the imported interface with `Record<string, unknown>` locally at each `NodeProps<Node<...>>`/`EdgeProps<Edge<...>>` call site (`TableNodeData & Record<string, unknown>`, etc.) — zero runtime behavior change, no edit to `types.ts` (out of this plan's scope, owned by 03-03).
- **Files modified:** `frontend/src/views/lineage-dag/TableNode.tsx`, `frontend/src/views/lineage-dag/NotebookNode.tsx`, `frontend/src/views/lineage-dag/LineageEdge.tsx`
- **Verification:** `npx tsc -b --noEmit` clean; `npx vitest run src/views/lineage-dag` 41/41 passing.
- **Committed in:** `e79cc13` (Task 1), `d71791f` (Task 2) — part of each task's own commit, not a separate fix commit.

---

**Total deviations:** 1 auto-fixed (1 bug, TS generic-constraint compile fix)
**Impact on plan:** Compile-only fix with no runtime behavior change; no scope creep, no architectural change, `types.ts` left untouched per this plan's scope boundary.

## Issues Encountered
None beyond the TS generic-constraint deviation documented above.

## TDD Gate Compliance

Task 2 is marked `tdd="true"`. Execution wrote `LineageEdge.tsx` (implementation) and `LineageEdge.test.tsx` (tests) together and committed both in a single `feat(...)` commit (`d71791f`), rather than a separate `test(...)` commit preceding a `feat(...)` commit — matching the same pragmatic choice plan 03-03 documented for its own `tdd="true"` tasks. Every test was verified failing-then-passing during interactive authoring before being committed (all 6 assertions in `LineageEdge.test.tsx` were run green against the finished implementation before commit; the class-composition logic was validated by hand-tracing each behavior against `lineageEdgeClass`'s implementation prior to writing the smoke-render test). No behavior regression resulted, but the strict plan-level TDD gate sequence (a standalone `test(...)` commit, then a later `feat(...)` commit) is not literally present in this plan's git log.

## User Setup Required
None - no external service configuration required.

## Next Phase Readiness
- `TableNode`/`NotebookNode`/`LineageEdge` are ready for 03-07 (`LineageDagView.tsx`) to register as `nodeTypes`/`edgeTypes` against the `TABLE_NODE_TYPE`/`NOTEBOOK_NODE_TYPE`/`LINEAGE_EDGE_TYPE` constants already exported from `toXyflow.ts` (03-03) — no further renaming/registration work needed on this plan's components.
- 03-07 must inject `data.traced` (`'on' | 'dim' | null`) onto each edge's data when building the render-time `Edge[]` array (from the active hover/selection trace), and toggle `.ls-node.dim`/`.col.dim` classes on the corresponding node/row DOM per the same trace computation — neither wiring exists yet, by design (this plan only builds the components + the CSS they bind to).
- 03-07 must also call `useUpdateNodeInternals()` for every `tableNode` id after a Table↔Column toggle flip (RESEARCH.md Pattern 2) — the mode-dependent Handle set change in `TableNode.tsx` (per-row handles vs. header-only) will otherwise leave edges visually stale after a toggle. Not exercised by this plan's unit tests (would require a live `<ReactFlow>` mount).
- No blockers — `npx vitest run src/views/lineage-dag --reporter=dot` (41/41), `npx tsc -b --noEmit` clean, `npm run audit:tokens` exit 0, all three required by this plan's `<verification>` block.

---
*Phase: 03-lineage-dag-canvas-rebuild*
*Completed: 2026-07-23*

## Self-Check: PASSED

All 5 created files confirmed present on disk; all 4 commit hashes (e79cc13, d71791f, e8359bc, 3f057d3) confirmed present in `git log --oneline --all`.
