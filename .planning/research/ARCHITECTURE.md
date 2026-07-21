# Architecture Research

**Domain:** Full frontend rebuild — dark-first data lineage visualization app (React 19 + TS + Vite), brownfield against a stable FastAPI/pydantic backend
**Researched:** 2026-07-20
**Confidence:** HIGH (grounded directly in the existing codebase — `App.tsx`, `model.tsx`, `api.ts`, `GraphView.tsx`, `LineageView.tsx`, `App.css` were read in full) / LOW-MEDIUM on general 2026 ecosystem claims (router choice, state-library choice) sourced from web search and marked accordingly

## Standard Architecture

### System Overview

```
┌──────────────────────────────────────────────────────────────────────────┐
│  Shell (IconRail + Router outlet + Inspector) — src/shell/, src/app/     │
│  ┌────────┐  ┌──────────────────────────────────┐  ┌──────────────────┐ │
│  │IconRail│  │        Destination (routed)        │  │  Inspector        │ │
│  │(5 dest)│  │  lineage | graph | purview-push |   │  │ (context-driven,  │ │
│  │        │  │  definitions | [future 5th]         │  │  reads selection) │ │
│  └───┬────┘  └──────────────┬───────────────────┘  └─────────┬──────────┘ │
│      │                      │                                 │            │
│      └──────────────┬───────┴────────────────┬────────────────┘           │
│                      ▼                        ▼                            │
│            state/selectionStore.ts   state/uiStore.ts   (Zustand)          │
│                      │                        │                            │
├──────────────────────┴────────────────────────┴───────────────────────────┤
│  Canvas layer — src/destinations/{lineage,graph}/, src/shared/canvas/      │
│  ┌──────────────────────────┐        ┌───────────────────────────┐        │
│  │ LineageCanvas (DOM+SVG)  │        │ ForceCanvas (Canvas 2D)   │        │
│  │ - table cards, col edges │        │ - constellation, drill-in │        │
│  └────────────┬──────────────┘        └────────────┬────────────┘        │
│               │  shared: selection.ts, trace(), layout primitives          │
│               │  shared: useCanvasTokens() ← design/theme.ts               │
├───────────────┴──────────────────────────┬───────────────────────────────┤
│  Model layer — src/model/                 │  Design layer — src/design/    │
│  adapt.ts → lineageLayout.ts / graphLayout.ts │ tokens.css → semantic.css   │
│  (pure, no React, no rendering)            │ → theme.ts (ThemeProvider)     │
├─────────────────────────────────────────────┴─────────────────────────────┤
│  Server state — src/shared/api/ (TanStack Query wrapping existing api.ts)  │
│  useGraph() · usePurviewStatus() · usePurviewGraph() · usePushLineage()    │
│  useApplyDefinitions() · useCatalogDataProduct()                            │
└───────────────────────────┬─────────────────────────────────────────────┘
                             │ HTTP / JSON (LineageGraph, WriteResult — unchanged)
┌───────────────────────────▼─────────────────────────────────────────────┐
│  FastAPI backend (NOT rebuilt) — /graph, /purview/*, /ingest              │
└───────────────────────────────────────────────────────────────────────────┘
```

The backend, the `LineageGraph`/`WriteResult` contracts, and the Purview/Fabric
integration layers are fixed points. Everything above the HTTP line is what
this research concerns.

### Component Responsibilities

| Component | Responsibility | Typical Implementation |
|-----------|----------------|-------------------------|
| **IconRail** | Renders top-level destinations from a static registry; owns nothing about their content | Config-driven list (`destinations.ts`), highlights active route |
| **Router outlet** | Owns which destination is mounted and its URL-addressable sub-state (drill level, focused node/column) | TanStack Router (recommended) or React Router v7 |
| **Inspector** | Contextual right panel; renders based on current selection, not current destination | Reads `selectionStore`, switches inner component by selected node's `kind` |
| **selectionStore** | Cross-canvas hover/selection/trace state, read by both canvases + inspector | Zustand store, selector-based subscriptions |
| **uiStore** | Theme, rail collapse state, panel open/closed flags — session-only UI state | Zustand store (small, separate from selectionStore) |
| **LineageCanvas** | Renders the column-level DAG: table cards (DOM), column edges (SVG overlay) | DOM absolute-position + `getBoundingClientRect` measurement (existing pattern, keep it) |
| **ForceCanvas** | Renders the knowledge-graph constellation: force-directed nodes/links | Raw `<canvas>` 2D context + custom simulation loop (existing pattern, keep it) |
| **model/adapt.ts** | Pure `LineageGraph → normalized domain model` (tables, notebooks, ops, colEdges, xform) — **no layout, no colour** | Function, no React/DOM dependency, unit-testable |
| **model/lineageLayout.ts** | Longest-path depth layout for the DAG | O(n+e) pass, pure function `(model) → positions` |
| **model/graphLayout.ts** | Force-directed simulation step + knowledge-graph level construction | Pure function `(nodes, links) → nodes'`; same shape a Web Worker would need |
| **design/theme.ts** | Theme state (`data-theme` attribute), `useThemeTokens()` snapshot for canvas consumers | Small provider + memoized token snapshot, invalidated on theme change only |
| **shared/api** | TanStack Query hooks wrapping the *existing* `api.ts` fetch functions | `useQuery`/`useMutation`, no change to `api.ts` itself needed |
| **usePurviewPush** | State machine: scope → preview → confirm → execute → results | Reducer/hook wrapping a generic `useWritePipeline()` |

## Recommended Project Structure

```
frontend/src/
├── main.tsx                        # unchanged: mounts <App/>
├── app/
│   ├── App.tsx                     # shell composition only — no business logic
│   ├── router.tsx                  # route tree, one route per destination
│   └── providers.tsx               # ThemeProvider + QueryClientProvider + Router composed
├── design/                         # NEW — the token/theme layer (Q1)
│   ├── tokens.css                  # primitive tokens: --slate-900, --indigo-400, raw scale
│   ├── semantic.css                # semantic tokens: --color-surface, --color-edge-reads, [data-theme] blocks
│   ├── theme.ts                    # data-theme controller + useThemeTokens() for canvas
│   ├── typography.css              # self-hosted variable font, type scale
│   └── fonts/                      # woff2 files, self-hosted (Windows-safe)
├── shared/
│   ├── api/
│   │   ├── client.ts                # HTTP layer, moved from api.ts, unchanged contracts
│   │   ├── types.ts                 # LineageGraph/WriteResult mirrors (unchanged)
│   │   └── queries.ts               # TanStack Query hooks wrapping client.ts
│   ├── ui/                          # primitives: Button, Panel, Pill, SegmentedControl, Kbd, Toast, Spinner
│   ├── canvas/                      # NEW — shared canvas infra (Q5)
│   │   ├── useCanvasTokens.ts       # cached CSS-var snapshot for Canvas 2D contexts
│   │   ├── selection.ts             # shared hover/selected/traced shape + trace() graph-walk
│   │   └── viewport.ts              # shared pan/zoom/hit-test helpers
│   └── hooks/                       # useKeyboardShortcut, useMediaQuery, etc.
├── state/                           # NEW — the two Zustand stores (Q4)
│   ├── selectionStore.ts            # { hoveredId, selectedId, tracedIds } — cross-canvas
│   └── uiStore.ts                   # theme, rail state, inspector open/collapsed
├── model/                           # decomposed from today's model.tsx (Q5)
│   ├── adapt.ts                     # LineageGraph -> normalized model, no layout/colour
│   ├── lineageLayout.ts             # DAG longest-path layout
│   ├── graphLayout.ts               # force-sim + knowledge-graph level construction
│   └── domainColor.ts               # colorFor(layer) -> semantic domain token
├── destinations/                    # one folder per rail item (Q3) — add a 5th by adding a folder
│   ├── registry.ts                  # Destination[] — id, icon, label, route, lazy component
│   ├── lineage/
│   │   ├── LineageDestination.tsx
│   │   ├── LineageCanvas.tsx
│   │   ├── ColumnEdgeLayer.tsx
│   │   └── lineage.css
│   ├── graph/
│   │   ├── GraphDestination.tsx
│   │   ├── ForceCanvas.tsx
│   │   ├── Breadcrumbs.tsx
│   │   └── graph.css
│   ├── purview-push/                # NEW first-class destination (Q6)
│   │   ├── PurviewPushDestination.tsx
│   │   ├── steps/
│   │   │   ├── ScopeSelect.tsx
│   │   │   ├── Preview.tsx
│   │   │   ├── Confirm.tsx
│   │   │   └── Results.tsx
│   │   ├── usePurviewPush.ts        # the scope→preview→confirm→execute→results state machine
│   │   └── purview-push.css
│   └── definitions/
│       ├── DefinitionsDestination.tsx
│       ├── DefinitionsImport.tsx    # logic mostly carries over from today's file
│       └── definitions.css
├── inspector/
│   ├── Inspector.tsx                # switches on selection.kind
│   ├── TableInspector.tsx
│   ├── ColumnInspector.tsx
│   └── inspector.css
├── shell/
│   ├── IconRail.tsx
│   ├── SearchPalette.tsx            # carries over near-unchanged
│   └── shell.css
└── sample/
    └── data.ts                      # bundled demo dataset, unchanged role
```

### Structure Rationale

- **`design/` is separated from `shared/ui/`:** tokens are consumed by both CSS
  and raw Canvas 2D JS; primitives (Button, Panel) are CSS/DOM-only. Keeping
  them apart means the canvas code only ever imports `design/theme.ts`, never
  a component library.
- **`destinations/` replaces `views/` 1:1 with the rail's mental model,** not
  an arbitrary type-based split. Each destination folder is self-contained
  (component + its own canvas/steps + its own CSS) — colocation-by-feature,
  not colocation-by-file-type. This is deliberately *not* full Feature-Sliced
  Design (entities/features/widgets/pages layering): at this app's size
  (single team, roughly 20-30 components total), FSD's layering is net
  overhead. Web research on FSD vs colocation converges on the same
  threshold: FSD earns its cost past several teams or many features;
  colocation is the pragmatic default below that (LOW confidence, general
  web consensus, not project-specific — see Sources).
- **`state/` is small and purpose-built, not a general store.** Only
  cross-cutting, high-frequency, multi-consumer state lives there (see Q4
  below). Everything else stays local or in `shared/api` query cache.
- **`model/` has zero React/DOM imports.** This is what makes both canvases
  swappable, testable, and (later, if ever needed) worker-portable — layout
  functions take plain data in, return plain data out.

## Architectural Patterns

### Pattern 1: Three-tier token layer, CSS as source of truth, JS as a read-only mirror

**What:** Primitive tokens (raw values: `--slate-900: #0c0e18`) feed semantic
tokens (`--color-surface: var(--slate-900)`), which is what components and
canvas code actually reference. Semantic tokens are re-assigned inside
`[data-theme="dark"]` / `[data-theme="light"]` blocks — the *names* never
change between themes, only the *values*. This is already how `App.css`
works today (`--bg`, `--accent`, `--bronze`… redefined under
`:root[data-theme="light"]`/`[data-theme="dark"]`) — the rebuild's job is to
split that single 134-line file into primitive/semantic layers and extend
the palette (the milestone's stated problem: bronze/notebook collapse
together at low luminance, `#4f5bd5` is a light-mode accent). Component
tokens (e.g. `--node-card-radius`) are optional and only introduced where a
component genuinely needs a value no semantic token expresses.

**When to use:** Always, for this app — dark+light parity is a stated
requirement, and CSS custom properties are the only mechanism that gives
both DOM/CSS and (via `getComputedStyle`) Canvas 2D a single source of truth
without duplicating the palette in a `.ts` file that CSS also has to import.

**Trade-offs:** A JS-side color constants file (`colors.ts`) would be
type-safe and avoid `getComputedStyle` calls, but then the palette exists in
two places and dark/light parity requires editing both in lockstep — exactly
the drift risk this milestone is trying to eliminate. CSS-vars-as-truth
costs a small runtime read (see Pattern 2) but keeps one file per theme
concern.

**Example (semantic layer over primitives):**
```css
/* design/tokens.css — primitives, theme-agnostic */
:root {
  --slate-950: #0c0e18; --slate-50: #f7f8fb;
  --indigo-400: #8b93f0; --indigo-600: #4f5bd5;
  --amber-500: #e0a05c; --violet-400: #a78bfa;
}

/* design/semantic.css — roles, swapped per theme, names never change */
:root[data-theme="dark"] {
  --color-bg: var(--slate-950);
  --color-accent: var(--indigo-400);       /* NOT --indigo-600 — the milestone's
                                               explicit finding: #4f5bd5 reads as
                                               a light-mode accent */
  --color-domain-bronze: var(--amber-500);
  --color-domain-notebook: var(--violet-400);
}
:root[data-theme="light"] {
  --color-bg: var(--slate-50);
  --color-accent: var(--indigo-600);
  --color-domain-bronze: #d98a3a;
  --color-domain-notebook: #8b5cf6;
}
```

### Pattern 2: Canvas reads the same tokens through a cached JS snapshot, not per-frame `getComputedStyle`

**What:** `GraphView.tsx` already solves "how does canvas code read theme
colours" — `const cssVar = (k) => getComputedStyle(document.documentElement).getPropertyValue('--' + k).trim()`
— and calls it per-node, per-link, **inside the `draw()` function that runs
every animation frame**. This is the right idea (CSS vars are the only
color source, canvas never hardcodes a hex) executed in a way that costs a
style recalculation on every call. Formalize the *pattern* but fix the
*cost*: read all needed tokens once (on mount, and again only when
`data-theme` changes), cache them in a plain object, and have the draw loop
read the cached object.

**When to use:** Any Canvas 2D (or WebGL) surface in this app. SVG elements
(as `LineageView`'s edge overlay already does) do **not** need this — SVG
is real DOM, so `stroke="var(--color-edge-reads)"` works natively with zero
JS.

**Trade-offs:** The cache must be invalidated when theme changes. Cheapest
correct approach: a `MutationObserver` on `document.documentElement`
watching the `data-theme` attribute, or simpler, have `design/theme.ts`'s
theme-setter function call a re-snapshot directly (it already owns the only
code path that flips `data-theme`, so no observer is even needed).

**Example:**
```ts
// shared/canvas/useCanvasTokens.ts
const TOKEN_KEYS = ['color-accent', 'color-surface', 'color-domain-bronze', /* … */] as const

export function readTokens(): Record<typeof TOKEN_KEYS[number], string> {
  const cs = getComputedStyle(document.documentElement)
  return Object.fromEntries(TOKEN_KEYS.map((k) => [k, cs.getPropertyValue('--' + k).trim()])) as any
}

// design/theme.ts — the ONLY place data-theme is ever written
export function setTheme(theme: 'dark' | 'light') {
  document.documentElement.dataset.theme = theme
  uiStore.getState().setTokens(readTokens())   // re-snapshot once, here, not per-frame
}
```
Both `ForceCanvas` and any future canvas subscribe to `uiStore`'s cached
token object, not to `getComputedStyle` directly.

### Pattern 3: `model/` is layout-and-colour-free; canvases are consumers, not owners, of layout

**What:** Today's `model.tsx` does five things in one function: normalizes
the graph, computes DAG depth layout, assigns colours, builds
knowledge-graph drill levels, and computes per-table up/downstream context.
Split by concern (see Recommended Project Structure). Both canvases then
*consume* a layout result (`{ id, x, y }[]`) rather than computing their own
positions inline — `ForceCanvas`'s simulation and `LineageCanvas`'s
longest-path placement both move into `model/`, leaving the canvas
components responsible only for rendering and interaction (hover, drag,
click-to-drill, pan/zoom).

**When to use:** Immediately, as the first step before either canvas is
touched — both canvas rebuilds depend on this split existing first.

**Trade-offs:** Slightly more indirection than "compute positions inline in
the component," but this is what makes the layout functions unit-testable
without a DOM, and is the same shape needed if a layout ever has to move to
a Web Worker (see Scaling Considerations).

## Data Flow

### Request Flow (server state, unchanged transport, new client-side layer)

```
[User opens Purview-push destination]
    ↓
[usePurviewPush hook] → [TanStack Query mutation] → [shared/api/client.ts fetch] → [FastAPI /purview/lineage/push]
    ↓                                                                                        ↓
[step: 'previewing']                                                          [apply:false — same code path,
                                                                                 dry-run, returns WriteResult]
    ↓
[Preview.tsx renders WriteResult.operations]
    ↓ (user clicks Confirm)
[step: 'executing'] → [same mutation, apply:true] → [FastAPI executes against Purview]
    ↓
[Results.tsx renders WriteResult.ok / .errors / .responses]
```

### State Management

```
Server state (TanStack Query cache)          Client/UI state (Zustand)
    /graph, /purview/status, /purview/graph      selectionStore: hoveredId, selectedId, tracedIds
    pushLineage, applyDefinitions,                uiStore: theme, railCollapsed, inspectorOpen
    catalogDataProduct (as mutations)
        ↓ read by                                     ↓ read by (selector hooks)
  destinations/* via useQuery/useMutation      LineageCanvas, ForceCanvas, Inspector (all three,
                                                 independently, without re-rendering each other)

URL state (router search/path params) — owns: active destination, drill path
(ws/lakehouse/table), focused node/column. Router is authoritative for
anything that should be shareable or back/forward-able; Zustand is for
session-only interaction state (hover, theme, panel collapse) that has no
business being in a URL.
```

### Key Data Flows

1. **Graph load:** `useGraph()` (TanStack Query) fetches `/graph` on mount,
   feeds `model/adapt.ts` → normalized model → `model/lineageLayout.ts` +
   `model/graphLayout.ts` produce positioned data → canvases render it. This
   is the same shape as today's `fetchGraph().then(adapt)`, just with
   caching/retry/loading-state handled by the query layer instead of manual
   `useState`.
2. **Cross-canvas selection:** user hovers a node in `ForceCanvas` →
   `selectionStore.setHovered(id)` → `Inspector` (subscribed to that slice)
   re-renders with the node's detail → if the user drills into a table and
   switches to the Lineage destination, `LineageCanvas` reads the same
   `selectedId` on mount and pre-highlights/traces it. Neither canvas
   re-renders on the other's *hover* (only on `selectedId`, which changes
   far less often) — this is the specific case Zustand's selector
   subscriptions solve that Context's broadcast model does not (see
   Anti-Patterns, below).
3. **Purview push:** described above — pessimistic by design (see
   Integration Points).

## Scaling Considerations

| Scale | Architecture Adjustments |
|-------|---------------------------|
| Current (single tenant, tens of workspaces, hundreds of tables) | Everything on the main thread. `ForceCanvas`'s O(n²) pairwise repulsion (already in `GraphView.tsx`) comfortably hits 60fps at this size — verified by the fact today's implementation already does this with no worker. |
| A single knowledge-graph level exceeding ~500-1000 nodes (e.g. an unusually large lakehouse view) | O(n²) repulsion starts costing >16ms/frame. First fix: reduce to O(n log n) via a spatial grid/quadtree for repulsion, *before* reaching for a worker — cheaper to implement and keeps the simulation in the same thread as pointer interaction (dragging a node needs low-latency access to sim state). |
| Layout genuinely too heavy for 60fps interaction even after algorithmic fixes | Move `model/graphLayout.ts`'s step function into a Web Worker — feasible with low rework *because* the layout functions were already written as pure `(nodes, links) → nodes'`, decoupled from rendering, per Pattern 3. This is a "when," not an "if you must," and is not expected to be needed in this milestone. |
| DAG (`lineageLayout.ts`) at any realistic Fabric scale | Longest-path layout is O(n+e); never a bottleneck. No worker consideration needed here regardless of scale. |

### Scaling Priorities

1. **First bottleneck (if it ever occurs): force-sim repulsion cost at high
   node counts.** Fix with a spatial partitioning structure before
   considering a worker.
2. **Second-order concern: per-frame `getComputedStyle` calls (Pattern 2).**
   Already flagged as worth fixing regardless of scale, since it's cheap to
   fix now and costs real frame budget at any node count once each node/edge
   triggers its own style read.

## Anti-Patterns

### Anti-Pattern 1 (revisit, don't discard): "No global store" applied too broadly

**What the existing codebase's ARCHITECTURE.md says:** React Context +
`useState` in `App.tsx` is sufficient; a global Redux/Zustand store is
unnecessary because the graph loads once and there's no real-time
cross-tab sync or time-travel debugging need.

**Where that reasoning still holds:** The graph itself (`LineageGraph`) is
still fetch-once/occasionally-refresh server data — TanStack Query is the
right upgrade for it (better loading/error/caching semantics than
hand-rolled `useState`+`useEffect`), not a client store. Ephemeral,
single-component UI state (expanded table cards, a form field in the
Purview-push wizard) still belongs in local component state, exactly as
today.

**Where it breaks down for this milestone specifically:** The original
justification assumed *one active canvas at a time* and *no shared,
high-frequency interaction state*. This milestone introduces exactly that:
selection/hover must be shared between two independent canvases and an
inspector that all need to react to the same value without re-rendering
each other on every mouse move. React Context broadcasts to every consumer
on every value change regardless of which slice they actually read — at
canvas-hover frequency (potentially per animation frame, driven from
outside React's render cycle in `ForceCanvas`'s `requestAnimationFrame`
loop) that becomes the exact case general React guidance flags as a
Context bottleneck (LOW confidence — general web-search consensus, not
project-measured, but consistent with how `ForceCanvas`'s hover/drag loop
is *already* structured entirely outside React state today).

**Do this instead:** Add two small, purpose-built Zustand stores
(`selectionStore`, `uiStore`) — not a general application store, not a
replacement for TanStack Query, not a place for the graph itself to live.
Everything else the original anti-pattern guarded against (Redux-style
normalized entity stores, time-travel debugging, cross-tab sync) remains
correctly out of scope. This is a scoped revision of the ADR, not a
reversal of it — record it as such rather than silently dropping the
constraint.

### Anti-Pattern 2: Hand-rolled routing via `useState` breadcrumb arrays

**What happens today:** `GraphView.tsx` maintains `path: Crumb[]` in
component state, with `drill()`/`goto()` pushing/slicing the array, and a
manual `Escape`-key handler for "back." There is no URL for any drill level,
no browser back/forward support, and no shareable link to "this
lakehouse" or "this table."

**Why it's wrong for this milestone:** The requirements explicitly want
deep-linkable URLs to a specific node/column and back/forward through
drill-down — the current implementation is a router, built manually, minus
the URL. It also means `App.tsx`'s `mode` state (`'lineage' | 'graph'`) and
`GraphView`'s internal path are two separate, uncoordinated notions of
"where am I," which is exactly what a router unifies.

**Do this instead:** Adopt a router (see decision below) and express both
the active destination and the drill path as route segments/search params.
`goto(i)` becomes `navigate(-n)` or a link to a specific breadcrumb URL;
`Escape`-to-go-back becomes the browser's native back button working
correctly, for free.

**Router recommendation:** TanStack Router over React Router v7 for this
app, specifically because drill level, selected node, and selected column
are exactly the kind of typed, validated search-param state TanStack
Router is built around (LOW confidence, single web-search pass — see
Sources). React Router v7's comparable type safety only applies in
"framework mode" (SSR-oriented), which this app has no reason to adopt — it
is and should remain a client-rendered SPA against a separate FastAPI
backend. If the team has strong existing React Router familiarity and
wants the more ecosystem-ubiquitous choice, React Router v7 in
declarative/data mode is a reasonable fallback; the loss is weaker
compile-time guarantees on search params, not a functional gap. Either way,
**do not ship the rebuild without a router** — the manual breadcrumb-array
approach is the anti-pattern to retire.

## Integration Points

### External Services

*(Unchanged by this milestone — listed for completeness, since the
frontend rebuild must not regress them.)*

| Service | Integration Pattern | Notes |
|---------|----------------------|-------|
| FastAPI backend (`/graph`, `/ingest`, `/purview/*`) | HTTP/JSON via `shared/api/client.ts` (renamed, logic unchanged from today's `api.ts`) | `LineageGraph` and `WriteResult` contracts are frozen — do not add fields the backend doesn't emit |
| Purview write paths (lineage push, definitions apply, data-product catalog) | Each already accepts an `apply: boolean` — `apply:false` is a genuine dry-run over the same code path, not a separate preview endpoint | This is the load-bearing fact that makes the preview→confirm→execute pipeline trustworthy: preview literally *is* the same operation, just not sent to Purview |

### Internal Boundaries

| Boundary | Communication | Notes |
|----------|----------------|-------|
| `model/` ↔ `destinations/{lineage,graph}` | Pure function calls (`adapt()`, `lineageLayout()`, `graphLayout()`) — no React context, no store | Keeps layout unit-testable and canvas-agnostic |
| `state/selectionStore` ↔ both canvases + `inspector/` | Zustand selector hooks, each subscriber reads only its slice | The one deliberate departure from "no global store," scoped narrowly |
| `shared/api` ↔ `destinations/purview-push` | TanStack Query mutations, each wrapping one existing `api.ts` function 1:1 | No new backend surface required by this milestone |
| `design/theme.ts` ↔ canvas components | One-way: theme.ts owns `data-theme` writes and token re-snapshots; canvases only ever read `useCanvasTokens()` | Prevents any canvas from becoming a second source of truth for colour |
| `app/router.tsx` ↔ `destinations/registry.ts` | Router config is generated from the destination registry, not maintained separately | Adding a 5th destination = one registry entry + one folder; router wiring falls out of it rather than being hand-added in two places |

## Build Order

Numbered by dependency; items at the same number can be built in parallel.

1. **Design tokens (primitive + semantic CSS) and self-hosted font.**
   Blocks everything visual. No dependencies.
2. **Directory scaffold + `shared/api` (TanStack Query wired to existing
   `api.ts` functions, unchanged contracts) + `state/` store skeletons.**
   Mechanical, low-risk, can start alongside (1).
3. *(parallel, both depend on 1+2)*
   - **Router adoption + shell (`IconRail` + route outlet + empty
     `Inspector`).** Router choice must be made here since rail navigation
     *is* routing.
   - **`model.tsx` decomposition** into `adapt.ts` /
     `lineageLayout.ts` / `graphLayout.ts` / `domainColor.ts`. Independent
     of shell work — touches no UI.
4. **`shared/canvas/` infra** (selection store wiring, generalized `trace()`,
   `useCanvasTokens()`). Depends on (2)'s store skeleton and (3)'s model
   split.
5. *(parallel, both depend on 4)*
   - **Lineage DAG canvas rebuild** (`destinations/lineage/`)
   - **Knowledge-graph canvas rebuild** (`destinations/graph/`)

   Neither depends on the other; both depend on (3)'s `model/` split and
   (4)'s shared canvas infra.
6. *(parallel with 5, depends only on 2 + 3's router/shell — not on the
   canvases being finished)*
   - **Purview push destination** (scope → preview → confirm → execute →
     results, `usePurviewPush`/`useWritePipeline`). Scope selection can work
     against a plain table/column list; it does not need the rebuilt
     canvases to exist first.
   - **Definitions import + data-product destinations**, promoted from
     bolt-on panel to first-class destination. Smallest lift — most of
     `DefinitionsImport.tsx`'s logic carries over; mainly needs the new
     shell wrapper and the shared write-pipeline hook.
7. **Cross-canvas selection wiring + drill-down URL sync.** Only meaningful
   once both canvases (5) and the router (3) are real — this is where
   "click a node in the knowledge graph → inspector shows it → open in
   lineage DAG, deep-linked" gets connected end to end.
8. **Motion/polish pass** (edge-trace animation, drill-in transitions).
   Explicitly last — additive on top of working interaction, blocks nothing
   else and is blocked by everything else being functionally done.

**Practical read for phase sequencing:** phases 1-2 are a single
foundational phase; 3 can be two parallel phases (shell+router,
model split); 5 and 6 can run as up to four parallel phases if capacity
allows (two canvases + push flow + definitions/data-product); 7 and 8 are
necessarily sequential tail phases.

## Sources

- Direct codebase inspection (HIGH confidence — primary source for all
  codebase-specific claims): `frontend/src/App.tsx`, `frontend/src/model.tsx`,
  `frontend/src/api.ts`, `frontend/src/App.css`,
  `frontend/src/views/GraphView.tsx`, `frontend/src/views/LineageView.tsx`,
  `.planning/codebase/ARCHITECTURE.md`, `.planning/codebase/STRUCTURE.md`,
  `.planning/codebase/CONVENTIONS.md`, `.planning/PROJECT.md`
- [TanStack Router vs React Router v7 2026 — PkgPulse Guides](https://www.pkgpulse.com/guides/react-router-v7-vs-tanstack-router-2026) (LOW confidence, single web-search pass, general ecosystem opinion not project-verified)
- [TanStack Router vs React Router | Better Stack Community](https://betterstack.com/community/guides/scaling-nodejs/tanstack-router-vs-react-router/) (LOW confidence)
- [Feature-Sliced Design](https://feature-sliced.design/) and [Maintainability with Colocation — Povio](https://povio.com/blog/maintainability-with-colocation) (LOW confidence, general web consensus on FSD-vs-colocation threshold)
- [Zustand and React Context — TkDodo](https://tkdodo.eu/blog/zustand-and-react-context) and [Migration from React Context to Zustand — Medium](https://medium.com/@shanmukhachanta1/migration-from-react-context-to-zustand-performance-challenges-in-dynamic-ui-builders-3c055ecd6e13) (LOW confidence, general web consensus on Context re-render broadcast behavior, not benchmarked against this codebase)

---
*Architecture research for: React frontend rebuild — data lineage / knowledge-graph visualization app with a Purview write UI*
*Researched: 2026-07-20*
