# Phase 3: Lineage DAG Canvas Rebuild - Research

**Researched:** 2026-07-23
**Domain:** `@xyflow/react` v12 custom nodes/edges + `@dagrejs/dagre` layout, keyboard/AT-accessible canvas interaction, additive backend evidence threading
**Confidence:** HIGH

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions

- **D-01:** Renderer is `@xyflow/react` (v12) + dagre, per ROADMAP. The repo
  currently has the *old* `reactflow@11` package installed — planning must treat
  migrating to `@xyflow/react` (renamed package, v11→v12) as explicit work, and
  reconcile it with the existing `model-studio` Solidatus modeling mode
  (`frontend/src/model-studio/`) which may also touch a graph renderer.
- **D-02:** Layout is deterministic (DAG-07) — same graph ⇒ same positions. Left-
  to-right (DAG-01). Consume the decomposed pure layout model from Phase 2
  (`frontend/src/model/lineageLayout.ts`, `adapt.ts`), don't re-derive positions
  ad hoc.
- **D-03:** **Global toggle, expanded by default.** Cards start expanded showing
  all column rows. One global control flips the whole view to table-level
  (headers only). This is the simple, Solidatus-like mental model — no per-card
  expand/collapse state in v1.
- **D-04:** Wide tables (many columns) **scroll inside the card**; no
  virtualization or truncate-with-count in v1. Revisit only if a real table's
  column count makes an expanded card unusable.
- **D-05:** **One trace treatment, hover is transient.** A "trace" = the full
  upstream+downstream connected path lit while everything unrelated **dims to
  ~15% opacity and becomes non-interactive**.
- **D-06:** Hover **previews** a trace transiently. A **click freezes** it as the
  persistent selection. Hovering a different column *while something is selected*
  shows that hover trace transiently **without losing the selected column** — the
  selection returns when the hover ends. Selection is cleared by Esc, the
  inspector close button, or an empty-canvas click (mirrors Phase 2 D-11).
- **D-07:** Selection state is the existing Phase-2 selection store + `?sel`/`?col`
  URL params — not a new local state model.
- **D-08:** Provenance is encoded by **line style, non-colour**: **declared =
  solid, inferred = dashed.** Edge-type colour (reads/writes/derives) stays free
  and the distinction survives colourblind simulation (pitfall #19 / THEME-06
  discipline).
- **D-09:** **Reality:** every edge produced today comes from static parsing, so
  in Phase 3 **all edges render as dashed/inferred.** The *solid/declared* style
  is built and wired now but only lights up in Phase 5 when the app reads
  Purview-declared lineage back. No numeric confidence — categorical only
  (per REQUIREMENTS out-of-scope).
- **D-10:** No backend provenance enum added in this phase — "all inferred" is a
  convention Phase 5 replaces with a real read-back, not a model change here.
  (Contrast with D-12 below, which *does* accept a scoped backend change.)
- **D-11:** The inspector for a selected column shows: the **transform
  expression**, the resolved **source→target columns**, the **originating
  notebook**, a **plain-English explanation**, and — new — the **matched notebook
  cell + line/snippet** as verbatim evidence for *why this inferred edge exists*.
- **D-12:** **Accepted scope note — this phase extends the backend parser.**
  Today the `Edge`/`ColumnMap` model (`backend/app/models.py`) carries only
  `transform` (e.g. `"upper(x)"`) and `via` (notebook node id) — there is **no
  cell/line/snippet evidence**. Delivering the verbatim snippet requires
  threading evidence (notebook, cell index, line, snippet) from `parser.py`
  through `ColumnMap` and out over the `LineageGraph` contract. This is a
  deliberate, bounded backend addition inside an otherwise frontend-focused
  phase. **The `LineageGraph` shape must stay backward-compatible** (additive,
  optional field) per CLAUDE.md's stability rule and the Phase-1→2 contract.
- **D-13:** The plain-English explanation continues to be **frontend-synthesized**
  from the available fields (as `adapt.ts` already does: *"Computed as … in
  {notebook}"* / *"Passed through from … by {notebook}"*), now enriched by the
  new evidence. It must **not imply more semantic understanding than a regex
  parser actually has** (pitfall #6) — evidence is shown *as parsed*, labelled
  inferred.
- **D-14:** The UI shows **when lineage data was last refreshed.** Surface it in
  the lineage view chrome/inspector (exact placement resolved by 03-UI-SPEC.md
  to the new lineage-toolbar strip), sourced from the existing load path — no
  new persistence.

### Claude's Discretion (resolved by 03-UI-SPEC.md — see that document for the binding spec)

- Keyboard/AT model (DAG-08, SC#6, pitfall #19) — resolved: roving-tabindex
  flat node+row list, `→`/`←` path-walk, `sr-only` edge summary list. **This
  requires disabling `@xyflow/react`'s own default keyboard scheme** (see
  Common Pitfalls below) rather than layering on top of it.
- Exact xyflow custom-node/edge component shapes, dagre tuning — resolved (node
  geometry table, dagre config block, both in 03-UI-SPEC.md).
- Exact dim opacity (0.15), transition timing (180ms) — resolved.
- Placement of "last refreshed" indicator and table↔column toggle — resolved
  (new `lineage-toolbar` strip, owned by this phase).

### Deferred Ideas (OUT OF SCOPE)

- Per-card expand/collapse state — deferred; v1 uses a single global toggle (D-03).
- Column-list virtualization / truncate-with-count for very wide tables — deferred.
- Backend provenance enum — not added here (D-10); Phase 5 supplies it for real.
- Numeric confidence scores — permanently out of scope (REQUIREMENTS).
- Animated edge tracing / panel transitions — Phase 7 (MOT-01/02).

</user_constraints>

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|------------------|
| DAG-01 | Column-level lineage renders left-to-right with expandable table cards and column rows | Node/edge architecture section — `tableNode`/`notebookNode` types, dagre `rankdir: 'LR'`, node geometry table |
| DAG-02 | Column-to-column edges connect to the correct column rows, not merely node boundaries | Column-Row Edge Anchoring section — per-row `<Handle>` pair keyed by `col.key`, `useUpdateNodeInternals` requirement on toggle flip |
| DAG-03 | Hovering a column traces its full upstream and downstream path; unrelated nodes/edges dim | Trace & Selection Interaction section — reuse `LineageView.tsx`'s existing `trace()` BFS/DFS, apply as CSS class/opacity, not xyflow's built-in selection |
| DAG-04 | Clicking a column selects it persistently; selection survives hovering elsewhere | Selection-store integration — `useSelection()` write path, hover-overrides-render-without-mutating-URL pattern |
| DAG-05 | Inspector shows a selected column's transform, plain-English explanation, inputs/outputs | Inspector Column-Detail section — extends `Inspector.tsx`'s `resolveSelected()`, reuses unused `.xform`/`.flow-item` CSS |
| DAG-06 | View toggles between table-level and column-level detail | Table↔Column toggle — local component state (not URL), drives both node render mode and handle-id fallback |
| DAG-07 | Layout is deterministic — same graph produces same positions | Dagre Determinism section — pure function of `(graph, toggleState)`, no incremental/warm-start behaviour |
| DAG-08 | Nodes and edges carry semantic labelling for assistive technology | Accessibility section — xyflow default a11y model vs. custom roving-tabindex requirement; `aria-label` templates; `sr-only` edge list |
| TRUST-01 | Edges are visually differentiated by provenance (declared vs inferred) | Provenance Edge Channel section — `stroke-dasharray` on custom edge component, independent of edge-type hue |
| TRUST-02 | Inspector explains why an inferred edge exists, showing parsed evidence | Backend Evidence Threading section — `ColumnMapEvidence`, `parser.py` `.start()`/line-count derivation |
| TRUST-03 | UI shows when lineage data was last refreshed | Freshness Indicator section — `fetchedAt` captured at root-loader, `AppModel.source` live/sample distinction |

</phase_requirements>

## Summary

This phase has an unusually complete design contract already: `03-UI-SPEC.md`
(approved, 6/6 dimensions PASS) resolves nearly every visual and interaction
decision — node geometry, dagre tuning parameters, the keyboard traversal
model, the Inspector layout, and the exact CSS classes to port from the
retired `LineageView.tsx`. This research file's job is narrower than usual: it
verifies the **technical mechanics** the UI-SPEC's decisions depend on — the
real `@xyflow/react` v12 / `@dagrejs/dagre` APIs, where the UI-SPEC's
pseudocode needs correction against the actual library surface, where
`@xyflow/react`'s built-in behaviour will *fight* the UI-SPEC's custom
keyboard model unless explicitly disabled, and the concrete mechanics of the
D-12 backend evidence thread.

Three load-bearing technical findings shape planning:

1. **`@xyflow/react`'s default keyboard model is incompatible with the
   UI-SPEC's roving-tabindex scheme and must be explicitly turned off**
   (`nodesFocusable={false}`, `edgesFocusable={false}`, `disableKeyboardA11y`),
   not layered on top of. By default, Tab moves through every node/edge as a
   separate DOM tab stop and arrow keys **drag the selected node** — both
   directly conflict with "one Tab stop into the canvas" and "arrow keys
   walk columns/ranks." This is the single highest-risk implementation detail
   in the phase and is not mentioned in 03-UI-SPEC.md.
2. **Column-row handle positions must be re-measured via
   `useUpdateNodeInternals()`** whenever the D-03 global toggle flips a card
   between Table and Column mode (handle count/position changes) — `@xyflow/react`
   does not auto-detect handle DOM changes after initial mount.
3. **`dagre.layout()`'s config lives on `g.setGraph({...})`, not as a second
   argument to `layout()`** — 03-UI-SPEC.md's pseudocode block
   (`dagre.layout(graph, {rankdir: 'LR', ...})`) is illustrative of the config
   *keys*, not the literal call shape; and dagre returns each node's **center**
   point, which must be converted to xyflow's **top-left** `position` convention.

**Primary recommendation:** Treat 03-UI-SPEC.md as the binding design contract
for *what* to build; treat this document's Architecture Patterns / Common
Pitfalls sections as the binding technical contract for *how* to wire it to
the real `@xyflow/react`/`dagre` APIs without fighting their defaults.

## Architectural Responsibility Map

| Capability | Primary Tier | Secondary Tier | Rationale |
|------------|-------------|----------------|-----------|
| DAG layout computation (dagre) | Frontend (client, pure function) | — | Deterministic, offline computation over already-fetched `LineageGraph`; no server round-trip per layout |
| Column-row edge anchoring | Frontend / Browser (DOM) | — | `<Handle>` position is a DOM-measured value (`getBoundingClientRect` under the hood via `useUpdateNodeInternals`) |
| Hover-trace / selection state | Frontend (client) | URL (via TanStack Router search params) | Trace is ephemeral render state; persisted selection is URL state (Phase-2 `useSelection`) — no backend involvement |
| Transform plain-English synthesis | Frontend (`adapt.ts`) | — | Locked D-13: never move this to the backend; it is a display concern over data the backend already returns |
| Evidence (cell/line/snippet) extraction | Backend (`parser.py`) | — | Only the backend has the raw notebook cell text and regex match objects; must be computed once at parse time, not reconstructed client-side |
| `LineageGraph` contract (nodes/edges/ColumnMap) | Backend (Pydantic) → Frontend (TS interface) | — | Additive-only per CLAUDE.md; frontend's `api.ts` interfaces mirror the backend 1:1, both sides must add the optional field together |
| "Last refreshed" freshness | Frontend (client, in-memory) | — | D-14 explicitly: no new persistence; captured at the moment `fetchGraph()` resolves in the root loader |
| Keyboard/AT traversal | Frontend (client, custom over xyflow) | — | xyflow's own a11y model must be disabled and replaced; this is app-level interaction logic, not a data concern |

## Standard Stack

### Core

| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| `@xyflow/react` | **12.11.2** `[VERIFIED: npm registry]` | Node/edge canvas renderer, pan/zoom, custom node & edge components, `<Handle>` primitives | Already the locked ROADMAP/CONTEXT/UI-SPEC decision (D-01); actively maintained (xyflow/xyflow on GitHub), MIT-equivalent licence, the de facto React diagramming library |
| `@dagrejs/dagre` | **3.0.0** `[VERIFIED: npm registry]` | Headless layered-DAG layout algorithm (rank assignment + node placement) | Locked ROADMAP decision; deterministic, well-understood layered-graph algorithm; no UI of its own so it composes cleanly with xyflow's render layer |

**Installation:**
```bash
cd frontend
npm uninstall reactflow
npm install @xyflow/react@12.11.2 @dagrejs/dagre@3.0.0
```

**Version verification:** `npm view @xyflow/react version` → `12.11.2` (matches
03-UI-SPEC.md's already-pinned version, confirmed live this session).
`npm view @dagrejs/dagre version` → `3.0.0`, published 2026-03-22 — note this
is newer than any version 03-UI-SPEC.md or ROADMAP.md explicitly named; no
breaking API surface was found affecting `setGraph`/`setNode`/`setEdge`/
`layout()` between `@dagrejs/dagre` 1.x→3.x (the documented v2.0.0 change was
build/module-format only: added an ESM dist alongside the existing IIFE,
dropped Bower/Karma/JSHint tooling — no runtime API break) `[CITED: github.com/dagrejs/dagre/releases]`.
Pin the exact version in `package.json` rather than a caret range given how
recently 3.0.0 shipped, so a future `npm install` elsewhere in the team
doesn't silently pick up an even-newer major.

### Package Legitimacy Audit

| Package | Registry | Age | Downloads (last 7d) | Source Repo | Verdict | Disposition |
|---------|----------|-----|---------------------|--------------|---------|-------------|
| `@xyflow/react` | npm | created 2024-01-03 (~2.5 yrs) | 9,018,368 | github.com/xyflow/xyflow | OK | Approved |
| `@dagrejs/dagre` | npm | created 2017-12-26 (~8.5 yrs) | 3,561,727 | github.com/dagrejs/dagre | OK | Approved |

No `postinstall` scripts on either package (checked via `npm view <pkg>
scripts.postinstall`, both empty). **Packages removed due to SLOP verdict:**
none. **Packages flagged SUS:** none. Both packages were locked decisions
carried from ROADMAP.md/03-UI-SPEC.md (not discovered via this session's
WebSearch), and their registry existence, download volume, and GitHub source
repo were independently confirmed this session — tag as `[VERIFIED: npm registry]`.

### Alternatives Considered

| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| `@dagrejs/dagre` | `elkjs` (Eclipse Layout Kernel) | ELK produces higher-quality layered layouts and has a documented xyflow example specifically for multi-handle nodes, but is heavier (WebWorker-friendly async API, larger bundle) and is not the locked ROADMAP decision — out of scope to relitigate here |
| xyflow's built-in a11y (`nodesFocusable`/`edgesFocusable`) | Fully custom roving-tabindex (UI-SPEC's resolved choice) | Built-in model gives Tab-per-node/edge + arrow-key-drag "for free" but cannot express the UI-SPEC's rank/row/path-walk semantics; must be disabled, not extended |

## Architecture Patterns

### System Architecture Diagram

```
LineageGraph (backend, additive evidence field)
        │  fetchGraph() / sampleModel()
        ▼
adapt.ts ── layoutLineage() [Phase-2 topology: tables, notebooks, colEdges,
        │                     ops, xform — x/y positions from this module are
        │                     SUPERSEDED by dagre in Phase 3, see Pitfall below]
        ▼
AppModel (tables[], notebooks[], colEdges[], ops[], xform{})
        │
        ▼
frontend/src/views/LineageDagView.tsx  (NEW — replaces LineageView.tsx)
        │
        ├─► buildDagreLayout(tables, notebooks, ops, toggleState)
        │        → dagre.layout(g) → { x, y } per node (center→top-left
        │          converted) + per-node height from geometry table
        │
        ├─► toXyflowNodesAndEdges(tables, notebooks, colEdges, ops, dagrePositions)
        │        → xyflow Node[] (type: 'tableNode' | 'notebookNode')
        │        → xyflow Edge[] (type: 'lineageEdge', sourceHandle/targetHandle
        │          keyed by col.key or __node__ fallback per DAG-02/toggle)
        │
        ├─► <ReactFlow nodes edges nodeTypes edgeTypes
        │      nodesFocusable={false} edgesFocusable={false}
        │      disableKeyboardA11y />
        │        ├─ tableNode / notebookNode custom components
        │        │     → per-row <Handle> pair (Column mode) or
        │        │       __node__ fallback pair (Table mode)
        │        │     → useUpdateNodeInternals() on toggle flip
        │        ├─ lineageEdge custom component
        │        │     → stroke = edge-type hue, stroke-dasharray = provenance
        │        │     → opacity/stroke-width driven by trace() Set membership
        │        └─ <Background variant="dots" />  (no minimap)
        │
        ├─► trace(colEdges, activeColumnKey) → Set<string>   [ported verbatim
        │        from retired LineageView.tsx, drives dim/hot CSS classes]
        │
        ├─► useSelection() [Phase-2 ?sel/?col store] ◄── click/Enter/Space
        │
        └─► custom roving-tabindex layer (keydown handler on the xyflow
             wrapper div) → ↓/↑ row nav, →/← rank + path-walk nav,
             Home/End, Enter/Space → select()

Inspector.tsx (Phase 2, extended this phase)
        └─► ColumnCard: provenance line + Transform (.xform) +
             Source→Target (.flow-item) + Evidence (NEW) + Connections
```

### Recommended Project Structure

```
frontend/src/
├── views/
│   ├── LineageDagView.tsx        # NEW — replaces LineageView.tsx; mounts <ReactFlow>
│   ├── lineage-dag/
│   │   ├── TableNode.tsx         # custom node: header + column rows + handles
│   │   ├── NotebookNode.tsx      # custom node: header only, always __node__ handles
│   │   ├── LineageEdge.tsx       # custom edge: bezier path + provenance/type styling
│   │   ├── useDagreLayout.ts     # pure: (tables, notebooks, ops, toggleState) -> positions
│   │   ├── useLineageKeyboardNav.ts  # roving-tabindex + path-walk keydown handler
│   │   └── lineage-dag.css       # ported .ls-node/.col/.tick/.caret styles → xyflow node/edge classes
│   └── LineageView.tsx           # DELETED this phase
├── model/
│   ├── adapt.ts                  # extended: thread evidence through xform map (D-13)
│   └── lineageLayout.ts          # topology-only responsibility narrows — see Pitfall
└── shell/
    └── Inspector.tsx             # extended: ColumnCard with Evidence section

backend/app/
├── models.py     # + ColumnMapEvidence, ColumnMap.evidence: ColumnMapEvidence | None = None
└── parser.py     # _column_maps() gains cell_index param, computes line/snippet from re.Match
```

### Pattern 1: Custom node with per-column `<Handle>` pairs

**What:** Each column row renders two invisible, absolutely-positioned
`<Handle>` elements (`Position.Left`/`Position.Right`), one pair per row, `id`
derived from the column key — exactly as 03-UI-SPEC.md's Column-Row Edge
Anchoring section specifies.
**When to use:** Every `tableNode` in Column mode; skip entirely in Table mode
(render only the `__node__` fallback pair on the header).
**Example:**
```tsx
// Source: https://reactflow.dev/learn/customization/handles (CITED)
import { Handle, Position } from '@xyflow/react'

function TableNode({ data }: NodeProps<TableNodeData>) {
  return (
    <div className="ls-node">
      <div className="head">…</div>
      {data.mode === 'column' && (
        <div className="cols">
          {data.columns.map((c, i) => (
            <div className="col" key={c.key} data-col={c.key}>
              <Handle
                type="target" id={`${c.key}__target`} position={Position.Left}
                style={{ top: HEADER_H + i * ROW_H + ROW_H / 2 }}
              />
              <span className="name">{c.name}</span>
              <Handle
                type="source" id={`${c.key}__source`} position={Position.Right}
                style={{ top: HEADER_H + i * ROW_H + ROW_H / 2 }}
              />
            </div>
          ))}
        </div>
      )}
      {data.mode === 'table' && (
        <>
          <Handle type="target" id="__node__target" position={Position.Left} style={{ top: HEADER_H / 2 }} />
          <Handle type="source" id="__node__source" position={Position.Right} style={{ top: HEADER_H / 2 }} />
        </>
      )}
    </div>
  )
}
```

### Pattern 2: Re-measuring handles after a mode toggle (`useUpdateNodeInternals`)

**What:** When D-03's global Table↔Column toggle flips, every `tableNode`'s
handle set changes (per-row handles ↔ single `__node__` fallback). `@xyflow/react`
measures handle positions once after mount and **does not automatically detect
DOM changes to handle count/position** — edges will visually detach from their
handles (snap to a stale position, or render from the node's top-left corner)
unless the internals are explicitly invalidated. `[CITED: reactflow.dev/learn/customization/handles]`
**When to use:** In the effect that reacts to the toggle-state change, for
every node whose handle set just changed (i.e., every `tableNode`).
**Example:**
```tsx
// Source: https://reactflow.dev/learn/customization/handles (CITED)
import { useUpdateNodeInternals } from '@xyflow/react'

function useToggleModeEffect(toggleState: 'table' | 'column', tableNodeIds: string[]) {
  const updateNodeInternals = useUpdateNodeInternals()
  useEffect(() => {
    tableNodeIds.forEach((id) => updateNodeInternals(id))
  }, [toggleState, tableNodeIds, updateNodeInternals])
}
```

### Pattern 3: Dagre layout as a pure conversion step

**What:** Feed `(tables, notebooks, ops)` topology + per-node computed height
(from the geometry table: `40 + min(columns.length, 10) * 28`, capped at 320)
into dagre; read back `{x, y}` **center** points; convert to xyflow's
**top-left** `position` convention before constructing `Node[]`.
**When to use:** Once per render of the lineage view (recomputed on toggle
flip per D-07's "deterministic per toggle state" contract) — not per-frame,
not incrementally.
**Example:**
```ts
// Source: https://reactflow.dev/examples/layout/dagre + npm dagre usage
// pattern (CITED — dagre's config lives on setGraph, not layout()'s 2nd arg)
import dagre from '@dagrejs/dagre'

export function buildDagreLayout(
  tables: Table[], notebooks: NB[], ops: [string, string, 'reads' | 'writes'][],
  mode: 'table' | 'column',
): Map<string, { x: number; y: number }> {
  const g = new dagre.graphlib.Graph()
  g.setDefaultEdgeLabel(() => ({}))
  g.setGraph({ rankdir: 'LR', ranksep: 64, nodesep: 32, edgesep: 16, marginx: 32, marginy: 32 })

  for (const t of tables) {
    const height = mode === 'table' ? 40 : 40 + Math.min(t.columns.length, 10) * 28
    g.setNode(t.id, { width: 240, height })
  }
  for (const n of notebooks) g.setNode(n.id, { width: 240, height: 40 })
  for (const [s, t] of ops) g.setEdge(s, t)

  dagre.layout(g)

  const positions = new Map<string, { x: number; y: number }>()
  g.nodes().forEach((id) => {
    const n = g.node(id)
    // dagre gives the CENTER point; xyflow's Node.position is top-left.
    positions.set(id, { x: n.x - n.width / 2, y: n.y - n.height / 2 })
  })
  return positions
}
```

### Anti-Patterns to Avoid

- **Reusing `lineageLayout.ts`'s existing `place()` cursor-based x/y as the
  final node positions:** that function's longest-path depth + manual
  y-cursor stacking was Phase 2's placeholder so the old SVG view had
  *something* deterministic to render; it does not do dagre's rank
  compaction/barycenter ordering and will produce visually worse layouts than
  real dagre for anything beyond a trivial graph. Reuse its **topology
  extraction** (which tables/notebooks/ops exist, in what depth order) as
  input to real `dagre.layout()`, not its `{x, y}` output directly. Treat
  this as an explicit architectural decision for the planner: either dagre
  *replaces* `lineageLayout.ts`'s placement half while keeping its topology
  half, or a new sibling module (`useDagreLayout.ts` above) supersedes it
  entirely for the DAG view while `lineageLayout.ts` continues to serve any
  other consumer that still wants the cheap placeholder.
- **Importing `@xyflow/react/dist/style.css` (the full themed stylesheet):**
  it ships xyflow's own default colours (light-grey handles, blue selection
  outline, etc.) which will visually fight the project's OKLCH token system
  and reintroduce raw hex values the token audit (`scripts/audit-tokens.mjs`)
  is designed to catch. Import `@xyflow/react/dist/base.css` instead (layout-
  only reset, no colour) and style every visual aspect through the existing
  `.ls-node`/`.col`/`.tick` classes plus new tier-3 tokens, per 03-UI-SPEC.md's
  New Tier-3 Component Tokens section. `[CITED: reactflow.dev/learn/troubleshooting/migrate-to-v12]`
- **Reading `node.width`/`node.height` for dagre sizing in v12:** these were
  repurposed in v12 as *inline style overrides*, not measured dimensions.
  Measured dimensions live at `node.measured.width`/`node.measured.height`
  (only populated after xyflow's first render pass). Since this phase computes
  node height itself (from `columns.length`, deterministically, before dagre
  even runs), it never needs to read `node.measured` for layout — but any
  code that reflexively reaches for `node.width` expecting a v11 semantic
  will silently break. `[CITED: reactflow.dev/learn/troubleshooting/migrate-to-v12]`
- **Extending xyflow's built-in node/edge selection (`node.selected`,
  `onSelectionChange`) as the persistence mechanism for D-06/D-07:** the
  persisted selection is `?sel`/`?col` URL state (Phase-2 contract), and the
  hover-preview-without-losing-selection behaviour has no equivalent in
  xyflow's single built-in `selected` boolean. Drive all selection/hover
  visuals from the app's own `trace()` Set + `useSelection()`, not from
  xyflow's selection state; treat xyflow purely as a renderer.

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Layered DAG rank/position assignment | A custom longest-path + y-cursor placement algorithm (what `lineageLayout.ts` currently does) | `@dagrejs/dagre`'s `layout()` | dagre implements proper barycenter-based crossing minimization and rank compaction; a hand-rolled cursor stack produces visually worse layouts and re-solves a well-studied graph-layout problem the ROADMAP already chose a library for |
| Edge routing between DOM elements | Manual `getBoundingClientRect()` + cubic-bezier `curve()` math on every resize tick (the retired `LineageView.tsx` approach) | xyflow's `<Handle>` + custom edge component reading `sourceX/sourceY/targetX/targetY` props | xyflow already tracks handle positions via internal `ResizeObserver`s and passes resolved coordinates as props to the edge component — no manual DOM measurement loop needed |
| Keyboard focus management inside a canvas with hundreds of potential DOM tab stops | A per-node/per-edge native `tabIndex` grid (xyflow's own default, `nodesFocusable`/`edgesFocusable`) | A single roving-tabindex controller (UI-SPEC's resolved design) with one `tabIndex={0}` root and manually-managed internal focus | Native per-element tab stops don't scale to a graph with dozens-to-hundreds of edges and can't express rank/row/path-walk semantics; roving tabindex is the standard WAI-ARIA pattern for exactly this class of widget |

**Key insight:** Both dagre and xyflow exist specifically to remove the two
hardest parts of a from-scratch DAG canvas (layout algorithm, DOM-position
tracking) that the *retired* `LineageView.tsx` had to hand-roll because it
predated this milestone's renderer decision. The phase's real net-new
complexity is not "draw a graph" — it is the accessibility layer, the
provenance channel, and the evidence thread, none of which any library
provides out of the box.

## Common Pitfalls

### Pitfall 1: xyflow's default keyboard model actively conflicts with the UI-SPEC's custom scheme

**What goes wrong:** Left at its defaults, `@xyflow/react` makes every node
and edge its own native `tabIndex={0}` DOM element (`nodesFocusable`/
`edgesFocusable` both default `true`), so Tab walks through every node **and**
every edge one at a time — on a real lineage graph with dozens of column
edges this makes Tab traversal impractical, and it does not match "the canvas
is one Tab stop" at all. Separately, arrow keys **move (drag) the currently
selected node** by default when `nodesDraggable && nodesFocusable` — which
directly collides with the UI-SPEC's `↓`/`↑`/`→`/`←` row-nav and path-walk
keybindings on the *same keys*.
**Why it happens:** xyflow's built-in accessibility model was designed for
"make an existing mouse-drag canvas keyboard-operable," not for "replace the
canvas's keyboard model with a domain-specific listbox/grid pattern."
**How to avoid:** Set `nodesFocusable={false}`, `edgesFocusable={false}`, and
`disableKeyboardA11y={true}` on the `<ReactFlow>` instance, then build the
entire roving-tabindex + path-walk scheme as an app-level `keydown` handler on
the xyflow wrapper (`role="group"` per UI-SPEC), managing focus via `ref.focus()`
calls on the DOM elements the custom node/row components render. `nodesDraggable`
should also be `false` outright — this phase has no drag-to-reposition
requirement (layout is deterministic/dagre-computed) and leaving it on invites
users to accidentally break the deterministic layout DAG-07 requires.
**Warning signs:** Tab key visibly lands on individual edges during manual
testing; pressing an arrow key while a column is selected visibly moves a
card instead of shifting focus.

### Pitfall 2: Handle positions go stale across the Table↔Column toggle

**What goes wrong:** Flipping the global toggle changes a `tableNode`'s
rendered handle set (per-row handles in Column mode vs. the single
`__node__` fallback pair in Table mode). Without calling
`useUpdateNodeInternals()` for every affected node id after the toggle,
xyflow keeps using the handle geometry it measured at the *previous* render,
so edges appear to originate/terminate from the wrong point (often the
node's top-left corner) until an unrelated re-render happens to trigger a
re-measure.
**Why it happens:** xyflow measures handle DOM positions once via internal
`ResizeObserver`s tied to the handle elements' own lifecycle; swapping which
handles exist (not just resizing them) doesn't automatically fire that
observer for the *new* handle set in every browser/timing scenario.
**How to avoid:** Call `updateNodeInternals(nodeId)` for every `tableNode` id
inside the `useEffect` that reacts to `toggleState` changing (Pattern 2
above), *and* update the edges' `sourceHandle`/`targetHandle` ids in the same
render pass (switching between `${col.key}__source` and `__node__source`).
**Warning signs:** Edges visibly "jump" to a node's corner right after
toggling, then snap back to normal position after the next interaction (hover,
resize, etc.).

### Pitfall 3: dagre center-point vs. xyflow top-left position mismatch

**What goes wrong:** `dagre.layout()` writes `x`/`y` onto each graph node as
its **center** point. If those values are assigned directly to an xyflow
`Node.position` (which expects the node's **top-left** corner), every node
renders offset by half its own width/height — small nodes look "close
enough" during a quick visual check, but the offset compounds visibly for the
240×up-to-320px cards this phase uses, and dagre's own rank/nodesep spacing
calculations (already tuned against the *center*-point convention) end up
systematically wrong once xyflow re-interprets those numbers as corners.
**Why it happens:** dagre and xyflow simply use different conventions for
where a node's reported position refers to; this is a well-known integration
gotcha independent of xyflow version.
**How to avoid:** Convert explicitly: `xyflowX = dagreCenterX - width / 2`,
`xyflowY = dagreCenterY - height / 2` (Pattern 3's code example does this).
**Warning signs:** Cards visually overlap or have inconsistent gaps that
don't match the configured `nodesep`/`ranksep` values.

### Pitfall 4: `_column_maps()`'s evidence is per-cell, not per-column

**What goes wrong:** D-11/D-12 read as "the matched notebook cell + line/
snippet" per resolved column-edge, which could be misread as needing a
distinct line/snippet per individual `ColumnMap`. In the actual parser,
`_SELECT_RE.search(cell)` finds **one** `SELECT…FROM` match per cell, and
`_column_maps()` then splits that single match's captured group on commas to
produce multiple `ColumnMap`s — so every `ColumnMap` produced from the same
cell necessarily shares the same `cell_index`/`line`/`snippet` evidence (the
whole matched `SELECT` clause, not a per-column sub-match). This is correct
and sufficient for D-11 ("matched cell + line/snippet" — singular per
inferred edge, satisfied at the SELECT-statement granularity), but a plan
that assumes per-column line numbers will find they don't exist without a
much larger parser rewrite that is out of this phase's bounded scope.
**Why it happens:** The regex is written to find one SELECT list per cell and
sub-split the captured column list textually; it was never designed to track
per-token source positions within that list.
**How to avoid:** Attach one `ColumnMapEvidence` (notebook, cell_index, line,
snippet = the whole matched SELECT clause) to *every* `ColumnMap` produced
from that cell's match — do not attempt to compute a narrower per-column
snippet. Document this granularity explicitly in the Inspector copy/tests so
it's an intentional, understood limitation rather than a silent gap.
**Warning signs:** A test asserting two different columns from the same
SELECT list have *different* snippet text will fail by design — that's
expected, not a bug.

### Pitfall 5: `Column.pk` (primary-key badge) has no backend field

**What goes wrong:** 03-UI-SPEC.md's E3 row layout and accessible-name
template both reference a PK pill/badge (`"{name}, {type}{, primary key if
pk}, {table name}"`), and the frontend's local `Col` type
(`frontend/src/data.ts`) already has an optional `pk?: boolean` — but it is
only ever populated in the **bundled sample data** (`data.ts`'s hand-written
`TABLES` constant). The backend's `Column` Pydantic model
(`backend/app/models.py`) has only `name` and `data_type` — there is no
primary-key concept anywhere in `LineageGraph`, and `lineageLayout.ts`'s
adapter (`layoutLineage()`) does not set `pk` when building `Col`s from a
real `LineageGraph`. A live-fetched graph (real Fabric data or manual JSON
ingest) will therefore **never** show a PK badge, silently, even though the
UI has a rendering path ready for it.
**Why it happens:** PK metadata was never part of the Phase-1 backend model;
the sample data set `pk: true` by hand for two demo columns, creating an
illusion of a feature that isn't backed end-to-end.
**How to avoid:** This phase's UI-SPEC scope does not require adding a
backend PK field (not named in any DAG-*/TRUST-* requirement or CONTEXT
decision) — treat the PK badge as "renders when the field happens to be
present" (same "missing field omits its row" rule the Inspector already
applies elsewhere), and do not treat its absence on real data as a bug to
fix in this phase. Flag it as a known gap so nobody spends time debugging
"why doesn't PK show up on my real graph" during execution.
**Warning signs:** None expected if scoped correctly — this is purely a
documentation/expectation-setting item, not a code fix.

## Code Examples

### Custom edge with provenance + edge-type dual channel

```tsx
// Source: composed from https://reactflow.dev/api-reference/components/base-edge
// (CITED) + 03-UI-SPEC.md's Provenance & Edge-Type Channel section (locked)
import { BaseEdge, getBezierPath, type EdgeProps } from '@xyflow/react'

export function LineageEdge({
  sourceX, sourceY, targetX, targetY, sourcePosition, targetPosition,
  data,
}: EdgeProps<{ kind: 'reads' | 'writes' | 'derives'; provenance: 'declared' | 'inferred'; traced: 'on' | 'dim' | null }>) {
  const [path] = getBezierPath({ sourceX, sourceY, sourcePosition, targetX, targetY, targetPosition })
  const cls = ['lineage-edge', data.kind, data.provenance, data.traced ?? ''].join(' ')
  return <BaseEdge path={path} className={cls} />
}
```
```css
/* Source: 03-UI-SPEC.md Provenance & Edge-Type Channel table (locked) */
.lineage-edge.reads   { stroke: var(--color-edge-reads); }
.lineage-edge.writes  { stroke: var(--color-edge-writes); }
.lineage-edge.derives { stroke: var(--color-edge-derives); }
.lineage-edge.inferred { stroke-dasharray: var(--dag-edge-dasharray-inferred); }
.lineage-edge.declared { stroke-dasharray: var(--dag-edge-dasharray-declared); }
.lineage-edge.on  { stroke: var(--color-accent); stroke-width: var(--dag-trace-stroke-width); opacity: 1; }
.lineage-edge.dim { opacity: var(--dag-dim-opacity); pointer-events: none; }
```

### Backend evidence threading (D-12)

```python
# Source: backend/app/parser.py, existing _column_maps() — extended per
# 03-UI-SPEC.md's "Backend evidence threading" section (locked design)
def _column_maps(cell: str, notebook: str, cell_index: int) -> list[ColumnMap]:
    m = _SELECT_RE.search(cell)
    if not m:
        return []
    line = cell[: m.start()].count("\n") + 1  # 1-indexed for display
    snippet = m.group(0).strip()
    evidence = ColumnMapEvidence(notebook=notebook, cell_index=cell_index, line=line, snippet=snippet)
    maps: list[ColumnMap] = []
    for raw in m.group(1).split(","):
        # ... existing per-column parsing unchanged ...
        maps.append(ColumnMap(from_column=..., to_column=..., transform=..., evidence=evidence))
    return maps

# in parse_notebook(): for cell_index, cell in enumerate(nb.cells): ...
```

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|---------------|--------|
| `reactflow` (npm package name) | `@xyflow/react` | v12 release (package renamed, scoped) | Fresh install for this project — zero live usage of `reactflow` exists in-repo, confirmed by 03-UI-SPEC.md's own grep, so this is a clean swap not a code migration |
| CSS auto-injected by the library | Explicit `import '@xyflow/react/dist/base.css'` (or `style.css`) | v12 | Must be imported once at app bootstrap or the canvas renders unstyled/broken |
| `node.width`/`node.height` as measured dims | `node.measured.width`/`node.measured.height` | v12 | Only relevant if code reads xyflow's own measured dimensions post-render; this phase computes height itself pre-layout, so low direct impact, but worth knowing for any debugging |

**Deprecated/outdated:** `parentNode` → `parentId`, `onEdgeUpdate*` →
`onReconnect*`, `updateEdge` → `reconnectEdge`, `xPos`/`yPos` on custom node
props → `positionAbsoluteX`/`positionAbsoluteY`. None of these are used in
this phase's planned surface (no subflows, no edge-reconnection UI, no custom
node reading absolute position), but a plan copying an older reactflow-v11
code sample off the open web should be checked against this list.
`[CITED: reactflow.dev/learn/troubleshooting/migrate-to-v12]`

## Assumptions Log

| # | Claim | Section | Risk if Wrong |
|---|-------|---------|---------------|
| A1 | `dagre.layout()`'s config lives entirely on `g.setGraph({...})`, with no second-argument config form in the current `@dagrejs/dagre` 3.0.0 API | Architecture Patterns, Pattern 3 | Low — if a second-arg form does exist, the `setGraph` form still works (it is dagre's long-standing documented pattern); at worst the plan writes slightly more verbose code than necessary |
| A2 | `@dagrejs/dagre` 3.0.0 has no runtime-breaking API changes vs. earlier 1.x/2.x versions affecting this phase's usage (`setNode`/`setEdge`/`setGraph`/`layout`) | Standard Stack, version verification note | Medium — the GitHub releases page did not surface a detailed 3.0.0 changelog during this session's research; if 3.0.0 did introduce an undocumented break, pin to a known-good 2.0.x version instead and note the deviation |
| A3 | No cross-ecosystem or npm-registry legitimacy concern exists for either package (both pre-date this session by years and are the project's own locked ROADMAP decisions, not newly discovered) | Package Legitimacy Audit | Low — both independently confirmed via `npm view`/download-count API this session |

**If this table is empty:** N/A — three items above need at most a quick
confirmation during Wave 0 of planning (a `dagre.layout(g)` smoke test
resolves A1/A2 in minutes).

## Open Questions

1. **Does `lineageLayout.ts` get modified in place, or superseded by a new
   dagre-based module for the DAG view specifically?**
   - What we know: D-02 says "consume the decomposed pure layout model…
     rather than re-deriving positions ad hoc," which on its own reads as
     "reuse `lineageLayout.ts`'s output verbatim." But 03-UI-SPEC.md
     specifies concrete dagre tuning (`ranksep: 64`, `nodesep: 32`, etc.)
     that only makes sense if `dagre.layout()` is actually invoked, which
     `lineageLayout.ts`'s current custom placement algorithm does not do.
   - What's unclear: whether "the pure layout model" in D-02 refers to the
     whole module (positions included) or just its topology-extraction half
     (which tables/notebooks/ops exist, column lists, xform map) — the
     latter reading is consistent with both D-02 and the UI-SPEC's dagre
     spec; the former is not.
   - Recommendation: plan to keep `lineageLayout.ts`'s topology-building
     logic (or hoist the shared parts into `adapt.ts`, which already computes
     `colEdges`/`ops`/`xform`) and add a **new** `useDagreLayout.ts` that
     consumes that topology and produces `{x, y}` via real
     `dagre.layout()`, replacing `lineageLayout.ts`'s `place()` cursor
     algorithm for the DAG view specifically. This satisfies D-02's "don't
     re-derive positions ad hoc" in spirit (topology still flows from the
     single Phase-2 source) while giving 03-UI-SPEC.md's dagre tuning
     somewhere real to apply. Flag this resolution explicitly in the plan so
     it isn't silently reinterpreted during execution.

2. **Should `nodesDraggable` be fully disabled, or allowed with a
   snap-back-on-toggle behaviour?**
   - What we know: DAG-07 requires deterministic layout; 03-UI-SPEC.md does
     not mention drag-to-reposition anywhere as a feature.
   - What's unclear: whether a user accidentally dragging a card (if drag is
     left enabled by xyflow's default) would be considered a DAG-07
     violation requiring explicit prevention, or a harmless transient view
     state that resets on next data load.
   - Recommendation: set `nodesDraggable={false}` outright (Pitfall 1
     already recommends this for the keyboard-conflict reason); this also
     resolves this question by construction — there is no case where DAG-07
     could be violated because dragging is never possible.

## Environment Availability

| Dependency | Required By | Available | Version | Fallback |
|------------|------------|-----------|---------|----------|
| Node.js / npm | `npm install @xyflow/react @dagrejs/dagre` | ✓ (existing `frontend/` toolchain, Phase 1/2 already installed deps via npm) | — | — |
| Backend Python venv | D-12's parser.py/models.py change, backend test run | ✓ (`backend/.venv` exists, `backend/tests/test_parser.py` already passing) | — | — |

No missing dependencies — this phase adds two frontend npm packages and one
additive backend Pydantic field to an already-functioning toolchain; nothing
new needs installing at the environment level.

## Validation Architecture

### Test Framework

| Property | Value |
|----------|-------|
| Frontend framework | Vitest 4.1.10 + `@testing-library/react` 16.3.2, jsdom 29.1.1 environment (`frontend/vitest.config.ts`) |
| Backend framework | pytest (`backend/tests/`, existing `test_parser.py` conventions: plain `assert`, small IngestRequest/NotebookSource fixtures built inline) |
| Config file | `frontend/vitest.config.ts` (frontend), no dedicated pytest.ini found — assume `pytest` default discovery from `backend/tests/` |
| Quick run command (frontend) | `cd frontend && npx vitest run src/views/lineage-dag --reporter=dot` |
| Quick run command (backend) | `cd backend && .venv/Scripts/python -m pytest tests/test_parser.py -x` |
| Full suite command (frontend) | `cd frontend && npm run test:run` |
| Full suite command (backend) | `cd backend && .venv/Scripts/python -m pytest` |

**New setup requirement — not yet present:** `frontend/src/test/setup.ts`
currently only imports `@testing-library/jest-dom`; it has **no**
`ResizeObserver`/`DOMMatrixReadOnly`/`SVGElement.getBBox` mocks. `@xyflow/react`
requires all three to render in jsdom (confirmed via multiple community
reports this session `[CITED: reactflow.dev/learn/advanced-use/testing]`, and
generically for canvas-measuring libraries under jsdom). Any component test
that mounts `<ReactFlow>` (even shallow) will fail without these mocks. This
is a **Wave 0 gap**, not an assumption — add it to `test/setup.ts` before
writing the first `TableNode`/`LineageEdge` component test.

### Phase Requirements → Test Map

| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|--------|----------|-----------|---------------------|-------------|
| DAG-01 | LR dagre layout produces expected node count/order for a fixture graph | unit | `npx vitest run src/views/lineage-dag/useDagreLayout.test.ts` | ❌ Wave 0 |
| DAG-02 | Column edge's `sourceHandle`/`targetHandle` resolves to the exact `${col.key}__source`/`__target` id in Column mode, and to `__node__*` in Table mode | unit | `npx vitest run src/views/lineage-dag/toXyflowEdges.test.ts` | ❌ Wave 0 |
| DAG-03/DAG-04 | `trace()` returns the correct upstream+downstream Set for a fixture `colEdges` array; hover sets transient state, click persists via `useSelection` | unit + component | `npx vitest run src/views/lineage-dag` | ❌ Wave 0 (port `trace()` + its tests from the retired `LineageView.tsx`'s implicit behaviour — no existing test file for it today) |
| DAG-05/TRUST-02 | `ColumnCard` renders Transform/Source→Target/Evidence sections correctly, omits Evidence when absent | component | `npx vitest run src/shell/__tests__/Inspector.test.tsx` | Existing file, extend |
| DAG-06 | Toggling table↔column recomputes node heights and handle ids deterministically | unit | `npx vitest run src/views/lineage-dag/useDagreLayout.test.ts` | ❌ Wave 0 |
| DAG-07 | Same `LineageGraph` fixture + same toggle state → byte-identical `{x,y}` positions across two calls | unit | `npx vitest run src/views/lineage-dag/useDagreLayout.test.ts` | ❌ Wave 0 (same file as DAG-01/06, one determinism-focused case) |
| DAG-08 | Roving-tabindex keydown handler moves focus correctly for ↓/↑/→/←/Home/End on a fixture DOM | component | `npx vitest run src/views/lineage-dag/useLineageKeyboardNav.test.ts` | ❌ Wave 0 |
| TRUST-01 | Edge component applies correct `stroke-dasharray` class for declared vs inferred, independent of edge-type class | component | `npx vitest run src/views/lineage-dag/LineageEdge.test.tsx` | ❌ Wave 0 |
| TRUST-02 | `ColumnMapEvidence` round-trips through `ColumnMap` → `LineageGraph` → frontend `api.ts` interface without breaking existing manual-JSON fixtures (backward compatibility) | unit (backend) | `.venv/Scripts/python -m pytest tests/test_parser.py -k evidence` | ❌ Wave 0, extends `test_parser.py` |
| TRUST-03 | Freshness indicator shows relative time when `source==='live'` and fetchedAt is set; shows "Showing bundled sample data" when `source==='sample'` | component | `npx vitest run src/views/lineage-dag/FreshnessIndicator.test.tsx` | ❌ Wave 0 |

### Sampling Rate

- **Per task commit:** relevant quick-run command above (frontend or backend,
  whichever the task touched)
- **Per wave merge:** `npm run test:run` (frontend) + `pytest` (backend)
- **Phase gate:** Both full suites green, plus a manual/Playwright visual
  check per the standing light-mode discipline (pitfall #12) before
  `/gsd-verify-work`

### Wave 0 Gaps

- [ ] `frontend/src/test/setup.ts` — add `ResizeObserver`, `DOMMatrixReadOnly`,
      and `SVGElement.prototype.getBBox` mocks (required for any test that
      mounts `<ReactFlow>`, confirmed community requirement for xyflow-under-
      jsdom this session)
- [ ] `frontend/src/views/lineage-dag/useDagreLayout.test.ts` — covers DAG-01,
      DAG-06, DAG-07
- [ ] `frontend/src/views/lineage-dag/toXyflowEdges.test.ts` — covers DAG-02
- [ ] `frontend/src/views/lineage-dag/useLineageKeyboardNav.test.ts` — covers
      DAG-08
- [ ] `frontend/src/views/lineage-dag/LineageEdge.test.tsx` — covers TRUST-01
- [ ] `frontend/src/views/lineage-dag/FreshnessIndicator.test.tsx` — covers
      TRUST-03
- [ ] `backend/tests/test_parser.py` extension — covers TRUST-02's evidence
      threading + backward-compatibility (old fixtures with no `evidence`
      field must still parse)

## Security Domain

### Applicable ASVS Categories

| ASVS Category | Applies | Standard Control |
|---------------|---------|-------------------|
| V2 Authentication | No | Unchanged — this phase adds no auth surface (per-user auth is explicitly out of scope project-wide) |
| V3 Session Management | No | No session concept touched |
| V4 Access Control | No | No new authorization boundary; single shared service principal model unchanged |
| V5 Input Validation | **Yes** | Pydantic (`ColumnMapEvidence`) validates the new backend field's shape; on the frontend, React's default JSX text-node escaping (never `dangerouslySetInnerHTML`) is the control for rendering the verbatim `snippet`/notebook source text pulled from parsed code |
| V6 Cryptography | No | No new secrets/crypto surface |

### Known Threat Patterns for this stack

| Pattern | STRIDE | Standard Mitigation |
|---------|--------|----------------------|
| Reflected/stored XSS via rendering raw notebook source (the Evidence snippet, and the pre-existing "notebook code grep" feature) inside the Inspector | Tampering / Elevation of Privilege (script injection through data the app treats as trusted) | React's default JSX rendering HTML-escapes all text-node content automatically; the plan must explicitly forbid `dangerouslySetInnerHTML` anywhere the `snippet`/notebook source is rendered (Evidence code block, existing notebook code search results) — this is a **verification checklist item**, not new code, since neither the existing code-search feature nor the new Evidence block has any legitimate reason to use raw HTML injection |
| Backend accepting arbitrarily large/malformed notebook cell text that inflates `snippet` to an unbounded size in the API response | Denial of Service (payload bloat) | Out of this phase's bounded scope — `IngestRequest.notebooks[].cells` already accepts arbitrary strings pre-Phase-3 with no length cap; the new `evidence.snippet` field derives from the *same* already-unbounded cell text via `m.group(0)`, so it introduces no new attack surface beyond what already exists. Not a regression this phase should be asked to fix, but worth a one-line note if a future hardening pass tackles ingest payload limits generally |

## Sources

### Primary (HIGH confidence)
- npm registry (`npm view`) — `@xyflow/react` version 12.11.2, `@dagrejs/dagre`
  version 3.0.0, repository URLs, creation dates, postinstall scripts (all
  checked live this session)
- `https://api.npmjs.org/downloads/point/last-week/...` — weekly download
  counts for both packages (checked live this session)
- Direct codebase reads this session: `frontend/package.json`,
  `frontend/src/model/{lineageLayout,adapt,index}.ts`,
  `frontend/src/views/LineageView.tsx`, `frontend/src/selection/useSelection.ts`,
  `frontend/src/api.ts`, `frontend/src/tokens/canvasTokens.ts`,
  `frontend/src/shell/{Inspector,AppShell}.tsx`, `frontend/src/data.ts`,
  `frontend/src/routes/lineage/**`, `frontend/src/styles/components.css`,
  `backend/app/{models,parser}.py`, `backend/tests/test_parser.py`,
  `frontend/vitest.config.ts`, `frontend/src/test/setup.ts`,
  `.planning/config.json`

### Secondary (MEDIUM confidence — `[CITED]`)
- `https://reactflow.dev/learn/customization/handles` — multi-handle
  pattern, `useUpdateNodeInternals`
- `https://reactflow.dev/learn/advanced-use/accessibility` — default
  keyboard model, `nodesFocusable`/`edgesFocusable`/`disableKeyboardA11y`,
  `ariaLabelConfig`
- `https://reactflow.dev/learn/troubleshooting/migrate-to-v12` — full v11→v12
  breaking-change list, CSS import change, `node.measured`
- `https://reactflow.dev/examples/layout/dagre` — dagre + xyflow integration
  pattern (`setGraph` config, center→top-left conversion)
- `https://reactflow.dev/learn/advanced-use/testing` — jsdom mocking
  requirements for testing xyflow components
- `https://github.com/dagrejs/dagre/releases` — version history, v2.0.0
  module-format-only change note

### Tertiary (LOW confidence)
- None — every claim above traces to either a live registry/API check this
  session or an official xyflow/dagre documentation page.

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH — both packages version-verified live against the npm
  registry this session, both already locked project decisions
- Architecture: HIGH — official xyflow docs directly confirm the
  handle/keyboard/dagre-integration patterns; the two Open Questions are
  flagged honestly rather than papered over
- Pitfalls: HIGH — each pitfall traces to either an official docs page
  (keyboard model, handle re-measurement, v12 migration) or a direct read of
  this repo's own source (`_column_maps()`'s per-cell granularity, `Column.pk`'s
  missing backend field)

**Research date:** 2026-07-23
**Valid until:** 2026-08-22 (30 days — stable, mature libraries; re-verify
`@dagrejs/dagre` version pin specifically if more than a few weeks pass before
planning executes, given how recently 3.0.0 shipped)
