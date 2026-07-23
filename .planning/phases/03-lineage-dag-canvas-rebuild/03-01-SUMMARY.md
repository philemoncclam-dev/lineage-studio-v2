---
phase: 03-lineage-dag-canvas-rebuild
plan: 01
subsystem: api
tags: [pydantic, fastapi, typescript, lineage-model]

# Dependency graph
requires: []
provides:
  - "ColumnMapEvidence Pydantic model on backend/app/models.py, optional field on ColumnMap"
  - "Mirrored ColumnMapEvidence TypeScript interface + optional field on frontend/src/api.ts's ColumnMap"
  - "parser.py threads notebook/cell_index/line/snippet evidence through _column_maps()/parse_notebook()"
  - "pytest coverage proving evidence population, per-cell sharing, and backward compatibility"
affects: [03-04, 03-07]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Additive-optional backend contract field: X | None = None on both Pydantic and TS sides, no required-field additions to LineageGraph/Edge"
    - "Per-cell/per-SELECT evidence granularity: one ColumnMapEvidence instance shared across every ColumnMap from the same SELECT match"

key-files:
  created: []
  modified:
    - backend/app/models.py
    - backend/app/parser.py
    - backend/tests/test_parser.py
    - frontend/src/api.ts

key-decisions:
  - "Merged the plan's optional third 'shared-evidence' assertion into test_column_map_carries_evidence rather than a separate test function, so `pytest -k evidence` collects exactly the two named tests the plan's acceptance criteria specify"

patterns-established:
  - "Additive, optional backend field: any new field on a shared contract type (ColumnMap, and future contract extensions) is `X | None = None` (Python) / `X | undefined`-style optional (TypeScript) — never required, per CLAUDE.md's LineageGraph stability rule"

requirements-completed: [TRUST-02]

coverage:
  - id: D1
    description: "ColumnMapEvidence model added to backend/app/models.py (notebook, cell_index, line, snippet), ColumnMap.evidence optional field, no other contract type touched"
    requirement: "TRUST-02"
    verification:
      - kind: unit
        ref: "backend/app/models.py — inline construction check (ColumnMap().evidence is None; ColumnMap(evidence=...).evidence.line == 1)"
        status: pass
      - kind: other
        ref: "git show f0f2b0f -- backend/app/models.py (diff scoped to new class + one field)"
        status: pass
    human_judgment: false
  - id: D2
    description: "frontend/src/api.ts mirrors ColumnMapEvidence interface + optional evidence field on ColumnMap"
    requirement: "TRUST-02"
    verification:
      - kind: other
        ref: "npx tsc -b --noEmit (frontend) — clean, no type errors"
        status: pass
    human_judgment: false
  - id: D3
    description: "parser._column_maps()/parse_notebook() thread notebook/cell_index/line/snippet evidence, per-cell/per-SELECT granularity"
    requirement: "TRUST-02"
    verification:
      - kind: unit
        ref: "backend/tests/test_parser.py#test_column_map_carries_evidence"
        status: pass
      - kind: unit
        ref: "backend/tests/test_parser.py (existing 4 pre-existing cases, unaffected)"
        status: pass
    human_judgment: false
  - id: D4
    description: "Backward compatibility: no-SELECT notebooks yield evidence=None; evidence-less payloads round-trip through LineageGraph.model_validate()"
    requirement: "TRUST-02"
    verification:
      - kind: unit
        ref: "backend/tests/test_parser.py#test_evidence_is_optional_for_backward_compat"
        status: pass
    human_judgment: false

duration: 12min
completed: 2026-07-23
status: complete
---

# Phase 3 Plan 1: Backend Evidence Threading (D-12) Summary

**Optional `ColumnMapEvidence` (notebook/cell_index/line/snippet) threaded from parser regex match through `ColumnMap` to the frontend `api.ts` contract, backward-compatible and additive.**

## Performance

- **Duration:** 12 min
- **Started:** 2026-07-23T23:18:40Z
- **Completed:** 2026-07-23T23:21:43Z
- **Tasks:** 3
- **Files modified:** 4

## Accomplishments
- Added `ColumnMapEvidence` Pydantic model and an optional `ColumnMap.evidence` field, plus the mirrored TypeScript interface in `api.ts` — zero changes to `Edge`/`LineageGraph`/`Node`, no provenance enum (D-10 respected)
- Threaded `notebook`/`cell_index`/`line`/`snippet` through `parser._column_maps()` and `parse_notebook()`, sharing one `ColumnMapEvidence` instance across every `ColumnMap` split from the same cell's SELECT match (per-cell granularity, RESEARCH Pitfall 4)
- Added `test_column_map_carries_evidence` (population + shared-evidence assertion) and `test_evidence_is_optional_for_backward_compat` (no-SELECT → `evidence is None`; hand-built evidence-less payload round-trips via `LineageGraph.model_validate()`)

## Task Commits

Each task was committed atomically:

1. **Task 1: Add ColumnMapEvidence to the backend + frontend contract** - `f0f2b0f` (feat)
2. **Task 2: Thread evidence through parser._column_maps() and parse_notebook()** - `974e43b` (feat)
3. **Task 3: pytest coverage — evidence population + backward-compatibility** - `11f0544` (test)

**Plan metadata:** (pending — this docs commit)

_Note: Task 3 is tagged `tdd="true"` in the plan, but the implementation it tests (Tasks 1-2) was already committed by design — the plan sequences contract+parser first, tests last. Tests were written and verified to pass against the already-implemented feature rather than run through a strict RED-then-GREEN cycle, since no prior implementation was missing to fail against._

## Files Created/Modified
- `backend/app/models.py` - New `ColumnMapEvidence` model; `ColumnMap.evidence: ColumnMapEvidence | None = None`
- `backend/app/parser.py` - `_column_maps(cell, notebook, cell_index)` computes line/snippet and builds shared evidence; `parse_notebook` enumerates cells
- `frontend/src/api.ts` - Mirrored `ColumnMapEvidence` interface; `ColumnMap.evidence?: ColumnMapEvidence | null`
- `backend/tests/test_parser.py` - Two new evidence tests, existing 4 cases untouched

## Decisions Made
- Merged the "shared evidence across columns from one SELECT" assertion into `test_column_map_carries_evidence` instead of a separate test function, so that `pytest tests/test_parser.py -k evidence` collects exactly the two tests named in the plan's acceptance criteria (adding a third `evidence`-named test would have broken that exact-count check)

## Deviations from Plan

None - plan executed exactly as written.

## Issues Encountered
None.

## User Setup Required

None - no external service configuration required.

## Next Phase Readiness
- The backend evidence contract (`ColumnMap.evidence`) is stable and available for `frontend/src/model/adapt.ts` to consume in a later plan (03-04 per PATTERNS.md's D-11/D-13 extension of the `xform` map)
- `frontend/src/shell/Inspector.tsx`'s future `ColumnCard` Evidence section (03-04/03-07) can now read `m.evidence` directly off `ColumnMap` once threaded through `adapt.ts`
- No blockers for downstream plans

---
*Phase: 03-lineage-dag-canvas-rebuild*
*Completed: 2026-07-23*

## Self-Check: PASSED

All created/modified files found on disk; all task and docs commits (f0f2b0f, 974e43b, 11f0544, 1707dbe) verified present in git log.
