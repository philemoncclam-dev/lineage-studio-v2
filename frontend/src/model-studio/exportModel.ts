// Client-side exports, ported from lineage-studio (exportCsv.ts /
// exportXlsx.ts). Two formats:
//  - Edge CSV: one row per attribute-level mapping, with resolved ancestry.
//  - Solidatus XLSX: Type/Name/Parent/ID/Source/Target/Properties/
//    transformation_logic rows, parents before children, plus an Edges sheet.
// SheetJS is heavy, so it is dynamically imported only when an export runs.
import type { Model, ModelNode } from './types'

const MULTI_DELIM = '; '
const TYPE_ORDER: Record<string, number> = { Layer: 0, Object: 1, Group: 2, Attribute: 3 }

function quoteField(value: string): string {
  if (value.includes(',') || value.includes('"') || value.includes('\n')) {
    return `"${value.replace(/"/g, '""')}"`
  }
  return value
}

function downloadBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  document.body.appendChild(a)
  a.click()
  document.body.removeChild(a)
  URL.revokeObjectURL(url)
}

export function safeFilename(name: string): string {
  return name.replace(/[^A-Za-z0-9._-]+/g, '_').replace(/^_+|_+$/g, '') || 'model'
}

/** node id -> qualified path (ancestor names joined by "/"). */
function buildPaths(model: Model): Map<string, string> {
  const byId = new Map(model.nodes.map((n) => [n.id, n]))
  const cache = new Map<string, string>()
  const path = (id: string): string => {
    const cached = cache.get(id)
    if (cached) return cached
    const node = byId.get(id)!
    const result =
      node.parentId && byId.has(node.parentId) ? `${path(node.parentId)}/${node.name}` : node.name
    cache.set(id, result)
    return result
  }
  model.nodes.forEach((n) => path(n.id))
  return cache
}

interface Ancestors {
  layer: string
  object: string
  table: string
  attribute: string
}

function resolveAncestors(nodeId: string, byId: Map<string, ModelNode>): Ancestors {
  const chain: ModelNode[] = []
  let current = byId.get(nodeId)
  while (current) {
    chain.unshift(current)
    current = current.parentId ? byId.get(current.parentId) : undefined
  }
  const get = (type: ModelNode['type']) => chain.find((c) => c.type === type)?.name ?? ''
  return { layer: get('Layer'), object: get('Object'), table: get('Group'), attribute: get('Attribute') }
}

export function exportModelCsv(model: Model): void {
  const byId = new Map(model.nodes.map((n) => [n.id, n]))
  const headers = [
    'SourceLayer', 'SourceObject', 'SourceTable', 'SourceAttribute',
    'TargetLayer', 'TargetObject', 'TargetTable', 'TargetAttribute',
    'edge_kind', 'edge_note',
  ]
  const lines = [headers.join(',')]
  for (const edge of model.edges) {
    const src = resolveAncestors(edge.sourceNodeId, byId)
    const tgt = resolveAncestors(edge.targetNodeId, byId)
    lines.push(
      [
        src.layer, src.object, src.table, src.attribute,
        tgt.layer, tgt.object, tgt.table, tgt.attribute,
        edge.kind ?? '', edge.note ?? '',
      ]
        .map(quoteField)
        .join(','),
    )
  }
  downloadBlob(new Blob([lines.join('\r\n')], { type: 'text/csv' }), `${safeFilename(model.name)}.lineage.csv`)
}

function buildRows(model: Model): (string | number)[][] {
  const paths = buildPaths(model)
  const byId = new Map(model.nodes.map((n) => [n.id, n]))

  const incoming = new Map<string, string[]>()
  const outgoing = new Map<string, string[]>()
  model.nodes.forEach((n) => {
    incoming.set(n.id, [])
    outgoing.set(n.id, [])
  })
  for (const e of model.edges) {
    if (byId.has(e.sourceNodeId) && byId.has(e.targetNodeId)) {
      outgoing.get(e.sourceNodeId)!.push(paths.get(e.targetNodeId)!)
      incoming.get(e.targetNodeId)!.push(paths.get(e.sourceNodeId)!)
    }
  }

  // Hierarchy order: depth-first by parent, types in canonical order then name.
  const children = new Map<string | null, ModelNode[]>()
  for (const n of model.nodes) {
    const arr = children.get(n.parentId) ?? []
    arr.push(n)
    children.set(n.parentId, arr)
  }
  for (const arr of children.values()) {
    arr.sort((a, b) => {
      const ta = TYPE_ORDER[a.type] ?? 9
      const tb = TYPE_ORDER[b.type] ?? 9
      return ta !== tb ? ta - tb : a.name.localeCompare(b.name)
    })
  }
  const ordered: ModelNode[] = []
  const walk = (parentId: string | null) => {
    for (const node of children.get(parentId) ?? []) {
      ordered.push(node)
      walk(node.id)
    }
  }
  walk(null)

  const rows: (string | number)[][] = [
    ['Type', 'Name', 'Parent', 'ID', 'Source', 'Target', 'Properties', 'transformation_logic'],
  ]
  for (const node of ordered) {
    rows.push([
      node.type,
      node.name,
      node.parentId && byId.has(node.parentId) ? paths.get(node.parentId)! : '',
      paths.get(node.id)!,
      incoming.get(node.id)!.join(MULTI_DELIM),
      outgoing.get(node.id)!.join(MULTI_DELIM),
      Object.keys(node.properties).length ? JSON.stringify(node.properties) : '',
      node.transformation_logic,
    ])
  }
  return rows
}

function buildEdgeRows(model: Model): (string | number)[][] {
  const paths = buildPaths(model)
  const byId = new Map(model.nodes.map((n) => [n.id, n]))
  const rows: (string | number)[][] = [['Source', 'Target', 'Kind', 'Note']]
  for (const e of model.edges) {
    if (!byId.has(e.sourceNodeId) || !byId.has(e.targetNodeId)) continue
    rows.push([paths.get(e.sourceNodeId)!, paths.get(e.targetNodeId)!, e.kind ?? '', e.note ?? ''])
  }
  return rows
}

export async function exportModelXlsx(model: Model): Promise<void> {
  const XLSX = await import('xlsx')
  const wb = XLSX.utils.book_new()
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(buildRows(model)), 'Lineage')
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(buildEdgeRows(model)), 'Edges')
  XLSX.writeFile(wb, `${safeFilename(model.name)}.xlsx`)
}
