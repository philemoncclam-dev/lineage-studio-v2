# Phase 2: App Shell, Routing & Canvas Infrastructure - Pattern Map

**Mapped:** 2026-07-21
**Files analyzed:** 20
**Analogs found:** 15 / 20 (5 are genuinely new patterns — router/Radix files with no in-repo precedent, listed under "No Analog Found")

## File Classification

| New/Modified File | Role | Data Flow | Closest Analog | Match Quality |
|--------------------|------|-----------|-----------------|----------------|
| `src/routes/__root.tsx` | provider/route | request-response (loader) | `src/App.tsx` (root composition + `fetchGraph` effect) | role-match |
| `src/routes/graph/route.tsx`, `lineage/route.tsx`, `purview/route.tsx` | route (layout) | request-response | `src/App.tsx` (mode switch + `validateSearch`-equivalent state) | role-match |
| `src/routes/graph/index.tsx`, `$workspace/index.tsx`, `$workspace/$lakehouse/index.tsx`, `$workspace/$lakehouse/$table.tsx` | route | CRUD (read-only drill) | `src/views/GraphView.tsx` (drill-level state machine) | role-match |
| `src/routes/lineage/$workspace.$lakehouse.$table.tsx` | route | request-response | `src/views/LineageView.tsx` (focusTable/focusColumn props) | role-match |
| `src/routes/purview/definitions.tsx` | route | CRUD | `src/views/DefinitionsImport.tsx` | exact (thin wrapper) |
| `src/routes/purview/push.tsx`, `data-products.tsx` | route (placeholder) | request-response | `src/views/PurviewPanel.tsx` (placeholder sections) | partial |
| `src/shell/AppShell.tsx` | component | request-response | `src/App.tsx` (`<div className="app">` composition + `<header className="toolbar">`) | role-match |
| `src/shell/ModeMenu.tsx` | component | event-driven | none in-repo (new Radix DropdownMenu) — style from `.seg`/`.tbtn` in `components.css` | no analog (styling analog only) |
| `src/shell/Rail.tsx` | component | event-driven | `src/App.tsx`'s `.seg` mode-switch buttons (nearest existing nav-list idiom) | partial |
| `src/shell/RailBottomCluster.tsx` | component | event-driven | `src/App.tsx`'s `.search` button + `hasPurview`/`loadError`/`src-chip` status chips | role-match |
| `src/shell/Inspector.tsx` | component | request-response | `src/views/LineageView.tsx` `.ls-inspector` `<aside>` (lines 140-161) | exact |
| `src/shell/CommandPalette.tsx` | component | event-driven | `src/views/SearchPalette.tsx` (entire file — full port target) | exact |
| `src/selection/useSelection.ts` | hook | event-driven | `src/model.tsx`'s `useModel()`/`ModelContext` hook idiom | role-match (hook-shape only) |
| `src/resolve/resolvePathSegments.ts` | utility | transform | `src/model.tsx`'s `adapt()` (pure function over `LineageGraph`, `byId` Map lookup pattern) | role-match |
| `src/model/adapt.ts` | utility | transform | `src/model.tsx` lines 50-99 (object-level ops + layered layout) | exact (extraction) |
| `src/model/lineageLayout.ts` | utility | transform | `src/model.tsx` lines 69-99 (`depth`/`yCursor`/`place`) | exact (extraction) |
| `src/model/graphLayout.ts` | utility | transform | `src/model.tsx` lines 132-197 (`levels.estate`/`ws:`/`lake:` builders) | exact (extraction) |
| `src/model/domainColor.ts` | utility | transform | `src/model.tsx` lines 44-45 (`LAYER_COLOR`/`colorFor`) | exact (extraction) |
| `src/model/index.tsx` | provider | request-response | `src/model.tsx` lines 1-42, 226-229 (`AppModel` type, `ModelProvider`/`useModel`, `sampleModel`) | exact (extraction) |
| `src/views/LineageView.tsx`, `src/views/GraphView.tsx` (modified, token bridge only) | component | request-response | themselves — modify in place to fill new container | exact (self) |

## Pattern Assignments

### `src/routes/__root.tsx` (route, request-response)

**Analog:** `src/App.tsx`

**Data-load pattern to port** (`App.tsx` lines 12-39):
```typescript
const [model, setModel] = useState<AppModel>(() => sampleModel())
...
useEffect(() => {
  let alive = true
  fetchGraph()
    .then((g) => { if (alive) setModel(adapt(g)) })
    .catch(() => {}) // backend down -> stay on the bundled sample
  fetchPurviewStatus()
    .then((s) => {
      if (!alive) return
      setHasPurview(s.configured)
      setWriteEnabled(s.write_enabled)
    })
    .catch(() => {})
  return () => { alive = false }
}, [])
```
Port this into the root `loader` (RESEARCH.md's "Root loader" code example) — same fallback-to-sample-on-failure behavior, moved from a `useEffect` to a router `loader({ context })`. The `ModelProvider` composition (`App.tsx` line 74, 106: `<ModelProvider value={model}>...</ModelProvider>`) wraps `<AppShell><Outlet/></AppShell>` in `__root.tsx`'s `component`.

**Cmd+K global listener to port** (`App.tsx` lines 58-64):
```typescript
useEffect(() => {
  const onKey = (e: KeyboardEvent) => {
    if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') { e.preventDefault(); setSearchOpen(true) }
  }
  window.addEventListener('keydown', onKey)
  return () => window.removeEventListener('keydown', onKey)
}, [])
```
Keep this exact listener shape at the shell level; wire `setSearchOpen` to `CommandPalette`'s `open` state (D-17 keeps rail-bottom + Cmd+K as the two triggers).

---

### `src/shell/AppShell.tsx` (component, request-response)

**Analog:** `src/App.tsx` lines 73-107 (JSX composition)

**Core layout pattern:**
```tsx
return (
  <ModelProvider value={model}>
  <div className="app">
    <header className="toolbar">
      <div className="seg">...</div>
      <div className="spacer" />
      {model.source === 'sample' && <span className="src-chip" ...>sample data</span>}
      {loadError && <span className="src-chip err" ...>catalog unavailable</span>}
      <button className="search" onClick={...}>...</button>
    </header>
    {/* mode content */}
    <SearchPalette .../>
  </div>
  </ModelProvider>
)
```
Reuse `.app`/`.toolbar`/`.seg`/`.spacer`/`.src-chip`/`.search`/`.tbtn` classes verbatim from `components.css` (do not invent new class names) — D-16 explicitly carries these forward as component styling for the new rail/mode-menu/rail-bottom-cluster controls. Replace the flat `mode === 'lineage' ? <LineageView/> : <GraphView/>` ternary (line 99) with `<Outlet/>`.

---

### `src/shell/Inspector.tsx` (component, request-response)

**Analog:** `src/views/LineageView.tsx` lines 140-161 (`.ls-inspector` `<aside>`)

**Overlay `<aside>` pattern to copy structurally (not verbatim CSS — D-10 requires floating/elevated, not flex-docked):**
```tsx
if (!colKey) return <aside className="ls-inspector" />
...
return (
  <aside className="ls-inspector">
    <div className="insp-head">
      ...
    </div>
    ...
  </aside>
)
```
Existing CSS reference (`components.css` lines 132-140):
```css
.ls-inspector { width: 320px; flex: none; background: var(--panel-bg); border-left: var(--border-width) solid var(--panel-border); overflow-y: auto; }
.insp-head { padding: var(--spacing-4) var(--spacing-4) var(--spacing-3); border-bottom: var(--border-width) solid var(--panel-border); }
```
New `Inspector.tsx` must NOT copy `flex: none`/docked layout (that reflows the canvas, violating D-10) — reposition as `position: absolute` / `fixed` off the canvas's right edge using `--panel-bg`/`--panel-border` tokens, fixed width per D-13 (~360-400px vs the old 320px). Conditional-render-on-selection idiom (`if (!colKey) return ...`) maps directly to Pattern 3 in RESEARCH.md (`if (!sel) return null`).

---

### `src/shell/CommandPalette.tsx` (component, event-driven)

**Analog:** `src/views/SearchPalette.tsx` (full file, 203 lines) — this is a full port target, not just a pattern reference.

**Ranking/grouping logic to preserve verbatim** (lines 23-27, 44-81):
```typescript
const GROUP_ORDER: SearchResult['kind'][] = ['table', 'column', 'notebook', 'code']
const GROUP_LABEL: Record<SearchResult['kind'], string> = {
  table: 'Tables', column: 'Columns', notebook: 'Notebooks', code: 'Code',
}
const MAX_PER_GROUP = 8

function search(m: AppModel, query: string): SearchResult[] { /* ... unchanged ... */ }
```
Per RESEARCH.md Pattern 4/Pitfall 6, this `search()` + `GROUP_ORDER`/`MAX_PER_GROUP` logic feeds `cmdk`'s `Command.List` with `shouldFilter={false}` — do not let `cmdk` re-sort/re-filter results. The `hl()` highlight helper (lines 84-100) and `SearchResult` type (lines 7-15) port unchanged.

**Result-selection callback to replace** (`App.tsx` lines 66-71):
```typescript
const onSearchResult = (r: SearchResult) => {
  setSearchOpen(false)
  if (r.kind === 'table' && r.tableId) openLineage(r.tableId)
  else if (r.kind === 'column' && r.tableId) openLineage(r.tableId, r.colKey)
  else setMode('lineage')
}
```
Replace `openLineage`/`setMode` calls with `navigate({ to: '/lineage/$workspace/$lakehouse/$table', params: ..., search: { sel: r.tableId, col: r.colKey } })` — a real navigation, per RESEARCH.md's system diagram note ("a real navigation, not a selection-only update").

**Keyboard nav to retire** (lines 139-144, the manual `ArrowUp`/`ArrowDown`/`Enter`/`Escape` handler) — replaced by `cmdk`'s built-in `Command.Input`/`Command.List` keyboard handling (RESEARCH.md "Don't Hand-Roll" table).

---

### `src/model/*.ts` (utility, transform) — decomposition of `src/model.tsx`

**Analog:** `src/model.tsx` itself (228 lines) — this is a pure extraction, not a new pattern. Boundaries are the file's own comment markers:

- `domainColor.ts` ← lines 44-45:
```typescript
const LAYER_COLOR: Record<string, ColorKey> = { bronze: 'bronze', silver: 'silver', gold: 'gold' }
const colorFor = (layer: string): ColorKey => LAYER_COLOR[layer] ?? 'workspace'
```
- `lineageLayout.ts` ← lines 69-99 (`depth`/`yCursor`/`place`, the DAG depth-placement algorithm) — takes `tableNodes`, `nbNodes`, `ops` in; returns `tables`/`notebooks` positions out. No pixel math belongs in `adapt.ts`.
- `graphLayout.ts` ← lines 132-197 (`levels.estate`, per-workspace `ws:`, per-lakehouse `lake:` builders, `levelTable`) — the topology-only levels builder; explicitly NOT the force simulation (that stays runtime-computed inside `GraphView.tsx` per RESEARCH.md).
- `adapt.ts` ← lines 50-68, 101-130, 199-224 (node/edge classification, column-edge/transform resolution, upstream/downstream `context`) — calls into `lineageLayout.ts`/`graphLayout.ts`/`domainColor.ts` rather than inlining them.
- `index.tsx` ← lines 1-42, 226-229 (`AppModel` interface, `sampleModel()`, `ModelContext`/`ModelProvider`/`useModel`) — the composition root, re-exporting the above four.

**Byid/Map lookup idiom to preserve** (line 55, reused across all four modules):
```typescript
const byId = new Map(g.nodes.map((n) => [n.id, n]))
```

---

### `src/resolve/resolvePathSegments.ts` (utility, transform)

**Analog:** `src/model.tsx`'s `adapt()` — same "walk `LineageGraph.nodes`/`parent_id` via a `byId` Map" shape as `layerOf()` (lines 57-60) and `lakehouseOf()` (line 135):
```typescript
const layerOf = (t: LineageNode) => {
  const lh = t.parent_id ? byId.get(t.parent_id) : undefined
  return lh ? lh.name.toLowerCase() : (t.meta?.inferred ? 'inferred' : 'table')
}
```
`resolveSegment()` (RESEARCH.md Code Examples) should follow this exact `parent_id`-chain-walking idiom against the root-loaded graph snapshot, per Pitfall 4's requirement to resolve against the root loader's `LineageGraph`, not a partial state.

---

### `src/selection/useSelection.ts` (hook, event-driven)

**Analog:** `src/model.tsx` lines 226-229 (`ModelContext`/`useModel` hook shape) — same "thin hook wrapping a single source of truth" idiom, but source is `Route.useSearch()`/`navigate()` instead of React Context (RESEARCH.md Pattern 1). No existing repo hook wraps router state (none exists pre-Phase-2) — model shape only, not implementation.

---

## Shared Patterns

### Token-only styling (no raw hex/px)
**Source:** `frontend/src/styles/components.css` (`.seg`, `.tbtn`, `.search` — lines 79-93), `frontend/src/styles/tokens.css`
**Apply to:** All new `shell/*.tsx` components (`AppShell`, `ModeMenu`, `Rail`, `RailBottomCluster`, `Inspector`, `CommandPalette`)
```css
--panel-bg: var(--color-surface-1);
--panel-border: var(--color-border);
--seg-bg: var(--color-surface-2);
--seg-border: var(--color-border);
--seg-radius: var(--radius-control);
--tbtn-bg: var(--color-surface-2);
--tbtn-border: var(--color-border);
--tbtn-radius: var(--radius-control);
.seg { display: flex; background: var(--seg-bg); border: var(--border-width) solid var(--seg-border); border-radius: var(--seg-radius); padding: var(--spacing-1); gap: 0; }
.tbtn { font: inherit; font-size: var(--text-micro); color: var(--color-text-secondary); background: var(--tbtn-bg);
  border: var(--border-width) solid var(--tbtn-border); border-radius: var(--tbtn-radius); padding: var(--spacing-2) var(--spacing-3); cursor: pointer; }
```
D-16 explicitly carries these forward as the visual basis for new shell controls — never introduce parallel new class names/hex values for equivalent affordances.

### Canvas token bridge (unchanged, consume-only)
**Source:** `frontend/src/tokens/canvasTokens.ts` (`getCanvasTokens()`, `initCanvasTokenCache()`)
**Apply to:** `views/GraphView.tsx`'s draw loop (unchanged this phase); NOT needed by new DOM-only shell chrome (rail/inspector/palette read CSS vars directly, no JS token read — RESEARCH.md Architectural Responsibility Map)
```typescript
export function getCanvasTokens(): CanvasTokens {
  if (!cached) cached = readTokensFromDOM()
  return cached
}
export function initCanvasTokenCache(): () => void { /* MutationObserver on data-theme */ }
```
`main.tsx` already wires `initCanvasTokenCache()` once at bootstrap (line 11) — no change needed there.

### Graph data loading with sample-fallback
**Source:** `src/App.tsx` lines 24-39 (see `__root.tsx` section above)
**Apply to:** `routes/__root.tsx` loader — preserve the exact silent-catch-fallback-to-sample behavior; do not surface a hard error state for a normal "backend not running in dev" case.

### `LineageGraph`/`byId` Map traversal idiom
**Source:** `src/model.tsx` lines 55-60, 135, 146-152
**Apply to:** `resolve/resolvePathSegments.ts`, `model/adapt.ts`, `model/graphLayout.ts` — every module that needs parent/child traversal over the flat `nodes[]`/`edges[]` arrays should build a `new Map(g.nodes.map(n => [n.id, n]))` once and reuse it, not re-`.find()` per lookup.

## No Analog Found

Files with no close match in the codebase (planner should use RESEARCH.md's Code Examples/Patterns instead — these are net-new library integrations with no prior in-repo precedent):

| File | Role | Data Flow | Reason |
|------|------|-----------|--------|
| `src/shell/ModeMenu.tsx` | component | event-driven | No existing Radix `DropdownMenu` usage in repo; App.tsx has no product-switcher analog (RESEARCH.md Pattern/Code Examples is the source; style from `.seg`/`.tbtn`) |
| `src/routes/**/*.tsx` (route files themselves, as TanStack file-based routes) | route | request-response | No router exists pre-Phase-2 (`App.tsx`'s hand-rolled `useState<Mode>` is the thing being replaced, not a routing analog); use RESEARCH.md's Pattern 5 / Code Examples verbatim |
| `src/selection/useSelection.ts` (implementation, not shape) | hook | event-driven | No prior hook wraps router search-params in this repo; use RESEARCH.md Pattern 1 verbatim |
| `src/resolve/resolvePathSegments.ts` (redirect/ancestor-fallback logic) | utility | transform | D-09's "nearest ancestor" fallback is original architecture per RESEARCH.md; only the `byId`/Map traversal shell has a repo analog (see Shared Patterns) |
| `vitest.config.ts`, `src/test/setup.ts`, `src/**/__tests__/*.test.ts(x)` | test/config | — | Zero pre-existing frontend test infrastructure (confirmed: no `vitest`/`jest` in `package.json`); use RESEARCH.md's Wave 0 Gaps section as the sole reference |

## Metadata

**Analog search scope:** `frontend/src/` (all files); `frontend/src/styles/`, `frontend/src/tokens/`, `frontend/src/views/`, `frontend/src/model.tsx`, `frontend/src/App.tsx`, `frontend/src/api.ts`, `frontend/src/main.tsx`
**Files scanned:** 15 (full repo frontend `src/` file count as of this phase)
**Pattern extraction date:** 2026-07-21
