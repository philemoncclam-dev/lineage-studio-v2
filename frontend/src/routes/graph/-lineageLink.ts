// Dash-prefixed: excluded from route generation by @tanstack/router-plugin's
// file-based routing (not a route file, just a shared helper for the
// graph-mode route components below).
//
// Best-effort readable-name path segments (D-06/D-07) for GraphView's
// onOpenLineage callback, which only hands back a table id + optional column
// key. Walks the raw root-loaded LineageGraph's parent_id chain to recover
// the table's workspace/lakehouse readable names. The bundled sample model
// (source === 'sample') has no such hierarchy at all, so that case falls
// back to fixed placeholder segments — still a valid, demoable URL, just not
// a literal Fabric-hierarchy mirror (there is no real hierarchy to mirror).
import type { LineageGraph } from '../../api'

export interface LineageTarget {
  workspace: string
  lakehouse: string
  table: string
}

export function lineageTarget(graph: LineageGraph | null, tableId: string): LineageTarget {
  if (graph) {
    const byId = new Map(graph.nodes.map((n) => [n.id, n]))
    const tableNode = byId.get(tableId)
    const lakehouseNode = tableNode?.parent_id ? byId.get(tableNode.parent_id) : undefined
    const workspaceNode = lakehouseNode?.parent_id ? byId.get(lakehouseNode.parent_id) : undefined
    if (tableNode && lakehouseNode?.kind === 'lakehouse' && workspaceNode?.kind === 'workspace') {
      return { workspace: workspaceNode.name, lakehouse: lakehouseNode.name, table: tableNode.name }
    }
  }
  return { workspace: 'sample', lakehouse: 'sample', table: tableId }
}
