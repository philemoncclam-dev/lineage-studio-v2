// Converts an authored model (this app's Layer > Object > Group > Attribute
// tree + attribute-level edges) into the host app's generic LineageGraph
// (api.ts) so the graph / lineage network views can render it — the
// "Open in graph view" export.
//
// Mapping (the host has only workspace/lakehouse/table/column/notebook kinds,
// so the 4-level authored hierarchy is flattened onto them):
//   model            → workspace node (drives the Estate/Workspace levels)
//   Layer            → lakehouse node (its name becomes each child table's
//                      "layer", which the host uses for medallion colouring)
//   Object (system)  → folded into the table's meta.system (no host kind for
//                      an intra-lakehouse system band)
//   Group (table)    → table node, parented to its Layer's lakehouse
//   Attribute        → column on that table
//   attr → attr edge → a table-to-table `derives` edge carrying a column map
//                      (multiple attribute edges between the same two tables
//                      collapse into one edge with several column maps)
import type { Column, LineageEdge as GraphEdge, LineageGraph, LineageNode as GraphNode } from '../api'
import type { LineageNode as ModelNode, Model } from './types'

export function modelToLineageGraph(model: Model): LineageGraph {
  const byId = new Map(model.nodes.map((n) => [n.id, n]))
  const childrenOf = new Map<string | null, ModelNode[]>()
  for (const n of model.nodes) {
    const arr = childrenOf.get(n.parentId) ?? []
    arr.push(n)
    childrenOf.set(n.parentId, arr)
  }

  // Nearest ancestor of a given type, walking parent pointers.
  const ancestorOfType = (n: ModelNode, type: ModelNode['type']): ModelNode | null => {
    let cur = n.parentId ? byId.get(n.parentId) : undefined
    while (cur) {
      if (cur.type === type) return cur
      cur = cur.parentId ? byId.get(cur.parentId) : undefined
    }
    return null
  }

  const nodes: GraphNode[] = []
  const workspaceId = `ws:${model.id}`
  nodes.push({ id: workspaceId, kind: 'workspace', name: model.name || 'Model', columns: [], meta: {} })

  // Layers → lakehouses.
  const lakehouseIdOf = new Map<string, string>() // layer node id → lakehouse graph id
  for (const layer of model.nodes.filter((n) => n.type === 'Layer')) {
    const id = `lh:${layer.id}`
    lakehouseIdOf.set(layer.id, id)
    nodes.push({ id, kind: 'lakehouse', name: layer.name, parent_id: workspaceId, columns: [], meta: {} })
  }

  // Groups → tables. `tableIdOf` maps the authored Group id to the graph table
  // id, and `colNameById` lets edge building resolve an attribute to its
  // (table, column-name) pair.
  const tableIdOf = new Map<string, string>()
  const colNameById = new Map<string, string>()
  const tableIdOfAttr = new Map<string, string>()
  for (const group of model.nodes.filter((n) => n.type === 'Group')) {
    const layer = ancestorOfType(group, 'Layer')
    const parentLakehouse = layer ? lakehouseIdOf.get(layer.id) : undefined
    const system = ancestorOfType(group, 'Object')
    const attrs = (childrenOf.get(group.id) ?? []).filter((n) => n.type === 'Attribute')
    const columns: Column[] = attrs.map((a) => ({
      name: a.name,
      data_type: (a.properties.dataType as string | undefined) ?? null,
    }))
    const tableId = `tbl:${group.id}`
    tableIdOf.set(group.id, tableId)
    for (const a of attrs) {
      colNameById.set(a.id, a.name)
      tableIdOfAttr.set(a.id, tableId)
    }
    nodes.push({
      id: tableId,
      kind: 'table',
      name: group.name,
      parent_id: parentLakehouse ?? workspaceId,
      columns,
      meta: system ? { system: system.name } : {},
    })
  }

  // Attribute → attribute edges collapse into table-to-table `derives` edges.
  const edgeByPair = new Map<string, GraphEdge>()
  for (const e of model.edges) {
    const srcTable = tableIdOfAttr.get(e.sourceNodeId)
    const tgtTable = tableIdOfAttr.get(e.targetNodeId)
    const fromCol = colNameById.get(e.sourceNodeId)
    const toCol = colNameById.get(e.targetNodeId)
    if (!srcTable || !tgtTable || !fromCol || !toCol) continue
    const key = `${srcTable}->${tgtTable}`
    let edge = edgeByPair.get(key)
    if (!edge) {
      edge = { source: srcTable, target: tgtTable, kind: 'derives', columns: [] }
      edgeByPair.set(key, edge)
    }
    const tgtNode = byId.get(e.targetNodeId)
    edge.columns.push({
      from_column: fromCol,
      to_column: toCol,
      transform: e.note || tgtNode?.transformation_logic || null,
    })
  }

  return { nodes, edges: [...edgeByPair.values()] }
}
