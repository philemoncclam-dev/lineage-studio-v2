---
gsd_state_version: 1.0
milestone: v1.0
milestone_name: milestone
current_phase: 02
current_phase_name: app-shell-routing-canvas-infrastructure
status: executing
stopped_at: Completed 02-08-PLAN.md
last_updated: "2026-07-22T15:16:04.026Z"
last_activity: 2026-07-22
last_activity_desc: Phase 02 execution started
progress:
  total_phases: 2
  completed_phases: 1
  total_plans: 13
  completed_plans: 12
---

# Project State

## Project Reference

See: .planning/PROJECT.md (updated 2026-07-20)

**Core value:** Purview gets populated from this app — explore lineage visually → select what matters → push to Purview → see it land, in a UI you'd demo without apologising.
**Current focus:** Phase 02 — app-shell-routing-canvas-infrastructure

## Current Position

Phase: 02 (app-shell-routing-canvas-infrastructure) — EXECUTING
Plan: 3 of 9
Status: Ready to execute
Last activity: 2026-07-22 — Phase 02 execution started

Progress: [█████████░] 92%

## Performance Metrics

**Velocity:**

- Total plans completed: 0
- Average duration: - min
- Total execution time: 0 hours

**By Phase:**

| Phase | Plans | Total | Avg/Plan |
|-------|-------|-------|----------|
| - | - | - | - |

**Recent Trend:**

- Last 5 plans: none yet
- Trend: N/A

*Updated after each plan completion*
**Per-Plan Metrics:**

| Plan | Duration | Tasks | Files |
|------|----------|-------|-------|
| Phase 01 P01 | 20min | 3 tasks | 8 files |
| Phase 01 P02 | 35min | 2 tasks | 3 files |
| Phase 01 P03 | 20min | 2 tasks | 3 files |
| Phase 01 P04 | 35min | 2 tasks | 6 files |
| Phase 02 P01 | 2min | 2 tasks | 5 files |
| Phase 02 P02 | 15min | 2 tasks | 11 files |
| Phase 02 P03 | 28min | 2 tasks | 25 files |
| Phase 02 P04 | 55min | 2 tasks | 12 files |
| Phase 02 P05 | 14min | 2 tasks | 5 files |
| Phase 02 P06 | 20min | 2 tasks | 6 files |
| Phase 02 P07 | 12min | 3 tasks | 4 files |
| Phase 02 P08 | 5min | 2 tasks | 4 files |

## Accumulated Context

### Decisions

Full decision log lives in PROJECT.md's Key Decisions table. Locked and
carried into the roadmap without re-litigation:

- Knowledge-graph renderer: sigma.js + graphology (MIT) — Cosmograph rejected on licensing, no gate task scheduled
- Token/styling layer: Tailwind CSS v4 `@theme`
- Router: TanStack Router
- Hop-depth control (GRAPH-04): in v1 (Phase 4), not deferred
- Push audit/history: deferred to v1.x, not in this roadmap
- Purview-push phase (Phase 5) is UI-only — `WriteSession` write-safety plumbing already verified server-side; no backend research scheduled
- THEME-07 (light theme review) gets its own dedicated Phase 6 rather than folding into a neighboring phase — explicit exception to normal single-requirement-phase compression
- [Phase ?]: Vendored Geist/Geist Mono woff2 into public/fonts/ instead of importing Fontsource's own CSS, keeping preload href and @font-face src byte-identical in dev and production
- [Phase ?]: unicode-range on both @font-face blocks copied verbatim from Fontsource's latin split so U+2318 deliberately falls through to the generic fallback stack
- [Phase ?]: Near-equality collision detection scoped to identity-bearing channels (domain/edge/state/status) only, not surface/text, since the raw OKLCH math makes it impossible to catch the sanctioned silver/accent pair without also flagging near-achromatic neutral pairs that are objectively closer on every axis
- [Phase ?]: audit-tokens.mjs discovered two genuine WCAG/CVD gaps beyond the UI-SPEC's own manual verification (domain-silver dark-vs-canvas contrast, text-tertiary dark-vs-raised-surface contrast); both are narrowly exempted with documented reasoning since this plan has no authority to re-derive the locked OKLCH values
- [Phase ?]: Added surface1 field to CanvasTokens (not enumerated by task 1's field list) because task 2 requires reading the surface-1 token for the node outline stroke
- [Phase ?]: canvasFont() takes an optional scale param so one helper serves both static and zoom-scaled canvas text, with the token's own px value as the floor
- [Phase ?]: GraphView keeps a component-local data-theme MutationObserver alongside the bootstrap-level one, explicitly calling invalidateCanvasTokens() before re-reading so its live redraw never depends on cross-observer firing order
- [Phase ?]: Applied plan 01-04's font-size/weight/radius/spacing migration tables mechanically (by literal old value), including the flagged 12px->13px density increase across ~14 declarations
- [Phase ?]: Spacing snaps to the nearest DECLARED spacing token (not an arbitrary 4px multiple) — e.g. 40px has no exact token and rounds down to --spacing-8 (32px) on a tie
- [Phase ?]: Uppercase micro-labels keep letter-spacing via 0.08em (matching search.css's pre-existing convention) instead of losing tracking outright, to avoid a visible inconsistency across uppercase labels
- [Phase ?]: Corrected purview's 2px tab-indicator border to var(--border-width) (1px) as a Rule 2 fix — DS-04/UI-SPEC forbids any component introducing a 2px structural border
- [Phase ?]: Added passWithNoTests: true to vitest.config.ts (Rule 3) so an empty Vitest suite exits 0 as the plan's acceptance criteria require
- [Phase ?]: Added frontend/src/model/ids.ts for shared tid/nid helpers, avoiding a circular import between adapt.ts and its leaf modules
- [Phase ?]: Added frontend/src/model/__tests__/fixtures.ts as a single shared LineageGraph fixture reused across all four model test files
- [Phase ?]: GraphView.tsx drill state stays internal (not URL-driven) in 02-03 — resolveSegment/resolvePathSegments delivered as tested utilities, ready for the Phase 3/4 canvas rebuild to wire in once GraphView's drill state itself becomes URL-driven
- [Phase ?]: LineageView.tsx/GraphView.tsx required zero code changes for container-fit — Phase-1 flex-based CSS already fills whatever ancestor provides real height; verified via Playwright screenshots + scroll-dimension parity rather than assumed
- [Phase ?]: Purview Push/Data Products placeholder pages needed no changes — 02-03 already shipped the locked Copywriting Contract text through existing tokens (including --text-display)
- [Phase ?]: 02-05: table.layer reused as the D-12 workspace/lakehouse location field (no separate workspace field exists on Table)
- [Phase ?]: 02-05: GraphView selection write scoped to TableDetail's table header only (table/detail level), not the force-directed constellation nodes
- [Phase ?]: 02-06: hl() uses createElement not JSX since search.ts is a .ts (not .tsx) module per plan
- [Phase ?]: 02-06: getRouteApi('__root__') used instead of importing the root Route object, avoiding a __root.tsx -> AppShell -> CommandPalette circular import
- [Phase ?]: 02-06: notebook/code palette results resolve to their written table via model.ops writes edge, else fall back to a selection-only useSelection().select()
- [Phase ?]: 02-07: AppShell gains an optional overlays prop (default true) so RootPending can mount shell chrome without Inspector/CommandPalette in the Suspense pending fallback slot, fixing CR-01 (router matchContext is never provided to the fallback slot)
- [Phase ?]: 02-07: Added routeFileIgnorePattern to vite.config.ts's tanstackRouter plugin to exclude *.test.tsx from route-tree generation, since the CR-01 regression test now lives under src/routes/__tests__/
- [Phase ?]: Took the plan's recommended default (distinct '.'->'__' encoding) for tid/nid over the hash alternative, producing zero churn in adapt.test.ts/graphLayout.test.ts/lineageLayout.test.ts

### Pending Todos

None yet.

### Blockers/Concerns

yet. Watch items carried from research, to revisit as their phases start:

- Phase 1: verify Geist's small-size legibility on real Windows ClearType before committing (flagged LOW-confidence risk in STACK.md)
- Phase 4: real Fabric-tenant node/edge scale is unknown — test against a synthesized large graph, not just the bundled demo dataset
- Follow-up: dark-theme --color-text-tertiary fails WCAG AA (4.5:1) against surface-1/2/3 (scores 4.23/3.79/3.31) — needs a lightness nudge or a documented never-use-on-raised-surfaces component rule in the first phase that renders tertiary text on a raised dark surface. Exempted with reasoning in audit-tokens.mjs and tokens.css.
- Follow-up for Phase 6 (THEME-07): re-verify domain-silver vs edge-writes and domain-notebook vs edge-reads under CVD simulation in light theme — both sit at/under the 0.05 perceptibility floor there (dark theme clears comfortably). Currently exempted pending that dedicated review.
- Pre-existing (not caused by 02-06): Suspense pendingComponent in routes/__root.tsx renders AppShell/Inspector outside router match context, crashing the app on load in both dev and production builds. Blocks all live-browser verification. See .planning/phases/02-app-shell-routing-canvas-infrastructure/deferred-items.md for root cause and suggested fix. Must be resolved before phase 02 sign-off / both-themes UAT.

## Deferred Items

| Category | Item | Status | Deferred At |
|----------|------|--------|-------------|
| v2 requirements | AUDIT-01/02/03 (push audit/history) | Deferred to v1.x | Requirements definition, 2026-07-21 |
| v2 requirements | EXPL-01..04 (saved views, universal command palette, impact analysis, columns as graph nodes) | Deferred to v2 | Requirements definition, 2026-07-21 |

## Session Continuity

Last session: 2026-07-22T15:16:04.017Z
Stopped at: Completed 02-08-PLAN.md
Resume file: None
