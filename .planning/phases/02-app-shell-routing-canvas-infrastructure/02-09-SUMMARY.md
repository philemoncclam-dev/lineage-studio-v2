---
phase: 02-app-shell-routing-canvas-infrastructure
plan: 09
subsystem: docs
tags: [requirements-traceability, roadmap, gap-closure, deferral, tanstack-router]

# Dependency graph
requires:
  - phase: 02-app-shell-routing-canvas-infrastructure
    provides: 02-VERIFICATION.md Gap #2/#3 and 02-REVIEW.md WR-01, the exact satisfied-vs-deferred split this plan documents
provides:
  - Honest SHELL-05/SHELL-06 status in REQUIREMENTS.md (Partial, not unqualified Complete)
  - Phase 2 SC#3 graph-mode deferral note in ROADMAP.md
  - Phase 4 carry-forward note in ROADMAP.md referencing the new todo
  - Precise Phase-4 wiring brief for resolvePathSegments + URL-driven graph drill
affects: [phase-04-knowledge-graph-canvas-rebuild]

# Tech tracking
tech-stack:
  added: []
  patterns: []

key-files:
  created:
    - .planning/todos/pending/phase4-graph-mode-drill-url-wiring.md
  modified:
    - .planning/REQUIREMENTS.md
    - .planning/ROADMAP.md

key-decisions:
  - "SHELL-05/SHELL-06 re-scoped from unqualified Complete to Partial in both REQUIREMENTS.md's checklist and traceability table, naming the graph-mode drill hierarchy + resolvePathSegments wiring deferral to Phase 4 (locked scope decision B, not relitigated here)"
  - "resolvePathSegments.ts and its 9 passing unit tests stay in-tree untouched, documented as intentionally staged for Phase 4 to consume"
  - "Phase-4 carry-forward todo also captures WR-02/WR-05 (canvas-rebuild-absorbed) and WR-06 (separately deferred UX item) as known-deferred notes so they aren't lost between phases"

patterns-established: []

requirements-completed: [SHELL-05, SHELL-06]

coverage:
  - id: D1
    description: "REQUIREMENTS.md SHELL-05/SHELL-06 no longer read as unqualified Complete; both traceability rows and checklist entries name the Phase-4 graph-mode drill deferral with a one-line reason, while satisfied portions (mode routes, /lineage/$workspace/$lakehouse/$table, selection) remain marked satisfied"
    requirement: "SHELL-05"
    verification:
      - kind: other
        ref: "grep -n \"SHELL-05\\|SHELL-06\" .planning/REQUIREMENTS.md | grep -iv \"complete\" | grep -i \"phase 4\\|deferred\\|partial\""
        status: pass
    human_judgment: false
  - id: D2
    description: "ROADMAP.md Phase 2 SC#3 carries an honest graph-mode deferral note pointing at Phase 4/GRAPH-02; Phase 4 gains a carry-forward note referencing the new todo"
    requirement: "SHELL-06"
    verification:
      - kind: other
        ref: "manual read of .planning/ROADMAP.md Phase 2 SC#3 block and Phase 4 Requirements line"
        status: pass
    human_judgment: false
  - id: D3
    description: "Phase-4 carry-forward todo exists with resolves_phase: 04 and status: pending, naming both wiring actions (resolvePathSegments beforeLoad + D-09 redirect/notice; URL-driven graph drill via navigate) and recording resolvePathSegments.ts + tests as intentionally staged"
    verification:
      - kind: other
        ref: "test -f .planning/todos/pending/phase4-graph-mode-drill-url-wiring.md && grep -q \"resolves_phase: 04\" ... && grep -qi \"resolvePathSegments\" ..."
        status: pass
    human_judgment: false
  - id: D4
    description: "Zero frontend/src changes — docs-only gap-closure plan"
    verification:
      - kind: other
        ref: "git status --short frontend/src (empty output, confirmed before both commits)"
        status: pass
    human_judgment: false

duration: 5min
completed: 2026-07-22
status: complete
---

# Phase 2 Plan 09: Honest Re-scope of SHELL-05/06 Graph-Mode Drill Deferral Summary

**REQUIREMENTS.md/ROADMAP.md re-scoped SHELL-05/06 from unqualified "Complete" to "Partial" for the graph-mode drill hierarchy, and a precise Phase-4 carry-forward todo now captures the exact resolvePathSegments + URL-driven drill wiring Phase 4 must do.**

## Performance

- **Duration:** 5 min
- **Started:** 2026-07-22T15:16:04Z (approx, following 02-08 completion)
- **Completed:** 2026-07-22T15:19:00Z
- **Tasks:** 2
- **Files modified:** 3 (2 modified, 1 created)

## Accomplishments
- REQUIREMENTS.md's SHELL-05/SHELL-06 checklist entries and traceability rows no longer claim unqualified "Complete" for the graph-mode drill hierarchy — both now read "Partial" with a one-line Phase-4 deferral reason, while the genuinely-satisfied portions (mode routes, `/lineage/$workspace/$lakehouse/$table`, `?sel`/`?col` selection) remain marked satisfied
- ROADMAP.md's Phase 2 Success Criterion #3 gained a scoped deferral note; Phase 4's requirements block gained a "Carried forward from Phase 2" note pointing at the new todo
- Created `.planning/todos/pending/phase4-graph-mode-drill-url-wiring.md` with `resolves_phase: 04`, precisely briefing the two wiring actions Phase 4 must perform, and preserving WR-02/WR-05/WR-06 as known-deferred notes so they survive the phase boundary

## Task Commits

Each task was committed atomically:

1. **Task 1: Re-scope SHELL-05/SHELL-06 status honestly in REQUIREMENTS.md and ROADMAP.md** - `fb02947` (docs)
2. **Task 2: Create the Phase-4 carry-forward todo and document resolvePathSegments as intentionally staged** - `002ce16` (docs)

**Plan metadata:** committed alongside this SUMMARY (see final commit below)

## Files Created/Modified
- `.planning/REQUIREMENTS.md` - SHELL-05/SHELL-06 checklist entries and traceability rows changed from unqualified Complete to Partial, naming the Phase-4 graph-mode drill deferral
- `.planning/ROADMAP.md` - Phase 2 SC#3 gained a graph-mode deferral note; Phase 4 gained a carry-forward note referencing the new todo
- `.planning/todos/pending/phase4-graph-mode-drill-url-wiring.md` - new carry-forward todo with the precise Phase-4 wiring brief and known-deferred notes (WR-02/WR-05/WR-06)

## Decisions Made
- Kept the REQUIREMENTS.md checklist checkboxes `[x]` for SHELL-05/SHELL-06 (rather than unchecking to `[ ]`) since the mode-route/lineage-table/selection portions genuinely work — the qualifier text carries the honesty, matching the plan's instruction to keep satisfied portions "accurately described" rather than inverting the binary checkbox semantics used elsewhere in the file (e.g. THEME-07's `[ ]`)
- Placed the ROADMAP.md deferral note as a nested bullet under Phase 2's SC#3 (rather than a new top-level criterion) so the numbered success-criteria list numbering stays stable for future references
- Placed the Phase 4 carry-forward note directly beneath Phase 4's `**Requirements**` line (before "Guards against") so it reads as setup context before the phase's own pitfall guards, without disturbing the existing Guards/Success Criteria structure

## Deviations from Plan

None - plan executed exactly as written. This was a scoped, docs-only edit; no frontend source was touched, no architectural decisions were needed, and no auto-fixes were required.

## Issues Encountered

One correction during Task 2 authoring: the plan's verification command expects the literal string `resolves_phase: 04` (unquoted) in the todo frontmatter. An initial draft wrote `resolves_phase: "04"` (quoted, to avoid YAML octal-literal ambiguity on the leading zero) which would have failed the plan's own grep-based verify step. Caught before commit and corrected to the unquoted form to match the exact acceptance criterion; the file is plain markdown frontmatter (not strictly parsed as YAML by any tool in this repo), so the unquoted leading-zero string is safe.

## User Setup Required

None - no external service configuration required.

## Next Phase Readiness
- Phase 2 gap-closure work (02-07, 02-08, 02-09) is now complete: crash fixed, real-data correctness issues fixed, and documentation honesty restored.
- Phase 4 (Knowledge Graph Canvas Rebuild) has a precise, ready-to-consume brief for its graph-mode drill URL wiring — no further discovery work needed before that phase's planning starts on this specific gap.
- `resolvePathSegments.ts` and its tests remain in-tree, untouched, ready for Phase 4 to wire in.

---
*Phase: 02-app-shell-routing-canvas-infrastructure*
*Completed: 2026-07-22*

## Self-Check: PASSED

- FOUND: .planning/todos/pending/phase4-graph-mode-drill-url-wiring.md
- FOUND: .planning/phases/02-app-shell-routing-canvas-infrastructure/02-09-SUMMARY.md
- FOUND: fb02947 (Task 1 commit)
- FOUND: 002ce16 (Task 2 commit)
- FOUND: f0f2cef (SUMMARY commit)
