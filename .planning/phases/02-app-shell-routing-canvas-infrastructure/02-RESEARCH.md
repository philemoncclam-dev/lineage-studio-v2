# Phase 2: App Shell, Routing & Canvas Infrastructure - Research

**Researched:** 2026-07-21
**Domain:** React 19 SPA routing (TanStack Router), URL-addressable navigation state, left-rail application shell, non-modal overlay inspector, command palette (cmdk), and a pure-function decomposition of the existing `model.tsx` monolith
**Confidence:** MEDIUM-HIGH — package versions and peer-dependency compatibility are `[VERIFIED: npm registry]`; TanStack Router API shape is `[CITED: tanstack.com docs]`; the URL-resolution and selection-store design itself is original architecture authored for this phase (no external source — flagged where relevant)

## Summary

Phase 2 replaces `App.tsx`'s hand-rolled `useState<Mode>` + breadcrumb-array routing with **TanStack Router** (already locked in STACK.md/PROJECT.md), a **mode-based left-rail shell** (Datadog-style app-logo mode switcher + per-mode contextual rail), a **non-modal overlay inspector**, and a **cmdk-based command palette** — while keeping the existing `LineageView`/`GraphView` on screen, bridged onto the new layout, at every commit (SHELL-07, pitfalls #13/#14).

The router work is the technically riskiest part: TanStack Router v1.170.18 is current, peer-compatible with React 19.2.7 and Vite 8.1.1, and Zod 4.4.3 (already the version `@tanstack/router-plugin` itself depends on) can be passed to `validateSearch` **directly** — Zod v4 implements Standard Schema, so the `@tanstack/zod-adapter` package used in older tutorials is unnecessary. Selection state (`?sel`/`?col`, D-08) should be modeled as **typed search params on the mode-level route**, not a separate client state store — the URL search params *are* the selection store; a thin `useSelection()` hook wraps `Route.useSearch()` / `navigate({ search, replace: true })` so no state duplication exists between the URL and app state. This is the direct architectural answer to "the shared cross-canvas plumbing... both canvas rebuilds depend on."

`model.tsx`'s 228 lines decompose cleanly along its own internal comment boundaries (object-level ops, layered layout, column edges/transforms, knowledge-graph levels, upstream/downstream context) into `adapt.ts` (LineageGraph → normalized domain records, no pixel math), `lineageLayout.ts` (the depth/yCursor DAG placement), `graphLayout.ts` (the levels.estate/ws/lake topology builder — NOT the force simulation, which stays runtime-computed inside `GraphView.tsx`), and `domainColor.ts` (`colorFor`/`LAYER_COLOR`). This is a pure internal refactor with no new external dependency.

**Primary recommendation:** Adopt `@tanstack/react-router` + `@tanstack/router-plugin` (Vite plugin, file-based routing) with Zod 4 schemas passed directly to `validateSearch`; build the shell shell chrome from Radix primitives (`Dialog` via `cmdk`'s `Command.Dialog`, `DropdownMenu` for the mode switcher, `Tooltip` for icon-only rail buttons, `VisuallyHidden` for their accessible names) styled entirely through the existing tier-3 component tokens (`--seg-*`, `--tbtn-*`, `--panel-*`) — introduce zero new hex values and zero new state-management library.

## Architectural Responsibility Map

This is a pure-frontend SPA phase — no new backend endpoints, no SSR, no CDN tier. Every capability below lives entirely in the browser/client tier, reading data the app already fetches once (`fetchGraph`/`fetchPurviewGraph`) into the existing `AppModel`.

| Capability | Primary Tier | Secondary Tier | Rationale |
|------------|-------------|----------------|-----------|
| Mode/rail navigation & URL routing | Browser/Client | — | TanStack Router is a client-side router; this SPA has no SSR tier |
| Path-segment name→GUID resolution (D-07) | Browser/Client | — | Resolves against the already-loaded `LineageGraph` in memory; no new API call per navigation |
| Unresolvable-segment → nearest-ancestor fallback (D-09) | Browser/Client | — | Pure client-side route `beforeLoad`/`loader` logic over already-fetched data |
| Selection state (`?sel`/`?col`) | Browser/Client | — | D-08 makes the URL itself the store; no separate state layer |
| Inspector metadata card (D-12) | Browser/Client | — | Derived synchronously from the loaded `LineageGraph`/`AppModel`; no new fetch |
| Command palette search index | Browser/Client | — | Mirrors existing `SearchPalette.tsx`'s in-memory search over `AppModel` |
| Canvas token reads (theme-aware colour) | Browser/Client | — | `tokens/canvasTokens.ts` already exists; new shell chrome consumes CSS vars directly (DOM, not canvas), no JS token read needed for non-canvas chrome |
| Theme toggle control (new in this phase) | Browser/Client | — | Sets `data-theme` on `<html>`; Phase 1 wired the mechanism but shipped no control (see UI-SPEC.md Copywriting Contract) |
| Graph data fetch (`/graph`, `/purview/graph`) | API/Backend | Browser/Client (loader) | Unchanged existing FastAPI endpoints; this phase only moves *when* the fetch happens (into a router `loader`), not what it does |
| Purview toolkit placeholder pages (Push/Data Products) | Browser/Client | API/Backend (Phase 5) | Phase 2 ships honest placeholder pages; the real write path is Phase 5, unaffected here |

## Standard Stack

### Core

| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| `@tanstack/react-router` | **1.170.18** | Client-side router — typed path/search params, file-based route tree | Locked in `.planning/PROJECT.md`/`STATE.md` ("Typed search params matter here — drill path and selection live in the URL"). Peer-compatible with React `>=19.0.0` `[VERIFIED: npm registry]` |
| `@tanstack/router-plugin` | **1.168.23** | Vite plugin — generates `routeTree.gen.ts` from `src/routes/**` at dev/build time | Peer supports `vite: '>=8.0.0'` and pins `@tanstack/react-router: ^1.170.18` — confirms the two packages are version-matched `[VERIFIED: npm registry]` |
| `zod` | **4.4.3** | Search-param schema validation (`validateSearch`) | Already a peer dependency of `@tanstack/router-plugin` (`zod: '^4.4.3'`) — installing it satisfies both the router's own tooling and route-level validation with one package `[VERIFIED: npm registry]` |
| `cmdk` | **1.1.1** | Command palette primitive (Cmd+K) | Purpose-built for this exact pattern; already the STACK.md-recommended replacement for the hand-rolled `SearchPalette.tsx` keyboard/filter logic. `Command.Dialog` wraps a Radix `Dialog` internally, so no separate Dialog wiring is needed for the palette shell `[CITED: github.com/pacocoursey/cmdk]` |
| `@radix-ui/react-dialog` | **1.1.20** | Focus-trapped modal primitive | Transitive dependency of `cmdk`'s `Command.Dialog`; declare explicitly since D-17 mandates the palette is "rebuilt on the new token/component primitives" — not just whatever `cmdk` happens to bundle |
| `@radix-ui/react-dropdown-menu` | **2.1.21** | App-logo mode switcher (D-02) | Correct primitive for a click-triggered menu of destinations (Datadog-style product switcher) — `NavigationMenu` is for horizontal nav bars, not this pattern |
| `@radix-ui/react-tooltip` | **1.2.13** | Icon-only rail button labels (D-04) | Rail is icon-only + tooltips by design; Tooltip is the accessible mechanism, paired with `VisuallyHidden` for the persistent accessible name |
| `@radix-ui/react-visually-hidden` | **1.2.8** | Accessible names on icon-only rail buttons | Icon-only buttons need a real accessible name in addition to (not instead of) the hover tooltip — WCAG requirement the current `.tbtn`/`.search` pattern doesn't yet need to solve |

### Supporting

| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| `@radix-ui/react-popover` | **1.1.20** | Non-critical floating menus (e.g. rail-bottom cluster's connection-status detail) | Only if the rail-bottom cluster (D-05) needs a click-to-expand detail beyond a tooltip; not required for the inspector itself (see Anti-Patterns) |
| `@radix-ui/react-tabs` | **1.1.18** | Optional — only if a Purview toolkit sub-page genuinely needs in-page tabs | D-03 puts Push/Definitions/Data Products as **rail items**, not tabs — most likely unused in this phase; keep in the supporting tier, don't install speculatively |
| `@tanstack/react-router-devtools` | **1.167.0** | Dev-only router state inspector | Optional but cheap; helps verify search-param typing and route matches during the router migration itself |

### Alternatives Considered

| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| URL search params as the selection store | `zustand` (5.0.14, `[VERIFIED: npm registry]`, legit) | D-08/D-11 explicitly make selection *and* inspector visibility the same thing as the `?sel` param — a separate client store would duplicate state that already lives in the URL and risks drift between the two. Only reach for zustand if a later phase needs genuinely ephemeral cross-tree UI state that must NOT be URL-addressable (e.g. a transient hover preview) |
| `@radix-ui/react-dialog` for the inspector panel | Plain conditionally-rendered `<aside>` | D-10 requires the inspector to be a non-modal overlay that never disturbs canvas layout and doesn't block interacting with the canvas; Dialog's focus trap and modal scrim are wrong for this (see Anti-Patterns below) |
| `@tanstack/zod-adapter` (1.167.0) | Pass the Zod schema straight to `validateSearch` | Zod v4 implements Standard Schema, which TanStack Router consumes natively as of the current major version — the adapter package is legacy guidance from pre-Zod-v4 tutorials `[CITED: tanstack.com search-params docs, cross-verified via WebSearch]` |
| File-based routing (`@tanstack/router-plugin`) | Code-based routing (`createRoute` chains by hand) | File-based keeps route ↔ URL structure legible at a glance (important given D-06's "mirror the real Fabric hierarchy" constraint) and auto-generates the typed route tree; code-based is viable but adds manual wiring for no benefit at this app's size |

**Installation:**
```bash
npm install @tanstack/react-router zod cmdk @radix-ui/react-dialog @radix-ui/react-dropdown-menu @radix-ui/react-tooltip @radix-ui/react-visually-hidden
npm install -D @tanstack/router-plugin @tanstack/react-router-devtools
```

**Version verification:** All versions above were confirmed directly against the npm registry with `npm view <pkg> version` / `npm view <pkg> peerDependencies` on 2026-07-21 (see Package Legitimacy Audit for publish-date detail). `@tanstack/router-plugin`'s own `zod: '^4.4.3'` dependency was cross-checked against the `zod@4.4.3` install to confirm no version mismatch.

## Package Legitimacy Audit

Run via `gsd-tools query package-legitimacy check --ecosystem npm`. Every "SUS" verdict below carries the identical reason code `too-new` — **not** low download counts, missing repos, or absent packages. Inspecting the raw signals shows why: TanStack's router packages and every `@radix-ui/*` package were republished within the last 1–8 days of this research date (2026-07-13 through 2026-07-20) as part of each project's routine synchronized-release cadence (Radix, in particular, republishes its entire primitives monorepo on the same timestamp — five different Radix packages below all show `2026-07-20T00:36:xx`, seconds apart). Weekly download counts in the tens of millions and long-lived, matching GitHub org repos (`radix-ui/primitives`, `TanStack/router`) are the actual legitimacy signal here, and they are strong.

| Package | Registry | Publish Date (latest) | Weekly Downloads | Source Repo | Verdict | Disposition |
|---------|----------|------------------------|-------------------|-------------|---------|-------------|
| `@tanstack/react-router` | npm | 2026-07-13 | 22.1M | github.com/TanStack/router | SUS (too-new) | Approved — established package (routine release), planner adds `checkpoint:human-verify` before install per protocol |
| `@tanstack/router-plugin` | npm | 2026-07-19 | 20.3M | github.com/TanStack/router | SUS (too-new) | Approved — same reasoning; version-matched to `@tanstack/react-router` |
| `@tanstack/zod-adapter` | npm | 2026-05-15 | 265K | github.com/TanStack/router | OK | Not installed — superseded by direct Zod v4 Standard Schema support (see Alternatives Considered) |
| `zod` | npm | 2026-05-04 | 233.2M | github.com/colinhacks/zod | OK | Approved |
| `cmdk` | npm | 2025-03-14 | 41.7M | github.com/pacocoursey/cmdk | OK | Approved |
| `zustand` | npm | 2026-05-28 | 45.8M | github.com/pmndrs/zustand | OK | Not installed this phase — see Alternatives Considered |
| `@radix-ui/react-dialog` | npm | 2026-07-20 | 65.3M | github.com/radix-ui/primitives | SUS (too-new) | Approved — checkpoint:human-verify before install |
| `@radix-ui/react-dropdown-menu` | npm | 2026-07-20 | 54.3M | github.com/radix-ui/primitives | SUS (too-new) | Approved — checkpoint:human-verify before install |
| `@radix-ui/react-tooltip` | npm | 2026-07-20 | 54.5M | github.com/radix-ui/primitives | SUS (too-new) | Approved — checkpoint:human-verify before install |
| `@radix-ui/react-popover` | npm | 2026-07-20 | 53.9M | github.com/radix-ui/primitives | SUS (too-new) | Approved — checkpoint:human-verify before install (supporting-tier only) |
| `@radix-ui/react-tabs` | npm | 2026-07-20 | 55.3M | github.com/radix-ui/primitives | SUS (too-new) | Approved — checkpoint:human-verify before install (supporting-tier only, likely unused) |
| `@radix-ui/react-visually-hidden` | npm | 2026-07-20 | 62.4M | github.com/radix-ui/primitives | SUS (too-new) | Approved — checkpoint:human-verify before install |
| `vitest` | npm | 2026-07-06 | 79.3M | github.com/vitest-dev/vitest | SUS (too-new) | Approved for Wave 0 test tooling — checkpoint:human-verify before install |
| `@testing-library/react` | npm | 2026-01-19 | 47.6M | github.com/testing-library/react-testing-library | OK | Approved for Wave 0 |
| `@testing-library/jest-dom` | npm | 2026-07-20 | 53.3M | github.com/testing-library/jest-dom | SUS (too-new) | Approved — checkpoint:human-verify before install |
| `jsdom` | npm | 2026-04-30 | 82.2M | github.com/jsdom/jsdom | OK | Approved |

**Packages removed due to `[SLOP]` verdict:** none.
**Packages flagged as suspicious `[SUS]`:** `@tanstack/react-router`, `@tanstack/router-plugin`, all listed `@radix-ui/*` packages, `vitest`, `@testing-library/jest-dom` — all flagged solely on the `too-new` publish-date heuristic against packages with tens-of-millions weekly downloads and matching long-lived source repos. The planner must still insert a `checkpoint:human-verify` task before each `npm install` per protocol, but this is a low-risk class of flag (synchronized-release cadence, not a suspicious new/unknown package) — the human-verify step should be a fast confirmation, not a deep investigation.

*Package names above were discovered via a combination of the project's own prior `STACK.md` research, WebSearch, and training knowledge — all are tagged `[ASSUMED]` for provenance purposes regardless of the `OK`/`SUS` registry verdict, per the package-name provenance rule. The registry checks above confirm existence and health signals, not that these are the objectively-correct choices — that judgment is this document's own recommendation.*

## Architecture Patterns

### System Architecture Diagram

```
Browser URL (e.g. /graph/sales-ws/bronze-lh/raw_orders?sel=table:raw_orders)
        │
        ▼
┌─────────────────────────────────────────────────────────────┐
│ TanStack Router — matches path segments against file routes  │
│  __root.tsx → /graph/route.tsx → /graph/$workspace/...       │
└─────────────────────────────────────────────────────────────┘
        │ path params (readable names)      │ search params (?sel, ?col)
        ▼                                    ▼
┌───────────────────────────┐      ┌──────────────────────────────┐
│ Root loader/beforeLoad:    │      │ validateSearch (Zod schema):  │
│ fetchGraph() once, stash   │      │ sel?: string, col?: string    │
│ LineageGraph in router     │      │ parsed + typed on every route │
│ context (existing api.ts)  │      │ that can show a selection     │
└───────────────────────────┘      └──────────────────────────────┘
        │                                    │
        ▼                                    │
┌───────────────────────────┐                │
│ Segment resolver:          │                │
│ readable name → Purview    │                │
│ GUID, walking parent_id    │                │
│ chain in the loaded graph. │                │
│ Unresolved → redirect to   │                │
│ nearest ancestor + notice  │                │
│ (D-09)                     │                │
└───────────────────────────┘                │
        │                                    │
        ▼                                    ▼
┌─────────────────────────────────────────────────────────────┐
│ <AppShell> (__root.tsx)                                       │
│  ┌───────────┐ ┌──────────────────────────────────────────┐ │
│  │ App-logo  │ │ Top bar: carried-forward segmented control│ │
│  │ mode menu │ │ / buttons (D-16, existing .seg/.tbtn CSS) │ │
│  │(Dropdown) │ └──────────────────────────────────────────┘ │
│  ├───────────┤ ┌──────────────────────────────────────────┐ │
│  │ Mode rail │ │                                            │ │
│  │ (per-mode │ │   Canvas region — <Outlet/>                │ │
│  │ items,    │ │   Phase 2: bridged LineageView/GraphView   │ │
│  │ Tooltip)  │ │   (token bridge only, D-15)                │ │
│  │           │ │                                            │ │
│  │ ┄┄┄┄┄┄┄┄┄ │ │        ┌─────────────────────────────┐    │ │
│  │ Rail-     │ │        │ Inspector overlay (D-10):    │    │ │
│  │ bottom    │ │        │ renders iff useSelection()   │    │ │
│  │ cluster   │ │        │ .sel is set. Reads directly  │    │ │
│  │ (D-05):   │ │        │ from AppModel — no new fetch │    │ │
│  │ ⌘K trigger│ │        └─────────────────────────────┘    │ │
│  │ theme     │ └──────────────────────────────────────────┘ │
│  │ toggle    │                                                │
│  │ conn.     │                                                │
│  │ status    │                                                │
│  └───────────┘                                                │
└─────────────────────────────────────────────────────────────┘
        │ Cmd+K / rail-bottom search click
        ▼
┌─────────────────────────────────────────────────────────────┐
│ cmdk Command.Dialog (Radix Dialog underneath) — searches the │
│ already-loaded AppModel; on select, navigate({ to, params,   │
│ search: { sel }, replace: false }) — a real navigation, not  │
│ a selection-only update                                      │
└─────────────────────────────────────────────────────────────┘
```

A reader can trace the primary use case end to end: a pasted URL is parsed into path params (resolved against the loaded graph) and typed search params, both feed the shell's rail/canvas/inspector render, and the two write paths back into the URL — drilling (pushes history) versus selecting (replaces history, per D-08) — are visibly different arrows into the same router.

### Recommended Project Structure

```
frontend/src/
├── routes/                        # file-based route tree (Claude's discretion on
│   │                               # exact shape per CONTEXT.md; this is the
│   │                               # recommended default)
│   ├── __root.tsx                 # AppShell: logo/mode-menu, providers, <Outlet/>
│   ├── graph/
│   │   ├── route.tsx               # GraphRail layout + validateSearch(?sel,?col)
│   │   ├── index.tsx                # /graph — Estate level
│   │   └── $workspace/
│   │       ├── index.tsx            # /graph/$workspace
│   │       └── $lakehouse/
│   │           ├── index.tsx        # /graph/$workspace/$lakehouse
│   │           └── $table.tsx       # /graph/$workspace/$lakehouse/$table
│   ├── lineage/
│   │   ├── route.tsx               # LineageRail layout + validateSearch
│   │   └── $workspace.$lakehouse.$table.tsx
│   └── purview/
│       ├── route.tsx               # PurviewRail (Push / Definitions / Data Products)
│       ├── definitions.tsx          # hosts existing DefinitionsImport-derived view
│       ├── push.tsx                 # honest placeholder until Phase 5
│       └── data-products.tsx        # honest placeholder until Phase 5
├── routeTree.gen.ts                # generated by @tanstack/router-plugin — gitignore
├── shell/
│   ├── AppShell.tsx                 # top-level chrome composition
│   ├── ModeMenu.tsx                 # app-logo Radix DropdownMenu (D-02)
│   ├── Rail.tsx                     # generic icon rail (D-01/D-04), takes mode items
│   ├── RailBottomCluster.tsx        # ⌘K trigger / theme toggle / status (D-05)
│   ├── Inspector.tsx                # non-modal overlay panel (D-10/D-12)
│   └── CommandPalette.tsx           # cmdk-based rebuild of SearchPalette (D-17)
├── selection/
│   └── useSelection.ts              # thin hook over Route.useSearch()/navigate()
├── resolve/
│   └── resolvePathSegments.ts       # name→GUID resolution + ancestor fallback (D-07/D-09)
├── model/                            # decomposition of the current model.tsx
│   ├── adapt.ts                      # LineageGraph → normalized records
│   ├── lineageLayout.ts              # DAG depth/position placement (pure)
│   ├── graphLayout.ts                # levels.estate/ws/lake topology builder (pure)
│   ├── domainColor.ts                # colorFor()/LAYER_COLOR (pure)
│   └── index.tsx                     # AppModel type + ModelProvider/useModel (composition root)
├── tokens/canvasTokens.ts            # existing — unchanged, consumed as-is
└── views/                            # existing LineageView/GraphView — token-bridged in place
```

### Pattern 1: Search params as the single selection store (D-08, D-11)

**What:** Model `?sel`/`?col` as a Zod-validated search-param schema on the mode-level layout route (`graph/route.tsx`, `lineage/route.tsx`), not as component state or a separate store. A `useSelection()` hook wraps `Route.useSearch()` for reads and `navigate({ search: (prev) => ({ ...prev, sel, col }), replace: true })` for writes.

**When to use:** Any component that needs to know "what's selected" (inspector, canvas hover-sync, command palette) or set it (canvas click handlers, command palette `onSelect`).

**Example:**
```typescript
// Source: TanStack Router search-params + navigation docs
// https://tanstack.com/router/latest/docs/framework/react/how-to/setup-basic-search-params
// https://tanstack.com/router/latest/docs/framework/react/guide/navigation
import { z } from 'zod'
import { createFileRoute, useNavigate } from '@tanstack/react-router'

const selectionSchema = z.object({
  sel: z.string().optional(),
  col: z.string().optional(),
})

export const Route = createFileRoute('/graph')({
  validateSearch: selectionSchema, // Zod v4: pass the schema directly, no adapter needed
  component: GraphRailLayout,
})

// selection/useSelection.ts
export function useSelection() {
  const { sel, col } = Route.useSearch()
  const navigate = useNavigate()
  const select = (nodeId?: string, colKey?: string) =>
    navigate({
      search: (prev) => ({ ...prev, sel: nodeId, col: colKey }),
      replace: true, // selection never pushes a history entry (SHELL-06 vs D-08)
    })
  const clear = () => select(undefined, undefined)
  return { sel, col, select, clear }
}
```

### Pattern 2: Drill navigation pushes history; selection replaces it

**What:** Two distinct navigation intents must use two distinct `navigate()` calls — drilling into `/graph/$workspace/$lakehouse` is a real history entry (SHELL-06: "browser back/forward moves through drill-down levels correctly"); selecting a node/column on the current level is not (D-08: selection survives refresh/paste but shouldn't clutter history).

**When to use:** Any rail/breadcrumb/canvas interaction that changes which level of the drill hierarchy is showing versus which node is highlighted at the current level.

**Example:**
```typescript
// Source: https://tanstack.com/router/latest/docs/framework/react/guide/navigation
// Drilling — pushes history (default navigate behavior)
navigate({ to: '/graph/$workspace/$lakehouse', params: { workspace: wsName, lakehouse: lhName } })

// Selecting — replaces history (explicit replace: true, see Pattern 1)
navigate({ search: (prev) => ({ ...prev, sel: nodeId }), replace: true })
```

### Pattern 3: Non-modal overlay inspector (D-10)

**What:** The inspector is a conditionally-rendered `<aside>` positioned via CSS (fixed/absolute to the canvas's right edge), not a `Dialog`/`Popover`. It renders whenever `useSelection().sel` is set, and Esc/close-button/empty-canvas-click all resolve to the same `clear()` call from Pattern 1.

**When to use:** Always, for this inspector. Reserve Radix `Dialog` for genuinely modal flows (confirmation prompts, the command palette) where blocking interaction with the rest of the page is correct.

**Example:**
```tsx
// shell/Inspector.tsx — sketch, not literal final code
export function Inspector() {
  const { sel, clear } = useSelection()
  if (!sel) return null
  return (
    <aside className="inspector-overlay" role="complementary" aria-label="Selection details">
      <button onClick={clear} aria-label="Close inspector">×</button>
      {/* metadata card, D-12 */}
    </aside>
  )
}
// Esc handling: a single window keydown listener at the shell level calls
// clear() — do not duplicate per-canvas Esc handlers once the shell owns this.
```

### Pattern 4: cmdk command palette wired to real navigation, filtering disabled where the app already ranks results

**What:** `cmdk`'s `Command` auto-filters/sorts items by default. The existing `SearchPalette.tsx` already implements grouped, capped, kind-ordered ranking (`GROUP_ORDER`, `MAX_PER_GROUP`) that should be preserved (D-17 rebuilds the *chrome*, not necessarily the ranking logic). Pass `shouldFilter={false}` to `Command` and feed it the pre-filtered/pre-grouped result list from the existing `search()` function, or thread the query through and let `cmdk` filter only if the grouping/cap behavior is intentionally being replaced.

**When to use:** Building `CommandPalette.tsx` as the `SearchPalette.tsx` replacement.

**Example:**
```tsx
// Source: https://github.com/pacocoursey/cmdk (Command.Dialog pattern)
import { Command } from 'cmdk'

function CommandPalette({ open, onOpenChange }: { open: boolean; onOpenChange: (v: boolean) => void }) {
  return (
    <Command.Dialog open={open} onOpenChange={onOpenChange} shouldFilter={false} label="Search">
      <Command.Input value={query} onValueChange={setQuery} placeholder="Search tables, columns, notebooks, code…" />
      <Command.List>
        <Command.Empty>No matches</Command.Empty>
        {/* existing grouped search() output rendered as Command.Group/Command.Item */}
      </Command.List>
    </Command.Dialog>
  )
}
```

### Pattern 5: File-based route naming for the D-06/D-07 URL scheme

**What:** `$paramName.tsx` for dynamic display-name segments (`$workspace.tsx`, `$lakehouse.tsx`, `$table.tsx`); a pathless `route.tsx` per mode directory hosts the mode's rail + shared `validateSearch`; `__root.tsx` is the app shell.

**When to use:** Setting up `src/routes/` per the Recommended Project Structure above.

**Example:**
```typescript
// Source: TanStack Router file-based routing conventions
// https://tanstack.com/router/latest/docs/framework/react/routing/file-based-routing
// routes/graph/$workspace/$lakehouse/$table.tsx
export const Route = createFileRoute('/graph/$workspace/$lakehouse/$table')({
  loader: async ({ params, context }) => resolvePathSegments(context.graph, params),
  component: TableDetail,
})
```

### Anti-Patterns to Avoid

- **Wrapping the inspector in `Dialog`/`Popover`:** Both trap focus and/or render a modal scrim; D-10 explicitly requires the canvas to remain interactive while the inspector is open. Use a plain overlay `<aside>` (Pattern 3).
- **A separate `selectionStore` (zustand/context) duplicating the URL:** D-08/D-11 make the URL the single source of truth. A parallel store invites drift (selection shown but URL stale, or vice versa) — exactly the class of bug this phase's "shared cross-canvas plumbing" goal exists to prevent.
- **`navigate()` without `replace: true` for selection-only changes:** Produces one history entry per node click, making browser back essentially unusable (violates SHELL-06's actual intent even though it technically satisfies "back/forward exists").
- **Installing `@tanstack/zod-adapter`:** Unnecessary indirection now that Zod v4 implements Standard Schema; adds a dependency for something `validateSearch` accepts natively.
- **Building the mode switcher on `@radix-ui/react-navigation-menu`:** That primitive models a horizontal navigation bar with submenus, not a click-to-open switcher menu; `DropdownMenu` is the correct fit for D-02.

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Selection/inspector state sync | A custom pub-sub or context store mirroring the URL | `useSelection()` over `Route.useSearch()`/`navigate()` (Pattern 1) | The URL already is the state; a mirror store is pure duplicated-state risk with zero benefit |
| Command palette keyboard nav / fuzzy match | Extending `SearchPalette.tsx`'s hand-rolled `ArrowUp`/`ArrowDown`/`Enter` handling | `cmdk`'s built-in keyboard navigation and `Command.Item`/`Command.Group` | `cmdk` is purpose-built for exactly this widget and already handles loop/wrap, disabled items, and a11y roles that the hand-rolled version doesn't |
| Focus trap + Esc-to-close for the palette overlay | Manual `document.addEventListener('keydown', ...)` + manual focus restoration (current `SearchPalette.tsx` pattern) | `Command.Dialog` (wraps Radix `Dialog`) | Radix's Dialog primitive has already solved focus-trap, focus-restore-on-close, and `aria-modal` correctly; hand-rolling this is a known accessibility bug source |
| Icon-only button accessible names + hover labels | Manual `title` attribute or a custom tooltip `<div>` | `@radix-ui/react-tooltip` + `@radix-ui/react-visually-hidden` | `title` attributes have poor/inconsistent screen-reader support and no keyboard-accessible equivalent; Radix Tooltip handles both pointer and keyboard-focus triggering correctly |
| Route-tree/typed-param generation | Hand-writing a route config object with manual TS generics | `@tanstack/router-plugin`'s file-based generation | The generated `routeTree.gen.ts` keeps path/search param types in sync with the actual file tree automatically; hand-written route configs drift silently as routes are added |

**Key insight:** Every "don't hand-roll" item above is *already hand-rolled once* in the current codebase (`SearchPalette.tsx`'s custom keyboard nav, `App.tsx`'s manual `useState<Mode>` + breadcrumb array). This phase's job is specifically to retire those hand-rolled versions in favor of maintained primitives — that retirement is itself part of SHELL-01 through SHELL-07's intent, not incidental cleanup.

## Runtime State Inventory

This phase is a rename/refactor phase in the broad sense (retiring `App.tsx`'s shell, decomposing `model.tsx`, retiring `SearchPalette.tsx`) but touches no external stored state. Each category below was checked explicitly against the actual codebase and backend, not assumed:

| Category | Items Found | Action Required |
|----------|-------------|------------------|
| Stored data | None — the app has no database; the backend's `_last_graph` is an in-memory slot rebuilt from `/graph`/`/purview/graph` on every request, unaffected by frontend routing changes | None |
| Live service config | None — no external service (n8n, Datadog, etc.) holds configuration keyed by names this phase changes. Purview/Fabric API calls are unaffected; only the frontend's URL scheme and shell components change | None |
| OS-registered state | None — this is a browser SPA with no OS-level task/service registration | None |
| Secrets/env vars | None touched — `VITE_API_BASE` (`api.ts`) is read as-is; no env var name changes in this phase | None |
| Build artifacts | `routeTree.gen.ts` is a **new** generated artifact from `@tanstack/router-plugin` — must be added to `.gitignore` (it's regenerated by the Vite plugin on every dev/build run, not hand-edited) | Add to `.gitignore`; do not commit |

**Nothing found requiring migration in any of the first four categories** — verified against `backend/app/main.py`'s route surface (no persistence layer beyond the in-memory graph slot) and the frontend's own `api.ts` (no localStorage/sessionStorage usage prior to this phase — the new theme-toggle persistence, discussed in Common Pitfalls, is genuinely new state, not a rename of existing state).

## Common Pitfalls

### Pitfall 1: Selection clicks silently flood browser history
**What goes wrong:** Every node/column click calls `navigate()` without `replace: true`, so clicking through five nodes means five browser-back presses to return to the drill level you started from — SHELL-06 technically "works" (back/forward exists) but reads as broken.
**Why it happens:** TanStack Router's default `navigate()` pushes a history entry; `replace: true` is opt-in, easy to forget on a hot path like a canvas click handler.
**How to avoid:** Centralize all selection writes through the single `useSelection().select()` hook (Pattern 1), which always sets `replace: true`. Never call `navigate({ search: ... })` directly from canvas code.
**Warning signs:** Manual UAT clicking through several nodes then pressing back once does not return to the pre-selection state.

### Pitfall 2: The theme toggle doesn't exist yet — it's easy to assume Phase 1 shipped it
**What goes wrong:** Phase 1's `01-UI-SPEC.md` explicitly deferred the interactive theme-toggle control to Phase 2 ("there is no toolbar/rail to put it in yet") — only the `data-theme` attribute mechanism and CSS exist. A planner or executor skimming Phase 1's output might assume theming is "done."
**Why it happens:** The mechanism (CSS, cache invalidation, `MutationObserver`) is fully built and easy to mistake for the whole feature.
**How to avoid:** D-05 explicitly places the theme toggle in the rail-bottom cluster — treat it as new work in this phase's task list, including choosing a persistence strategy (localStorage is the obvious default; verify it against the OS `prefers-color-scheme` fallback already wired via `color-scheme: light dark` on `:root`).
**Warning signs:** No `localStorage` read/write exists anywhere in `frontend/src` before this phase (confirmed via grep) — if the shell ships without adding one, the user's theme choice won't survive a reload.

### Pitfall 3: Half-migrated shell reads as regression, not progress (Pitfall #14 from PITFALLS.md)
**What goes wrong:** New rail/mode-menu/inspector chrome ships using the new token vocabulary while `LineageView.tsx`/`GraphView.tsx` still render with old raw layout assumptions (e.g. assuming they own the full viewport under the old top bar), producing visibly broken proportions or double-scrollbars — worse than the pre-migration state.
**Why it happens:** Global chrome (rail, top bar, inspector) changes atomically, but the two canvases are large, complex components (their real rebuild is Phases 3–4) — there's an inherent window where the frame around them has changed shape and they haven't been told.
**How to avoid:** D-15's "token bridge only" is precisely the mitigation — as part of *this* phase, make `LineageView`/`GraphView` fill whatever new container the shell gives them (flex/grid sizing, not fixed pixel assumptions) without touching their internal rendering logic. Verify this at the end of the shell-wiring plan, not assumed.
**Warning signs:** A screenshot after wiring the new shell shows either canvas cut off, double-scrolling, or misaligned against the new rail/inspector edges.

### Pitfall 4: Unresolved URL segments causing a redirect loop or breaking back/forward
**What goes wrong:** D-09's "nearest existing ancestor" fallback, if implemented as a `beforeLoad` redirect, can loop if the ancestor itself also fails to resolve for a different reason, or can silently swallow legitimate back/forward navigation if the redirect uses `push` instead of `replace`.
**Why it happens:** TanStack Router's `redirect()` helper defaults to pushing a new history entry unless told otherwise; combined with a resolver bug, this can produce an ever-growing history chain.
**How to avoid:** Always resolve segments against the **root-loaded** `LineageGraph` snapshot (not a partially-loaded intermediate state), always use `redirect({ replace: true })` for the ancestor fallback so a bad paste doesn't itself become a back-button trap, and unit-test the resolver against a synthetic graph with at least one genuinely broken segment.
**Warning signs:** Pasting a URL with a typo'd table name causes more than one redirect hop, or causes the back button to require multiple presses to leave the resolved page.

### Pitfall 5: Light-mode chrome shipped unreviewed (standing discipline #12)
**What goes wrong:** New rail/mode-menu/inspector/palette chrome is built and eyeballed only in dark mode (the default dev environment), then ships with an untested light-mode rendering — collision risk is real given `--color-domain-silver`'s known-tight light-mode contrast margins already flagged in `STATE.md`.
**Why it happens:** Dark is the primary design direction and the default `data-theme` state during development; light mode requires deliberately toggling to check.
**How to avoid:** Per the phase description's explicit note ("Continues the standing light-mode-review discipline (#12) for all new shell chrome"), check every new component (rail, mode menu, inspector, palette) in both themes before considering a plan's UI work done — this is a lighter-weight check than Phase 6's dedicated THEME-07 audit, not a substitute for it.
**Warning signs:** No screenshot or manual check of the new shell exists in light mode before the plan is marked complete.

### Pitfall 6: `cmdk`'s default filtering fights the existing grouped/capped ranking
**What goes wrong:** If `Command` is used with its default `shouldFilter` behavior while also feeding it a pre-ranked, pre-grouped, capped result list (the existing `search()` logic in `SearchPalette.tsx`), `cmdk` re-sorts/re-filters on top of that ranking, silently reordering or dropping results the app already decided to show.
**Why it happens:** `cmdk`'s value proposition is "you render items, it filters and sorts them automatically" — that's exactly the wrong behavior when the app wants to keep its own ranking.
**How to avoid:** Pattern 4 above — pass `shouldFilter={false}` and drive `Command.List`'s children directly from the existing (or equivalently ported) `search()`/`GROUP_ORDER`/`MAX_PER_GROUP` logic.
**Warning signs:** Search results in the new palette appear in a different order than the old `SearchPalette.tsx` for the same query, or the per-kind grouping (Tables/Columns/Notebooks/Code) disappears.

## Code Examples

### Root loader providing the LineageGraph to all child routes
```typescript
// Source: TanStack Router router-context pattern, adapted to this app's existing api.ts
// routes/__root.tsx
import { createRootRouteWithContext, Outlet } from '@tanstack/react-router'
import { fetchGraph } from '../api'
import type { LineageGraph } from '../api'

interface RouterContext { graph: LineageGraph | null }

export const Route = createRootRouteWithContext<RouterContext>()({
  loader: async () => ({ graph: await fetchGraph().catch(() => null) }),
  component: () => (
    <AppShell>
      <Outlet />
    </AppShell>
  ),
})
```

### Path-segment resolver (D-07/D-09) — original design for this phase, no external source
```typescript
// resolve/resolvePathSegments.ts
// Resolves readable display-name path segments (workspace/lakehouse/table names)
// against the loaded LineageGraph's parent_id chain, returning Purview GUIDs.
// Unresolvable segments redirect to the nearest resolvable ancestor (D-09).
import { redirect } from '@tanstack/react-router'
import type { LineageGraph, LineageNode } from '../api'

export function resolveSegment(
  graph: LineageGraph,
  kind: LineageNode['kind'],
  name: string,
  parentGuid?: string,
): string | null {
  const match = graph.nodes.find(
    (n) => n.kind === kind && n.name === name && (parentGuid ? n.parent_id === parentGuid : true),
  )
  return match?.id ?? null
}

// In a route loader: on failure, redirect to the parent path with `replace: true`
// and surface the failed segment via a search param the shell reads as a
// non-blocking notice (D-09) — e.g. `?unresolved=raw_orders_typo`.
```

### Theme toggle (new in this phase)
```typescript
// shell/RailBottomCluster.tsx — sketch
const THEME_KEY = 'lineage-studio-theme'

function setTheme(theme: 'light' | 'dark' | null) {
  if (theme) {
    document.documentElement.setAttribute('data-theme', theme)
    localStorage.setItem(THEME_KEY, theme)
  } else {
    document.documentElement.removeAttribute('data-theme') // falls back to OS preference
    localStorage.removeItem(THEME_KEY)
  }
  // canvasTokens.ts's MutationObserver (already wired in main.tsx) picks up
  // the attribute change automatically — no manual invalidateCanvasTokens() call needed here.
}
```

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|---------------|--------|
| `useState<Mode>` + `useState<Crumb[]>` breadcrumb array (`App.tsx`, `GraphView.tsx`) | TanStack Router file-based routes with typed path/search params | This phase | Destination/drill-path/selection become URL-addressable (SHELL-05), satisfying refresh/paste/back-forward requirements the old approach structurally couldn't |
| `@tanstack/zod-adapter` wrapping a Zod schema for `validateSearch` | Zod schema passed directly (Standard Schema support) | Zod v4 / current TanStack Router | One fewer dependency; identical runtime behavior |
| Hand-rolled `SearchPalette.tsx` keyboard nav + `document.addEventListener` | `cmdk`'s `Command.Dialog` (Radix Dialog-backed) | This phase (D-17) | Correct focus-trap/restore and a11y roles "for free"; existing ranking logic ported, not lost |

**Deprecated/outdated:**
- `reactflow` (11.11.4, currently installed): not used by this phase directly, but note it is the deprecated name for `@xyflow/react` — Phase 3's concern, flagged here only because `App.tsx`'s current import list will be touched during this phase's shell rewrite; don't accidentally re-import from the old package name in new shell code.

## Assumptions Log

| # | Claim | Section | Risk if Wrong |
|---|-------|---------|---------------|
| A1 | The exact recommended route-tree file shape (`routes/graph/$workspace/$lakehouse/$table.tsx` etc.) is a sensible default, not verified against a real Fabric tenant's actual naming depth | Recommended Project Structure | Low — CONTEXT.md explicitly leaves "exact route tree shape... provided D-06–D-09 hold" to Claude's discretion; the planner can adjust without violating any locked decision |
| A2 | `cmdk`'s `shouldFilter={false}` + externally-ranked items is the right integration shape versus letting `cmdk` do its own fuzzy filtering | Pattern 4 / Pitfall 6 | Medium — if the planner instead wants `cmdk`'s built-in fuzzy search (a reasonable simplification, dropping the exact-substring `search()` logic), the palette's result ordering will differ from today's; worth an explicit decision, not silently inherited from this research |
| A3 | localStorage is the right persistence mechanism for the new theme toggle (no existing precedent in the codebase to confirm this convention) | Common Pitfalls, Pitfall 2 / Code Examples | Low — localStorage is the uncontroversial default for this exact use case; alternative (no persistence, always defer to OS) is also plausible if the user prefers that, worth confirming in planning |
| A4 | `@radix-ui/react-popover` is genuinely optional/deferrable this phase (supporting tier only) | Standard Stack, Supporting | Low — if the rail-bottom cluster's status indicator turns out to need click-to-expand detail rather than a tooltip, this becomes core-tier; cheap to add later since it's already vetted |

## Open Questions

1. **Does the rail-bottom cluster's "connection/backend status" (D-05) need live polling, or a one-time check at load?**
   - What we know: the existing `App.tsx` checks `fetchPurviewStatus()` once on mount and never re-checks.
   - What's unclear: whether Phase 2 should introduce periodic re-checking (e.g. on window focus) or preserve the existing one-shot behavior.
   - Recommendation: preserve the existing one-shot behavior for this phase (scope discipline per pitfall #13 — don't add unrequested polling); revisit only if a later phase's UAT surfaces staleness as a real problem.

2. **Exact Purview-mode rail item set and icons beyond Push/Definitions/Data Products.**
   - What we know: D-03 names these three as the toolkit skeleton; CONTEXT.md leaves exact icon choices to Claude's discretion.
   - What's unclear: whether any additional utility items (e.g. a raw JSON ingest fallback, mentioned in PROJECT.md as "existing") belong in this rail or stay elsewhere.
   - Recommendation: keep the Purview rail to exactly the three named items for this phase; the manual JSON ingest fallback is not named in SHELL/NAV requirements and shouldn't be relocated without an explicit decision.

## Environment Availability

| Dependency | Required By | Available | Version | Fallback |
|------------|------------|-----------|---------|----------|
| Node.js | Vite dev/build, `@tanstack/router-plugin` codegen | ✓ | v24.15.0 | — |
| npm | Package installation | ✓ | 11.12.1 | — |
| Vite | Existing build tool | ✓ | ^8.1.1 (installed) | — |
| `@tanstack/router-plugin` peer range | Vite plugin compatibility | ✓ | Peer accepts `vite: '>=8.0.0'` — satisfied | — |

**Missing dependencies with no fallback:** none — this phase's tooling is entirely npm-installable and already compatible with the installed toolchain.
**Missing dependencies with fallback:** none.

## Validation Architecture

### Test Framework
| Property | Value |
|----------|-------|
| Framework | **None currently exists for the frontend** — `frontend/package.json` has no test script, no `vitest`/`jest` dependency. Backend has `pytest` (`backend/pytest.ini`, `backend/tests/`), irrelevant to this phase. |
| Config file | none — see Wave 0 |
| Quick run command | `npx vitest run <file> --reporter=dot` (once Wave 0 installs it) |
| Full suite command | `npx vitest run` (once Wave 0 installs it) |

### Phase Requirements → Test Map
| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|--------|----------|-----------|-------------------|-------------|
| SHELL-01 | Rail lists top-level destinations; adding a 5th needs no structural change | unit (rail renders from a data array, not hardcoded JSX) | `npx vitest run src/shell/__tests__/Rail.test.tsx` | ❌ Wave 0 |
| SHELL-03 | Inspector opens on selection, closes without disturbing canvas layout | unit (selection hook + Inspector render logic) | `npx vitest run src/selection/__tests__/useSelection.test.ts` | ❌ Wave 0 |
| SHELL-05 | Destination/drill/selection survive refresh + paste | unit (resolver + validateSearch schema round-trip) | `npx vitest run src/resolve/__tests__/resolvePathSegments.test.ts` | ❌ Wave 0 |
| SHELL-06 | Back/forward moves through drill levels correctly | manual-only (justification: requires real browser history stack; TanStack Router's own test suite covers the router mechanics, this app only needs to verify `replace` vs push are used correctly at each call site, which the unit tests above cover indirectly by asserting `replace: true` is passed) | — | — |
| SHELL-07 | App remains usable/demoable at every commit | manual-only (justification: "demoable" is a human visual/UX judgment, not a mechanically testable assertion) | — | — |
| NAV-01 | Cmd+K opens palette searching tables/columns/code | unit (existing `search()` ranking logic, ported) | `npx vitest run src/shell/__tests__/CommandPalette.test.tsx` | ❌ Wave 0 |
| NAV-03 | Palette is fully keyboard-operable | manual-only (justification: keyboard-operability of a `cmdk`/Radix-Dialog composition is best verified by actually tabbing/arrowing through it; `cmdk`'s own test suite covers the primitive's internal keyboard handling) | — | — |
| D-07 (URL name→GUID resolution) | unit — pure function, ideal test target | `npx vitest run src/resolve/__tests__/resolvePathSegments.test.ts` | ❌ Wave 0 |
| D-09 (unresolvable → nearest ancestor) | unit — pure function with a synthetic broken-segment fixture | same file as above | ❌ Wave 0 |
| `model.tsx` decomposition (`adapt`/`lineageLayout`/`graphLayout`/`domainColor`) | unit — each is now a pure function, directly testable in isolation (impossible before this phase, since `model.tsx` mixed all four concerns in one 228-line function) | `npx vitest run src/model/__tests__/*.test.ts` | ❌ Wave 0 |

### Sampling Rate
- **Per task commit:** `npx vitest run <changed-test-file>`
- **Per wave merge:** `npx vitest run`
- **Phase gate:** Full suite green before `/gsd-verify-work`

### Wave 0 Gaps
- [ ] Install `vitest`, `@testing-library/react`, `@testing-library/jest-dom`, `jsdom` (all legitimacy-checked above; `vitest`/`@testing-library/jest-dom` are `[SUS]`-flagged solely on publish recency, see Package Legitimacy Audit)
- [ ] `vitest.config.ts` (or a `test` block in `vite.config.ts`) — none exists today
- [ ] `src/test/setup.ts` — jsdom + `@testing-library/jest-dom` matcher registration
- [ ] `src/resolve/__tests__/resolvePathSegments.test.ts` — covers D-07, D-09, SHELL-05
- [ ] `src/model/__tests__/adapt.test.ts`, `lineageLayout.test.ts`, `graphLayout.test.ts`, `domainColor.test.ts` — covers the `model.tsx` decomposition workstream, newly testable as a direct consequence of the decomposition itself
- [ ] `src/selection/__tests__/useSelection.test.ts` — covers SHELL-03/SHELL-06's `replace: true` contract
- [ ] `src/shell/__tests__/Rail.test.tsx`, `CommandPalette.test.tsx` — covers SHELL-01, NAV-01

*This phase has zero pre-existing frontend test infrastructure — every item above is new. Given the phase is largely pure-function-friendly (router search-param logic, the resolver, and the entire `model.tsx` decomposition are all pure functions with no DOM dependency), prioritize unit tests over component/DOM tests where the requirement allows it; reserve `@testing-library/react` for the handful of genuinely stateful component behaviors (Rail rendering from data, CommandPalette open/close wiring).*

## Security Domain

ASVS Level 1, `security_block_on: high` (`.planning/config.json`). This phase adds no authentication, no new backend endpoints, and no new write paths — the security surface is narrow.

### Applicable ASVS Categories

| ASVS Category | Applies | Standard Control |
|---------------|---------|-----------------|
| V2 Authentication | No | Unchanged — credentials remain environment-driven per PROJECT.md; this phase touches no auth code |
| V3 Session Management | No | No session state introduced; URL state is not session state |
| V4 Access Control | No | No new authorization boundary; existing conditional rendering (`hasPurview`) is a UX affordance, not a security control, and is unchanged in kind by this phase |
| V5 Input Validation | Yes | Zod (`validateSearch`) validates every search param before it reaches component code — this is the concrete new input-validation surface this phase introduces (URL search params are attacker-influenceable input, since they arrive via a pasted/shared link per SHELL-05) |
| V6 Cryptography | No | No cryptographic operations in this phase |

### Known Threat Patterns for this stack

| Pattern | STRIDE | Standard Mitigation |
|---------|--------|---------------------|
| Reflected content from an unresolved URL segment rendered as a "notice" (D-09) without escaping | Tampering / Information Disclosure (XSS-adjacent) | React's default JSX text-node rendering already escapes this — do not use `dangerouslySetInnerHTML` to render the "segment that didn't resolve" notice text; render it as a plain JSX text child |
| Open-redirect-shaped navigation from an untrusted `to`/`params` value | Tampering | Not applicable here — all `navigate()`/`redirect()` targets in this phase are constructed from the app's own route definitions and resolved graph node names, never from an arbitrary user-supplied absolute URL |
| Search-param type confusion (e.g. `?sel[]=x&sel[]=y` producing an array where a string is expected) | Tampering | Zod's `validateSearch` schema (Pattern 1) rejects/coerces malformed shapes per its `.catch()`/`.optional()` definitions rather than letting an unexpected shape reach component code unchecked |

## Sources

### Primary (HIGH confidence)
- npm registry (`npm view <pkg> version`, `npm view <pkg> peerDependencies`, `npm view <pkg> dependencies`) — direct authoritative version/compatibility checks for `@tanstack/react-router`, `@tanstack/router-plugin`, `@tanstack/zod-adapter`, `zod`, `cmdk`, `zustand`, all listed `@radix-ui/*` packages, `vitest`, `@testing-library/react`, `@testing-library/jest-dom`, `jsdom` — 2026-07-21
- `gsd-tools query package-legitimacy check --ecosystem npm` — registry existence, publish-date, weekly-download, and source-repo signals for the full package list above
- Local repo inspection — `frontend/src/App.tsx`, `model.tsx`, `tokens/canvasTokens.ts`, `styles/components.css`, `styles/tokens.css`, `views/*.tsx`, `api.ts`, `data.ts`, `main.tsx`, `package.json`, `vite.config.ts`, `tsconfig.app.json` (all read directly, current state confirmed)

### Secondary (MEDIUM confidence)
- [TanStack Router — Search Parameters guide](https://tanstack.com/router/latest/docs/framework/react/how-to/setup-basic-search-params) — `validateSearch`/`useSearch` shape, fetched via WebFetch
- [TanStack Router — Navigation guide](https://tanstack.com/router/latest/docs/framework/react/guide/navigation) — `replace`, `params`, function-updater `search` pattern, fetched via WebFetch
- [TanStack Router — File-Based Routing](https://tanstack.com/router/latest/docs/framework/react/routing/file-based-routing) — `$param`, pathless layout, catch-all conventions, fetched via WebFetch
- [cmdk (pacocoursey/cmdk)](https://github.com/pacocoursey/cmdk) — `Command.Dialog`, `shouldFilter`, component API, fetched via WebFetch
- [TanStack Router — Not Found Errors](https://tanstack.com/router/latest/docs/framework/react/guide/not-found-errors) and related `notFound()`/`beforeLoad` discussion, via WebSearch cross-referenced across TanStack's own docs and GitHub issue discussion — informed the D-09 resolver design (which is itself original architecture, not a documented TanStack pattern)
- WebSearch: "TanStack Router standard schema zod v4 validateSearch without zodValidator adapter" — cross-referenced Zod v4 Standard Schema support claim against TanStack's own search-params docs page

### Tertiary (LOW confidence)
- None presented as authoritative without the above cross-checks; the D-07/D-09 segment-resolution algorithm and the theme-toggle persistence design in Code Examples are original design for this phase (not sourced from any external doc) — flagged inline rather than mis-tagged as CITED/VERIFIED.

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH — every version/peer-compatibility claim verified directly against the npm registry
- Architecture: MEDIUM-HIGH — TanStack Router API shape confirmed against official docs; the selection-store/resolver design is original architecture for this specific app, reasoned from CONTEXT.md's locked decisions rather than copied from a reference implementation
- Pitfalls: MEDIUM — Pitfalls 1, 2, 4, 6 are derived directly from the mechanics of the recommended APIs (high confidence in the mechanism, inferred the failure mode); Pitfalls 3 and 5 are transcribed from this project's own prior `PITFALLS.md`/`STATE.md` research (HIGH confidence, already vetted)

**Research date:** 2026-07-21
**Valid until:** ~30 days (TanStack Router and Radix are both fast-moving but API-stable at this major-version level; re-verify exact patch versions at execution time given the observed near-daily release cadence)
