---
phase: 02-app-shell-routing-canvas-infrastructure
plan: 04
subsystem: ui
tags: [react, radix-ui, tanstack-router, cmdk, css-tokens, dark-mode]

# Dependency graph
requires:
  - phase: 02-app-shell-routing-canvas-infrastructure (plans 02-03)
    provides: TanStack Router route tree, root loader, selection store, retired App.tsx
provides:
  - Mode-based shell chrome (logo mode menu, per-mode data-driven icon rail, rail-bottom cluster)
  - Theme toggle with localStorage persistence + OS-preference fallback
  - Inspector and CommandPalette overlay mount points (stubs for 02-05/02-06)
  - New tier-3 shell component tokens in components.css
  - Verified container-fit of bridged LineageView/GraphView inside the new shell
  - Honest Purview Push / Data Products placeholder pages
affects: [02-05-inspector, 02-06-command-palette]

# Tech tracking
tech-stack:
  added: []  # Radix DropdownMenu/Tooltip/VisuallyHidden and cmdk were already installed in 02-01; this plan is their first real usage
  patterns:
    - "Data-driven rail: Rail.tsx maps a per-mode railConfig.ts array — adding a destination is a one-line config edit, no JSX change"
    - "Tier-3 token block append-only: new shell tokens live in components.css's existing :root block, each resolving to a Phase-1 tier-2 semantic"
    - "Overlay z-index stacking centralized in shell.css per the UI-SPEC table (rail 5, canvas content 6, inspector 20, tooltip 50, mode-menu 60, palette 100)"

key-files:
  created:
    - frontend/src/shell/AppShell.tsx
    - frontend/src/shell/ModeMenu.tsx
    - frontend/src/shell/Rail.tsx
    - frontend/src/shell/RailBottomCluster.tsx
    - frontend/src/shell/railConfig.ts
    - frontend/src/shell/theme.ts
    - frontend/src/shell/Inspector.tsx
    - frontend/src/shell/CommandPalette.tsx
    - frontend/src/shell/__tests__/Rail.test.tsx
    - frontend/src/styles/shell.css
  modified:
    - frontend/src/styles/components.css
    - frontend/src/main.tsx

key-decisions:
  - "LineageView.tsx/GraphView.tsx required zero code changes for container-fit — their existing Phase-1 flex-based CSS (.ls-body/.gv-root as flex:1 children of a flex-column parent) already fills whatever ancestor provides real height, and .shell-canvas provides exactly that, same as the retired .app did. Verified via screenshots + scrollWidth/Height==clientWidth/Height (no double-scroll) rather than assumed."
  - "Purview placeholder pages (push.tsx, data-products.tsx) needed no changes — 02-03 already shipped the locked Copywriting Contract text and .purview-page/.page-title/.page-lead already resolve through tokens (including --text-display, defined in Phase 1 for this exact use)"

patterns-established:
  - "Icon-only rail item: Radix Tooltip + VisuallyHidden pair per interactive rail/rail-bottom control, locked accessible-name text sourced from railConfig.ts"

requirements-completed: [SHELL-01, SHELL-02, SHELL-04, SHELL-07]

coverage:
  - id: D1
    description: "Persistent per-mode icon rail renders from railConfig.ts (N entries -> N buttons, locked accessible names, no structural change to add a destination)"
    requirement: "SHELL-01"
    verification:
      - kind: unit
        ref: "frontend/src/shell/__tests__/Rail.test.tsx#Rail (SHELL-01)"
        status: pass
    human_judgment: false
  - id: D2
    description: "App-logo Radix DropdownMenu mode switcher, current mode checkmarked, no segmented control/rail-icon mode switch"
    requirement: "SHELL-01"
    verification:
      - kind: automated_ui
        ref: "playwright screenshot: dark-mode-menu.png / light l-mode-menu.png (mode menu open, Purview checkmarked)"
        status: pass
    human_judgment: false
  - id: D3
    description: "Canvas region fills remaining viewport (SHELL-02); bridged LineageView/GraphView size via flex, no double-scrollbar, no cut-off edge"
    requirement: "SHELL-02"
    verification:
      - kind: automated_ui
        ref: "playwright: document/body scrollWidth==clientWidth and scrollHeight==clientHeight at 1024x700 on /graph, /lineage/sample/sample/clean, /purview/push (no page-level scroll; single inner scroll container only)"
        status: pass
    human_judgment: false
  - id: D4
    description: "Carried-forward .seg/.tbtn/.search treatment reused for new shell controls, no parallel class names (SHELL-04)"
    verification:
      - kind: other
        ref: "code inspection: RailBottomCluster reuses .search treatment styling convention; no new .seg-like class introduced"
        status: pass
    human_judgment: false
  - id: D5
    description: "Theme toggle persists to localStorage and survives reload; falls back to OS preference when cleared"
    verification:
      - kind: other
        ref: "code inspection: theme.ts setTheme/getTheme/initTheme + main.tsx calls initTheme() before first paint"
        status: pass
    human_judgment: false
  - id: D6
    description: "Honest Purview Push / Data Products placeholders — locked copy, no CTA/confirm button (transparency prohibition)"
    verification:
      - kind: automated_ui
        ref: "playwright screenshots dark-purview-push.png / dark-purview-data-products.png; code inspection confirms no <button> in either route file"
        status: pass
    human_judgment: false
  - id: D7
    description: "Both themes checked for every new shell component (rail, mode menu, rail-bottom, tooltips) — standing discipline #12"
    verification:
      - kind: automated_ui
        ref: "playwright screenshots: d-graph.png/d-rail-hover.png/d-mode-menu.png (dark) and l-graph.png/l-mode-menu.png (light)"
        status: pass
    human_judgment: true
    rationale: "Visual polish/contrast judgment (e.g. force-layout node label overlap, subtle color legibility) benefits from a human look even though automated screenshots exist and show no structural defects"

# Metrics
duration: 55min
completed: 2026-07-21
status: complete
---

# Phase 2 Plan 04: App Shell Chrome & Canvas Bridge Summary

**Mode-based shell chrome (Radix DropdownMenu logo switcher + data-driven icon rail + rail-bottom cluster) composed over the 02-03 router root, with new tier-3 tokens and a verified container-fit bridge for the existing canvases — no code changes needed in LineageView/GraphView since Phase 1's flex-based CSS already filled whatever container it was given.**

## Performance

- **Duration:** ~55 min
- **Started:** 2026-07-21 (session continued from a prior uncommitted work-in-progress state)
- **Completed:** 2026-07-21
- **Tasks:** 2 (Task 1 code + commit; Task 2 verification-only, no diff required)
- **Files modified:** 12 (Task 1 commit)

## Accomplishments
- Data-driven per-mode icon rail (`Rail.tsx` + `railConfig.ts`) — adding a fifth destination to any mode is a one-line array edit; unit-tested for N-entries-to-N-buttons, accessible names, single-item and never-merge edges
- App-logo Radix `DropdownMenu` mode switcher (`ModeMenu.tsx`) — Graph/Lineage/Purview, current mode checkmarked, the only mode-switch affordance (D-02)
- Rail-bottom cluster (`RailBottomCluster.tsx`): Cmd+K search trigger, theme toggle, tri-state connection-status dot (one-shot `fetchPurviewStatus`, no polling)
- Theme toggle (`theme.ts`): `setTheme`/`getTheme`/`initTheme`, `data-theme` + `lineage-studio-theme` localStorage key, OS-preference fallback when cleared; `initTheme()` wired into `main.tsx` before first paint so the choice survives a reload
- `AppShell.tsx` composes logo/rail/rail-bottom + canvas region wrapping `<Outlet/>` + `Inspector`/`CommandPalette` overlay stub mounts (both intentionally render inert placeholders for 02-05/02-06); owns the global Cmd+K keydown listener
- 20 new tier-3 shell tokens appended to `components.css`'s existing tier-3 block (`--rail-*`, `--mode-menu-*`, `--inspector-*`, `--palette-*`, `--rail-bottom-gap`, `--theme-toggle-size`, `--status-dot-*`), every one resolving to a Phase-1 tier-2 semantic — no new hex/primitive
- `shell.css`: structural rail/mode-menu/inspector/palette layout, overlay z-index stacking per the UI-SPEC table
- Verified (not assumed) that bridged `LineageView`/`GraphView` need zero changes to fill the new canvas region cleanly — no double-scrollbar, no cut-off edge, in both themes
- Verified Purview Push/Data Products placeholder pages already carry the exact locked copy with no CTA, styled through tokens including `--text-display` (defined in Phase 1 specifically for this use)

## Task Commits

1. **Task 1: Tier-3 shell tokens + mode menu + data-driven rail + rail-bottom cluster + AppShell composition** - `1353781` (feat)
2. **Task 2: Container-fit bridge for LineageView/GraphView + honest Purview placeholder pages** - no commit (zero-diff; see Deviations)

**Plan metadata:** committed separately as part of this summary's own commit.

## Files Created/Modified
- `frontend/src/shell/AppShell.tsx` - composes logo/rail/rail-bottom, canvas Outlet region, Inspector/CommandPalette mounts, owns Cmd+K listener
- `frontend/src/shell/ModeMenu.tsx` - Radix DropdownMenu app-logo mode switcher
- `frontend/src/shell/Rail.tsx` - data-driven per-mode icon rail (Tooltip + VisuallyHidden per item)
- `frontend/src/shell/RailBottomCluster.tsx` - Cmd+K trigger, theme toggle, connection-status dot
- `frontend/src/shell/railConfig.ts` - per-mode destination arrays, locked accessible-name text, `modeFromPathname`/`MODE_LANDING`/`MODE_LABEL`
- `frontend/src/shell/theme.ts` - `setTheme`/`getTheme`/`initTheme`/`isDarkResolved`
- `frontend/src/shell/Inspector.tsx` - stub, returns null (02-05 fills in)
- `frontend/src/shell/CommandPalette.tsx` - stub `Command.Dialog` gated on open state (02-06 fills in)
- `frontend/src/shell/__tests__/Rail.test.tsx` - 4 unit tests for SHELL-01's rendering contract
- `frontend/src/styles/shell.css` - new file: rail/mode-menu/inspector/palette structural CSS + z-index stacking
- `frontend/src/styles/components.css` - 20 new tier-3 shell tokens appended to the existing tier-3 block
- `frontend/src/main.tsx` - calls `initTheme()` before first paint

Unmodified (verified, not changed):
- `frontend/src/views/LineageView.tsx`, `frontend/src/views/GraphView.tsx` - already flex-fill their container; no fixed-viewport assumption found
- `frontend/src/routes/purview/push.tsx`, `frontend/src/routes/purview/data-products.tsx` - already carry the locked Copywriting Contract text with no CTA (shipped in 02-03)

## Decisions Made
- Treated Task 2 as verification-first rather than change-first: read the existing `.ls-body`/`.ls-stage`/`.ls-canvas` and `.gv-root`/`.gv-stage`/`.gv-canvas-wrap` CSS before touching anything, found they were already `flex:1`/`min-height:0` children designed to fill whatever flex-column ancestor provides real height (originally `.app`, now `.shell-canvas`) — no fixed-viewport pixel assumption existed to fix. Verified with Playwright rather than assumed: rendered `/graph`, `/lineage/$workspace/$lakehouse/$table`, and `/purview/push` at 1024x700 and confirmed `document.body.scrollWidth/Height` exactly equal `clientWidth/Height` (no page-level scroll, single inner scroll container only) in addition to full-viewport screenshots in both themes.
- Used a route-abort (`page.route(... => route.abort())`) in the verification harness only, to short-circuit the unreachable-backend `fetchGraph()` call for fast, deterministic test timing — this is a test-only technique, not a product change; `fetchGraph()` itself is unmodified and still has no client-side timeout (pre-existing behavior, ported verbatim from `App.tsx` per 02-PATTERNS.md's explicit instruction to preserve the silent-catch-fallback-to-sample behavior unchanged).

## Deviations from Plan

### Auto-fixed Issues

None — Task 1's implementation exactly matches the plan's acceptance criteria as found in the working tree (see "Issues Encountered" for provenance).

---

**Total deviations:** 0 rule-triggered auto-fixes.

**Task 2 zero-diff note (not a Rule 1-4 deviation):** Task 2's acceptance criteria ("LineageView/GraphView diffs are container-sizing only... introduce no raw hex colour", exact Purview placeholder copy, no CTA) were already fully satisfied by prior work — 02-03's route files already contain the locked placeholder copy, and Phase 1's flex-based `.ls-body`/`.gv-root` CSS already fills whatever flex-column ancestor it's given. This was verified with automated Playwright checks (full-page screenshots in both themes + `scrollWidth/Height` parity checks at a second viewport size) rather than assumed from reading the plan's framing. No code was changed because none was needed; making a cosmetic no-op edit purely to have "a diff" would violate the scope boundary (only fix issues directly caused by the current task).

## Issues Encountered
- On starting this plan, `git status` showed Task 1's shell files already present in the working tree but **uncommitted** — `AppShell.tsx`, `ModeMenu.tsx`, `Rail.tsx`, `RailBottomCluster.tsx`, `railConfig.ts`, `theme.ts`, `Inspector.tsx`, `CommandPalette.tsx`, `Rail.test.tsx`, `shell.css`, plus a diff to `components.css` and `main.tsx` — evidently from an earlier interrupted session that implemented the work but never committed. Verified the implementation against every acceptance criterion in the plan (unit tests, `npm run build`, and fresh Playwright visual verification in both themes) before committing it as this plan's Task 1, rather than re-implementing from scratch.
- Initial visual verification attempts hit a pre-existing latency issue unrelated to this plan: `fetchGraph()` (in `api.ts`, unchanged since before this phase) has no client-side timeout, so with the backend unreachable, direct browser navigations sat in the root loader's `pendingComponent` ("Loading graph…") for over 20 seconds before falling back to the sample model. Worked around this in the verification harness only via a Playwright route-abort (see Decisions Made) — no product code was touched to work around it, since it is out of this plan's scope and the exact fallback timing was never a stated requirement here.

## User Setup Required

None - no external service configuration required.

## Next Phase Readiness
- Inspector.tsx and CommandPalette.tsx are in place as inert stub mount points — 02-05 (Inspector) and 02-06 (Command Palette) can fill them in without any AppShell/layout changes; the overlay z-index stacking and `--inspector-width`/`--palette-*` tokens are already defined.
- The shell chrome is demoable end-to-end: mode switching, rail navigation, theme toggle (persists across reload), connection-status dot, and both bridged canvases all render correctly in light and dark themes with no double-scrollbar or cut-off edges.
- No blockers. One pre-existing (not introduced by this plan) latency note carried forward: `fetchGraph()` has no timeout against an unreachable backend — worth a timeout/AbortController in a later polish pass if dev-without-backend startup latency becomes a real annoyance, but out of scope here.

---
*Phase: 02-app-shell-routing-canvas-infrastructure*
*Completed: 2026-07-21*
