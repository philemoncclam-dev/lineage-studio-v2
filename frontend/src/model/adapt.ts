// Adapts the backend's generic LineageGraph (api.ts, mirroring
// backend/app/models.py) into the concrete shapes the views render.
// Composes the pure layout/topology/colour modules alongside it.

import type { ColumnMapEvidence, LineageGraph } from '../api'
import type { Table } from '../data'
import type { AppModel, TableContext } from './index'
import { buildGraphLevels } from './graphLayout'
import { nid, tid } from './ids'
import { layoutLineage } from './lineageLayout'

export function adapt(g: LineageGraph): AppModel {
  const nbNodes = g.nodes.filter((n) => n.kind === 'notebook')
  const byId = new Map(g.nodes.map((n) => [n.id, n]))

  // ---- object-level ops (table -> notebook -> table) ----
  const ops: [string, string, 'reads' | 'writes'][] = []
  for (const e of g.edges) {
    if (e.kind === 'reads') ops.push([tid(e.source), nid(e.target), 'reads'])
    if (e.kind === 'writes') ops.push([nid(e.source), tid(e.target), 'writes'])
  }

  // ---- layered lineage layout ----
  const { tables, notebooks } = layoutLineage(g, ops)
  const tableById = new Map(tables.map((t) => [t.id, t]))

  // ---- column-level edges + transforms from write-edge column maps ----
  const colEdges: [string, string][] = []
  const xform: Record<string, [string, string]> = {}
  const evidence: Record<string, ColumnMapEvidence> = {}
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
      if (m.evidence) evidence[toCol.key] = m.evidence
    }
  }

  // ---- knowledge-graph drill levels ----
  const { levels, levelTable } = buildGraphLevels(g)

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

  return { source: 'live', tables, notebooks, colEdges, ops, xform, evidence, levels, levelTable, notebookCode, context }
}
