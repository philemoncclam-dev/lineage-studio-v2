---
phase: 03-lineage-dag-canvas-rebuild
plan: 04
subsystem: ui
tags: [react, typescript, inspector, evidence, xss-safety]

# Dependency graph
requires:
  - phase: 03-lineage-dag-canvas-rebuild (plan 01)
    provides: backend ColumnMapEvidence (notebook, cell_index, line, snippet), threaded through parser.py and mirrored in api.ts
provides:
  - AppModel.evidence map threading backend ColumnMapEvidence into the frontend model
  - Inspector ColumnCard rendering Transform/Source→Target/Evidence/Connections for a selected column
  - Component-test coverage proving the missing-field-omit rules (pass-through omits code block, missing evidence omits the section)
affects: [03-05, 03-06, 03-07]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "resolveSelected() column branch resolves the owning table via `sel` then the column via `col`, mirroring the existing table/notebook dispatch"
    - "Pass-through detection reads adapt.ts's own synthesized sentence prefix ('Passed through' vs 'Computed as') instead of re-deriving transform-null logic in the Inspector"

key-files:
  created: []
  modified:
    - frontend/src/model/adapt.ts
    - frontend/src/model/index.tsx
    - frontend/src/shell/Inspector.tsx
    - frontend/src/shell/__tests__/Inspector.test.tsx
    - frontend/src/shell/__tests__/CommandPalette.test.tsx
    - frontend/src/shell/__tests__/search.test.ts

key-decisions:
  - "Connections counts (Upstream N · Downstream N) use direct model.colEdges neighbours, not a full transitive trace() walk, per the plan's literal Task 2 instruction"
  - "Provenance line and Evidence header/caption use inline style with CSS custom properties (no new components.css selectors), since this plan's files_modified scope excludes the stylesheet"

patterns-established:
  - "Missing-field-omits-its-row extended to column-level sections: Transform section omitted when no xform entry exists at all; code block specifically omitted for pass-through; Evidence section omitted when model.evidence has no entry for the column"

requirements-completed: [DAG-05, TRUST-02]

coverage:
  - id: D1
    description: "AppModel.evidence map threaded from backend ColumnMap.evidence through adapt.ts, additive and backward-compatible (sampleModel defaults to {})"
    requirement: "TRUST-02"
    verification:
      - kind: unit
        ref: "frontend/src/model/__tests__/adapt.test.ts (existing suite, unaffected by the additive field) + tsc -b --noEmit"
        status: pass
    human_judgment: false
  - id: D2
    description: "ColumnCard renders provenance line, Transform (code block + synthesized sentence), Source→Target flow rows, Evidence (notebook/cell/line + verbatim snippet + locked caption), and Connections for a column with evidence"
    requirement: "DAG-05"
    verification:
      - kind: unit
        ref: "frontend/src/shell/__tests__/Inspector.test.tsx#Inspector ColumnCard (DAG-05, TRUST-02) > renders Transform code + sentence, Source→Target, Evidence snippet + locked caption, and Upstream/Downstream counts for a column with evidence"
        status: pass
    human_judgment: false
  - id: D3
    description: "Pass-through column (null transform) omits the .xform code block, rendering only the plain-English sentence"
    requirement: "DAG-05"
    verification:
      - kind: unit
        ref: "frontend/src/shell/__tests__/Inspector.test.tsx#Inspector ColumnCard (DAG-05, TRUST-02) > omits the .xform code block for a pass-through column, rendering only the plain-English sentence"
        status: pass
    human_judgment: false
  - id: D4
    description: "Column with no model.evidence entry omits the Evidence section entirely (never a rendered-blank block)"
    requirement: "TRUST-02"
    verification:
      - kind: unit
        ref: "frontend/src/shell/__tests__/Inspector.test.tsx#Inspector ColumnCard (DAG-05, TRUST-02) > omits the Evidence section entirely for a column with no model.evidence entry (missing-evidence fallback)"
        status: pass
    human_judgment: false
  - id: D5
    description: "No raw-HTML injection path in Inspector.tsx (T-03-07 XSS mitigation) — all evidence/snippet/name text renders as JSX text nodes"
    requirement: "TRUST-02"
    verification:
      - kind: other
        ref: "grep -v \"^\\s*//\" frontend/src/shell/Inspector.tsx | grep -c dangerouslySetInnerHTML  (returns 0)"
        status: pass
    human_judgment: false

duration: 25min
completed: 2026-07-23
status: complete
---

# Phase 3 Plan 4: Inspector Evidence & ColumnCard Summary

**Threaded backend column-map evidence into the frontend model and built the Inspector's column-detail view — Transform, Source→Target, Evidence (verbatim snippet + locked "not executed" caption), and Connections — filling DAG-05 and TRUST-02.**

## Performance

- **Duration:** ~25 min
- **Started:** 2026-07-23T23:35:00Z
- **Completed:** 2026-07-23T23:43:00Z
- **Tasks:** 3 completed
- **Files modified:** 6 (3 plan-scoped source/test files + 3 pre-existing test fixtures backfilled for the additive `evidence` field)

## Accomplishments
- `AppModel.evidence: Record<string, ColumnMapEvidence>` threaded through `adapt.ts`'s existing write-edge column loop, alongside (not replacing) the `xform` map — the plain-English synthesis strings are byte-identical to before
- `Inspector.tsx` gained a `ResolvedColumn` branch and a `ColumnCard` component rendering, in UI-SPEC order: provenance line (dashed swatch + "Inferred"), Transform (`.xform` family, reused verbatim), Source → Target (`.flow`/`.flow-item`, reused verbatim, each row clickable via `select()`), Evidence (new — notebook/cell/line header, verbatim snippet in the same mono code treatment, the locked caption), Connections ("Upstream N · Downstream N")
- Three component tests cover the DAG-05/TRUST-02 test map: full evidence render, pass-through code-block omission, missing-evidence section omission
- Verified the XSS mitigation gate (T-03-07): a comment-stripped grep for `dangerouslySetInnerHTML` in `Inspector.tsx` returns 0 — every rendered value is a plain JSX text node

## Task Commits

Each task was committed atomically:

1. **Task 1: Thread evidence into adapt.ts + AppModel** - `cb0ef84` (feat)
2. **Task 2: Inspector ColumnCard (RED)** - `c36eab6` (test)
2. **Task 2: Inspector ColumnCard (GREEN)** - `a55cc2c` (feat)
3. **Task 3: Inspector.test.tsx — missing-evidence coverage** - `6ec6133` (test)

**Plan metadata:** (this commit)

_TDD tasks (2 and 3) each followed RED → GREEN; Task 3's single new test built on Task 2's already-shipped implementation, so no further production-code change was needed to turn it green._

## Files Created/Modified
- `frontend/src/model/adapt.ts` - builds the `evidence` map alongside `xform` inside the write-edge column loop; returns it as part of `AppModel`
- `frontend/src/model/index.tsx` - `AppModel.evidence` field (imported `ColumnMapEvidence` from `../api`); `sampleModel()` defaults it to `{}`
- `frontend/src/shell/Inspector.tsx` - `ResolvedColumn` branch in `resolveSelected()`; new `ColumnCard` + `DirArrow` components
- `frontend/src/shell/__tests__/Inspector.test.tsx` - ColumnCard fixtures (`rawTable`/`cleanTable`/`columnModel()`) and three new test cases
- `frontend/src/shell/__tests__/CommandPalette.test.tsx`, `frontend/src/shell/__tests__/search.test.ts` - backfilled `evidence: {}` in existing `AppModel` test fixtures (Rule 3 fix, see below)

## Decisions Made
- Connections counts read direct `model.colEdges` neighbours (not a full transitive `trace()` walk) — matches the plan's Task 2 action text literally; `trace.ts` (03-03's module) stays untouched, out of this plan's scope
- Provenance-line and Evidence header/caption styling uses inline `style` objects referencing existing CSS custom properties (`var(--text-micro)`, `var(--color-text-secondary)`, etc.) rather than new `components.css` selectors, since this plan's `files_modified` list excludes the stylesheet — token discipline preserved without a CSS-file change
- Pass-through detection reads adapt.ts's own synthesized sentence prefix (`'Passed through'` vs `'Computed as'`) rather than re-deriving "is this a real transform" logic in the Inspector, per the plan's explicit instruction and D-13 (synthesis never moves/duplicates)

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] Backfilled `evidence: {}` in three pre-existing `AppModel` test fixtures**
- **Found during:** Task 1 (`tsc -b --noEmit` verification)
- **Issue:** `AppModel.evidence` is a new required field; `CommandPalette.test.tsx`, `search.test.ts`, and the pre-existing `Inspector.test.tsx` (shipped in an earlier phase, not previously known to this plan) each construct a literal `AppModel` object without it, breaking the type check
- **Fix:** Added `evidence: {}` to each fixture's `baseModel()`/`columnModel()`-equivalent function
- **Files modified:** `frontend/src/shell/__tests__/CommandPalette.test.tsx`, `frontend/src/shell/__tests__/search.test.ts`, `frontend/src/shell/__tests__/Inspector.test.tsx`
- **Verification:** `npx tsc -b --noEmit` clean; full `npm run test:run` green (75/75)
- **Committed in:** `cb0ef84` (Task 1 commit)

**2. [Rule 1 - Bug] Ambiguous test query fixed**
- **Found during:** Task 2 GREEN verification
- **Issue:** The new ColumnCard test asserted `screen.getByText('customer_name')`, but that string also matches the Source→Target flow-item's `.fcol` span, causing a "multiple elements found" failure
- **Fix:** Scoped the assertion to `screen.getByRole('heading', { name: 'customer_name' })`, matching only the Inspector's `<h2>` title
- **Files modified:** `frontend/src/shell/__tests__/Inspector.test.tsx`
- **Verification:** Test passes deterministically
- **Committed in:** `a55cc2c` (Task 2 commit)

---

**Total deviations:** 2 auto-fixed (1 blocking type-check fix, 1 test-query bug fix)
**Impact on plan:** Both fixes were necessary to keep the codebase compiling/green after the additive `AppModel.evidence` field; no scope creep — no production behavior changed beyond what the plan specified.

## Issues Encountered
- A pre-existing `Inspector.test.tsx` already existed in the repo (shipped in an earlier phase, not called out in this plan's `prior_work` context) covering table/notebook selection. Extended it in place per Task 3's own instruction ("existing file if present — extend it") rather than treating it as new.

## User Setup Required
None - no external service configuration required.

## Next Phase Readiness
- The Inspector's column-detail surface (DAG-05, TRUST-02) is fully wired against the `AppModel` shape; 03-05 (the xyflow canvas itself) can now rely on `select(tableId, colKey)` producing a populated Inspector for any column with an `xform`/`evidence` entry
- No blockers. `model.evidence` currently only ever populates from `adapt()` (live/parsed data) — `sampleModel()`'s bundled demo data has no evidence entries, so the bundled sample always exercises the missing-evidence fallback path, which is itself now test-covered

---
*Phase: 03-lineage-dag-canvas-rebuild*
*Completed: 2026-07-23*

## Self-Check: PASSED

All claimed commits (`cb0ef84`, `c36eab6`, `a55cc2c`, `6ec6133`) verified present in `git log`. All claimed created/modified files (`adapt.ts`, `index.tsx`, `Inspector.tsx`, `Inspector.test.tsx`) verified present on disk.
