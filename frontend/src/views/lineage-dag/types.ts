// Shared node/edge data shapes + handle-id conventions for the xyflow DAG
// canvas. Consumed by useDagreLayout.ts (layout), toXyflow.ts (mapping) and
// the TableNode/NotebookNode/LineageEdge components (plan 03-05).
//
// Handle-id convention (03-UI-SPEC.md "Column-row edge anchoring"):
// - Column mode: each column row gets its own handle pair, id derived from
//   the column's `key` (`${tableId}.${colName}`) via colSourceHandle/
//   colTargetHandle.
// - Table mode / object-level (reads/writes) edges: every node exposes one
//   always-present fallback handle pair, NODE_SOURCE_HANDLE/NODE_TARGET_HANDLE.

import type { Col, ColorKey } from '../../data'

export type LineageMode = 'table' | 'column'

export interface TableNodeData {
  id: string
  name: string
  layer: string
  columns: Col[]
  mode: LineageMode
  colorKey: ColorKey
}

export interface NotebookNodeData {
  id: string
  name: string
}

export interface LineageEdgeData {
  kind: 'reads' | 'writes' | 'derives'
  provenance: 'declared' | 'inferred'
  from?: string
  to?: string
}

export const NODE_SOURCE_HANDLE = '__node__source'
export const NODE_TARGET_HANDLE = '__node__target'

export function colSourceHandle(key: string): string {
  return `${key}__source`
}

export function colTargetHandle(key: string): string {
  return `${key}__target`
}

// `key` is `${tableId}.${colName}` (data.ts's Col.key convention) — strip
// the trailing `.${colName}` to recover the owning table's node id.
export function tableIdOfColKey(key: string): string {
  return key.slice(0, key.lastIndexOf('.'))
}
