---
phase: 02-app-shell-routing-canvas-infrastructure
plan: 08
subsystem: ui
tags: [typescript, vitest, id-derivation, search, command-palette]

# Dependency graph
requires:
  - phase: 02-app-shell-routing-canvas-infrastructure
    provides: model/ids.ts (shared tid/nid helpers), shell/search.ts (cmdk-backed notebookIndex/search from 02-06)
provides:
  - Collision-free tid/nid short-id derivation (distinct interior '.' vs literal '_' encoding)
  - id-based (not name-based) notebookIndex() in shell/search.ts, consistent with nid()-mapped ids across AppModel
affects: [phase-3-canvas-rebuild, phase-4-knowledge-graph, real-Fabric-data-verification]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "tid/nid sanitize interior '.' to a distinct '__' token before the generic non-word-char fallback, so ids that previously collided under naive substitution now diverge while punctuation-free fixture ids are unaffected"
    - "notebookIndex() dedupes by canonical nid()-mapped node id, never by display label, mirroring the id-based keying already used by model.notebooks/model.notebookCode/model.ops"

key-files:
  created:
    - frontend/src/model/__tests__/ids.test.ts
  modified:
    - frontend/src/model/ids.ts
    - frontend/src/shell/search.ts
    - frontend/src/shell/__tests__/search.test.ts

key-decisions:
  - "Took the plan's recommended default (distinct '.'->'__' encoding) over the hash alternative — zero churn to adapt.test.ts/graphLayout.test.ts/lineageLayout.test.ts since none of the shared fixture ids contain interior dots"

patterns-established:
  - "id-derivation collision guards belong in a dedicated *.test.ts next to the pure helper (ids.test.ts), not folded into a consumer's test file"

requirements-completed: [NAV-01]

coverage:
  - id: D1
    description: "tid('table.raw.orders') and tid('table.raw_orders') (and the analogous nid pair) now produce distinct short ids, with every output staying DOM-id/CSS-selector safe ([A-Za-z0-9_-])"
    requirement: "NAV-01"
    verification:
      - kind: unit
        ref: "frontend/src/model/__tests__/ids.test.ts#tid/nid (collision-free short ids)"
        status: pass
    human_judgment: false
  - id: D2
    description: "notebookIndex() dedupes by canonical nid()-mapped node id instead of display name, so two same-named notebooks with distinct ids are both searchable, and every returned notebook id resolves against model.notebookCode/model.ops (the unreachable label-based fallback is removed)"
    requirement: "NAV-01"
    verification:
      - kind: unit
        ref: "frontend/src/shell/__tests__/search.test.ts#WR-04: two same-named notebooks with distinct ids are BOTH searchable (dedupe is by id, not name)"
        status: pass
      - kind: unit
        ref: "frontend/src/shell/__tests__/search.test.ts#WR-04: a graph-only notebook resolves to its nid()-mapped id, matching model.notebookCode/model.ops keys"
        status: pass
    human_judgment: false

duration: 5min
completed: 2026-07-22
status: complete
---

# Phase 02 Plan 08: Real-data ID/Search Correctness Fixes Summary

**Collision-free tid/nid short-id derivation (WR-03) and id-based notebookIndex() resolution (WR-04) — both silent-corruption defects that only surface on real Fabric metadata, not the bundled punctuation-free sample fixture.**

## Performance

- **Duration:** ~5 min
- **Started:** 2026-07-22T08:12Z (approx, following prior plan's commit)
- **Completed:** 2026-07-22T08:15:05-07:00
- **Tasks:** 2
- **Files modified:** 4 (1 new)

## Accomplishments
- `tid`/`nid` in `frontend/src/model/ids.ts` now encode interior `.` as a distinct `__` token before the generic non-word-char fallback, so two Fabric ids that previously collapsed to the same short id (e.g. `table.raw.orders` and `table.raw_orders` both → `raw_orders`) now diverge — while every existing fixture-derived id (no interior dots) is byte-identical, so the whole suite needed zero expectation edits.
- `notebookIndex()` in `frontend/src/shell/search.ts` now dedupes by the canonical `nid()`-mapped node id instead of display name, and resolves graph-only notebook nodes through the same `nid()` used by `model.notebooks`/`model.notebookCode`/`model.ops` — removing the unreachable `n.label in m.notebookCode ? n.label : n.id` fallback that always returned an unresolvable raw graph id.
- Added `frontend/src/model/__tests__/ids.test.ts` (collision pairs, DOM-safety regex, stable fixture pinning) and extended `frontend/src/shell/__tests__/search.test.ts` (duplicate-named-notebook case, graph-only-notebook id-resolution case).

## Task Commits

Each task was committed atomically:

1. **Task 1: Make tid/nid collision-free (WR-03) with a guard test** - `e627df1` (fix)
2. **Task 2: Fix notebookIndex() id resolution and dedupe (WR-04) with coverage** - `5645c0a` (fix)

**Plan metadata:** (this commit, following)

_Note: both tasks were single-commit fixes with test additions folded into the same commit (no separate RED/GREEN split — plan was not `tdd="true"`)._

## Files Created/Modified
- `frontend/src/model/ids.ts` - `tid`/`nid` now encode interior `.` distinctly from literal `_` via a shared `sanitize()` helper
- `frontend/src/model/__tests__/ids.test.ts` - new: collision pairs, DOM-safety, stable-fixture-mapping guard
- `frontend/src/shell/search.ts` - `notebookIndex()` rewritten to dedupe/resolve by canonical `nid()`-mapped id; imports `nid` from `../model/ids`
- `frontend/src/shell/__tests__/search.test.ts` - two new cases: duplicate-named notebooks both indexed; graph-only notebook resolves to its `nid()`-mapped id

## Decisions Made
- Took the plan's recommended default (distinct `.`→`__` encoding) rather than the hash-based alternative — the shared fixture (`table.raw_orders`, `notebook.clean_orders`) has no interior dots, so this path produced zero churn across `adapt.test.ts`, `graphLayout.test.ts`, and `lineageLayout.test.ts` (all still pass unmodified).

## Deviations from Plan

None - plan executed exactly as written. Both tasks followed the plan's recommended default approach; no architectural changes, no missing critical functionality beyond what the plan specified, no blocking issues.

## Issues Encountered

None.

## User Setup Required

None - no external service configuration required.

## Next Phase Readiness

- Both WR-03 and WR-04 real-data correctness defects (flagged in 02-REVIEW.md/02-VERIFICATION.md) are now closed with regression coverage; the `LineageGraph` contract is unchanged.
- Full frontend suite (12 test files, 56 tests) and `npm run build` are green.
- No new blockers introduced. The pre-existing Suspense/root-context crash (tracked separately, fixed in 02-07) and the Phase-4 real-Fabric-scale watch item remain the only outstanding phase-02 concerns.

---
*Phase: 02-app-shell-routing-canvas-infrastructure*
*Completed: 2026-07-22*

## Self-Check: PASSED

All created/modified files exist on disk; both task commit hashes (`e627df1`, `5645c0a`) verified present in `git log --oneline --all`.
