import type { Edge, Node } from 'reactflow'
import type { LineageGraph, LineageNode } from './api'

// Left-to-right layered layout keyed by node kind. Good enough for Phase 1;
// swap for dagre/elk if graphs get dense.
const COLUMN_X: Record<string, number> = {
  lakehouse: 0,
  table: 320,
  notebook: 660,
  workspace: 660,
  column: 1000,
}

const KIND_COLOR: Record<string, string> = {
  workspace: '#6b7280',
  notebook: '#7c3aed',
  lakehouse: '#0ea5e9',
  table: '#059669',
  column: '#d97706',
}

export function toFlow(graph: LineageGraph): { nodes: Node[]; edges: Edge[] } {
  const perColumn: Record<string, number> = {}

  const nodes: Node[] = graph.nodes.map((n: LineageNode) => {
    const x = COLUMN_X[n.kind] ?? 500
    const row = perColumn[n.kind] ?? 0
    perColumn[n.kind] = row + 1
    return {
      id: n.id,
      position: { x, y: row * 110 },
      data: { label: labelFor(n), node: n },
      style: {
        borderLeft: `4px solid ${KIND_COLOR[n.kind] ?? '#888'}`,
        borderRadius: 8,
        padding: 10,
        background: '#fff',
        fontSize: 12,
        width: 220,
        boxShadow: '0 1px 3px rgba(0,0,0,.12)',
      },
    }
  })

  const edges: Edge[] = graph.edges.map((e, i) => ({
    id: `e${i}`,
    source: e.source,
    target: e.target,
    label: e.kind,
    animated: e.kind === 'writes',
    style: { stroke: e.kind === 'writes' ? '#7c3aed' : '#94a3b8' },
    labelStyle: { fontSize: 10, fill: '#64748b' },
  }))

  return { nodes, edges }
}

function labelFor(n: LineageNode): string {
  const cols = n.columns?.length ? ` · ${n.columns.length} cols` : ''
  const inferred = n.meta?.inferred ? ' (inferred)' : ''
  return `${n.kind.toUpperCase()}: ${n.name}${cols}${inferred}`
}
