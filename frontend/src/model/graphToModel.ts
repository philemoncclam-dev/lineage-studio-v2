// Turns the live graph (the AppModel the graph/lineage views render) into an
// authored 4-layer model for the modelling tab — the inverse of
// model-app/toLineageGraph.ts. Produces the vendored model shape (Layer >
// Object > Group > Attribute + attribute edges), which localdb.saveNew persists.
//
// The four layers (per the product's modelling convention):
//   1. Data Sources          — raw source files. Left blank: Fabric metadata
//                              rarely exposes the upstream raw files.
//   2. <workspace name>       — every lakehouse (Bronze/Silver/Gold/Landing…)
//                              as an Object, its tables as Groups, columns as
//                              Attributes.
//   3. Transformations        — every notebook as an Object; each notebook's
//                              output tables become "(staged)" Groups so the
//                              end-to-end flow (source → notebook → output) is
//                              visible as attribute edges routed through them.
//   4. Cataloged Data Assets  — left blank for the user to curate.
import type { LineageEdge, LineageNode, NodeType } from '../model-app/types'
import type { AppModel } from './index'

const uid = (): string =>
  typeof crypto !== 'undefined' && 'randomUUID' in crypto
    ? crypto.randomUUID()
    : `id-${Math.random().toString(36).slice(2)}-${Date.now().toString(36)}`

const titleCase = (s: string) =>
  s.replace(/[_-]+/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase()).trim()

// Medallion ordering so Objects read landing → bronze → silver → gold.
const LAYER_RANK: Record<string, number> = { landing: 0, bronze: 1, silver: 2, gold: 3 }
const rankOf = (layer: string) => LAYER_RANK[layer] ?? 9

export interface AuthoredModelDraft {
  name: string
  nodes: LineageNode[]
  edges: LineageEdge[]
}

export function graphToModel(m: AppModel): AuthoredModelDraft {
  const nodes: LineageNode[] = []
  const mk = (
    type: NodeType,
    name: string,
    parentId: string | null,
    properties: Record<string, unknown> = {},
    logic = '',
  ): LineageNode => {
    const node: LineageNode = {
      id: uid(),
      type,
      name,
      parentId,
      properties,
      transformation_logic: logic,
      x: 0,
      y: 0,
    }
    nodes.push(node)
    return node
  }

  const workspaceName = m.levels.estate?.nodes?.[0]?.label ?? 'Workspace'

  // ── Layer 1: Data Sources (blank) ──
  mk('Layer', 'Data Sources', null)

  // ── Layer 2: <workspace>  — lakehouses → Objects, tables → Groups, cols → Attributes ──
  const l2 = mk('Layer', workspaceName, null)
  // attrByColKey: AppModel column key ("table.col") → the real Attribute node id.
  const attrByColKey = new Map<string, string>()

  const tablesByLayer = new Map<string, typeof m.tables>()
  for (const t of m.tables) {
    const arr = tablesByLayer.get(t.layer) ?? []
    arr.push(t)
    tablesByLayer.set(t.layer, arr)
  }
  const orderedLayers = [...tablesByLayer.keys()].sort((a, b) => rankOf(a) - rankOf(b) || a.localeCompare(b))
  for (const layer of orderedLayers) {
    const obj = mk('Object', titleCase(layer), l2.id)
    for (const t of tablesByLayer.get(layer)!) {
      const grp = mk('Group', t.name, obj.id)
      for (const col of t.columns) {
        const attr = mk('Attribute', col.name, grp.id, col.type ? { dataType: col.type } : {})
        attrByColKey.set(col.key, attr.id)
      }
    }
  }

  // ── Layer 3: Transformations — notebooks → Objects, output tables → staged Groups ──
  const l3 = mk('Layer', 'Transformations', null)
  const tableById = new Map(m.tables.map((t) => [t.id, t]))
  // stagingByColKey: real output column key → its staging Attribute node id.
  const stagingByColKey = new Map<string, string>()
  for (const nb of m.notebooks) {
    const nbObj = mk('Object', nb.name, l3.id, {}, m.notebookCode[nb.id] ?? '')
    const outputTableIds = m.ops.filter(([s, , k]) => k === 'writes' && s === nb.id).map(([, t]) => t)
    for (const outId of new Set(outputTableIds)) {
      const outTable = tableById.get(outId)
      if (!outTable) continue
      const stg = mk('Group', `${outTable.name} (staged)`, nbObj.id)
      for (const col of outTable.columns) {
        const sAttr = mk('Attribute', col.name, stg.id, col.type ? { dataType: col.type } : {})
        stagingByColKey.set(col.key, sAttr.id)
      }
    }
  }

  // ── Layer 4: Cataloged Data Assets (blank) ──
  mk('Layer', 'Cataloged Data Assets', null)

  // ── Attribute edges ── route each column flow through the notebook staging
  // when the target column is produced by a notebook, else draw it directly.
  const edges: LineageEdge[] = []
  const seen = new Set<string>()
  const link = (sourceNodeId: string, targetNodeId: string) => {
    if (sourceNodeId === targetNodeId) return
    const key = `${sourceNodeId}->${targetNodeId}`
    if (seen.has(key)) return
    seen.add(key)
    edges.push({ id: uid(), sourceNodeId, targetNodeId, kind: 'copy' })
  }
  for (const [fromKey, toKey] of m.colEdges) {
    const fromAttr = attrByColKey.get(fromKey)
    const toAttr = attrByColKey.get(toKey)
    const stgAttr = stagingByColKey.get(toKey)
    if (fromAttr && stgAttr && toAttr) {
      link(fromAttr, stgAttr) // source (L2) → notebook staging (L3)
      link(stgAttr, toAttr) //   staging (L3) → produced column (L2)
    } else if (fromAttr && toAttr) {
      link(fromAttr, toAttr) // no owning notebook — direct column flow
    }
  }

  return { name: `${workspaceName} — model`, nodes, edges }
}
