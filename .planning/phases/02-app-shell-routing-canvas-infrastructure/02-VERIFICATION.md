---
phase: 02-app-shell-routing-canvas-infrastructure
verified: 2026-07-22T07:14:26Z
status: gaps_found
score: 11/17 must-haves verified
behavior_unverified: 3
overrides_applied: 0
gaps:
  - truth: "The app remains usable and demoable at every commit — no window in which the rebuild leaves it broken or half-migrated (SHELL-07 / ROADMAP SC#6)"
    status: failed
    reason: "Confirmed, reproducible crash: the root route's Suspense pendingComponent (RootPending in src/routes/__root.tsx) renders <AppShell>, which unconditionally mounts <Inspector/> and <CommandPalette/>. Inspector calls useSelection() -> useSearch({strict:false}) -> useMatch(); CommandPalette calls getRouteApi('__root__').useLoaderData() -> also useMatch() internally. Both read React.useContext(matchContext), which @tanstack/react-router's Matches() component only provides to the Suspense *primary* children (MatchesInner), never to the fallback element (the pendingComponent). Verified by direct inspection of node_modules/@tanstack/react-router/dist/esm/{useSearch,useMatch,Matches}.js: Matches() passes `pendingElement` as Suspense `fallback`, sibling to (not descendant of) `matchContext.Provider` in MatchesInner. useMatch throws `Invariant failed: Could not find a nearest match!` when no matchContext is present and shouldThrow defaults true. Since the root loader's fetchGraph() is a real network call, the pendingComponent renders on effectively every load (dev and prod), producing a blank screen. This is independently documented in deferred-items.md (Playwright-reproduced, both npm run dev and vite preview) and flagged as CR-01 (Critical) in 02-REVIEW.md. 02-06-SUMMARY.md explicitly states this 'should be picked up before phase 02 is signed off, not carried into phase 3/4.'"
    artifacts:
      - path: "frontend/src/routes/__root.tsx"
        issue: "RootPending() (lines 36-44) renders <AppShell> unconditionally in the Suspense fallback slot"
      - path: "frontend/src/shell/AppShell.tsx"
        issue: "Unconditionally mounts <Inspector/> (line 46) and <CommandPalette/> (line 49), both of which call router hooks that require match context"
      - path: "frontend/src/shell/Inspector.tsx"
        issue: "useSelection() call (line 40) is unconditional at the top of the component"
      - path: "frontend/src/shell/CommandPalette.tsx"
        issue: "rootRoute.useLoaderData() call (line 41) is unconditional at the top of the component"
    missing:
      - "A fix along one of the documented options: (a) don't render <AppShell>/<Inspector>/<CommandPalette> in RootPending — a bare skeleton with no router-context-dependent children, or (b) give useSelection()/Inspector/CommandPalette a guarded read that no-ops outside a router match, or (c) wrap the pending fallback in the same matchContext.Provider MatchesInner uses"
  - truth: "Destination and drill path are URL-addressable: /graph, /lineage, /purview and the drill path /graph/{workspace}/{lakehouse}/{table} each render the correct level and survive a full page refresh (SHELL-05 / ROADMAP SC#3)"
    status: failed
    reason: "Confirmed: /graph/$workspace, /graph/$workspace/$lakehouse, and /graph/$workspace/$lakehouse/$table routes exist and are valid, non-crashing, refresh-safe URLs, but src/routes/graph/-GraphRouteView.tsx (the shared bridge every graph leaf route renders) reads none of the $workspace/$lakehouse/$table path params — it renders <GraphView onOpenLineage={...}/> only. GraphView.tsx manages its own drill state entirely internally (useState<Crumb[]> reset to Estate on every model change, src/views/GraphView.tsx line 21/24) and never calls navigate() when the user drills by clicking a node (drill() at line 29-33 only calls setPath/setQuery, no router call). Consequently every /graph/* URL renders the same Estate-rooted view regardless of the path segments, and clicking through the canvas to drill in never updates the URL at all. This is self-documented as a 'Known Limitation' in 02-03-SUMMARY.md, but ROADMAP.md and REQUIREMENTS.md both mark SHELL-05/SC#3 'Complete' without qualification."
    artifacts:
      - path: "frontend/src/routes/graph/-GraphRouteView.tsx"
        issue: "Ignores $workspace/$lakehouse/$table path params entirely; passes nothing to GraphView besides onOpenLineage"
      - path: "frontend/src/views/GraphView.tsx"
        issue: "Drill state (path/setPath, lines 21-34) is purely local React state; drill() never calls navigate(), so drilling in the graph canvas never changes the URL and browser back/forward has nothing to walk for graph-mode drill levels (also falsifies the SHELL-06 'drilling pushes a history entry' truth for this canvas)"
      - path: "frontend/src/resolve/resolvePathSegments.ts"
        issue: "Fully implemented and unit-tested (name->GUID resolution + nearest-ancestor redirect + notice), but grep confirms it is referenced only by itself and its own test file — never called from any route loader/beforeLoad"
    missing:
      - "Wire resolvePathSegments into a beforeLoad on the /graph/$workspace* routes (and drive GraphView's drill state from the resolved path, or accept this is genuinely deferred to the Phase 3/4 canvas rebuild and downgrade SHELL-05/SC#3's roadmap/requirements status from 'Complete' to reflect the graph-mode gap)"
  - truth: "An unresolvable path segment redirects (replace: true) to the nearest resolvable ancestor and surfaces the failed segment via a non-blocking notice param, never a redirect loop and never a hard error (D-09 / Pitfall 4, part of SHELL-05)"
    status: failed
    reason: "resolveSegment/resolvePathSegments implement and unit-test this behavior correctly in isolation (9 passing tests), but since no route calls them (see above), pasting a URL with a broken workspace/lakehouse/table name never redirects and never shows the documented notice anywhere in the running app — the promised D-09 behavior does not exist at runtime."
    artifacts:
      - path: "frontend/src/resolve/resolvePathSegments.ts"
        issue: "Unwired — see WR-01 in 02-REVIEW.md"
    missing:
      - "Same fix as above — wire the resolver into route loaders, or explicitly re-scope this truth to a later phase"
deferred: []
behavior_unverified_items:
  - truth: "The inspector overlay causes ZERO reflow of the canvas when opening/closing, and is visually correct in both light and dark theme (SHELL-03)"
    test: "Open the app, select a table/column on both LineageView and GraphView's TableDetail, confirm the canvas does not shift, in both themes"
    expected: "No layout shift; inspector renders correctly in both themes"
    why_human: "This is a visual/layout judgment; also currently blocked by the CR-01 blank-screen crash, which prevents any live-browser check at all until fixed. 02-05-SUMMARY.md self-reports this check was never performed (no headless browser tool available in that execution environment)."
  - truth: "The command palette is checked in BOTH light and dark theme and is fully keyboard-operable end-to-end in a live browser (NAV-03)"
    test: "Open Cmd+K, tab/arrow through results, Enter to select, Esc to close and confirm focus restores, in both themes"
    expected: "Full keyboard operability and correct focus-trap/restore from cmdk/Radix Dialog; correct visuals in both themes"
    why_human: "02-06-SUMMARY.md explicitly states this manual pass is blocked by the same CR-01 crash and was never performed; only a mocked-router component test exists as a substitute."
  - truth: "Both themes were checked for every new shell component before each plan was marked done (standing discipline #12)"
    test: "Re-run the both-themes visual check for Rail/ModeMenu/RailBottomCluster/Inspector/CommandPalette/Purview placeholders now, in a live browser"
    expected: "All shell chrome renders correctly in both themes with no regression"
    why_human: "02-04's both-themes Playwright screenshots were taken before Inspector (02-05) and CommandPalette (02-06) became real implementations that trigger CR-01; those earlier screenshots no longer represent the current app's runtime behavior, and no both-themes check has been possible since without hitting the crash."
human_verification:
  - test: "Open the app, select a table/column on both LineageView and GraphView's TableDetail, confirm the canvas does not shift, in both themes"
    expected: "No layout shift; inspector renders correctly in both themes"
    why_human: "Visual/layout judgment; blocked today by CR-01"
  - test: "Open Cmd+K, tab/arrow through results, Enter to select, Esc to close and confirm focus restores, in both themes"
    expected: "Full keyboard operability and correct focus-trap/restore from cmdk/Radix Dialog"
    why_human: "Requires a live browser; blocked today by CR-01"
  - test: "Re-verify both-themes visual correctness for all Phase 2 shell chrome once CR-01 is fixed"
    expected: "No visual regression versus the (now-stale) 02-04 screenshots"
    why_human: "The only prior both-themes evidence predates the code that currently crashes the app"
---

# Phase 2: App Shell, Routing & Canvas Infrastructure Verification Report

**Phase Goal:** Replace the flat top-bar view-switch and hand-rolled breadcrumb-array routing with a left icon rail, a URL-addressable router, and the shared cross-canvas plumbing (selection store, cached canvas-token reader, decomposed pure layout model) that both canvas rebuilds depend on — without ever leaving the app in a broken or half-migrated state.
**Verified:** 2026-07-22T07:14:26Z
**Status:** gaps_found
**Re-verification:** No — initial verification

## Goal Achievement

### Observable Truths

| # | Truth | Status | Evidence |
|---|-------|--------|----------|
| 1 | Persistent left icon rail, N config entries -> N buttons, canvas fills viewport, 5th destination = one-line edit (SHELL-01) | VERIFIED | `Rail.tsx` maps `railConfig[mode]` array (no hardcoded per-destination JSX); `railConfig.ts` holds per-mode arrays; `Rail.test.tsx` (4 tests) asserts button-count-equals-config-length + accessible names; all pass |
| 2 | Contextual right-hand inspector opens on selection, closes without disturbing canvas layout (SHELL-03) | ⚠️ PRESENT_BEHAVIOR_UNVERIFIED | `Inspector.tsx` is a `position`-based overlay (not `flex:none`, not wrapped in Radix Dialog/Popover), renders iff `sel` set, unit-tested (4 tests); the "zero reflow" + both-theme visual claim is unexercised by any test and blocked from live verification by Gap #1 (CR-01) |
| 3 | Destination, drill path, and selection all URL-addressable; survive refresh + paste; back/forward walks drill levels (SHELL-05/SHELL-06) | FAILED | Mode routes (`/graph`,`/lineage`,`/purview`) and `/lineage/$workspace/$lakehouse/$table` are genuinely URL-driven; but the Knowledge-Graph drill hierarchy (`/graph/$workspace/...`) is not — `GraphRouteView` ignores path params, `GraphView`'s drill state is local-only and never calls `navigate()`. See Gap #2/#3 |
| 4 | Existing top-bar button/segmented-control treatment carried forward unchanged (SHELL-04) | VERIFIED | `RailBottomCluster`/`ModeMenu` reuse `.search`/`.seg`/`.tbtn` classes per `02-REVIEW.md` file-by-file check; no parallel class names found |
| 5 | Cmd+K opens a fully keyboard-operable palette searching tables/columns/notebooks/code (NAV-01/NAV-03) | ⚠️ PRESENT_BEHAVIOR_UNVERIFIED | `CommandPalette.tsx` built on `cmdk`'s `Command.Dialog`, `shouldFilter={false}`, ported `GROUP_ORDER`/`MAX_PER_GROUP=8` verbatim (`search.ts`), no manual keydown/Arrow handlers (grep-confirmed); 49 unit tests pass. Live keyboard-operability/focus-restore unexercised by any test and blocked by Gap #1 (CR-01) |
| 6 | App remains usable/demoable at every commit — never broken or half-migrated (SHELL-07 / ROADMAP SC#6) | FAILED | Confirmed reproducible blank-screen crash on load (dev and prod) — see Gap #1 |
| 7 | Selection lives in typed `?sel`/`?col` search params, single `replace:true` write path (SHELL-05/D-08) | VERIFIED | `useSelection.ts`; `useSelection.test.ts` (4 tests) asserts `replace:true` + param merge; `grep -rn "navigate({ *search"` outside `useSelection.ts` finds no other selection writer |
| 8 | `resolvePathSegments` resolves readable names -> GUIDs with nearest-ancestor redirect fallback (D-07/D-09) | FAILED | Module fully implemented + 9 passing unit tests, but never called from any route — see Gap #3 |
| 9 | Backend-unreachable falls back to bundled sample model rather than blank/error screen (SHELL-07 empty edge) | ⚠️ PRESENT_BEHAVIOR_UNVERIFIED | `__root.tsx`'s loader logic (`fetchGraph().catch(() => null)` -> `sampleModel()`) is correct in isolation, but reaching that state still requires passing through the pendingComponent, which itself crashes per Gap #1 — so in practice the promised graceful-degradation UX is currently unreachable |
| 10 | Purview Push/Data Products are honest, CTA-free placeholders with locked copy (D-03, prohibitions) | VERIFIED | `push.tsx`/`data-products.tsx` contain the exact locked headings/body, no `<button>` present |
| 11 | Theme toggle sets `data-theme` + persists to `localStorage`, OS fallback on clear (D-05) | VERIFIED | `theme.ts` `setTheme`/`getTheme`/`initTheme`; `main.tsx` calls `initTheme()` pre-paint |
| 12 | Mode switching only via app-logo Radix DropdownMenu, current mode checkmarked (D-02) | VERIFIED | `ModeMenu.tsx` uses `@radix-ui/react-dropdown-menu` exclusively; no segmented control/rail-icon mode switch found |
| 13 | Model decomposition: four pure modules + index.tsx, `./model` import surface unchanged, `model.tsx` deleted (SHELL-07 workstream B) | VERIFIED | `src/model/{domainColor,lineageLayout,graphLayout,adapt,index.tsx}` all present; `src/model.tsx` absent; 17 parity unit tests pass; `npm run build` exits 0 |
| 14 | Esc / close button / empty-canvas click all resolve to the single `useSelection().clear()` path (D-11) | VERIFIED | `Inspector.tsx`'s Esc effect and close button both call `clear()`; `LineageView.tsx`/`GraphView.tsx` empty-click handlers (`e.target === e.currentTarget`) also call `clear()`; no duplicate Esc handler found |
| 15 | Toolchain foundation: exact audited package versions, Vitest/jsdom runner green, `routeTree.gen.ts` git-ignored (SHELL-07) | VERIFIED | `npm run build` exits 0; `npx vitest run` — 49/49 tests pass across 10 files; `.gitignore` contains `routeTree.gen.ts` |
| 16 | SearchPalette.tsx (hand-rolled keyboard nav) retired, not left dead in tree (D-17) | VERIFIED | `test ! -f frontend/src/views/SearchPalette.tsx` confirmed; `search.css` also absent |
| 17 | New shell components checked in both light/dark theme before each plan marked done (standing discipline #12) | ⚠️ PRESENT_BEHAVIOR_UNVERIFIED | 02-04's Playwright screenshots predate 02-05/02-06's changes that introduced CR-01; no both-theme check has been possible since without hitting the crash |

**Score:** 11/17 truths verified (3 present-but-behavior-unverified, 3 failed)

### Required Artifacts

| Artifact | Expected | Status | Details |
|----------|----------|--------|---------|
| `frontend/src/shell/Rail.tsx` | Data-driven icon rail | VERIFIED | Maps `railConfig[mode]`, Tooltip + VisuallyHidden per item |
| `frontend/src/shell/railConfig.ts` | Per-mode destination arrays | VERIFIED | 3 modes x 3 items, locked accessible-name text |
| `frontend/src/shell/ModeMenu.tsx` | Radix DropdownMenu mode switcher | VERIFIED | Checkmarks current mode, navigates on select |
| `frontend/src/shell/RailBottomCluster.tsx` | Cmd+K trigger, theme toggle, status dot | VERIFIED | Present, wired into `AppShell` |
| `frontend/src/shell/theme.ts` | `setTheme`/localStorage/OS fallback | VERIFIED | Exports `setTheme`, `getTheme`, `initTheme` |
| `frontend/src/shell/Inspector.tsx` | Non-modal overlay metadata card | VERIFIED (artifact) / ⚠️ (live behavior) | Substantive, wired, unit-tested; live no-reflow/both-theme claim unverified |
| `frontend/src/shell/CommandPalette.tsx` | cmdk Command.Dialog palette | VERIFIED (artifact) / ⚠️ (live behavior) | Substantive, wired, unit-tested; live keyboard-op claim unverified |
| `frontend/src/shell/search.ts` | Ported ranked/grouped/capped search | VERIFIED | `GROUP_ORDER`/`MAX_PER_GROUP=8`/`shouldFilter=false` preserved; has a known edge-case bug (WR-04, see Anti-Patterns) |
| `frontend/src/selection/useSelection.ts` | Single selection write path | VERIFIED | `replace:true` on every write, unit-tested |
| `frontend/src/resolve/resolvePathSegments.ts` | Name->GUID resolver + fallback | STUB-LIKE (unwired) | Fully implemented + tested in isolation, but ORPHANED at the application level — no caller anywhere outside its own test |
| `frontend/src/routes/__root.tsx` | Root loader + shell composition | VERIFIED (build) / FAILED (runtime) | Builds and type-checks; its `pendingComponent` is the site of the CR-01 crash |
| `frontend/src/model/*.ts` (4 modules + index) | Decomposed pure layout model | VERIFIED | All present, `model.tsx` deleted, 17 parity tests pass |
| `frontend/src/styles/components.css` (tier-3 tokens) | New shell tokens resolving to tier-2 semantics | VERIFIED | `--rail-width`, `--inspector-width`, `--status-dot-ok` etc. present, resolve to `var(--color-*/--spacing-*)`, no new raw hex |

### Key Link Verification

| From | To | Via | Status | Details |
|------|----|----|--------|---------|
| `Rail.tsx` | `railConfig.ts` | maps config array | WIRED | Confirmed by direct read |
| `AppShell.tsx` | `Inspector.tsx` / `CommandPalette.tsx` | mounts overlay components | WIRED (but see runtime failure) | Both mounted unconditionally; this unconditional mount is exactly what causes CR-01 in the pending-render path |
| `RailBottomCluster.tsx` | `theme.ts` | `setTheme` call on toggle | WIRED | Confirmed |
| `main.tsx` | `router.tsx` | `RouterProvider` | WIRED | `initCanvasTokenCache()` preserved |
| `routes/graph/route.tsx` / `routes/lineage/route.tsx` | `selectionSchema` | `validateSearch` | WIRED | Confirmed present on both mode routes |
| `resolve/resolvePathSegments.ts` | any route loader/`beforeLoad` | (expected) resolver call | **NOT_WIRED** | Grep across `frontend/src` finds zero callers outside the module and its own test file (WR-01) |
| `routes/graph/-GraphRouteView.tsx` | `views/GraphView.tsx` path params | (expected) drill state from URL | **NOT_WIRED** | Bridge component passes only `onOpenLineage`; no path param flows into GraphView's drill state |
| `CommandPalette.tsx` | `useSelection.ts` / navigation | real navigation on select | WIRED | `pick()` calls `navigate()` with `sel`/`col` for table/column results |
| `Inspector.tsx` / views | `useSelection.ts` | select/clear on click, Esc | WIRED | Confirmed via direct read of all three files |

### Data-Flow Trace (Level 4)

| Artifact | Data Variable | Source | Produces Real Data | Status |
|----------|---------------|--------|---------------------|--------|
| `Inspector.tsx` | `model` (via `useModel()`) | `ModelProvider` value = `adapt(graph)` or `sampleModel()` in `__root.tsx` | Yes | FLOWING |
| `CommandPalette.tsx` | `results` (via `search(model, query)`) | Same `useModel()` graph | Yes | FLOWING |
| `Rail.tsx` | `items` prop | `railConfig[mode]` static config | Yes (by design — static per-mode config) | FLOWING |
| `GraphRouteView.tsx` | drill level | GraphView's own internal `useState` | N/A — never reads route params | DISCONNECTED (URL params are dead inputs) |

### Behavioral Spot-Checks

| Behavior | Command | Result | Status |
|----------|---------|--------|--------|
| Frontend builds clean | `cd frontend && npm run build` | exit 0, all chunks emitted | PASS |
| Full unit-test suite | `cd frontend && npx vitest run --reporter=dot` | 10 files, 49 tests, all pass | PASS |
| `resolveSegment`/`resolvePathSegments` never called at runtime | `grep -rn "resolveSegment\|resolvePathSegments" frontend/src` | only `resolve/resolvePathSegments.ts` + its own test | CONFIRMED (gap, not a pass/fail of a feature) |
| CR-01 mechanism (Suspense fallback lacks `matchContext`) | Source read of `node_modules/@tanstack/react-router/dist/esm/{useSearch,useMatch,Matches}.js` | `Matches()` passes `pendingElement` as Suspense `fallback`, sibling to `MatchesInner`'s `matchContext.Provider`; `useMatch` throws when context absent and `shouldThrow` defaults true | CONFIRMED — independently reproduces the exact reported stack trace mechanism |
| Purview placeholders contain no CTA | Direct read of `push.tsx`/`data-products.tsx` | No `<button>`, exact locked copy present | PASS |
| GraphView drill never calls `navigate()` | `grep -n "navigate\|setPath\|onDrill" frontend/src/views/GraphView.tsx` | Only local `setPath`/`setQuery` calls, no router import used for drilling | CONFIRMED (gap) |

Live-browser checks (Playwright/manual) were not performed by this verifier beyond source-level confirmation, because the confirmed CR-01 crash means any such attempt would itself blank-screen — consistent with `deferred-items.md`'s own account of reproducing this exact failure via Playwright against both `npm run dev` and a `vite preview` production build.

### Requirements Coverage

| Requirement | Source Plan | Description | Status | Evidence |
|-------------|-------------|--------------|--------|----------|
| SHELL-01 | 02-04 | Persistent left icon rail, 5th destination = config edit | SATISFIED | Rail.tsx/railConfig.ts + passing unit tests |
| SHELL-02 | 02-04 | Canvas fills viewport, chrome recedes | SATISFIED (structurally) / live-check stale | `.shell-canvas` flex-fill verified in code; 02-04's live Playwright checks predate CR-01-introducing changes but the CSS itself is unchanged since |
| SHELL-03 | 02-05 | Contextual inspector opens/closes without reflow | NEEDS HUMAN | Mechanism present + unit-tested; "zero reflow" + both-theme visual claim unverified, blocked by CR-01 |
| SHELL-04 | 02-04 | Top-bar/segmented-control treatment carried forward | SATISFIED | `.seg`/`.tbtn`/`.search` reused, no parallel classes |
| SHELL-05 | 02-03 | Destination/drill/selection URL-addressable, survive refresh+paste | **BLOCKED** | Mode routes + lineage-table route are URL-driven; graph-mode drill hierarchy is not (GraphRouteView ignores path params); resolvePathSegments never wired |
| SHELL-06 | 02-03 | Back/forward moves through drill levels correctly | **BLOCKED** (partial) | True for selection (replace:true, tested); false for graph-mode drilling (never pushes history at all) |
| SHELL-07 | 02-01/02/03/04 | App remains usable/demoable at every commit, never broken | **BLOCKED** | Confirmed reproducible blank-screen crash (CR-01) present in current HEAD |
| NAV-01 | 02-06 | Cmd+K opens palette searching tables/columns/notebooks/code | SATISFIED (core) / minor bug | Core search ported+tested; `notebookIndex()` has two id-resolution bugs for graph-only/duplicate-named notebooks (WR-04, non-blocking edge case) |
| NAV-03 | 02-06 | Palette fully keyboard-operable | SATISFIED (mechanism) / NEEDS HUMAN (live) | No manual key handlers, cmdk/Radix Dialog owns keyboard nav; live end-to-end keyboard/focus-restore check blocked by CR-01 |

No orphaned requirements found — SHELL-01..07, NAV-01, NAV-03 all appear in at least one plan's `requirements` frontmatter and are cross-referenced above. Note that `.planning/REQUIREMENTS.md`'s traceability table currently marks all nine as "Complete," which this verification does not confirm for SHELL-05, SHELL-06, and SHELL-07.

### Anti-Patterns Found

| File | Line | Pattern | Severity | Impact |
|------|------|---------|----------|--------|
| `frontend/src/routes/__root.tsx` | 36-44 | `pendingComponent` renders full shell outside match context | 🛑 Blocker | Causes the CR-01 blank-screen crash on load (see Gap #1) |
| `frontend/src/resolve/resolvePathSegments.ts` | whole file | Fully built, tested, but dead code at the application level | 🛑 Blocker (for SHELL-05 truth) | The documented D-07/D-09 URL-resolution behavior does not exist in the running app |
| `frontend/src/views/GraphView.tsx` | 18-34, 194 | `drill`/`onDrill` callback not memoized; re-created every render; `GraphCanvas`'s simulation effect depends on it | ⚠️ Warning | Typing in the canvas-search box tears down and re-initializes the force simulation every keystroke (WR-02 in 02-REVIEW.md) — not a Phase-2 shell truth but a real regression risk for Phase 3/4 to inherit |
| `frontend/src/model/ids.ts` | 4-5 | `tid`/`nid` naive character substitution can collide two distinct Fabric node ids | ⚠️ Warning | Silent data-merge risk on real (non-sample) Fabric data; not exercised by the bundled sample graph |
| `frontend/src/shell/search.ts` | 29-41 | `notebookIndex()` dedupes by display name (not id) and its `notebookCode` fallback branch can never resolve to the correct `nid()`-mapped id | ⚠️ Warning | Selecting certain notebook/code search results can silently no-op or show "unknown" in the Inspector |
| `frontend/src/views/LineageView.tsx` | 32-35 | `useEffect` only sets `selected` when `focusColumn` is truthy, never resets it to `null` | ⚠️ Warning | A previously selected column stays highlighted after navigating to a table with no column focus |
| `frontend/src/routes/__root.tsx` | 16 | `loader` swallows every `fetchGraph()` failure silently, with no UI indicator of sample-vs-live data (`.src-chip` dead CSS, unused) | ⚠️ Warning | A user could be viewing demo data with zero indication their real Fabric graph failed to load |

(The above four ⚠️ Warning items are carried over from `02-REVIEW.md`'s independent code-review pass, WR-02 through WR-06, and were spot-checked directly against the source by this verifier rather than taken on faith.)

### Human Verification Required

### 1. Inspector no-reflow + both-theme visual check

**Test:** Once CR-01 is fixed, run `npm run dev`, select a table/column on both canvases, confirm the canvas does not shift when the inspector opens/closes, in both light and dark theme.
**Expected:** Zero layout shift; correct visuals in both themes.
**Why human:** Visual/layout judgment; currently blocked entirely by the CR-01 crash.

### 2. Command palette live keyboard-operability

**Test:** Once CR-01 is fixed, open Cmd+K, arrow through grouped results, Enter to select and land on the lineage canvas, Esc to close and confirm focus restores to the trigger — in both themes.
**Expected:** Full keyboard operability with correct cmdk/Radix-Dialog focus-trap/restore.
**Why human:** Requires a live, running browser session; blocked today by CR-01.

### 3. Full both-theme re-check of all Phase-2 shell chrome

**Test:** Re-run the standing both-themes discipline (#12) against Rail, ModeMenu, RailBottomCluster, theme toggle, Inspector, CommandPalette, and the Purview placeholders once CR-01 is fixed.
**Expected:** No visual regression versus 02-04's (now-stale) screenshots.
**Why human:** The only prior visual evidence (02-04's Playwright screenshots) predates the 02-05/02-06 changes that introduced the crash; nothing has verified the current app's actual rendered state since.

### Gaps Summary

This phase delivers substantial, well-tested infrastructure — the rail, mode menu, theme toggle, selection store, model decomposition, and command palette are all genuinely implemented and unit-tested, not stubs. However, three must-have truths tied directly to the phase's own stated goal are **not met in the current codebase**:

1. **The app crashes on load (CR-01).** The phase's goal text explicitly promises "without ever leaving the app in a broken or half-migrated state," and ROADMAP.md's own Success Criterion #6 requires the app remain "usable and demoable" at every commit. The current HEAD state blank-screens on essentially every page load (dev and production), because the root route's Suspense `pendingComponent` renders the full shell (including `Inspector`/`CommandPalette`, both of which now call router hooks) outside the router's match context. This is not a hypothetical risk — it is independently confirmed three ways in this verification: (a) `deferred-items.md`'s own Playwright reproduction, (b) `02-REVIEW.md`'s CR-01 finding, and (c) this verifier's own line-by-line trace through the installed `@tanstack/react-router` source proving the exact mechanism. The phase's own final plan (02-06-SUMMARY.md) states this "should be picked up before phase 02 is signed off" — the executor itself did not consider the phase safely closeable with this open.

2. **The Knowledge-Graph drill path is not URL-addressable.** `/graph/$workspace/$lakehouse/$table` routes exist and don't crash, but they are decorative: `GraphRouteView` never reads their params, and `GraphView`'s drill-in never calls `navigate()`. Refreshing a "drilled" graph URL always shows the Estate view, and browser back/forward has no history entries to walk for graph-mode drilling. This directly contradicts SHELL-05/SHELL-06 and ROADMAP Success Criterion #3, both of which are nonetheless marked "Complete" in REQUIREMENTS.md.

3. **The name→GUID resolver (D-07/D-09) is fully built and tested but never wired in.** The specific, plan-documented "bad pasted URL redirects to the nearest resolvable ancestor with a bounded notice" behavior does not happen anywhere in the running app.

Given these are foundational plumbing pieces that Phase 3 and Phase 4 (the canvas rebuilds) are explicitly said to depend on, and given the phase's own goal is precisely about not leaving the app broken, this phase should not be considered complete until at minimum Gap #1 (the crash) is resolved. Gaps #2/#3 are a real, scoped decision point: either wire the resolver + drive GraphView's drill state from the URL now, or explicitly re-scope SHELL-05/SHELL-06's "Complete" status to note the Knowledge-Graph canvas's drill hierarchy is deferred to Phase 4 (which does rebuild GraphView) — but that decision should be made explicitly, not left as an unmarked discrepancy between REQUIREMENTS.md and the actual code.

---

_Verified: 2026-07-22T07:14:26Z_
_Verifier: Claude (gsd-verifier)_
