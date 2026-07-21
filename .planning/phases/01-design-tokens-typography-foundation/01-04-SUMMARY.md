---
phase: 01-design-tokens-typography-foundation
plan: 04
subsystem: ui
tags: [css, design-tokens, tailwind-v4, oklch, typography]

# Dependency graph
requires:
  - phase: 01-design-tokens-typography-foundation (plan 01-02)
    provides: tokens.css's full OKLCH tier-1/tier-2 vocabulary (surfaces, text, accent, domain, edge, status, elevation)
provides:
  - Single-token-layer app — components.css + four view stylesheets reference only tokens.css/components.css tokens, App.css (the last competing token base) deleted
  - Tier-3 component token vocabulary (card, panel, toolbar, segmented control, toolbar button/search trigger, input, pill/badge, primary button, overlay scrim)
  - Thirteen legacy font sizes collapsed onto the four-step type ramp; seven legacy weights collapsed onto 400/600
  - Every padding/margin/gap/border-radius/border-width in component CSS on the declared token scale
affects: [phase-2-shell, phase-3-lineage-dag, phase-4-knowledge-graph, phase-5-purview-push]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Tier-3 component tokens live in a plain :root block at the top of components.css, each referencing exactly one tier-2 semantic — never a raw colour, never light-dark()"
    - "Icon-only interactive controls get a >=44x44px hit target via token-based padding plus an equal negative margin (calc(-1 * var(--spacing-N))), so the touch target grows without shifting layout"
    - "Warning/error UI state routes through --color-destructive, never a domain colour (THEME-05 channel rule extended to purview.css/definitions.css)"

key-files:
  created:
    - frontend/src/styles/components.css
  modified:
    - frontend/src/App.tsx
    - frontend/src/views/graph.css
    - frontend/src/views/search.css
    - frontend/src/views/purview.css
    - frontend/src/views/definitions.css
  deleted:
    - frontend/src/App.css

key-decisions:
  - "Applied the plan's font-size/weight/radius/spacing migration tables mechanically (by literal old value, not by re-deriving semantic role), including the 12px->13px (text-base) visible density increase across ~14 declarations the plan flagged in advance"
  - "Spacing snaps to the nearest DECLARED spacing token (4/8/12/16/24/32/48/64), not to an arbitrary 4px multiple — several values (e.g. 40px) have no exact token and round to the nearest neighbor with ties rounding down per the plan's rule"
  - "Uppercase micro-labels (.sec-t, .lcol .lh, .card .ct, .td-sidehead) keep letter-spacing via 0.08em (matching search.css's pre-existing .sp-group-label convention) instead of being dropped outright — their original px-unit tracking had to go (grep-checked violation), but dropping all uppercase-label tracking would have created a visible inconsistency against the one instance (.sp-group-label) that was already em-based and therefore compliant"
  - "The purview write-flow tab indicator's structural 2px bottom border was reduced to var(--border-width) (1px) — DS-04/UI-SPEC explicitly forbids any component introducing a 2px structural border"
  - ".di-row.ambiguous .di-conf is kept explicit (tertiary text/border) rather than deleted even though it now matches .di-conf's own default state, to keep the bronze-to-neutral migration decision visible in the diff"

requirements-completed: [DS-02, DS-03, DS-04, DS-05, THEME-05]

coverage:
  - id: D1
    description: "components.css created with the tier-3 component token vocabulary and every App.css rule migrated onto it; App.css deleted and App.tsx repointed"
    requirement: "DS-02"
    verification:
      - kind: automated_ui
        ref: "npm run build && npm run lint && npm run audit:tokens (all exit 0)"
        status: pass
      - kind: other
        ref: "grep-based acceptance criteria from 01-04-PLAN.md task 1 (zero hex/rgba literals, zero non-oklch color-mix, zero bare px in type/spacing/radius declarations, only 400/600 weights, all var() references resolve, no light-dark() in tier-3 declarations)"
        status: pass
    human_judgment: true
    rationale: "Plan's own verify step requires a human render pass over the toolbar/segmented control/toolbar buttons/search trigger to confirm the explicitly-liked chrome character survived the systematic radius/weight values — this is a visual judgment call, not something the grep checks can prove."
  - id: D2
    description: "graph.css, search.css, purview.css and definitions.css migrated onto the token vocabulary; font shorthand decomposed; both overlay scrims routed through --overlay-scrim; bronze-as-warning replaced with --color-destructive; icon-only controls get a 44x44px hit target"
    requirement: "DS-03, DS-04, DS-05, THEME-05"
    verification:
      - kind: automated_ui
        ref: "npm run build && npm run lint && npm run audit:tokens (all exit 0)"
        status: pass
      - kind: other
        ref: "grep-based acceptance criteria from 01-04-PLAN.md task 2 (zero hex/rgba, zero non-oklch color-mix, zero bare px, zero font-shorthand-with-size, only 400/600 weights, zero color-domain in purview.css/definitions.css, all var() references resolve against tokens.css+components.css)"
        status: pass
    human_judgment: true
    rationale: "Plan's own verify step requires a human render pass over the command palette, Purview write panel and definitions import overlay to confirm no unstyled/default-blue elements and that both scrims dim the page — a visual judgment call outside grep's reach."

# Metrics
duration: 35min
completed: 2026-07-21
status: complete
---

# Phase 1 Plan 4: Component & View Stylesheet Token Migration Summary

**Deleted App.css, moved its rules plus a new tier-3 component-token vocabulary into components.css, and migrated all four view stylesheets — closing out the one-token-layer claim for DS-02/DS-03/DS-04/DS-05/THEME-05.**

## Performance

- **Duration:** 35 min
- **Started:** 2026-07-21T13:20:00Z (approx.)
- **Completed:** 2026-07-21T13:44:28Z
- **Tasks:** 2
- **Files modified:** 6 (1 created, 4 modified, 1 deleted)

## Accomplishments
- `frontend/src/styles/components.css` created with a tier-3 component token block (card, panel/inspector, toolbar, segmented control, toolbar button/search trigger, input, pill/badge, primary button, overlay scrim) and every migrated App.css rule
- `frontend/src/App.css` deleted; `frontend/src/App.tsx` now imports `./styles/components.css` — the app's CSS is down to `tokens.css` + `components.css` + four view files, with no competing token base
- Thirteen legacy font sizes collapsed onto the four-step ramp (`--text-micro`/`--text-base`/`--text-heading`/`--text-display`); seven legacy weights (560/620/640/650/700 and friends) collapsed onto 400/600
- All four view stylesheets (`graph.css`, `search.css`, `purview.css`, `definitions.css`) migrated onto the same vocabulary — `search.css`'s `font` shorthand decomposed, both overlay scrims routed through `--overlay-scrim`, the bronze-as-warning affordance in `purview.css`/`definitions.css` routed to `--color-destructive`, and the palette-clear/overlay-close icon buttons given a 44×44px hit target

## Task Commits

Each task was committed atomically:

1. **Task 1: Create components.css with the tier-3 vocabulary, migrate all of App.css into it, and retire App.css** - `003a54d` (feat)
2. **Task 2: Migrate the four view stylesheets onto the token vocabulary** - `fea6d27` (feat)

_Both tasks passed `npm run build`, `npm run lint`, `npm run audit:tokens` and every grep-based acceptance criterion in the plan before being committed._

## Files Created/Modified
- `frontend/src/styles/components.css` - New: tier-3 component token block + every migrated App.css rule
- `frontend/src/App.tsx` - Import repointed from `./App.css` to `./styles/components.css`
- `frontend/src/views/graph.css` - Migrated graph query pill + table-detail panel onto the token vocabulary
- `frontend/src/views/search.css` - Migrated command palette; decomposed `font` shorthand
- `frontend/src/views/purview.css` - Migrated write panel; 2px tab-indicator border reduced to `var(--border-width)`
- `frontend/src/views/definitions.css` - Migrated import overlay; bronze warning/ambiguous-confidence treatment replaced with destructive/neutral tokens
- `frontend/src/App.css` - Deleted (last competing token base)

## Decisions Made
- Mechanical application of the plan's three migration tables (token names, font sizes, weights, radii, spacing) by literal old value rather than re-deriving semantic intent case by case, including the flagged 12px→13px (`text-base`) density increase across ~14 declarations
- Spacing rounds to the nearest *declared* spacing token (there is no token for every 4px multiple — e.g. 40px has no exact match and rounds, on a tie, down to `--spacing-8` (32px) per the plan's tie-break rule)
- Uppercase micro-labels keep letter-spacing via `0.08em` rather than losing tracking outright, matching the one pre-existing em-based instance (`search.css`'s `.sp-group-label`) so uppercase labels read consistently across the app
- The purview tab-indicator's 2px structural border was corrected to 1px (`var(--border-width)`) — a direct DS-04/UI-SPEC requirement ("no component introduces a 2px structural border"), applied as an in-scope Rule 1/2 style fix rather than a deviation requiring sign-off

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 2 - Missing Critical] Corrected purview's 2px tab-indicator border to the systematic 1px border-width**
- **Found during:** Task 2 (`purview.css` migration)
- **Issue:** `.pv-tabs button { border-bottom: 2px solid transparent; }` predates the token system and directly violates DS-04/UI-SPEC's explicit "no component introduces a 2px structural border" rule
- **Fix:** Changed to `border-bottom: var(--border-width) solid transparent;` (1px), with `margin-bottom: calc(-1 * var(--border-width))` preserved to keep the tab strip's bottom edge flush against the panel's own border
- **Files modified:** `frontend/src/views/purview.css`
- **Verification:** `npm run build`, `npm run lint` both pass; visually the active-tab indicator is 1px thinner than before (minor, spec-mandated)
- **Committed in:** `fea6d27` (Task 2 commit)

---

**Total deviations:** 1 auto-fixed (1 missing-critical/spec-compliance fix)
**Impact on plan:** Necessary for DS-04 compliance. No scope creep — no new files, no architectural change.

## Issues Encountered
None - both tasks completed on the first pass; all grep-based acceptance criteria and `npm run build`/`lint`/`audit:tokens` passed without needing a second attempt.

## User Setup Required
None - no external service configuration required.

## Next Phase Readiness
- The app renders entirely from one token layer: `tokens.css` (tier 1/2) + `components.css` (tier 3 + migrated rules) + four view files, none of which declares a colour or an ad hoc type/spacing/radius value
- Phase 2's shell rebuild can consume the tier-3 vocabulary defined at the top of `components.css` (`--toolbar-*`, `--seg-*`, `--tbtn-*`, `--input-*`) directly, per SHELL-04's carry-forward requirement — no guessing needed
- Deferred: the plan's `<human-check>` verification steps (visual confirmation of toolbar/segmented-control/search-trigger chrome, and of the command palette/write panel/import overlay rendering with no unstyled elements) were not captured as a screenshot in this run; `human_verify_mode: "end-of-phase"` in `.planning/config.json` means this is expected to happen at end-of-phase review rather than per-plan
- No blockers for Phase 2

---
*Phase: 01-design-tokens-typography-foundation*
*Completed: 2026-07-21*

## Self-Check: PASSED

- FOUND: frontend/src/styles/components.css
- CONFIRMED DELETED: frontend/src/App.css
- FOUND: frontend/src/views/graph.css
- FOUND: frontend/src/views/search.css
- FOUND: frontend/src/views/purview.css
- FOUND: frontend/src/views/definitions.css
- FOUND commit: 003a54d
- FOUND commit: fea6d27
