---
phase: 03-lineage-dag-canvas-rebuild
verified: 2026-07-24T00:37:02Z
status: human_needed
score: 10/11 must-haves verified
behavior_unverified: 1
overrides_applied: 0
behavior_unverified_items:
  - truth: "DAG-04 — clicking a column selects it persistently, and that selection survives hovering elsewhere (hover overrides the render transiently without mutating the URL, reverting to the persisted selection when the hover ends)"
    test: "In a mounted LineageDagView: click a column row (calls select() -> ?sel/?col), then hover a different, unrelated column, then end the hover — assert the DOM still shows the ORIGINAL clicked column as 'sel' (not the hovered one, and not cleared) both during and after the hover."
    expected: "The persisted selection (?sel/?col) is unaffected by any hover; hovering a different column transiently overrides the rendered trace only while the pointer stays there, then reverts to showing the original persisted selection — never clearing it."
    why_human: "This is a state-transition/persistence invariant (click freezes → subsequent unrelated hover must not clobber it → un-hover must revert to it, not clear it). The code path is present and structurally sound (`active = hover ?? selectedCol`, click and hover write to two independent state slots, hover never calls select()/clear()), but no test exercises the actual click-then-hover-then-unhover sequence. LineageDagView.test.tsx's only hover test starts from an unselected state; 03-07-SUMMARY.md self-flags this exact gap (coverage id D4, human_judgment: true, verification: [])."
---

# Phase 3: Lineage DAG Canvas Rebuild Verification Report

**Phase Goal:** Rebuild the column-level lineage view on `@xyflow/react` + dagre with correct column-row edge anchoring, hover-to-trace, persistent selection, an inspector that explains transforms and inferred-edge evidence, and full keyboard/assistive-technology reachability — establishing the provenance treatment the Purview-push phase depends on.
**Verified:** 2026-07-24T00:37:02Z
**Status:** human_needed
**Re-verification:** No — initial verification

## Investigation of Known Concerns

1. **03-02 marked DAG-01/TRUST-01 "complete" prematurely?** Confirmed the concern is real at the plan-attribution level (03-02's `requirements-completed: [DAG-01, TRUST-01]` frontmatter is misleading — 03-02 only installed `@xyflow/react`/`@dagrejs/dagre` and declared tokens) but the **phase end-state is genuinely satisfied**: real `dagre.layout()` LR layout with center→top-left conversion and per-mode node geometry lives in `frontend/src/views/lineage-dag/useDagreLayout.ts` (03-03), and the independent provenance/hue/trace channel composition lives in `frontend/src/views/lineage-dag/LineageEdge.tsx`'s `lineageEdgeClass()` (03-05), both unit-tested and read directly. REQUIREMENTS.md's "Phase 3 / Complete" designation for DAG-01/TRUST-01 is accurate as of the final commit, even though the per-plan attribution in 03-02 was premature.
2. **03-05 deferred `data.traced` injection + `.ls-node.dim`/`.col.dim` toggling and `useUpdateNodeInternals()` on toggle to 03-07?** Confirmed both landed in `frontend/src/views/LineageDagView.tsx`: the `edges` memo injects `data.traced: 'on'|'dim'|null` onto every edge (lines 137-147), the `nodes` memo injects `traced`/`active`/`onHoverColumn`/`dim` onto node data (lines 119-135) which `TableNode.tsx`/`NotebookNode.tsx` consume to render `.ls-node.dim`/`.col.dim`/`.col.hot`/`.col.sel`, and a `useEffect` calls `updateNodeInternals(t.id)` for every table on every `mode` change (lines 154-156) — directly test-covered by `LineageDagView.test.tsx`'s hover-trace and toggle tests.
3. **`LineageView.tsx` deleted and no stale imports?** Confirmed: `frontend/src/views/LineageView.tsx` does not exist on disk, and `grep -rn "LineageView" frontend/src` returns zero matches anywhere in the source tree.

## Goal Achievement

### Observable Truths

| # | Truth | Status | Evidence |
|---|-------|--------|----------|
| 1 | DAG-01: Column-level lineage renders LR with expandable table cards + column rows | ✓ VERIFIED | `useDagreLayout.ts` runs real `dagre.layout()` with `rankdir:'LR'`, config on `setGraph()` (not a `layout()` arg); `TableNode.tsx` renders `.ls-node/.head/.cols/.col` per UI-SPEC; `useDagreLayout.test.ts`/`toXyflowEdges.test.ts` pass (14/14); no `reactflow` package remains (`package.json` has `@xyflow/react@12.11.2` + `@dagrejs/dagre@3.0.0` exact-pinned, `node_modules/reactflow` absent, no `from 'reactflow'` import in src) |
| 2 | DAG-02: Column-to-column edges connect to exact column rows, not node boundaries | ✓ VERIFIED | `TableNode.tsx` renders a target/source `<Handle>` pair per column row at `top: HEADER_HEIGHT + i*ROW_HEIGHT + ROW_HEIGHT/2`; `toXyflow.ts` resolves `sourceHandle`/`targetHandle` to `colSourceHandle(fromKey)`/`colTargetHandle(toKey)` in Column mode and the `__node__*` fallback pair in Table mode / for object-level ops edges; `toXyflowEdges.test.ts` asserts both modes |
| 3 | DAG-03: Hovering a column traces upstream/downstream, dims unrelated | ✓ VERIFIED | `LineageDagView.test.tsx`'s `fireEvent.mouseEnter(rawRow)` behavioral test asserts real DOM class changes: hovered row gets `sel`, traced peer gets `hot`, unrelated notebook card gets `dim`; `fireEvent.mouseLeave` reverts. `trace.ts` (ported, cycle-safe BFS/DFS) independently unit-tested (`trace.test.ts`, 3/3) |
| 4 | DAG-04: Clicking a column selects it persistently; selection survives hovering elsewhere | ⚠️ PRESENT_BEHAVIOR_UNVERIFIED | Code is present and structurally sound (`active = hover ?? selectedCol`; click calls `select()`, a single write path per D-07; hover is separate local `useState`, never calls `select()`/`clear()`) but no automated test exercises the click-then-hover-elsewhere-then-unhover sequence. 03-07-SUMMARY.md self-flags this exact gap (coverage id D4, `human_judgment: true`, `verification: []`). See Human Verification below. |
| 5 | DAG-05: Inspector shows a selected column's transform expression, plain-English explanation, inputs/outputs | ✓ VERIFIED | `Inspector.tsx`'s `ColumnCard` renders `.xform code`/`.xform p` (transform + synthesis), Source→Target `.flow-item` rows, Connections line; `Inspector.test.tsx` covers full render, pass-through code-block omission, missing-evidence omission (3 new cases, all passing in the 107/107 full suite) |
| 6 | DAG-06: View toggles between table-level and column-level detail | ✓ VERIFIED | `LineageDagView.tsx` renders a `Table`/`Column` segmented toggle (default Column); `nodeHeight(mode, columnCount)` implements 40px table / `40+min(cols,10)*28` column (capped 320, zero-column collapse); `useDagreLayout.test.ts` covers all geometry cases |
| 7 | DAG-07: Layout is deterministic — same graph produces same positions | ✓ VERIFIED | `buildDagreLayout` is a pure function of `(tables, notebooks, ops, mode)` with no random seed/warm-start; `useDagreLayout.test.ts`'s determinism case does a structural deepEqual of two calls; `nodesDraggable={false}` on `<ReactFlow>` prevents a user from perturbing the deterministic layout |
| 8 | DAG-08: Every node/edge reachable by mouse is reachable/operable via keyboard, with AT semantic labelling | ✓ VERIFIED | `useLineageKeyboardNav.ts`'s `resolveNextFocus` (pure resolver) and DOM-facing hook are both behaviorally tested (`useLineageKeyboardNav.test.ts`, 17 tests incl. 4 jsdom real-focus-movement cases); `<ReactFlow>` sets `nodesFocusable={false}`/`edgesFocusable={false}`/`disableKeyboardA11y`/`nodesDraggable={false}` (xyflow's default keyboard model fully replaced, not extended); `role="group"` canvas wrapper + accessible-name template + `aria-label` on every header/row/edge + `sr-only` edge summary list, all test-covered. A live screen-reader/browser walk remains a self-flagged manual, non-blocking item — see Human Verification |
| 9 | TRUST-01: Edges visually differentiated by provenance (declared vs inferred), independent of edge-type hue | ✓ VERIFIED | `LineageEdge.tsx`'s `lineageEdgeClass()` composes `kind`/`provenance`/`traced` as three independent class tokens; `LineageEdge.test.tsx` proves independence for every `(kind, provenance)` pair (6 tests); `lineage-dag.css` binds `.inferred`/`.declared` to `--dag-edge-dasharray-inferred`/`-declared` tokens, `audit:tokens` green, no raw hex |
| 10 | TRUST-02: Inspector explains why an inferred edge exists, showing parsed evidence | ✓ VERIFIED | `ColumnMapEvidence` threaded backend→frontend (`models.py`→`api.ts`→`adapt.ts`→`AppModel.evidence`); `Inspector.tsx`'s Evidence section renders notebook/cell/line + verbatim snippet + locked "Inferred from static pattern-matching — not executed." caption, omitted entirely when absent; backend `test_column_map_carries_evidence`/`test_evidence_is_optional_for_backward_compat` pass; grep confirms no live `dangerouslySetInnerHTML` usage (JSX text-node rendering only) |
| 11 | TRUST-03: UI shows when lineage data was last refreshed | ✓ VERIFIED | `FreshnessIndicator.tsx` renders `Intl.RelativeTimeFormat` output + absolute-ISO `title` when `source==='live'` and `fetchedAt` set, else the honest `'Showing bundled sample data'` copy (never a fabricated time); wired into `LineageDagView`'s toolbar from the new root-loader `fetchedAt`; `FreshnessIndicator.test.tsx` (4/4) and `LineageDagView.test.tsx`'s toolbar test pass |

**Score:** 10/11 truths verified (1 present, behavior-unverified — DAG-04)

### Required Artifacts

| Artifact | Expected | Status | Details |
|----------|----------|--------|---------|
| `backend/app/models.py` | `ColumnMapEvidence` + optional `ColumnMap.evidence` | ✓ VERIFIED | Present, additive, backward-compatible; 97/97 backend tests pass |
| `backend/app/parser.py` | Threads notebook/cell_index/line/snippet evidence | ✓ VERIFIED | `_column_maps(cell, notebook, cell_index)`; per-cell shared evidence |
| `frontend/src/api.ts` | Mirrored `ColumnMapEvidence` interface | ✓ VERIFIED | `evidence?: ColumnMapEvidence \| null` present |
| `frontend/package.json` | `@xyflow/react@12.11.2` + `@dagrejs/dagre@3.0.0`, no `reactflow` | ✓ VERIFIED | Exact pins confirmed; `node_modules/reactflow` absent |
| `frontend/src/test/setup.ts` | ResizeObserver/DOMMatrixReadOnly/getBBox jsdom polyfills | ✓ VERIFIED | Present (getBBox on `SVGGraphicsElement.prototype`, documented deviation) |
| `frontend/src/styles/components.css` | tier-3 `--dag-*`/`--lineage-toolbar-*` tokens | ✓ VERIFIED | `audit:tokens` green, no raw hex |
| `frontend/src/views/lineage-dag/types.ts` | Shared node/edge data types + handle-id helpers | ✓ VERIFIED | Present, consumed by TableNode/NotebookNode/toXyflow |
| `frontend/src/views/lineage-dag/trace.ts` | Ported cycle-safe `trace()` | ✓ VERIFIED | 3/3 tests pass |
| `frontend/src/views/lineage-dag/useDagreLayout.ts` | Deterministic real-dagre LR layout | ✓ VERIFIED | 6/6 tests pass (LR order, node count, per-mode geometry x3, determinism) |
| `frontend/src/views/lineage-dag/toXyflow.ts` | Node[]/Edge[] builder, per-mode handle resolution | ✓ VERIFIED | 5/5 tests pass |
| `frontend/src/views/lineage-dag/TableNode.tsx` | Ported card + per-row Handles + fallback pair | ✓ VERIFIED | Handles, aria-labels, `data-lineage-focus`, dim/hot/sel wiring all present |
| `frontend/src/views/lineage-dag/NotebookNode.tsx` | Header-only card, fallback pair only | ✓ VERIFIED | No per-row handles, `.ls-node.dim` wiring present |
| `frontend/src/views/lineage-dag/LineageEdge.tsx` | Dual independent channels + trace state | ✓ VERIFIED | 6/6 tests pass |
| `frontend/src/views/lineage-dag/lineage-dag.css` | Ported styles on tier-3 tokens | ✓ VERIFIED | No themed-sheet import, no raw hex, `audit:tokens` green |
| `frontend/src/views/lineage-dag/useLineageKeyboardNav.ts` | Roving-tabindex + path-walk resolver | ✓ VERIFIED | 17/17 tests pass |
| `frontend/src/views/lineage-dag/FreshnessIndicator.tsx` | Live vs sample honesty component | ✓ VERIFIED | 4/4 tests pass |
| `frontend/src/model/adapt.ts` / `index.tsx` | `AppModel.evidence` map threaded | ✓ VERIFIED | Additive, `sampleModel()` defaults to `{}` |
| `frontend/src/shell/Inspector.tsx` | `ColumnCard` with 5 ordered sections | ✓ VERIFIED | Provenance line, Transform, Source→Target, Evidence, Connections all present in source order |
| `frontend/src/views/LineageDagView.tsx` | Assembled `<ReactFlow>` canvas | ✓ VERIFIED | Composes all prior artifacts; 5/5 smoke tests pass |
| `frontend/src/routes/__root.tsx` | `RouterContext.fetchedAt` | ✓ VERIFIED | Threaded, in-memory only, `rootPending.test.tsx` still green |
| `frontend/src/routes/lineage/$workspace.$lakehouse.$table.tsx` | Renders `LineageDagView` | ✓ VERIFIED | Route swapped |
| `frontend/src/views/LineageView.tsx` (deleted) | Legacy view removed | ✓ VERIFIED | File absent; zero references anywhere in `frontend/src` |

### Key Link Verification

| From | To | Via | Status | Details |
|------|-----|-----|--------|---------|
| `parser._column_maps()` | `ColumnMap.evidence` → `api.ts` → `adapt.ts` → Inspector | Backend evidence thread | ✓ WIRED | Confirmed end-to-end; backend + frontend tests green |
| `types.ts` handle-id helpers | `TableNode`/`NotebookNode` `<Handle>` ids | Handle-id convention | ✓ WIRED | `colSourceHandle`/`colTargetHandle`/`NODE_SOURCE_HANDLE`/`NODE_TARGET_HANDLE` imported and used identically on both the layout (toXyflow) and render (TableNode) sides |
| `useDagreLayout` + `toXyflow` | `LineageDagView` nodes/edges | Compose in view | ✓ WIRED | `useMemo`-composed, positions/mode dependencies correct |
| `LineageDagView` trace state | `TableNode`/`NotebookNode`/`LineageEdge` dim/hot/sel classes | `data.traced`/`active`/`onHoverColumn`/`dim` injection | ✓ WIRED | Confirmed both in source and via behavioral hover test |
| toggle mode change | `useUpdateNodeInternals(id)` per table | `useEffect` keyed on `mode` | ✓ WIRED | Behavioral test confirms `updateNodeInternalsSpy` called with each table id on toggle |
| root loader `fetchedAt` | `FreshnessIndicator` | `RootRoute.useLoaderData()` | ✓ WIRED | Confirmed in source and toolbar test |
| lineage route | `LineageDagView` | Route element | ✓ WIRED | `LineageView` import fully removed, route renders new view |

### Requirements Coverage

| Requirement | Source Plan | Status | Evidence |
|-------------|-------------|--------|----------|
| DAG-01 | 03-02 (foundation), 03-03 (real behavior), 03-05 (render) | ✓ SATISFIED | See Truth 1 |
| DAG-02 | 03-03, 03-05 | ✓ SATISFIED | See Truth 2 |
| DAG-03 | 03-03 (trace algo), 03-07 (wiring) | ✓ SATISFIED | See Truth 3 |
| DAG-04 | 03-07 | ? NEEDS HUMAN | See Truth 4 — code present, behavior unexercised by a test |
| DAG-05 | 03-04 | ✓ SATISFIED | See Truth 5 |
| DAG-06 | 03-03 (geometry), 03-07 (toggle + re-measure) | ✓ SATISFIED | See Truth 6 |
| DAG-07 | 03-03 | ✓ SATISFIED | See Truth 7 |
| DAG-08 | 03-06 (resolver/hook), 03-07 (wiring) | ✓ SATISFIED | See Truth 8 (live AT walk flagged as human item, non-blocking) |
| TRUST-01 | 03-02 (tokens), 03-05 (channel composition) | ✓ SATISFIED | See Truth 9 |
| TRUST-02 | 03-01 (backend evidence), 03-04 (render) | ✓ SATISFIED | See Truth 10 |
| TRUST-03 | 03-06 (component), 03-07 (wiring) | ✓ SATISFIED | See Truth 11 |

No orphaned requirements — REQUIREMENTS.md maps exactly these 11 IDs to Phase 3, and all 11 appear in at least one plan's `requirements:` frontmatter.

### Anti-Patterns Found

None. Scanned all phase-3 source files (`frontend/src/views/lineage-dag/*`, `LineageDagView.tsx`, `shell/Inspector.tsx`, `model/adapt.ts`, `model/index.tsx`) for `TBD`/`FIXME`/`XXX`/`TODO`/`HACK`/`PLACEHOLDER`/"coming soon"/"not yet implemented" — zero matches. The one `dangerouslySetInnerHTML` grep hit in `Inspector.tsx` is a comment documenting its absence, not usage.

### Behavioral Spot-Checks / Automated Verification

| Check | Command | Result | Status |
|-------|---------|--------|--------|
| Frontend full suite | `npm run test:run` (frontend) | 107/107 passed, 19 files | ✓ PASS |
| Backend full suite | `pytest` (backend) | 97/97 passed | ✓ PASS |
| TypeScript compile | `npx tsc -b --noEmit` | Clean | ✓ PASS |
| Token audit | `npm run audit:tokens` | All checks passed | ✓ PASS |
| Production build | `npm run build` | Succeeds | ✓ PASS |
| `reactflow` package removal | `grep -rn "from 'reactflow'" frontend/src` + `node_modules` check | No matches; package absent | ✓ PASS |
| `LineageView.tsx` removal | file existence + `grep -rn "LineageView" frontend/src` | Deleted; zero references | ✓ PASS |
| xyflow keyboard/drag model replaced | grep `nodesFocusable\|edgesFocusable\|disableKeyboardA11y\|nodesDraggable` in `LineageDagView.tsx` | All four present | ✓ PASS |
| Git commit integrity (spot check) | `git log --oneline --all \| grep <hashes>` | All 6 spot-checked commits (03-05/03-07) present | ✓ PASS |

## Human Verification Required

### 1. Selection persistence survives hover (DAG-04)

**Test:** In the running app, click a column to select it (Inspector opens for that column). Then hover a different, unrelated column elsewhere on the canvas. While hovering, observe the trace. Then move the mouse away (end the hover).
**Expected:** The clicked column's Inspector stays open and its `sel` state is not lost. While hovering elsewhere, the render transiently shows the hovered column's trace (not the URL), but the moment the hover ends, the canvas reverts to showing the originally-clicked, persisted selection — it must never silently clear to "nothing selected."
**Why human:** This is a click→hover→unhover state-transition sequence that no automated test currently exercises (self-flagged gap in 03-07-SUMMARY.md, coverage id D4). The code is structurally sound (hover and selection are separate state, hover never calls `select()`/`clear()`) but the actual multi-step behavior is unverified.

### 2. Full keyboard/assistive-technology walk (DAG-08)

**Test:** Tab into the lineage canvas. Use arrow keys to walk cards/columns (↓/↑ within a card and across cards in the same rank, →/← across ranks on a header and path-walking a connected column). Use Home/End. Press Enter/Space on a focused column to select it. Run with a screen reader active.
**Expected:** Focus-visible rings appear on every focused header/row; the screen reader announces each element's accessible name (including provenance and type); Tab never gets trapped inside the canvas (it's a single Tab stop); dimmed (traced-out) rows remain keyboard-focusable even though they're mouse-non-interactive.
**Why human:** The resolver and DOM focus-movement logic are thoroughly unit-tested (17 tests, including jsdom real-focus-movement cases), but real screen-reader announcement behavior and visual focus-ring rendering cannot be verified by jsdom. This is the plan's own self-flagged, non-blocking manual phase-gate item (03-06/03-07 SUMMARYs).

### 3. Provenance distinguishability under color-vision deficiency simulation (TRUST-01)

**Test:** With a deuteranopia/protanopia simulator active (or light mode), compare a declared (solid) vs inferred (dashed) edge of the same edge-type hue (e.g., two `reads` edges, one hypothetically declared, one inferred).
**Expected:** The dash-pattern remains distinguishable regardless of simulated color vision, since provenance is carried on a shape channel (dasharray), never on hue alone.
**Why human:** This is a visual-perception check; `lineageEdgeClass()`'s channel-independence is code-proven, but the perceptual outcome (does the dash pattern actually read at typical stroke widths/zoom levels) requires a human eye. Self-flagged, non-blocking phase-gate item in 03-05/03-07 SUMMARYs. Note: only the `inferred`/dashed style has a live data path this phase (D-09) — the `declared`/solid style is built and test-exercised but has no real data to display until Phase 5.

### 4. Evidence block renders safely in the running app (TRUST-02)

**Test:** Select an inferred column with evidence in the running app. Confirm the Evidence section shows the matched SELECT snippet and the locked "not executed" caption. If feasible, construct a fixture notebook cell containing a `<script>`-like string in a column expression and confirm it renders as inert, visible text (not executed, not stripped).
**Expected:** Evidence renders correctly; any HTML-like content in the snippet is inert escaped text, never executed or interpreted.
**Why human:** Largely already covered by automated tests (`Inspector.test.tsx`'s Evidence cases, plus the `dangerouslySetInnerHTML` absence grep), but this is the plan's own explicit, non-blocking manual phase-gate confirmation in a real browser with a crafted adversarial fixture.

## Gaps Summary

No blocking gaps. All 11 phase-3 requirement IDs (DAG-01 through DAG-08, TRUST-01 through TRUST-03) have working, tested code behind them, and both investigated known-concerns (premature DAG-01/TRUST-01 attribution in 03-02; the 03-05→03-07 deferred trace-wiring/useUpdateNodeInternals handoff) resolved cleanly in the final code. `LineageView.tsx` is fully retired with no stale references. The frontend (107/107) and backend (97/97) test suites, `tsc`, `audit:tokens`, and `npm run build` are all green.

The phase is held at `human_needed` rather than `passed` because one truth (DAG-04's click-persists-through-hover invariant) is present and architecturally sound but not exercised by any automated test — the plan's own SUMMARY.md self-flagged this gap rather than silently claiming coverage. The remaining three human-verification items are visual/AT checks the plan's own `<verification>` blocks already scoped as manual, non-blocking phase-gate confirmations, not newly discovered problems.

---

*Verified: 2026-07-24T00:37:02Z*
*Verifier: Claude (gsd-verifier)*
