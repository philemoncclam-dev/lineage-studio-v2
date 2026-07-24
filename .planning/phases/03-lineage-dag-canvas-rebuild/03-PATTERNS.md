# Phase 3: Lineage DAG Canvas Rebuild - Pattern Map

**Mapped:** 2026-07-23
**Files analyzed:** 17
**Analogs found:** 15 / 17

## File Classification

| New/Modified File | Role | Data Flow | Closest Analog | Match Quality |
|---|---|---|---|---|
| `frontend/src/views/LineageDagView.tsx` | component (view) | request-response (renders loaded AppModel) | `frontend/src/views/LineageView.tsx` | exact (direct replacement) |
| `frontend/src/views/lineage-dag/TableNode.tsx` | component | transform (data→DOM) | `frontend/src/views/LineageView.tsx` (table `.ls-node` block, lines 123-147) | role-match |
| `frontend/src/views/lineage-dag/NotebookNode.tsx` | component | transform | `frontend/src/views/LineageView.tsx` (notebook `.ls-node` block, lines 114-121) | role-match |
| `frontend/src/views/lineage-dag/LineageEdge.tsx` | component | transform | `frontend/src/views/LineageView.tsx` (`curve()`/`<path>` rendering, lines 53-56, 105-112) | role-match |
| `frontend/src/views/lineage-dag/useDagreLayout.ts` | utility (pure) | batch/transform | `frontend/src/model/lineageLayout.ts` | role-match (topology extraction reused, placement algorithm replaced) |
| `frontend/src/views/lineage-dag/useLineageKeyboardNav.ts` | hook | event-driven | *(no analog — new pattern)* | none |
| `frontend/src/views/lineage-dag/lineage-dag.css` | config (styles) | — | `frontend/src/styles/components.css` (`.ls-node`/`.col`/`.tick`/`.caret`/`.edge` rules) | exact (port verbatim) |
| `frontend/src/views/lineage-dag/FreshnessIndicator.tsx` | component | request-response | `frontend/src/routes/__root.tsx` (source of `graph`/timing) + `frontend/src/model/index.tsx` (`AppModel.source`) | partial |
| `frontend/src/model/adapt.ts` (extended) | transform/service | CRUD (read-derive) | itself — extend `xform` map construction (lines 39-55) | exact (in-place extension) |
| `frontend/src/shell/Inspector.tsx` (extended) | component | request-response | itself — extend `TableCard` pattern (lines 77-111) with new `ColumnCard` | exact (in-place extension) |
| `frontend/src/selection/useSelection.ts` | store | request-response | reused unmodified | exact (no change needed) |
| `frontend/src/tokens/canvasTokens.ts` | utility | transform | reused unmodified | exact (no change needed) |
| `frontend/src/test/setup.ts` (extended) | config (test) | — | itself — add `ResizeObserver`/`DOMMatrixReadOnly`/`getBBox` mocks | exact (in-place extension) |
| `backend/app/models.py` (extended) | model | CRUD | itself — add `ColumnMapEvidence` beside `ColumnMap` (lines 39-44) | exact (in-place extension) |
| `backend/app/parser.py` (extended) | service | transform/batch | itself — extend `_column_maps()`/`parse_notebook()` (lines 74-116) | exact (in-place extension) |
| `frontend/src/views/lineage-dag/useDagreLayout.test.ts` | test | — | *(new; no direct existing analog for a layout-determinism test)* | none |
| `backend/tests/test_parser.py` (extended) | test | — | itself — mirror existing `_tables()`/`build_graph()` fixture-assert style (lines 9-44) | exact (in-place extension) |

## Pattern Assignments

### `frontend/src/views/LineageDagView.tsx` (component, request-response)

**Analog:** `frontend/src/views/LineageView.tsx` (152 lines, entire file is the ancestor being replaced)

**Imports pattern** (lines 1-3):
```typescript
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { useModel } from '../model'
import { useSelection } from '../selection/useSelection'
```
New file adds `@xyflow/react` imports (`ReactFlow`, `Background`, `useUpdateNodeInternals`) alongside these — keep `useModel`/`useSelection` imports identical.

**Trace logic to port verbatim** (lines 9-21):
```typescript
function trace(colEdges: [string, string][], id: string): Set<string> {
  const set = new Set<string>()
  const go = (c: string, dir: number) => {
    set.add(c)
    for (const [s, t] of colEdges) {
      if (dir >= 0 && s === c && !set.has(t)) go(t, 1)
      if (dir <= 0 && t === c && !set.has(s)) go(s, -1)
    }
  }
  go(id, 0)
  return set
}
```
Move this into a shared module (e.g. `lineage-dag/trace.ts`) so it's independently unit-testable per RESEARCH's DAG-03/DAG-04 test map — same BFS/DFS body, no algorithm change.

**Selection integration pattern** (lines 24-25, 32-34, 100-103, 138):
```typescript
const { select, clear } = useSelection()
const [selected, setSelected] = useState<string | null>(focusColumn ?? null)
useEffect(() => { if (focusColumn) setSelected(focusColumn) }, [focusColumn])
// empty-canvas click:
if (e.target === e.currentTarget) { setSelected(null); clear() }
// column click:
onClick={(e) => { e.stopPropagation(); setSelected(c.key); select(t.id, c.key) }}
```
D-06/D-07: keep `select()`/`clear()` as the only selection write path; hover state stays local (`useState`), never written to the URL.

**Empty-canvas click-to-clear pattern** (lines 92-104): reuse this guard (`e.target === e.currentTarget`) on the new `<ReactFlow onPaneClick>` handler instead of a raw `onClick` on a div.

**Anti-pattern warning:** do NOT port lines 43-79 (the `useLayoutEffect` DOM-measurement/`anchor()`/`curve()` edge-geometry block) — this is exactly the manual `getBoundingClientRect()` approach RESEARCH.md's "Don't Hand-Roll" table says xyflow's `<Handle>` + custom edge component replaces.

---

### `frontend/src/views/lineage-dag/TableNode.tsx` / `NotebookNode.tsx` (component, transform)

**Analog:** `frontend/src/views/LineageView.tsx` JSX structure (lines 114-147)

**Notebook card structure** (lines 114-121):
```tsx
<div className="ls-node" id={`ls-${nb.id}`} key={nb.id} style={{ left: nb.x, top: nb.y }}>
  <div className="head">
    <span className="tick notebook" />
    <div><div className="title">{nb.name}</div><div className="sub">notebook · PySpark</div></div>
  </div>
</div>
```

**Table card structure with column rows** (lines 123-147):
```tsx
<div className={`ls-node ${isOpen ? 'open' : ''} ${t.id === focusTable ? 'focus' : ''}`}
  id={`ls-${t.id}`} key={t.id} style={{ left: t.x, top: t.y }}>
  <div className="head" onClick={() => toggle(t.id)}>
    <span className={`tick ${t.layer}`} />
    <div><div className="title">{t.name}</div><div className="sub">{t.layer}</div></div>
    <span className="caret"><Caret /></span>
  </div>
  <div className="cols">
    {t.columns.map((c) => (
      <div className={`col ${traced?.has(c.key) && c.key !== active ? 'hot' : ''} ${c.key === selected ? 'sel' : ''}`}
        key={c.key} data-col={c.key}
        onMouseEnter={() => setHover(c.key)} onMouseLeave={() => setHover(null)}
        onClick={(e) => { e.stopPropagation(); setSelected(c.key); select(t.id, c.key) }}>
        <span className="name">{c.name}</span>
        {c.pk && <span className="pk">PK</span>}
        <span className="type">{c.type}</span>
      </div>
    ))}
  </div>
</div>
```
Keep `.ls-node`/`.head`/`.tick`/`.title`/`.sub`/`.caret`/`.cols`/`.col`/`.name`/`.pk`/`.type`/`.hot`/`.sel` classes verbatim — 03-UI-SPEC.md mandates the visual language is unchanged, only the positioning mechanism (xyflow `<Handle>` per-row per UI-SPEC's Column-row edge anchoring section) is new. Per D-03, drop the per-card `toggle(t.id)` `onClick` on `.head` — replaced by the new global toolbar toggle; header click now only calls `select()`.

**Caret icon component** (line 5):
```tsx
const Caret = () => <svg viewBox="0 0 24 24"><path d="M9 6l6 6-6 6" /></svg>
```
Only needed if Table mode keeps an expand affordance; per D-03 (global toggle, no per-card state) this may become unused — flag for planner to confirm removal or repurpose.

---

### `frontend/src/views/lineage-dag/LineageEdge.tsx` (component, transform)

**Analog:** `frontend/src/views/LineageView.tsx` (lines 53-56, 105-112)

**Curve math being replaced by xyflow's `getBezierPath`:**
```typescript
const curve = (a: { x: number; y: number }, b: { x: number; y: number }) => {
  const dx = Math.max(40, Math.abs(b.x - a.x) * 0.5)
  return `M${a.x},${a.y} C${a.x + dx},${a.y} ${b.x - dx},${b.y} ${b.x},${b.y}`
}
```

**Edge class-driven styling pattern to port** (lines 106-111):
```typescript
{paths.map((p, i) => {
  const isCol = !!p.from
  const on = isCol && traced?.has(p.from!) && traced?.has(p.to!)
  const cls = ['edge', p.kind ?? '', on ? 'hot' : '', traced && !on ? 'dim' : ''].join(' ')
  return <path key={i} d={p.d} className={cls} />
})}
```
Same class-composition idiom (`['base', kind, tracedState].join(' ')`) carries directly into `LineageEdge`'s `cls` construction per RESEARCH.md's Code Examples section — add `provenance` (`declared`/`inferred`) as a fourth class per D-08/TRUST-01, hardcoded `'inferred'` per D-09.

**CSS to port** — locate `.ls-edges .edge`/`.edge.hot`/`.edge.dim` rules in `frontend/src/styles/components.css` (transition timing 180ms, referenced by 03-UI-SPEC.md) and carry stroke-dasharray additions alongside.

---

### `frontend/src/views/lineage-dag/useDagreLayout.ts` (utility, pure)

**Analog:** `frontend/src/model/lineageLayout.ts` (56 lines)

**Reuse — topology extraction (depth via longest path)** (lines 26-36):
```typescript
const depth = new Map<string, number>()
const ids = [...tableNodes.map((t) => tid(t.id)), ...nbNodes.map((n) => nid(n.id))]
ids.forEach((i) => depth.set(i, 0))
for (let pass = 0; pass < ids.length; pass++) {
  let changed = false
  for (const [s, t] of ops) {
    const d = (depth.get(s) ?? 0) + 1
    if (d > (depth.get(t) ?? 0)) { depth.set(t, d); changed = true }
  }
  if (!changed) break
}
```
Per RESEARCH.md's Open Question #1 resolution: this depth-only signal is superseded entirely by `dagre.layout()`'s own rank assignment — do not port it; dagre computes ranks from the edge list directly (`g.setEdge(s, t)`), no manual longest-path pass needed.

**Reuse — table/notebook shape construction** (lines 45-56):
```typescript
const tables: Table[] = tableNodes.map((t) => {
  const id = tid(t.id)
  const layer = layerOf(t)
  const pos = place(id, 47 + 29 * t.columns.length)
  return {
    id, name: t.name, layer, c: colorFor(layer), ...pos,
    columns: t.columns.map((c) => ({ key: `${id}.${c.name}`, name: c.name, type: c.data_type ?? '' })),
  }
})
const notebooks: NB[] = nbNodes.map((n) => ({ id: nid(n.id), name: n.name, ...place(nid(n.id), 47) }))
```
Reuse this shape-building (id/name/layer/columns extraction, `colorFor()`, `nid()`/`tid()`) verbatim in the new module; replace only `place()` (the cursor-based `{x, y}` calc, lines 37-43) with a call into the RESEARCH.md Pattern-3 `buildDagreLayout()` (center→top-left conversion, `dagre.layout(g)`).

**Anti-pattern:** do not feed `lineageLayout.ts`'s `place()` output directly as final xyflow positions (RESEARCH.md Anti-Patterns section, first bullet) — its y-cursor stacking is not dagre's barycenter compaction.

---

### `frontend/src/model/adapt.ts` (extended, in-place)

**Analog:** itself — the existing `xform` map construction (lines 39-55) is what D-11/D-13 extend, not rebuild

**Current pattern:**
```typescript
for (const m of e.columns) {
  const toCol = target.columns.find((c) => c.name === m.to_column)
  if (!toCol) continue
  const tokens = m.from_column.match(/\w+/g) ?? []
  let fromKey: string | undefined
  for (const tk of tokens) {
    const src = readTables.find((t) => t.columns.some((c) => c.name === tk))
    if (src) { fromKey = `${src.id}.${tk}`; break }
  }
  if (fromKey) colEdges.push([fromKey, toCol.key])
  const srcLabel = fromKey ?? m.from_column
  xform[toCol.key] = m.transform
    ? [m.transform, `Computed as ${m.transform} in ${nb.name}.`]
    : [m.from_column, `Passed through from ${srcLabel.replace('.', ' · ')} by ${nb.name}.`]
}
```
D-11/D-13: extend the `xform` value tuple (or add a parallel `evidence: Record<string, ColumnMapEvidence>` map on `AppModel`) sourced from `m.evidence` (new optional field on the backend `ColumnMap`, threaded through `LineageGraph`/`api.ts`). Keep the plain-English synthesis (`Computed as…`/`Passed through from…`) exactly as-is — D-13 explicitly forbids moving this logic to the backend.

---

### `frontend/src/shell/Inspector.tsx` (extended, in-place)

**Analog:** itself — `TableCard`'s `.sec`/`.sec-t` pattern (lines 77-111)

**Pattern to replicate for the new `ColumnCard`:**
```tsx
function TableCard({ table, context, selectedCol }: { table: Table; context?: TableContext; selectedCol?: string }) {
  return (
    <>
      {table.layer && (
        <div className="sec">
          <div className="sec-t">Location</div>
          <div className="inspector-location">{table.layer}</div>
        </div>
      )}
      {table.columns.length > 0 && (
        <div className="sec">
          <div className="sec-t">Columns <span className="n">{table.columns.length}</span></div>
          <div className="inspector-cols">...</div>
        </div>
      )}
      {context && (
        <div className="sec">
          <div className="sec-t">Connections ({context.up.length} in / {context.down.length} out)</div>
        </div>
      )}
    </>
  )
}
```
**Missing-field-omits-its-row rule** (lines 80, 86, 102 — each section wrapped in a truthy guard) — apply identically to the new `ColumnCard`'s Evidence section (D-11 fallback: omit entirely when no evidence resolves) and to the Transform section's code block (omit when `m.transform` is null, per adapt.ts's existing pass-through branch).

**`resolveSelected()` dispatch pattern** (lines 31-37):
```typescript
function resolveSelected(model: AppModel, sel: string): Resolved | null {
  const table = model.tables.find((t) => t.id === sel)
  if (table) return { kind: 'table', name: table.name, table, context: model.context[table.id] }
  const notebook = model.notebooks.find((n) => n.id === sel)
  if (notebook) return { kind: 'notebook', name: notebook.name }
  return null
}
```
Add a third branch: when `col` (from `useSelection()`) is set alongside `sel`, resolve and render `ColumnCard` instead of/in addition to `TableCard` — the component already destructures `col` (line 40) but never consumes it (DAG-05 gap this phase fills).

**Esc-to-clear listener** (lines 46-53) — unchanged, do not duplicate in the new canvas view.

---

### `frontend/src/selection/useSelection.ts` — reused unmodified

**Analog:** itself, no changes needed

**Selection write path** (lines 33-46):
```typescript
const select = (nodeId?: string, colKey?: string) => {
  void navigate({
    search: ((prev: Record<string, unknown>) => ({ ...prev, sel: nodeId, col: colKey })) as never,
    replace: true,
  })
}
const clear = () => select(undefined, undefined)
return { sel: search.sel, col: search.col, select, clear }
```
Import and call `useSelection()` exactly as `LineageView.tsx` currently does (line 25) — this is D-07's binding contract, no local state model permitted for persisted selection.

---

### `frontend/src/tokens/canvasTokens.ts` — reused unmodified

**Analog:** itself; also `frontend/src/shell/GraphView.tsx`'s existing consumption pattern (per module doc comment, lines 6-9) is the established bridge-usage precedent for a canvas-drawn colour consumer

**Cached-token read pattern** (lines 113-118):
```typescript
export function getCanvasTokens(): CanvasTokens {
  if (!cached) cached = readTokensFromDOM()
  return cached
}
```
Any xyflow custom node/edge component that needs a raw colour value (e.g. edge-type hue swatch inside `LineageEdge`, or the Inspector's provenance swatch icon) must call `getCanvasTokens()` — never read `getComputedStyle`/hex literals directly, per the module's own prohibition comment and CLAUDE.md's token discipline.

---

### `backend/app/models.py` (extended, in-place)

**Analog:** itself — `ColumnMap` (lines 39-44), extended additively per D-12

**Current model:**
```python
class ColumnMap(BaseModel):
    """A single source-column -> target-column derivation."""
    from_column: str
    to_column: str
    transform: str | None = Field(None, description="Human-readable transform, e.g. 'upper(x)'")
```
Add (03-UI-SPEC.md's exact locked shape):
```python
class ColumnMapEvidence(BaseModel):
    notebook: str
    cell_index: int
    line: int
    snippet: str

class ColumnMap(BaseModel):
    from_column: str
    to_column: str
    transform: str | None = None
    evidence: ColumnMapEvidence | None = None   # NEW, additive, optional
```
Backward compatibility: `LineageGraph` (lines 58-60) and `Edge` (lines 50-55) are untouched containers — no shape change propagates beyond `ColumnMap` gaining one optional field, satisfying CLAUDE.md's stability rule.

---

### `backend/app/parser.py` (extended, in-place)

**Analog:** itself — `_column_maps()` (lines 74-89) and `parse_notebook()`'s cell loop (lines 92-116)

**Current per-cell scan (no cell_index, no evidence):**
```python
def _column_maps(cell: str) -> list[ColumnMap]:
    m = _SELECT_RE.search(cell)
    if not m:
        return []
    maps: list[ColumnMap] = []
    for raw in m.group(1).split(","):
        expr = raw.strip()
        if not expr or expr == "*":
            continue
        alias_m = re.search(r"\bAS\s+([\w]+)\s*$", expr, re.I)
        target = alias_m.group(1) if alias_m else expr.split(".")[-1]
        target = re.sub(r"[^\w]", "", target) or expr
        transform = None if re.fullmatch(r"[\w.]+", expr) else expr
        maps.append(ColumnMap(from_column=expr.split(" AS ")[0].strip(), to_column=target, transform=transform))
    return maps
```
```python
for cell in nb.cells:
    scannable = _without_python_imports(cell)
    reads |= _find(_READ_PATTERNS, scannable)
    writes |= _find(_WRITE_PATTERNS, scannable)
    col_maps.extend(_column_maps(scannable))
```
Extend per RESEARCH.md's Code Examples section (`_column_maps(cell, notebook, cell_index)`): compute `line = cell[:m.start()].count('\n') + 1` and `snippet = m.group(0).strip()` once per cell match, attach the same `ColumnMapEvidence` instance to every `ColumnMap` produced from that cell (Pitfall 4 — evidence granularity is per-cell/per-SELECT, not per-column; do not attempt narrower per-column snippets). Update the `for cell in nb.cells:` loop to `for cell_index, cell in enumerate(nb.cells):` and thread `nb.name`/`cell_index` through the call.

---

### `frontend/src/test/setup.ts` (extended, in-place)

**Analog:** itself (1 line today)

**Current file:**
```typescript
import '@testing-library/jest-dom'
```
RESEARCH.md's Validation Architecture flags this as a Wave-0 gap: add `ResizeObserver`, `DOMMatrixReadOnly`, and `SVGElement.prototype.getBBox` mocks before any test mounts `<ReactFlow>` — `[CITED: reactflow.dev/learn/advanced-use/testing]`. No existing in-repo analog for these three specific mocks; write them as plain `globalThis`/`class` polyfills alongside the existing import.

---

### `backend/tests/test_parser.py` (extended, in-place)

**Analog:** itself — existing fixture/assert idiom (lines 9-44)

**Pattern to replicate for TRUST-02's evidence tests:**
```python
def _tables(cells: list[str]) -> set[str]:
    graph = build_graph(IngestRequest(notebooks=[NotebookSource(name="nb", cells=cells)]))
    return {n.name for n in graph.nodes if n.id.startswith("table.")}

def test_a_real_from_clause_still_reads():
    assert "raw_orders" in _tables(["df = spark.sql('SELECT * FROM raw_orders')"])
```
Same style: small inline `IngestRequest`/`NotebookSource` fixtures, plain `assert`, one behavior per test function, descriptive docstring anchored to a concrete scenario. Add `test_column_map_carries_evidence()` (asserts `evidence.notebook`/`cell_index`/`line`/`snippet` populated) and `test_evidence_is_optional_for_backward_compat()` (asserts a graph built without any SELECT still produces `ColumnMap`s with `evidence=None`, and that old fixtures without the field still round-trip through `LineageGraph.model_validate()`).

---

## Shared Patterns

### Trace-driven CSS class composition
**Source:** `frontend/src/views/LineageView.tsx` lines 106-111, 135
**Apply to:** `TableNode.tsx` (column row classes), `LineageEdge.tsx` (edge classes)
```typescript
const cls = ['edge', p.kind ?? '', on ? 'hot' : '', traced && !on ? 'dim' : ''].join(' ')
```
Same `[base, ...conditionalClasses].join(' ')` idiom used throughout — extend with a `provenance` slot (`declared`/`inferred`) per D-08, and swap the two-tier `hot`/`dim` for xyflow's D-05 "traced (1.0 opacity) vs unrelated (0.15, non-interactive)" binary exactly as 03-UI-SPEC.md's Trace & Selection table specifies.

### Selection store as single write path
**Source:** `frontend/src/selection/useSelection.ts` (whole file, unchanged) + its usage in `frontend/src/views/LineageView.tsx` lines 25, 138 and `frontend/src/shell/Inspector.tsx` lines 40, 49
**Apply to:** all new lineage-dag components that trigger selection (`TableNode`, column rows, keyboard nav's Enter/Space handler)
```typescript
const { select, clear } = useSelection()
// ...
onClick={(e) => { e.stopPropagation(); select(t.id, c.key) }}
```

### Missing-field-omits-its-row
**Source:** `frontend/src/shell/Inspector.tsx` lines 80, 86, 102 (`{table.layer && (...)}`, `{table.columns.length > 0 && (...)}`, `{context && (...)}`)
**Apply to:** the new `ColumnCard`'s Transform code block (omit when `m.transform` is null), Evidence section (omit when no evidence resolves)

### Cached canvas-token read (no raw hex/px)
**Source:** `frontend/src/tokens/canvasTokens.ts` lines 113-118, module doc comment lines 1-9
**Apply to:** any xyflow custom node/edge component or Inspector swatch that needs a computed colour value
```typescript
export function getCanvasTokens(): CanvasTokens {
  if (!cached) cached = readTokensFromDOM()
  return cached
}
```

### Additive, optional backend field (Pydantic + LineageGraph stability)
**Source:** `backend/app/models.py` — the whole file's existing shape (`ColumnMap.transform: str | None = None` is the precedent for `evidence`)
**Apply to:** `backend/app/models.py`'s new `ColumnMapEvidence`/`ColumnMap.evidence`, and its TypeScript mirror in `frontend/src/api.ts`'s `ColumnMap` interface
```python
transform: str | None = Field(None, description="...")
```
Every new field on a shared contract type is `X | None = None` (Python) / `X | undefined` (TypeScript) — never a required addition, per CLAUDE.md's "keep the LineageGraph shape stable" rule.

## No Analog Found

| File | Role | Data Flow | Reason |
|------|------|-----------|--------|
| `frontend/src/views/lineage-dag/useLineageKeyboardNav.ts` | hook | event-driven | No existing roving-tabindex/custom keyboard-nav controller exists anywhere in the codebase (Rail/CommandPalette use native focus, not a custom scheme); RESEARCH.md's Architecture Patterns section + 03-UI-SPEC.md's Keyboard & AT Traversal Model table are the binding design source instead of a codebase analog |
| `frontend/src/views/lineage-dag/useDagreLayout.test.ts` | test | — | No prior test exercises `lineageLayout.ts`'s determinism directly; RESEARCH.md's Validation Architecture "Phase Requirements → Test Map" table specifies the exact assertions (DAG-01/06/07) to write from scratch |

## Metadata

**Analog search scope:** `frontend/src/views/`, `frontend/src/model/`, `frontend/src/selection/`, `frontend/src/tokens/`, `frontend/src/shell/`, `frontend/src/model-studio/`, `frontend/src/test/`, `backend/app/`, `backend/tests/`
**Files scanned:** `LineageView.tsx`, `adapt.ts`, `lineageLayout.ts`, `useSelection.ts`, `canvasTokens.ts`, `Inspector.tsx`, `models.py`, `parser.py`, `test_parser.py`, `test/setup.ts`, `vitest.config.ts`, `model-studio/*` (confirmed no reactflow/xyflow dependency, D-01 non-issue), `routes/__root.tsx`, `model/index.tsx`, `package.json`
**Pattern extraction date:** 2026-07-23
