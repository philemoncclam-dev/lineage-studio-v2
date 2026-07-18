// Adapts the backend's generic LineageGraph (api.ts, mirroring
// backend/app/models.py) into the concrete shapes the views render.
// data.ts remains only as the offline/demo fallback payload.

import { createContext, useContext } from 'react'
import type { LineageGraph, LineageNode } from './api'
import {
  COL_EDGES, LEVELS, LEVEL_TABLE, NOTEBOOKS, NOTEBOOK_CODE, OPS, TABLES, XFORM,
  type ColorKey, type GNode, type Level, type NB, type Table,
} from './data'

export interface TableContext {
  up: [string, string, string][]   // [name, layer, via]
  down: [string, string, string][]
}

export interface AppModel {
  source: 'live' | 'sample'
  tables: Table[]
  notebooks: NB[]
  colEdges: [string, string][]
  ops: [string, string, 'reads' | 'writes'][]
  xform: Record<string, [string, string]>
  levels: Record<string, Level>
  levelTable: Record<string, string>
  notebookCode: Record<string, string>
  context: Record<string, TableContext>
}

export function sampleModel(): AppModel {
  return {
    source: 'sample',
    tables: TABLES, notebooks: NOTEBOOKS, colEdges: COL_EDGES, ops: OPS, xform: XFORM,
    levels: LEVELS, levelTable: LEVEL_TABLE, notebookCode: NOTEBOOK_CODE,
    context: {
      clean: {
        up: [['raw_orders', 'bronze', 'clean_orders'], ['raw_customers', 'bronze', 'clean_orders']],
        down: [['orders_report', 'gold', 'daily_revenue'], ['revenue_daily', 'gold', 'daily_revenue'], ['customer_360', 'gold', 'build_customer_360']],
      },
    },
  }
}

const LAYER_COLOR: Record<string, ColorKey> = { bronze: 'bronze', silver: 'silver', gold: 'gold' }
const colorFor = (layer: string): ColorKey => LAYER_COLOR[layer] ?? 'workspace'
// element-id-safe short ids: 'table.raw_orders' -> 'raw_orders', 'notebook.x' -> 'nb_x'
const tid = (id: string) => id.replace(/^table\./, '').replace(/[^\w-]/g, '_')
const nid = (id: string) => 'nb_' + id.replace(/^notebook\./, '').replace(/[^\w-]/g, '_')

export function adapt(g: LineageGraph): AppModel {
  const tableNodes = g.nodes.filter((n) => n.kind === 'table')
  const nbNodes = g.nodes.filter((n) => n.kind === 'notebook')
  const lakehouses = g.nodes.filter((n) => n.kind === 'lakehouse')
  const workspaces = g.nodes.filter((n) => n.kind === 'workspace')
  const byId = new Map(g.nodes.map((n) => [n.id, n]))

  const layerOf = (t: LineageNode) => {
    const lh = t.parent_id ? byId.get(t.parent_id) : undefined
    return lh ? lh.name.toLowerCase() : (t.meta?.inferred ? 'inferred' : 'table')
  }

  // ---- object-level ops (table -> notebook -> table) ----
  const ops: [string, string, 'reads' | 'writes'][] = []
  for (const e of g.edges) {
    if (e.kind === 'reads') ops.push([tid(e.source), nid(e.target), 'reads'])
    if (e.kind === 'writes') ops.push([nid(e.source), tid(e.target), 'writes'])
  }

  // ---- layered layout: depth via longest path over ops ----
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
  const tableById = new Map(tables.map((t) => [t.id, t]))
  const notebooks: NB[] = nbNodes.map((n) => ({ id: nid(n.id), name: n.name, ...place(nid(n.id), 47) }))

  // ---- column-level edges + transforms from write-edge column maps ----
  const colEdges: [string, string][] = []
  const xform: Record<string, [string, string]> = {}
  for (const e of g.edges) {
    if (e.kind !== 'writes' || !e.columns.length) continue
    const nb = byId.get(e.source)
    const target = tableById.get(tid(e.target))
    if (!nb || !target) continue
    const readTables = g.edges
      .filter((r) => r.kind === 'reads' && r.target === nb.id)
      .map((r) => tableById.get(tid(r.source)))
      .filter((t): t is Table => !!t)
    for (const m of e.columns) {
      const toCol = target.columns.find((c) => c.name === m.to_column)
      if (!toCol) continue
      // resolve source column: first identifier token in the expression that
      // names a column on a table this notebook reads
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
  }

  // ---- knowledge-graph drill levels ----
  const levels: Record<string, Level> = {}
  const levelTable: Record<string, string> = {}
  const lakehouseOf = (t: LineageNode) => (t.parent_id && byId.get(t.parent_id)?.kind === 'lakehouse' ? t.parent_id : null)

  levels.estate = {
    level: 'Estate', type: 'graph',
    nodes: workspaces.map((w) => ({
      id: w.id, label: w.name, c: 'accent', r: 30,
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
    levels[`lake:${lh.id}`] = { level: 'Lakehouse', crumb: lh.name, type: 'graph', nodes, links }
  }

  for (const t of tableNodes) {
    const id = tid(t.id)
    levels[`tbl:${id}`] = { level: 'Table lineage', crumb: t.name, type: 'lineage' }
    levelTable[`tbl:${id}`] = id
  }

  // ---- upstream/downstream context per table (via shared notebooks) ----
  const context: Record<string, TableContext> = {}
  for (const t of tables) {
    const writers = ops.filter(([, tt, k]) => k === 'writes' && tt === t.id).map(([nb]) => nb)
    const readers = ops.filter(([s, , k]) => k === 'reads' && s === t.id).map(([, nb]) => nb)
    const nbName = (id: string) => notebooks.find((n) => n.id === id)?.name ?? id
    const up: [string, string, string][] = []
    const down: [string, string, string][] = []
    for (const nb of writers)
      for (const [s, tt, k] of ops)
        if (k === 'reads' && tt === nb) { const st = tableById.get(s); if (st) up.push([st.name, st.layer, nbName(nb)]) }
    for (const nb of readers)
      for (const [s, tt, k] of ops)
        if (k === 'writes' && s === nb) { const dt = tableById.get(tt); if (dt) down.push([dt.name, dt.layer, nbName(nb)]) }
    if (up.length || down.length) context[t.id] = { up, down }
  }

  // ---- notebook source for the code grep ----
  const notebookCode: Record<string, string> = {}
  for (const n of nbNodes) {
    const src = n.meta?.source
    if (typeof src === 'string' && src) notebookCode[nid(n.id)] = src
  }

  return { source: 'live', tables, notebooks, colEdges, ops, xform, levels, levelTable, notebookCode, context }
}

const ModelContext = createContext<AppModel>(sampleModel())
export const ModelProvider = ModelContext.Provider
export const useModel = () => useContext(ModelContext)
