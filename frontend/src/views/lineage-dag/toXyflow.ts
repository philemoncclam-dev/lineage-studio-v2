// Topology (tables, notebooks, colEdges, ops) + dagre positions -> xyflow
// Node[]/Edge[]. Resolves per-mode handle ids (DAG-02) and hardcodes every
// edge's provenance to 'inferred' (D-09 — Phase 3 has no declared-lineage
// data path yet; that's Phase 5).

import type { NB, Table } from '../../data'
import {
  colSourceHandle,
  colTargetHandle,
  NODE_SOURCE_HANDLE,
  NODE_TARGET_HANDLE,
  tableIdOfColKey,
  type LineageEdgeData,
  type LineageMode,
  type NotebookNodeData,
  type TableNodeData,
} from './types'

export const TABLE_NODE_TYPE = 'tableNode'
export const NOTEBOOK_NODE_TYPE = 'notebookNode'
export const LINEAGE_EDGE_TYPE = 'lineageEdge'

export interface XyflowNode<T> {
  id: string
  type: string
  position: { x: number; y: number }
  data: T
}

export interface XyflowEdge {
  id: string
  type: string
  source: string
  target: string
  sourceHandle: string
  targetHandle: string
  data: LineageEdgeData
}

export interface XyflowGraph {
  nodes: XyflowNode<TableNodeData | NotebookNodeData>[]
  edges: XyflowEdge[]
}

export function toXyflow(
  tables: Table[],
  notebooks: NB[],
  colEdges: [string, string][],
  ops: [string, string, 'reads' | 'writes'][],
  positions: Map<string, { x: number; y: number }>,
  mode: LineageMode,
): XyflowGraph {
  const nodes: XyflowNode<TableNodeData | NotebookNodeData>[] = []

  for (const t of tables) {
    nodes.push({
      id: t.id,
      type: TABLE_NODE_TYPE,
      position: positions.get(t.id) ?? { x: 0, y: 0 },
      data: { id: t.id, name: t.name, layer: t.layer, columns: t.columns, mode, colorKey: t.c },
    })
  }
  for (const n of notebooks) {
    nodes.push({
      id: n.id,
      type: NOTEBOOK_NODE_TYPE,
      position: positions.get(n.id) ?? { x: 0, y: 0 },
      data: { id: n.id, name: n.name },
    })
  }

  const edges: XyflowEdge[] = []

  // Column-level edges: per-row handles in Column mode, the shared
  // __node__* fallback pair in Table mode — a pure function of
  // (edge, mode), recomputed on every toggle flip (DAG-02/DAG-07).
  colEdges.forEach(([fromKey, toKey], i) => {
    edges.push({
      id: `col-${i}-${fromKey}->${toKey}`,
      type: LINEAGE_EDGE_TYPE,
      source: tableIdOfColKey(fromKey),
      target: tableIdOfColKey(toKey),
      sourceHandle: mode === 'column' ? colSourceHandle(fromKey) : NODE_SOURCE_HANDLE,
      targetHandle: mode === 'column' ? colTargetHandle(toKey) : NODE_TARGET_HANDLE,
      data: { kind: 'derives', provenance: 'inferred', from: fromKey, to: toKey },
    })
  })

  // Object-level (reads/writes) edges always use the __node__* fallback
  // pair on both ends — notebooks never have column rows to anchor to.
  ops.forEach(([source, target, kind], i) => {
    edges.push({
      id: `op-${i}-${source}->${target}`,
      type: LINEAGE_EDGE_TYPE,
      source,
      target,
      sourceHandle: NODE_SOURCE_HANDLE,
      targetHandle: NODE_TARGET_HANDLE,
      data: { kind, provenance: 'inferred' },
    })
  })

  return { nodes, edges }
}
