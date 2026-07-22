---
phase: 02-app-shell-routing-canvas-infrastructure
plan: 07
subsystem: ui
tags: [react, tanstack-router, vitest, testing-library, cr-01, gap-closure]

# Dependency graph
requires:
  - phase: 02-app-shell-routing-canvas-infrastructure (02-05, 02-06)
    provides: Inspector and CommandPalette real implementations, both of which read router match context and are the root cause of CR-01
provides:
  - The root route's Suspense pendingComponent (RootPending) no longer mounts anything that reads router match context — the app paints on load instead of blank-screening
  - AppShell's optional `overlays` prop, letting a caller mount shell chrome without Inspector/CommandPalette
  - A regression test (rootPending.test.tsx) that reproduces the CR-01 crash and guards against it recurring
  - Live confirmation (Playwright screenshots, both themes, dark and light color-scheme) that the app paints on load and gracefully degrades to the sample model when the backend is unreachable
affects: [03-lineage-canvas-rebuild, 04-graph-canvas-rebuild, phase-02-signoff]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Suspense pendingComponent fallback slot never receives router matchContext — any component in that slot must avoid useMatch/useSearch/useLoaderData (directly or via a hook that calls them)"
    - "AppShell's overlays prop as the mechanism for mounting shell chrome without match-context-reading overlays in contexts where match context isn't guaranteed"

key-files:
  created:
    - frontend/src/routes/__tests__/rootPending.test.tsx
  modified:
    - frontend/src/routes/__root.tsx
    - frontend/src/shell/AppShell.tsx
    - frontend/vite.config.ts

key-decisions:
  - "Chose the 'overlays' prop approach over the guaranteed-safe bare-skeleton alternative, since ModeMenu/Rail/RailBottomCluster were verified (by reading useRouterState.js source) to read only router *state*, never match context — the UI-SPEC's 'shell stays interactive during loading' intent is preserved"
  - "Added routeFileIgnorePattern: '\\.test\\.tsx$' to vite.config.ts's tanstackRouter plugin config (Rule 1) to silence a build warning caused by the new test file living under src/routes/__tests__/ — a supported plugin option, not a workaround"

requirements-completed: [SHELL-07]

coverage:
  - id: D1
    description: "RootPending mounts nothing that reads router match context; the CR-01 'Could not find a nearest match' crash no longer reproduces"
    requirement: "SHELL-07"
    verification:
      - kind: unit
        ref: "frontend/src/routes/__tests__/rootPending.test.tsx#renders the pending fallback without throwing the router match-context invariant"
        status: pass
      - kind: automated_ui
        ref: "playwright:paint-dark.png, playwright:paint-light.png (npx playwright screenshot, --color-scheme dark|light against vite preview)"
        status: pass
    human_judgment: false
  - id: D2
    description: "AppShell gains an optional overlays prop (default true) that omits Inspector/CommandPalette when false; normal (matched) render path is behaviorally unchanged"
    verification:
      - kind: unit
        ref: "frontend/src/shell/__tests__/CommandPalette.test.tsx, frontend/src/shell/__tests__/Inspector.test.tsx (both still pass unmodified, proving overlays=true default keeps normal render path identical)"
        status: pass
      - kind: integration
        ref: "cd frontend && npx vitest run (50/50 passing) && npm run build (exit 0)"
        status: pass
    human_judgment: false
  - id: D3
    description: "The app paints (no blank screen) on load in both light and dark theme, and gracefully degrades to the sample model when the backend is unreachable"
    verification:
      - kind: automated_ui
        ref: "playwright:paint-dark.png, playwright:paint-light.png, playwright:paint-dark-settled.png — captured against `npm run build && vite preview` with no backend running"
        status: pass
    human_judgment: true
    rationale: "Executor-side automation (Playwright screenshots, both color-schemes) confirms the app paints and is visually plausible, but the plan's human_verify_mode=end-of-phase harvests final sign-off on the three previously-blocked VERIFICATION.md items (SHELL-03 no-reflow, NAV-03 keyboard-op, standing-discipline #12) at end-of-phase, not here."

# Metrics
duration: 12min
completed: 2026-07-22
status: complete
---

# Phase 02 Plan 07: Fix CR-01 blank-screen crash Summary

**Fixed the confirmed CR-01 blank-screen crash by giving AppShell an `overlays` prop so the Suspense pending fallback mounts shell chrome without Inspector/CommandPalette, whose router-match-context reads previously threw "Could not find a nearest match!" on effectively every load.**

## Performance

- **Duration:** 12 min
- **Started:** 2026-07-22T15:01:39Z
- **Completed:** 2026-07-22T15:14:00Z
- **Tasks:** 3 (2 code tasks + 1 live-verification task)
- **Files modified:** 4 (1 created, 3 modified)

## Accomplishments
- Root-caused and fixed CR-01: `RootPending` (the router's Suspense `pendingComponent`) no longer mounts `Inspector`/`CommandPalette`, both of which read router match context via hooks that throw when no `matchContext` is in scope (the exact mechanism confirmed by 02-VERIFICATION.md's node_modules trace)
- Added a genuine RED→GREEN regression test (`rootPending.test.tsx`) that drives the real root Route into its pending state and reproduces the crash before the fix, then passes after
- Confirmed live, in a built-and-previewed app with no backend running: the app paints immediately (rail + loading skeleton, not blank) in both dark and light `prefers-color-scheme`, then gracefully falls back to the bundled sample model (Estate → Analytics/Finance/Marketing) once `fetchGraph()` rejects — unblocking the three VERIFICATION.md human-check items that CR-01 had blocked from any live-browser attempt

## Task Commits

Each task was committed atomically:

1. **Task 1: Add a pending-state regression test that reproduces the CR-01 crash** - `53b1000` (test)
2. **Task 2: Make the pending/loading state mount nothing that reads router match context** - `06c47e8` (fix)
3. **Task 3: Live both-theme paint confirmation (dev server)** - no source changes; live verification only (see below)

**Plan metadata:** (this commit, following SUMMARY.md write)

## Files Created/Modified
- `frontend/src/routes/__tests__/rootPending.test.tsx` - New regression test: builds a minimal in-memory router from the real root Route + a trivial index child, mocks `fetchGraph` to never resolve and `fetchPurviewStatus` to a stub, zeroes pending thresholds, and asserts the pending render doesn't throw and shows "Loading graph…"
- `frontend/src/routes/__root.tsx` - `RootPending` now renders `<AppShell overlays={false}>` instead of `<AppShell>`
- `frontend/src/shell/AppShell.tsx` - Added optional `overlays?: boolean` prop (default `true`); when `false`, `Inspector` and `CommandPalette` are not rendered
- `frontend/vite.config.ts` - Added `routeFileIgnorePattern: '\\.test\\.tsx$'` to the `tanstackRouter` plugin config

## Decisions Made
- Verified (by reading the installed `@tanstack/react-router` `useRouterState.js` source directly, not assuming) that `useRouterState` — used by `AppShell`, `ModeMenu`, and indirectly nothing else in the chrome path — reads only the router's state store, never `matchContext`, confirming the `overlays` approach is safe rather than falling back to the plan's "guaranteed-safe" bare-skeleton alternative
- Added `routeFileIgnorePattern` to `vite.config.ts` (Rule 1 — a build warning directly caused by this task's new test file living under `src/routes/__tests__/`) rather than renaming the plan-specified test file path

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] Silenced a new build warning caused by the regression test's required file path**
- **Found during:** Task 2 (`npm run build` verification)
- **Issue:** The plan's required test path (`frontend/src/routes/__tests__/rootPending.test.tsx`) lives inside the TanStack Router plugin's scanned `routesDirectory`, so `npm run build` emitted a "does not export a Route" warning for it (non-fatal, exit 0, but noise the plugin itself suggests fixing via config)
- **Fix:** Added `routeFileIgnorePattern: '\\.test\\.tsx$'` to `vite.config.ts`'s `tanstackRouter` plugin options — a supported plugin option that also covers any future `*.test.tsx` files placed under `src/routes/`
- **Files modified:** `frontend/vite.config.ts`
- **Verification:** `npm run build` now exits 0 with no warnings
- **Committed in:** `06c47e8` (Task 2 commit)

---

**Total deviations:** 1 auto-fixed (1 Rule 1 - bug/warning cleanup)
**Impact on plan:** No scope creep — the fix only silences a warning directly introduced by this plan's own required test file path.

## Issues Encountered
None.

## User Setup Required
None - no external service configuration required.

## Live Verification (Task 3)

Executor performed the live-browser portion itself (human_verify_mode=end-of-phase — no interactive human sign-off waited on here):

1. Built the app (`npm run build`, exit 0) and served it via `npx vite preview --port 4173`.
2. Captured screenshots with `npx playwright screenshot` (Chromium, already cached locally, no network install needed) at `--color-scheme dark` and `--color-scheme light`, `--wait-for-timeout 1500`:
   - Both show the shell rail + `.canvas-skeleton` "Loading graph…" text rendering correctly, styled per-theme — **no blank screen**, confirming the CR-01 fix live.
3. Captured a longer-settled dark screenshot (`--wait-for-timeout 4000`, no backend running): the app gracefully degrades to the bundled sample model, rendering the full Knowledge-Graph Estate view (Analytics/Finance/Marketing nodes, connection-status dot correctly red/err) — confirming SHELL-07's graceful-degradation truth is now actually reachable at runtime, not just correct in isolated loader logic.
4. Preview server process terminated after capture.

This unblocks (does not itself perform) the three VERIFICATION.md `human_verification` items previously blocked entirely by CR-01:
- SHELL-03 inspector no-reflow, both themes — now exercisable in a live browser; not performed here (needs interactive selection clicks, reserved for end-of-phase human harvest per `human_verify_mode=end-of-phase`)
- NAV-03 palette keyboard-operability, both themes — now exercisable; not performed here (needs interactive keyboard sequence)
- Standing discipline #12 both-theme re-check across all Phase-2 shell chrome — the two screenshots above are a first-pass proof the shell chrome (rail, mode-menu icon, status dot, loading skeleton) renders correctly in both themes; a full re-check of every component (Inspector open, CommandPalette open) is reserved for end-of-phase harvest.

## Next Phase Readiness
- CR-01 is resolved: the app no longer blank-screens on load in dev or production builds, restoring ROADMAP Success Criterion #6 and satisfying SHELL-07's "never leave the app broken" truth
- The three previously-blocked VERIFICATION.md `human_verification` items are now exercisable and ready for the end-of-phase verifier/human pass to harvest
- Gaps #2 and #3 from 02-VERIFICATION.md (Knowledge-Graph drill path not URL-addressable; `resolvePathSegments` unwired) are explicitly out of scope for this plan and remain open — tracked separately per the phase's other gap-closure plans (WR-03/04, SHELL-05/06 re-scope)

---
*Phase: 02-app-shell-routing-canvas-infrastructure*
*Completed: 2026-07-22*

## Self-Check: PASSED

- FOUND: frontend/src/routes/__tests__/rootPending.test.tsx
- FOUND: .planning/phases/02-app-shell-routing-canvas-infrastructure/02-07-SUMMARY.md
- FOUND: 53b1000 (test commit)
- FOUND: 06c47e8 (fix commit)
- FOUND: f8a5ad1 (summary commit)
