# Deferred Items — Phase 02

Out-of-scope discoveries logged during plan execution (SCOPE BOUNDARY: only
auto-fixed issues directly caused by the current task's changes; everything
else is logged here, not fixed).

## 02-06: Suspense pendingComponent crash — pre-existing, blocks live-browser verification

**Discovered during:** 02-06 Task 2 verification (attempting to manually
exercise the new CommandPalette in a running dev server / production build,
both themes, per the plan's human-check).

**Symptom:** The entire app renders a blank screen on every load, in both
`npm run dev` and a production `vite preview` build. Console shows:

```
Invariant failed: Could not find a nearest match!
  at useMatch (@tanstack/react-router)
  at useSearch (@tanstack/react-router)
  at useSelection (src/selection/useSelection.ts:30)
  at Inspector (src/shell/Inspector.tsx:40)
```

**Root cause:** `src/routes/__root.tsx`'s `RootPending()` (the router's
`pendingComponent`, shown while the root loader's `fetchGraph()` promise is
in flight — which is always, at least briefly, since it's a real network
call) renders `<AppShell>`. `AppShell` unconditionally mounts `<Inspector/>`,
which calls `useSelection()` → `useSearch({ strict: false })` → `useMatch()`.
`@tanstack/react-router`'s `Matches()` component only provides the
`matchContext` (which `useMatch` needs to resolve "the nearest match") to the
*primary* Suspense children (`<MatchesInner/>`), not to the `fallback`
element (`pendingElement = <PendingComponent/>`). Because `RootPending` is
passed as that `fallback`, its render tree — including AppShell → Inspector →
useSelection → useMatch — executes with no `matchContext` in scope, and
`useMatch` throws synchronously. With no error boundary around the pending
path, the whole React tree unmounts (or never mounts): the practical result
is a blank white page on essentially every load.

**Confirmed pre-existing:** Reproduced against `master` (i.e. with 02-06's
own changes reverted/stashed, using the 02-04 `CommandPalette` stub and
unmodified `shell.css`) via Playwright — identical crash, same stack trace,
in both `npm run dev` and a `vite build` + `vite preview` production build.
Not caused by 02-06's CommandPalette/search.ts work.

**Why not auto-fixed here:** The files involved (`src/routes/__root.tsx`,
`src/shell/AppShell.tsx`, `src/shell/Inspector.tsx`) are outside 02-06's
declared `files_modified`, and the correct fix is a small design decision
(e.g. give `AppShell` an optional "hide overlays" prop for the pending path,
or render a minimal pending skeleton that doesn't go through `AppShell`) that
belongs to whichever phase/plan owns the root loader + shell composition,
not a blind patch bolted on by an unrelated plan.

**Impact:** Blocks any live-browser (dev or built) verification of the app
today, including 02-06's own both-themes human-check for the command
palette. Worked around for 02-06 by adding
`src/shell/__tests__/CommandPalette.test.tsx` (mocked-router component test)
for functional coverage; the plan's own automated checks
(`npx vitest run src/shell/__tests__/search.test.ts`, `npm run build`) both
pass. The both-themes manual click-through from 02-06's `<verification>`
section is deferred until this blocker is fixed.

**Suggested fix (for whoever picks this up):** Either (a) don't render
`<AppShell>`/`<Inspector/>` in `RootPending()` — show a bare loading skeleton
instead, matching the "shell stays interactive" intent by only compositing
the shell once the first real match exists, or (b) wrap the Suspense
`fallback` in the same `matchContext.Provider` `MatchesInner` uses (harder —
would need a router-level change or a local workaround component), or (c)
give `useSelection()`/`Inspector` a guarded/optional-context read that no-ops
outside a router match, so it degrades instead of throwing.
