---
phase: 02-app-shell-routing-canvas-infrastructure
reviewed: 2026-07-22T00:00:00Z
depth: standard
files_reviewed: 8
files_reviewed_list:
  - frontend/src/model/ids.ts
  - frontend/src/model/__tests__/ids.test.ts
  - frontend/src/routes/__root.tsx
  - frontend/src/routes/__tests__/rootPending.test.tsx
  - frontend/src/shell/AppShell.tsx
  - frontend/src/shell/search.ts
  - frontend/src/shell/__tests__/search.test.ts
  - frontend/vite.config.ts
findings:
  critical: 0
  warning: 2
  info: 3
  total: 5
status: issues_found
---

# Phase 02: Code Review Report (gap-closure wave: CR-01 crash fix, WR-03/WR-04)

**Reviewed:** 2026-07-22T00:00:00Z
**Depth:** standard
**Files Reviewed:** 8
**Status:** issues_found

## Summary

This is a follow-up review scoped to the gap-closure wave for phase 02 (diff
base `14a4c57`, the commit immediately preceding this wave): the CR-01
pending-state crash fix (`__root.tsx` / `AppShell.tsx` / `rootPending.test.tsx`)
and the WR-03/WR-04 id-collision and notebook-index correctness fixes
(`ids.ts` / `search.ts`). It supersedes the prior phase-02 review's CR-01/
WR-03/WR-04 entries, which described the pre-fix state.

**CR-01 is now correctly fixed.** `RootPending` renders `AppShell` with
`overlays={false}`, which keeps the two match-context-dependent overlays
(`Inspector`/`CommandPalette`) unmounted during the router's Suspense
fallback while the router-*state*-only chrome (`ModeMenu`/`Rail`/
`RailBottomCluster`) stays mounted. `rootPending.test.tsx` is a genuine
regression test — it drives the actual `Route` object from `__root.tsx`
through a real pending render (via `createRouter`/`RouterProvider` with
`defaultPendingMs: 0`) rather than a hand-rolled substitute, so it would
actually catch a regression of this fix.

**WR-04 (`notebookIndex()` id resolution) is now correctly fixed.** It dedupes
by node id (not display name) and always resolves graph-only notebook nodes
through `nid(n.id)`, consistent with how `model.notebooks`,
`model.notebookCode`, and `model.ops` key their entries elsewhere (verified
against `adapt.ts:82` and `lineageLayout.ts:54`).

**WR-03, however, does not deliver on its own stated "collision-free"
guarantee.** The fix only special-cases interior `.` — it does not
special-case a raw id that already contains a literal `__` (double
underscore), which collides with the *encoded form* of an interior dot. This
is the same class of silent-collision bug WR-03 set out to fix, just moved to
a different, equally realistic pair of inputs (data-engineering naming like
`stg__orders` vs `stg.orders`). See WR-01 below — it also has a knock-on
effect on the newly-fixed WR-04 dedup logic (a `nid()` collision would cause
`notebookIndex()` to silently drop one of the two colliding notebooks from
search). `search.ts`'s `hl()` correctly avoids any HTML-string rendering path
(builds `<mark>` nodes via `createElement` only), satisfying the T-02-06
threat-register requirement.

## Warnings

### WR-01: `tid`/`nid` are still not collision-free — the fix only covers the one documented pair

**File:** `frontend/src/model/ids.ts:12`
**Issue:**

```ts
const sanitize = (s: string) => s.replace(/\./g, '__').replace(/[^\w-]/g, '_')
```

The fix encodes interior `.` as `__` specifically so it no longer collapses
onto a literal `_`. But this introduces a *new* collision: any raw id that
already contains a literal `__` now collides with an otherwise-distinct raw
id that has an interior `.` in the same position, because both sanitize to
the same output:

```
sanitize('raw__orders')  // no dots to encode, no non-word chars -> 'raw__orders'
sanitize('raw.orders')   // '.' -> '__'                            -> 'raw__orders'
```

So `tid('table.raw__orders')` and `tid('table.raw.orders')` both produce the
identical short id `raw__orders` — the exact silent-collision failure mode
WR-03 was written to fix, just moved to a different input pair. Double
underscores are a common data-engineering naming convention (e.g.
`stg__orders`, `dim__customer`), so this is not a far-fetched edge case for
real Fabric ids.

The same root cause means any two *other* punctuation characters that both
fall through to the generic `[^\w-]` -> `_` replacement still collide with
each other and with a literal `_` (e.g. `table.raw/orders` and
`table.raw_orders` both sanitize to `raw_orders`). The fix narrowed the
collision surface to exactly the one pair called out in the comment and test
suite; it did not eliminate collisions in general, despite the surrounding
comment ("the two diverge") and the `ids.test.ts` describe-block title
("collision-free short ids") both claiming otherwise.

This also undermines the WR-04 fix in this same wave: `notebookIndex()`
(`frontend/src/shell/search.ts:36-47`) now correctly dedups by `nid(n.id)`,
but if two distinct notebook ids collide under `nid()`, the second is
silently treated as "already seen" (`if (!seen.has(id))`) and dropped from
search results entirely rather than surfacing as two entries or an error —
so this is a live risk to the very fix the current wave shipped, not just a
theoretical concern in `ids.ts` alone.

**Fix:** Use an encoding that is provably injective, e.g. escape the escape
character itself before introducing the new token:

```ts
// Escape existing '_' first, then encode '.' distinctly, so no two
// distinct inputs can ever map to the same output.
const sanitize = (s: string) =>
  s.replace(/_/g, '_u').replace(/\./g, '_d').replace(/[^\w-]/g, '_')
```
(or equivalently: a percent-encode-style scheme, or append a short
deterministic hash of the full raw id as a disambiguating suffix). Add a test
case for a raw id containing a literal `__` colliding with an interior-dot
id, mirroring the existing `ids.test.ts` cases — the current suite's "every
produced id is DOM-safe" and "distinguishes interior '.' from literal '_'"
tests do not cover this and would not catch this regression.

### WR-02: Root loader swallows all graph-fetch failures with no visible signal

**File:** `frontend/src/routes/__root.tsx:16`
**Issue:**

```ts
loader: async () => ({ graph: await fetchGraph().catch(() => null) }),
```

Any failure (network error, a misconfigured/expired Fabric token producing a
401/403, a 500, a timeout, malformed JSON) is swallowed identically, and the
app silently falls back to `sampleModel()` (`__root.tsx:23`). There is no
`console.error`, no toast/banner, and nothing in the returned loader data that
lets `AppShell` or any other component tell "real Fabric lineage" apart from
"the fetch failed and this is the bundled sample fixture." For a data-lineage
tool specifically built to be trusted during incident/audit work, silently
substituting fabricated sample data for a failed live fetch — with zero
indication — is a real risk of misleading whoever is looking at the graph.
**Fix:** At minimum log the error, and thread a flag through so the shell can
render a visible indicator:

```ts
loader: async () => {
  try {
    return { graph: await fetchGraph() }
  } catch (err) {
    console.error('fetchGraph failed, falling back to sample model', err)
    return { graph: null }
  }
},
```

## Info

### IN-01: Notebook-node detection via substring match on a display field

**File:** `frontend/src/shell/search.ts:41`
**Issue:**

```ts
if (!n.sub?.includes('notebook')) continue
```

`GNode.sub` is a free-text display string (e.g. `'table · 4 cols'`,
`'2 lakehouses · 7 tables'`, `'notebook'`). Using `.includes()` rather than an
exact match to classify node *kind* is a fragile proxy — it happens to be
correct today because no other current producer's `sub` text contains the
substring `"notebook"`, but a future producer (e.g. a richer notebook
subtitle like `'notebook · 3 ops'`, which would still match, or an unrelated
node whose `sub` text later happens to include the word) would silently
change classification behavior. Note `n.c === 'notebook'` is not a safe
alternative either, since `'notebook'` is also a valid `ColorKey` reused for
unrelated nodes (`data.ts:68`'s `ws_mk` workspace node has `c: 'notebook'`),
so no field on `GNode` unambiguously identifies "is a notebook node" today.
**Fix:** Use exact equality against the literal constant:

```ts
if (n.sub !== 'notebook') continue
```
and longer-term, add a dedicated `kind`/`nodeKind` field to `GNode` at the
source (`graphLayout.ts`) so downstream consumers don't have to sniff a
display string at all.

### IN-02: Search trigger is a silent no-op during the pending (loading) state

**File:** `frontend/src/shell/AppShell.tsx:33-42, 50, 57`
**Issue:** Both the global Cmd/Ctrl+K listener (lines 33-42) and
`RailBottomCluster`'s `onOpenSearch` (line 50) call `setPaletteOpen(true)`
unconditionally, but `CommandPalette` is only rendered when `overlays` is
true (line 57). During `RootPending` (`overlays={false}`), a user pressing
Cmd+K or clicking the rail search button gets no feedback at all — the state
flips but nothing renders, and once the loader resolves and a fresh
`AppShell` instance mounts with `overlays=true`, that stale `paletteOpen`
state is gone anyway (separate component instance). Not a crash, just a
discoverable dead-end during the loading window.
**Fix:** Either short-circuit/disable the search trigger while `overlays` is
false, or show a lightweight inline affordance (e.g. "search available once
loaded") instead of silently doing nothing.

### IN-03: `routeFileIgnorePattern` only excludes `.test.tsx`, not `.test.ts`

**File:** `frontend/vite.config.ts:17`
**Issue:**

```ts
routeFileIgnorePattern: '\\.test\\.tsx$',
```

This is scoped narrowly to the one file that motivated it
(`rootPending.test.tsx`). A future non-JSX test file placed under
`src/routes` (e.g. `src/routes/__tests__/something.test.ts`) would not match
this pattern, and the router-plugin warning this change was meant to silence
would resurface.
**Fix:** Broaden slightly to cover both extensions: `'\\.test\\.tsx?$'`.

---

_Reviewed: 2026-07-22T00:00:00Z_
_Reviewer: Claude (gsd-code-reviewer)_
_Depth: standard_
