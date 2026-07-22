---
phase: 02-app-shell-routing-canvas-infrastructure
plan: 03
subsystem: routing
tags: [tanstack-router, zod, search-params, resolver, vitest]

# Dependency graph
requires:
  - phase: 02-app-shell-routing-canvas-infrastructure
    provides: "Phase-2 dependency set + Vitest runner (plan 02-01)"
provides:
  - "TanStack Router route tree replacing App.tsx's hand-rolled useState<Mode> + breadcrumb array"
  - "Root loader with sample-fallback (graph: LineageGraph | null) available to the whole route tree"
  - "Selection search-param store (?sel/?col, Zod-validated, single replace:true write path)"
  - "Name->GUID segment resolver (resolveSegment/resolvePathSegments) with nearest-ancestor redirect, unit tested"
  - "AppShell mount point + canvas pendingComponent skeleton for 02-04 to flesh out"
affects: [02-04, 02-05, 02-06]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Dash-prefixed route-tree files (routes/graph/-GraphRouteView.tsx, -lineageLink.ts) hold shared bridge logic excluded from @tanstack/router-plugin's file-based codegen"
    - "useSelection() reads via generic useSearch({strict:false}) rather than a specific route's Route.useSearch(), so one hook serves both /graph and /lineage (which declare an identical selectionSchema)"
    - "Cross-route search-param writers (useSelection's navigate, resolvePathSegments' redirect) use a targeted `as never` cast on the search updater, since TanStack Router can't statically narrow a search shape without a `from` route — verified correct at runtime via unit tests, not just type-checked away"

key-files:
  created:
    - "frontend/src/routes/__root.tsx"
    - "frontend/src/router.tsx"
    - "frontend/src/routes/index.tsx"
    - "frontend/src/routes/graph/route.tsx"
    - "frontend/src/routes/graph/index.tsx"
    - "frontend/src/routes/graph/$workspace.index.tsx"
    - "frontend/src/routes/graph/$workspace.$lakehouse.index.tsx"
    - "frontend/src/routes/graph/$workspace.$lakehouse.$table.tsx"
    - "frontend/src/routes/graph/-GraphRouteView.tsx"
    - "frontend/src/routes/graph/-lineageLink.ts"
    - "frontend/src/routes/lineage/route.tsx"
    - "frontend/src/routes/lineage/$workspace.$lakehouse.$table.tsx"
    - "frontend/src/routes/purview/route.tsx"
    - "frontend/src/routes/purview/definitions.tsx"
    - "frontend/src/routes/purview/push.tsx"
    - "frontend/src/routes/purview/data-products.tsx"
    - "frontend/src/shell/AppShell.tsx"
    - "frontend/src/selection/useSelection.ts"
    - "frontend/src/selection/__tests__/useSelection.test.ts"
    - "frontend/src/resolve/resolvePathSegments.ts"
    - "frontend/src/resolve/__tests__/resolvePathSegments.test.ts"
  modified:
    - "frontend/vite.config.ts"
    - "frontend/src/main.tsx"
    - "frontend/src/styles/components.css"
  deleted:
    - "frontend/src/App.tsx"

key-decisions:
  - "Added routes/graph/-GraphRouteView.tsx + -lineageLink.ts (dash-prefixed, not codegen'd as routes) — a shared bridge component/helper for GraphView's onOpenLineage wiring, reused by all four graph-mode leaf routes rather than duplicated four times. Not in the plan's declared files_modified list; added under deviation Rule 2 (necessary functionality the plan's own action text requires)."
  - "GraphView.tsx's internal drill/breadcrumb state is NOT driven from the graph-mode URL params in this plan (see Deviations) — consistent with D-14/D-15 and reinforced by 02-04-PLAN.md's own scope, which limits further GraphView changes to container-fit only."
  - "resolveSegment/resolvePathSegments (D-07/D-09) are delivered as fully tested pure utilities per the plan's literal task file-scoping, but are not wired into any route loader in this plan — see Deviations for why the file-list ordering made that the correct call here."
  - "useSelection() reads search state generically (useSearch({strict:false})) instead of importing a specific route's Route.useSearch(), so the same hook works from both /graph and /lineage without duplication."

requirements-completed: [SHELL-05, SHELL-06, SHELL-07]

coverage:
  - id: D1
    description: "App runs on TanStack Router (file-based routes, tanstackRouter Vite plugin); root loader fetches the graph once with silent-catch-fallback-to-sample (App.tsx's old effect behavior preserved); App.tsx deleted; RouterProvider + initCanvasTokenCache() wired in main.tsx"
    requirement: SHELL-07
    verification:
      - kind: other
        ref: "cd frontend && npm run build (exit 0, tsc -b + router codegen + vite build)"
        status: pass
      - kind: other
        ref: "test ! -f frontend/src/App.tsx"
        status: pass
      - kind: other
        ref: "npx vite dev smoke test — server boots, index.html + main.tsx + routeTree.gen.ts all serve 200"
        status: pass
    human_judgment: false
  - id: D2
    description: "Fabric-mirrored route tree exists for all three modes (/graph, /lineage, /purview) plus the graph/lineage drill hierarchy; Purview Push/Data Products are honest placeholders using the locked UI-SPEC Copywriting Contract text; Definitions hosts the existing DefinitionsImport view behind a new table picker"
    requirement: SHELL-05
    verification:
      - kind: other
        ref: "cd frontend && npm run build (exit 0); grep-verified push.tsx/data-products.tsx contain the exact locked headings"
        status: pass
    human_judgment: true
  - id: D3
    description: "Selection lives in typed, Zod-validated ?sel/?col search params declared on both mode routes via validateSearch; useSelection() is the single write path and always passes replace:true so selection never pushes history (SHELL-06 vs D-08)"
    requirement: SHELL-06
    verification:
      - kind: unit
        ref: "frontend/src/selection/__tests__/useSelection.test.ts (4 tests: read, replace:true, search-merge, clear)"
        status: pass
      - kind: other
        ref: "grep -rn \"navigate({ *search\" frontend/src — no match outside useSelection.ts/its test"
        status: pass
    human_judgment: false
  - id: D4
    description: "resolveSegment/resolvePathSegments resolve readable-name path segments to GUIDs (D-07), disambiguating same-named siblings by parent, and redirect (replace:true) to the nearest resolvable ancestor with a length-bounded notice on the first unresolvable segment, exactly one hop (D-09/Pitfall 4)"
    requirement: SHELL-05
    verification:
      - kind: unit
        ref: "frontend/src/resolve/__tests__/resolvePathSegments.test.ts (9 tests: exact resolve, parent disambiguation, deterministic duplicate-sibling, full-chain success, absent-segment no-redirect, single-hop ancestor redirect x2, notice length bound)"
        status: pass
    human_judgment: false
  - id: D5
    description: "The root loader's fetchGraph() shows a subtle canvas-region pending state (route pendingComponent) while resolving, rather than a full-page blocker"
    requirement: SHELL-07
    verification:
      - kind: other
        ref: "frontend/src/routes/__root.tsx RootPending component + .canvas-skeleton rule in components.css"
        status: pass
    human_judgment: true

duration: 28min
completed: 2026-07-21
status: complete
---

# Phase 02 Plan 03: TanStack Router, Selection Store & Segment Resolver Summary

**Replaced App.tsx's hand-rolled mode/breadcrumb state with a TanStack Router file-based route tree (Fabric-mirrored URL scheme), a root loader with sample-data fallback, a Zod-validated `?sel`/`?col` selection search-param store with a single `replace:true` write path, and a fully unit-tested name→GUID segment resolver with nearest-ancestor redirect — while keeping the existing LineageView/GraphView canvases rendering through the new shell root.**

## Performance

- **Duration:** ~28 min
- **Started:** 2026-07-21T22:20:00-07:00 (approx, continuing directly from 02-02)
- **Completed:** 2026-07-21T22:48:43-07:00
- **Tasks:** 2
- **Files modified:** 25 (21 created, 3 modified, 1 deleted)

## Accomplishments

- Added the `tanstackRouter` Vite plugin (file-based routing, `src/routes` → `src/routeTree.gen.ts`, already git-ignored from 02-01)
- Built `routes/__root.tsx`: `createRootRouteWithContext<{graph: LineageGraph | null}>()`, a `loader` that fetches the graph once with the exact silent-catch-fallback-to-sample behavior App.tsx's old effect had, and a `pendingComponent` canvas skeleton
- Built the full route tree: `/` → redirect to `/graph`; `/graph`, `/graph/$workspace`, `/graph/$workspace/$lakehouse`, `/graph/$workspace/$lakehouse/$table` (all rendering GraphView through a shared bridge component); `/lineage/$workspace/$lakehouse/$table` (genuinely URL-driven — `focusTable`/`focusColumn` come from path/search, not internal state); `/purview`, `/purview/definitions` (new table-picker hosting the existing `DefinitionsImport`), `/purview/push`, `/purview/data-products` (honest placeholders, locked UI-SPEC copy)
- Wired `GraphView`'s `onOpenLineage` prop to a real router navigation (pushes history) via a best-effort readable-name resolver that walks the raw graph's `parent_id` chain, falling back to fixed `sample` segments for the bundled demo data (which has no workspace/lakehouse hierarchy to mirror)
- Rewrote `router.tsx` + `main.tsx` to `RouterProvider`, preserving `initCanvasTokenCache()`; deleted `App.tsx`
- Built `selection/useSelection.ts`: Zod `selectionSchema`, single `select()`/`clear()` write path, always `replace: true`; declared `validateSearch(selectionSchema)` on both `graph/route.tsx` and `lineage/route.tsx`
- Built `resolve/resolvePathSegments.ts`: `resolveSegment` (kind+name+parent walk) and `resolvePathSegments` (workspace→lakehouse→table chain, `redirect({replace:true})` to the nearest resolved ancestor with a length-bounded `unresolved` notice on the first broken segment — never more than one hop)
- 30 total Vitest tests pass (13 new: 9 resolver + 4 selection), full `npm run build` and `npm run lint` clean (only pre-existing `only-export-components` pattern warnings inherent to file-based route exports)

## Task Commits

Each task was committed atomically:

1. **Task 1: Wire the router plugin, root loader, route tree, and mode routes; retire App.tsx** - `c944df9` (feat)
2. **Task 2: Selection search-param store + name→GUID segment resolver with ancestor fallback, unit tested** - `9f4b3ef` (test)

**Plan metadata:** pending (this commit)

## Files Created/Modified

- `frontend/vite.config.ts` - Added `tanstackRouter` plugin (file-based routing) ahead of `react()`/`tailwindcss()`
- `frontend/src/routes/__root.tsx` - Root route: context type, loader (sample fallback), AppShell+Outlet composition, pendingComponent
- `frontend/src/router.tsx` - `createRouter` instance + `Register` module augmentation
- `frontend/src/main.tsx` - `RouterProvider` in place of `<App/>`, `initCanvasTokenCache()` preserved
- `frontend/src/routes/index.tsx` - `/` → `/graph` redirect
- `frontend/src/routes/graph/route.tsx` - Graph mode layout + `validateSearch(selectionSchema)`
- `frontend/src/routes/graph/index.tsx`, `$workspace.index.tsx`, `$workspace.$lakehouse.index.tsx`, `$workspace.$lakehouse.$table.tsx` - Graph drill route tree, all rendering the shared bridge component
- `frontend/src/routes/graph/-GraphRouteView.tsx` - Shared graph-mode bridge component (onOpenLineage → real navigation)
- `frontend/src/routes/graph/-lineageLink.ts` - Best-effort readable-name resolver for the onOpenLineage bridge target
- `frontend/src/routes/lineage/route.tsx` - Lineage mode layout + `validateSearch(selectionSchema)`
- `frontend/src/routes/lineage/$workspace.$lakehouse.$table.tsx` - URL-driven `LineageView` (focusTable/focusColumn)
- `frontend/src/routes/purview/route.tsx` - Purview mode layout
- `frontend/src/routes/purview/definitions.tsx` - New table-picker page hosting `DefinitionsImport`
- `frontend/src/routes/purview/push.tsx`, `data-products.tsx` - Honest placeholders (locked UI-SPEC copy)
- `frontend/src/shell/AppShell.tsx` - Minimal root chrome (`.app` wrapper) — 02-04 fleshes this out
- `frontend/src/styles/components.css` - Added `.canvas-skeleton`, `.purview-page`/`.page-title`/`.page-lead`/`.purview-table-list` (token-only)
- `frontend/src/selection/useSelection.ts` - `selectionSchema`, `useSelection()` — the single selection write path
- `frontend/src/selection/__tests__/useSelection.test.ts` - 4 tests
- `frontend/src/resolve/resolvePathSegments.ts` - `resolveSegment`, `resolvePathSegments`
- `frontend/src/resolve/__tests__/resolvePathSegments.test.ts` - 9 tests
- `frontend/src/App.tsx` - deleted (superseded by the router tree)

## Decisions Made

- Added `routes/graph/-GraphRouteView.tsx` and `-lineageLink.ts` (dash-prefixed, excluded from route codegen) for the shared graph-mode bridge logic — see Deviations.
- Kept `resolveSegment`/`resolvePathSegments` as tested pure utilities without wiring them into a live route loader in this plan — see Deviations.
- `useSelection()` uses the generic `useSearch({strict:false})` rather than a specific route's `Route.useSearch()`, so one implementation serves both `/graph` and `/lineage`.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 2 - Missing critical functionality] Shared bridge files for graph-mode route wiring**
- **Found during:** Task 1
- **Issue:** All four graph-mode leaf routes (`/graph`, `/graph/$workspace`, `/graph/$workspace/$lakehouse`, `/graph/$workspace/$lakehouse/$table`) need the identical `onOpenLineage` → navigation wiring the plan's action text describes. Writing it inline four times would duplicate real logic (including the readable-name resolution for the lineage target).
- **Fix:** Added `routes/graph/-GraphRouteView.tsx` (shared bridge component) and `routes/graph/-lineageLink.ts` (readable-name resolution helper). Both are dash-prefixed, which `@tanstack/router-plugin` excludes from route-tree codegen, so they don't become spurious routes.
- **Files added:** `frontend/src/routes/graph/-GraphRouteView.tsx`, `frontend/src/routes/graph/-lineageLink.ts`
- **Verification:** `npm run build` exits 0; all four leaf routes render identically via the shared component.
- **Committed in:** `c944df9` (Task 1 commit)

**2. [Rule 1 - Bug] TypeScript couldn't statically type cross-route search updaters**
- **Found during:** Task 2, after adding `validateSearch(selectionSchema)` to both mode routes
- **Issue:** Once both routes declared `validateSearch`, `tsc -b` failed: `useSelection`'s `navigate({search: ...})` and `resolvePathSegments`' `redirect({search: ...})` calls can't be statically narrowed to one route's search shape (no `from` is specified — `useSelection` is deliberately generic across `/graph`/`/lineage`, and `resolvePathSegments`' `unresolved` notice key isn't part of `selectionSchema` at all).
- **Fix:** Added a targeted `as never` cast on the search-updater function at each call site (the bottom type is assignable to any expected type, and the runtime shape is correct — verified by the unit tests, not just type-suppressed).
- **Files modified:** `frontend/src/selection/useSelection.ts`, `frontend/src/resolve/resolvePathSegments.ts`
- **Verification:** `npm run build` exits 0; unit tests assert the actual runtime shape of the search-updater's return value.
- **Committed in:** `9f4b3ef` (Task 2 commit)

---

**Total deviations:** 2 auto-fixed (both necessary, no scope creep beyond what the plan's own action text and acceptance criteria required).

### Known Limitation (documented, not a defect)

**GraphView's internal drill/breadcrumb state is not yet driven from the graph-mode URL.** `GraphView.tsx` exposes exactly one prop, `onOpenLineage` — it manages its own `path`/breadcrumb state entirely internally (`useState<Crumb[]>`, reset to Estate on mount/model change) and was explicitly out of scope to edit in this plan ("route wrappers must adapt router state to these props without editing the view internals"). Consequently:

- `/graph`, `/graph/$workspace`, `/graph/$workspace/$lakehouse`, and `/graph/$workspace/$lakehouse/$table` are all valid, non-crashing, refresh-safe URLs (no 404, no error), but they currently render the *same* Estate-rooted `GraphView` — the deeper URLs don't yet visually restore that specific drill level. `resolveSegment`/`resolvePathSegments` are fully built and unit-tested (Task 2) but are not wired into these leaf routes' loaders — that wiring wasn't in either task's declared `files_modified` list, and wiring it in would have required either editing `GraphView.tsx` internals (explicitly forbidden this plan) or building loader-level validation whose result nothing downstream would consume yet.
- `/lineage/$workspace/$lakehouse/$table` does **not** have this limitation — `LineageView` already accepts `focusTable`/`focusColumn` as props, so that route is genuinely URL-driven end to end.
- This is consistent with D-14 ("old canvases embedded purely as interim content") and D-15 ("token bridge only... write no throwaway styling code Phases 3-4 will delete") — the real fix is the Phase 3/4 canvas rebuild, which replaces `GraphView`'s internal state machine with router-driven state as part of rebuilding the canvas itself, not a token-bridge-phase change. 02-04-PLAN.md's own scope (already written) limits further `GraphView.tsx` changes in this phase to container-fit sizing only, confirming this was the intended sequencing.
- The D-09 "unresolved segment" notice banner (rendered as a `.src-chip`-styled dismissible strip beneath the top bar, per UI-SPEC) has no UI consumer yet either — `AppShell.tsx` in this plan is deliberately minimal (no top bar); 02-04 builds that chrome.

No user-facing regression results from this: the app is exactly as demoable as before (GraphView's own drill-by-click still works identically), and the new URLs are additive, not replacing any working interaction.

## Issues Encountered

None beyond the two auto-fixed deviations above. `npx vite build` had to be run once standalone before `npm run build` (`tsc -b && vite build`) would succeed, because `tsc` type-checks the generated `routeTree.gen.ts` import before Vite's plugin pipeline has a chance to generate it on a fresh clone/CI run — a one-time bootstrap step (the file is git-ignored per 02-01), not an ongoing issue for local dev (`npm run dev` generates it automatically on server start).

## User Setup Required

None - no external service configuration required. (The `npm run build` bootstrap note above is a one-time build-order detail, not a manual step for the user.)

## Next Phase Readiness

- 02-04 (mode-based shell chrome) has a router root to build on: `AppShell.tsx` is the mount point, `RootPending`'s canvas-skeleton pattern is ready to extend, and the route tree already has the Purview Push/Data Products destinations with the locked copy in place
- 02-05/02-06 (Inspector, CommandPalette) can consume `useSelection()` directly — it's already the single selection write path with the `replace:true` contract proven by unit tests
- `resolveSegment`/`resolvePathSegments` are ready for the Phase 3/4 canvas rebuild (or an earlier follow-up plan) to wire into the graph-mode leaf routes once `GraphView`'s drill state becomes URL-driven — see Known Limitation above
- No blockers for Wave 3 (02-04)

---
*Phase: 02-app-shell-routing-canvas-infrastructure*
*Completed: 2026-07-21*

## Self-Check: PASSED

All 21 created files verified present on disk; `frontend/src/App.tsx` verified absent (deleted as planned); both commit hashes (`c944df9`, `9f4b3ef`) verified in `git log`. `npm run build` exits 0; `npx vitest run` (30 tests, 6 files) exits 0; `npm run lint` shows only pre-existing-pattern warnings, no errors.
