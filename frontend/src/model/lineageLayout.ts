// Pure layered DAG placement for the lineage (table -> notebook -> table) view.
// Depth is the longest path over the object-level ops; each depth column is
// its own x position, and nodes stack top-to-bottom within a column with a
// fixed gutter. No consumer of this module needs to know about React or the
// LineageGraph's parent/child topology beyond what's passed in here.

import type { LineageGraph, LineageNode } from '../api'
import type { NB, Table } from '../data'
import { colorFor } from './domainColor'
import { nid, tid } from './ids'

export function layoutLineage(
  g: LineageGraph,
  ops: [string, string, 'reads' | 'writes'][],
): { tables: Table[]; notebooks: NB[] } {
  const tableNodes = g.nodes.filter((n) => n.kind === 'table')
  const nbNodes = g.nodes.filter((n) => n.kind === 'notebook')
  const byId = new Map(g.nodes.map((n) => [n.id, n]))

  const layerOf = (t: LineageNode) => {
    const lh = t.parent_id ? byId.get(t.parent_id) : undefined
    return lh ? lh.name.toLowerCase() : (t.meta?.inferred ? 'inferred' : 'table')
  }

  // ---- depth via longest path over ops ----
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
  const yCursor = new Map<number, number>()
  const place = (key: string, height: number) => {
    const d = depth.get(key) ?? 0
    const y = yCursor.get(d) ?? 70
    yCursor.set(d, y + height + 36)
    return { x: 40 + d * 274, y }
  }

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

  return { tables, notebooks }
}
