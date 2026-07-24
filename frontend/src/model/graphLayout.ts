// Pure knowledge-graph topology builder: Estate -> Workspace -> Lakehouse
// drill levels plus the Lakehouse -> Table lineage-key map. This is
// topology-only — the runtime force simulation that lays these nodes out
// stays in views/GraphView.tsx.

import type { LineageGraph, LineageNode } from '../api'
import type { ColorKey, GNode, Level } from '../data'
import { colorFor } from './domainColor'
import { tid } from './ids'

export function buildGraphLevels(g: LineageGraph): { levels: Record<string, Level>; levelTable: Record<string, string> } {
  const tableNodes = g.nodes.filter((n) => n.kind === 'table')
  const nbNodes = g.nodes.filter((n) => n.kind === 'notebook')
  const lakehouses = g.nodes.filter((n) => n.kind === 'lakehouse')
  const workspaces = g.nodes.filter((n) => n.kind === 'workspace')
  const byId = new Map(g.nodes.map((n) => [n.id, n]))

  const layerOf = (t: LineageNode) => {
    const lh = t.parent_id ? byId.get(t.parent_id) : undefined
    return lh ? lh.name.toLowerCase() : (t.meta?.inferred ? 'inferred' : 'table')
  }

  const levels: Record<string, Level> = {}
  const levelTable: Record<string, string> = {}
  const lakehouseOf = (t: LineageNode) => (t.parent_id && byId.get(t.parent_id)?.kind === 'lakehouse' ? t.parent_id : null)

  levels.estate = {
    level: 'Estate', type: 'graph',
    nodes: workspaces.map((w) => ({
      id: w.id, label: w.name, c: 'accent' as ColorKey, r: 30,
      sub: `${lakehouses.length} lakehouses · ${tableNodes.length} tables`, drill: `ws:${w.id}`,
    })),
    links: [],
  }

  for (const w of workspaces) {
    const wsNotebooks = nbNodes.filter((n) => n.parent_id === w.id)
    const looseTables = tableNodes.filter((t) => !lakehouseOf(t))
    const nodes: GNode[] = [
      ...lakehouses.map((lh) => ({
        id: lh.id, label: lh.name, c: colorFor(lh.name.toLowerCase()), r: 20,
        sub: `${tableNodes.filter((t) => t.parent_id === lh.id).length} tables`, drill: `lake:${lh.id}`,
      })),
      ...wsNotebooks.map((n) => ({ id: n.id, label: n.name, c: 'notebook' as ColorKey, r: 11, sub: 'notebook' })),
      ...looseTables.map((t) => ({
        id: t.id, label: t.name, c: colorFor(layerOf(t)), r: 12,
        sub: `table · ${t.columns.length} cols`, drill: `tbl:${tid(t.id)}`,
      })),
    ]
    const links: [string, string, string][] = []
    for (const e of g.edges) {
      if (e.kind !== 'reads' && e.kind !== 'writes') continue
      const [tNode, nb] = e.kind === 'reads' ? [byId.get(e.source), e.target] : [byId.get(e.target), e.source]
      if (!tNode) continue
      const anchor = lakehouseOf(tNode) ?? tNode.id
      links.push([e.kind === 'reads' ? anchor : nb, e.kind === 'reads' ? nb : anchor, e.kind])
    }
    // Table-to-table `derives` edges (notebook-free authored models): connect
    // the two tables' lakehouses so the estate/workspace network stays linked.
    for (const e of g.edges) {
      if (e.kind !== 'derives') continue
      const s = byId.get(e.source)
      const t = byId.get(e.target)
      if (!s || !t) continue
      links.push([lakehouseOf(s) ?? s.id, lakehouseOf(t) ?? t.id, 'derives'])
    }
    levels[`ws:${w.id}`] = { level: 'Workspace', crumb: w.name, type: 'graph', nodes, links }
  }

  for (const lh of lakehouses) {
    const lhTables = tableNodes.filter((t) => t.parent_id === lh.id)
    const touching = new Set(
      g.edges.flatMap((e) => {
        if (e.kind === 'reads' && lhTables.some((t) => t.id === e.source)) return [e.target]
        if (e.kind === 'writes' && lhTables.some((t) => t.id === e.target)) return [e.source]
        return []
      }),
    )
    const nodes: GNode[] = [
      ...lhTables.map((t) => ({
        id: t.id, label: t.name, c: colorFor(lh.name.toLowerCase()), r: 13,
        sub: `table · ${t.columns.length} cols`, drill: `tbl:${tid(t.id)}`,
      })),
      ...nbNodes.filter((n) => touching.has(n.id)).map((n) => ({ id: n.id, label: n.name, c: 'notebook' as ColorKey, r: 10, sub: 'notebook' })),
    ]
    const links: [string, string, string][] = g.edges
      .filter((e) => (e.kind === 'reads' && lhTables.some((t) => t.id === e.source)) || (e.kind === 'writes' && lhTables.some((t) => t.id === e.target)))
      .map((e) => [e.source, e.target, e.kind] as [string, string, string])
    // `derives` edges wholly within this lakehouse (both endpoints are tables
    // shown here). Cross-lakehouse derivations surface at the workspace level.
    for (const e of g.edges) {
      if (e.kind !== 'derives') continue
      if (lhTables.some((t) => t.id === e.source) && lhTables.some((t) => t.id === e.target))
        links.push([e.source, e.target, 'derives'])
    }
    levels[`lake:${lh.id}`] = { level: 'Lakehouse', crumb: lh.name, type: 'graph', nodes, links }
  }

  for (const t of tableNodes) {
    const id = tid(t.id)
    levels[`tbl:${id}`] = { level: 'Table lineage', crumb: t.name, type: 'lineage' }
    levelTable[`tbl:${id}`] = id
  }

  return { levels, levelTable }
}
