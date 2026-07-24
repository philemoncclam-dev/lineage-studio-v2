// LineageDagView — the finished DAG canvas assembly (03-07). Mounts a single
// <ReactFlow> using the pure layout/mapping core (03-03: buildDagreLayout,
// toXyflow, trace), the custom nodes/edges (03-05: TableNode, NotebookNode,
// LineageEdge), and the keyboard/freshness pieces (03-06:
// useLineageKeyboardNav, FreshnessIndicator) — replacing the retired
// frontend/src/views/LineageView.tsx (its trace/selection/empty-canvas-click
// patterns carry forward per 03-PATTERNS.md; its useLayoutEffect DOM-
// measurement block does not, per RESEARCH.md's Don't Hand-Roll table).
//
// This plan owns two pieces of wiring 03-05 explicitly deferred (03-05
// SUMMARY): injecting `data.traced` onto edges and the `.ls-node.dim`/
// `.col.dim` classes per the active trace (done via new optional fields on
// TableNodeData/NotebookNodeData, see lineage-dag/types.ts), and calling
// useUpdateNodeInternals() on every Table<->Column toggle flip (RESEARCH.md
// Pitfall 2).
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  Background,
  BackgroundVariant,
  ReactFlow,
  ReactFlowProvider,
  useUpdateNodeInternals,
  type Edge,
  type Node,
} from '@xyflow/react'
// Base layout-reset only — never the themed dist/style.css (RESEARCH.md
// Anti-Patterns: importing the themed sheet would reintroduce raw-hex xyflow
// defaults the token audit is designed to catch).
import '@xyflow/react/dist/base.css'
import { useModel, type AppModel } from '../model'
import { Route as RootRoute } from '../routes/__root'
import { useSelection } from '../selection/useSelection'
import FreshnessIndicator from './lineage-dag/FreshnessIndicator'
import LineageEdge, { type TracedLineageEdgeData } from './lineage-dag/LineageEdge'
import NotebookNode from './lineage-dag/NotebookNode'
import TableNode from './lineage-dag/TableNode'
import { trace } from './lineage-dag/trace'
import { LINEAGE_EDGE_TYPE, NOTEBOOK_NODE_TYPE, TABLE_NODE_TYPE, toXyflow } from './lineage-dag/toXyflow'
import { tableIdOfColKey, type LineageMode, type NotebookNodeData, type TableNodeData } from './lineage-dag/types'
import { buildDagreLayout } from './lineage-dag/useDagreLayout'
import { useLineageKeyboardNav, type FocusTarget } from './lineage-dag/useLineageKeyboardNav'
import './lineage-dag/lineage-dag.css'

// Stable module-scope maps — recreating these object literals every render
// is a documented xyflow anti-pattern (forces every node/edge to re-mount).
const nodeTypes = { [TABLE_NODE_TYPE]: TableNode, [NOTEBOOK_NODE_TYPE]: NotebookNode }
const edgeTypes = { [LINEAGE_EDGE_TYPE]: LineageEdge }

export interface LineageDagViewProps {
  focusTable?: string
  focusColumn?: string
}

// "{tableName}.{colName}" — human-readable qualified label for the sr-only
// edge summary list (DAG-08); falls back to the raw key/id if a lookup
// somehow misses (never throws on a malformed fixture).
function colLabel(model: AppModel, key: string): string {
  const table = model.tables.find((t) => t.id === tableIdOfColKey(key))
  const col = table?.columns.find((c) => c.key === key)
  return `${table?.name ?? tableIdOfColKey(key)}.${col?.name ?? key}`
}

// The notebook that produced a column edge's target: prefer the new
// evidence map (D-12, populated for real backend-parsed data), falling back
// to the table-level `writes` op that feeds the target table (covers the
// bundled sample model, whose XFORM has no structured evidence).
function notebookForColEdge(model: AppModel, toKey: string): string {
  const fromEvidence = model.evidence[toKey]?.notebook
  if (fromEvidence) return fromEvidence
  const toTable = tableIdOfColKey(toKey)
  const writeOp = model.ops.find(([, target, kind]) => kind === 'writes' && target === toTable)
  if (!writeOp) return ''
  return model.notebooks.find((n) => n.id === writeOp[0])?.name ?? writeOp[0]
}

export default function LineageDagView(props: LineageDagViewProps) {
  // useUpdateNodeInternals (and the rest of the flow hooks used below) only
  // resolve inside a <ReactFlowProvider> — wrapping here lets the same inner
  // component both render <ReactFlow> and call flow hooks (RESEARCH.md
  // Pattern 2's standard "toolbar needs the flow store" shape).
  return (
    <ReactFlowProvider>
      <LineageDagViewInner {...props} />
    </ReactFlowProvider>
  )
}

function LineageDagViewInner({ focusTable, focusColumn }: LineageDagViewProps) {
  void focusColumn // reflected via useSelection().col below (D-07 single source of truth), kept for prop-contract parity with the retired LineageView
  const model = useModel()
  const { fetchedAt } = RootRoute.useLoaderData()
  const { col: selectedCol, select, clear } = useSelection()
  const [mode, setMode] = useState<LineageMode>('column')
  const [hover, setHover] = useState<string | null>(null)
  const containerRef = useRef<HTMLDivElement>(null)
  const updateNodeInternals = useUpdateNodeInternals()

  const isEmpty = model.tables.length === 0 && model.notebooks.length === 0

  const positions = useMemo(
    () => buildDagreLayout(model.tables, model.notebooks, model.ops, mode),
    [model.tables, model.notebooks, model.ops, mode],
  )

  const xyflowGraph = useMemo(
    () => toXyflow(model.tables, model.notebooks, model.colEdges, model.ops, positions, mode),
    [model.tables, model.notebooks, model.colEdges, model.ops, positions, mode],
  )

  // D-06: hover previews a trace transiently; a click freezes it via
  // useSelection().select() (D-07's single write path, already wired inside
  // TableNode/NotebookNode). Hovering a different column while one is
  // selected overrides the rendered trace without mutating the URL —
  // `active` simply prefers the transient hover over the persisted
  // selection, reverting the instant the hover ends.
  const active = hover ?? selectedCol ?? null
  const traced = useMemo(() => (active ? trace(model.colEdges, active) : null), [active, model.colEdges])

  const nodes = useMemo<Node[]>(() => {
    return xyflowGraph.nodes.map((n) => {
      // xyflow's own Node.className lands on the .react-flow__node wrapper
      // (not on TableNode/NotebookNode's inner .ls-node div), so this is a
      // separate CSS hook (.lineage-focus, lineage-dag.css) — a direct port
      // of the retired LineageView.tsx's `.ls-node.focus` ring for the
      // route-deep-linked-to table (focusTable prop), applied without
      // needing to add another data field to either node component.
      const className = n.id === focusTable ? 'lineage-focus' : undefined
      if (n.type === TABLE_NODE_TYPE) {
        const data = n.data as TableNodeData
        return { ...n, data: { ...data, traced, active, onHoverColumn: setHover }, className } as Node
      }
      const data = n.data as NotebookNodeData
      return { ...n, data: { ...data, dim: traced != null }, className } as Node
    })
  }, [xyflowGraph.nodes, traced, active, focusTable])

  const edges = useMemo<Edge[]>(() => {
    return xyflowGraph.edges.map((e) => {
      let tracedState: 'on' | 'dim' | null = null
      if (traced) {
        const isOn = !!(e.data.from && e.data.to && traced.has(e.data.from) && traced.has(e.data.to))
        tracedState = isOn ? 'on' : 'dim'
      }
      const data: TracedLineageEdgeData & Record<string, unknown> = { ...e.data, traced: tracedState }
      return { ...e, data } as unknown as Edge
    })
  }, [xyflowGraph.edges, traced])

  // Table<->Column toggle re-measure (RESEARCH.md Pitfall 2/Pattern 2): every
  // table node's handle set changes shape (per-row handles <-> the single
  // __node__ fallback pair) on a mode flip, and xyflow does not auto-detect
  // that DOM change — without this, edges visually detach until an
  // unrelated re-render happens to trigger a re-measure.
  useEffect(() => {
    for (const t of model.tables) updateNodeInternals(t.id)
  }, [mode, model.tables, updateNodeInternals])

  // Roving-tabindex bootstrap (WAI-ARIA pattern): TableNode/NotebookNode
  // always mount their focus targets at tabIndex={-1} (03-05); exactly one
  // needs tabIndex 0 so Tab can land inside the canvas at all. Re-runs on
  // mode flips (column rows mount/unmount then) and whenever the node/rank
  // topology changes — not on hover/selection alone (those don't remount
  // the underlying [data-lineage-focus] elements, so this wouldn't fight
  // useLineageKeyboardNav's own imperative tabIndex management mid-session).
  const rankOf = useMemo(() => {
    const xs = Array.from(new Set(Array.from(positions.values()).map((p) => p.x))).sort((a, b) => a - b)
    const m = new Map<string, number>()
    for (const [id, pos] of positions) m.set(id, xs.indexOf(pos.x))
    return m
  }, [positions])

  const focusTargets = useMemo<FocusTarget[]>(() => {
    const headers = [
      ...model.tables.map((t) => ({ id: t.id, isTable: true as const })),
      ...model.notebooks.map((n) => ({ id: n.id, isTable: false as const })),
    ].sort((a, b) => {
      const pa = positions.get(a.id) ?? { x: 0, y: 0 }
      const pb = positions.get(b.id) ?? { x: 0, y: 0 }
      return pa.x !== pb.x ? pa.x - pb.x : pa.y - pb.y
    })
    const targets: FocusTarget[] = []
    for (const h of headers) {
      const rank = rankOf.get(h.id) ?? 0
      targets.push({ id: h.id, kind: 'header', rank, cardId: h.id })
      if (h.isTable && mode === 'column') {
        const table = model.tables.find((t) => t.id === h.id)!
        for (const c of table.columns) {
          targets.push({ id: c.key, kind: 'row', rank, cardId: h.id, colKey: c.key })
        }
      }
    }
    return targets
  }, [model.tables, model.notebooks, positions, rankOf, mode])

  useEffect(() => {
    const container = containerRef.current
    if (!container || focusTargets.length === 0) return
    const all = container.querySelectorAll<HTMLElement>('[data-lineage-focus]')
    const firstId = focusTargets[0].id
    all.forEach((el) => {
      el.tabIndex = el.getAttribute('data-lineage-focus') === firstId ? 0 : -1
    })
  }, [mode, focusTargets])

  const { onKeyDown } = useLineageKeyboardNav({
    containerRef,
    targets: focusTargets,
    colEdges: model.colEdges,
    onSelect: select,
  })

  const handleModeChange = useCallback((next: LineageMode) => setMode(next), [])

  const edgeSummaryLines = useMemo(
    () =>
      model.colEdges.map(
        ([from, to]) =>
          `${colLabel(model, from)} → ${colLabel(model, to)}, derives, inferred via ${notebookForColEdge(model, to)}`,
      ),
    [model],
  )

  const canvasLabel = `Lineage graph: ${model.tables.length} tables, ${model.notebooks.length} notebooks, ${edges.length} connections`

  return (
    <div className="lineage-view">
      <div className="lineage-toolbar">
        <div className="seg" role="group" aria-label="Lineage detail level">
          <button
            type="button"
            className={mode === 'table' ? 'on' : ''}
            aria-label="Show table-level detail"
            onClick={() => handleModeChange('table')}
          >
            Table
          </button>
          <button
            type="button"
            className={mode === 'column' ? 'on' : ''}
            aria-label="Show column-level detail"
            onClick={() => handleModeChange('column')}
          >
            Column
          </button>
        </div>
        <span className="spacer" />
        <FreshnessIndicator source={model.source} fetchedAt={fetchedAt ?? undefined} />
      </div>

      {isEmpty ? (
        <div className="lineage-canvas-empty">
          <p className="lineage-canvas-empty-heading">No lineage to show yet</p>
          <p className="lineage-canvas-empty-body">
            Upload notebook code or connect a workspace to see column-level lineage here.
          </p>
        </div>
      ) : (
        <div
          className="lineage-canvas"
          ref={containerRef}
          role="group"
          aria-label={canvasLabel}
          onKeyDown={onKeyDown}
        >
          <ReactFlow
            nodes={nodes}
            edges={edges}
            nodeTypes={nodeTypes}
            edgeTypes={edgeTypes}
            nodesFocusable={false}
            edgesFocusable={false}
            disableKeyboardA11y
            nodesDraggable={false}
            onPaneClick={() => clear()}
            fitView
          >
            <Background variant={BackgroundVariant.Dots} gap={22} size={1.2} color="var(--color-grid-dot)" />
          </ReactFlow>
          <ul className="sr-only">
            {edgeSummaryLines.map((line, i) => (
              // Static, order-stable list re-derived every render from
              // model.colEdges — index keys are safe here (no reordering/
              // filtering interaction on this list).
              // eslint-disable-next-line react/no-array-index-key
              <li key={i}>{line}</li>
            ))}
          </ul>
        </div>
      )}
    </div>
  )
}
