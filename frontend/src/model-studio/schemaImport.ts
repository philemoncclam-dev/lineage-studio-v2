// Schema import, ported from lineage-studio's editor/schemaImport.ts: parse a
// pasted/uploaded schema table (CSV/TSV of Table | Column | Ordinal | DataType)
// and build Group(table) > Attribute(column) nodes under a chosen Layer.
// Existing Layer/Group/Attribute nodes (matched by name + parent) are reused so
// re-importing doesn't duplicate.
import { uid, type Model, type ModelNode, type NodeType } from './types'

/**
 * RFC-4180-compliant CSV line parser. Splits on commas outside double-quoted
 * fields, so values like DECIMAL(10,2) are kept intact.
 */
export function parseCSVLine(line: string): string[] {
  const fields: string[] = []
  let current = ''
  let inQuotes = false
  for (let i = 0; i < line.length; i++) {
    const ch = line[i]
    if (inQuotes) {
      if (ch === '"') {
        if (line[i + 1] === '"') {
          current += '"'
          i++
        } else {
          inQuotes = false
        }
      } else {
        current += ch
      }
    } else if (ch === '"') {
      inQuotes = true
    } else if (ch === ',') {
      fields.push(current.trim())
      current = ''
    } else {
      current += ch
    }
  }
  fields.push(current.trim())
  return fields
}

export interface ParsedSchema {
  headers: string[]
  rows: string[][]
  delimiter: 'tab' | 'comma'
  hasHeader: boolean
}

// A row "looks like data" (not a header) when its 3rd field is a number —
// i.e. an ordinal like `Customers,CustomerID,1,INTEGER`.
function looksLikeDataRow(cells: string[]): boolean {
  const ordinal = cells[2]
  return ordinal != null && ordinal.trim() !== '' && Number.isFinite(Number(ordinal))
}

export function parseSchema(text: string): ParsedSchema {
  const lines = text.split(/\r?\n/).filter((l) => l.trim().length > 0)
  if (lines.length === 0) return { headers: [], rows: [], delimiter: 'comma', hasHeader: false }
  const delimiter = lines[0].includes('\t') ? 'tab' : 'comma'
  const split =
    delimiter === 'tab' ? (l: string) => l.split('\t').map((c) => c.trim()) : parseCSVLine
  const cells = lines.map(split)

  const hasHeader = !looksLikeDataRow(cells[0])
  if (!hasHeader) {
    const width = Math.max(4, ...cells.map((c) => c.length))
    const headers = Array.from(
      { length: width },
      (_, i) => ['Table', 'Column', 'Ordinal', 'DataType'][i] ?? `Column ${i + 1}`,
    )
    return { headers, rows: cells, delimiter, hasHeader: false }
  }
  return { headers: cells[0], rows: cells.slice(1), delimiter, hasHeader: true }
}

export interface TableGroup {
  table: string
  columns: { name: string; ordinal: number; dataType: string }[]
}

/** Group parsed rows by table name (first-seen order), columns by ordinal. */
export function groupByTable(
  parsed: ParsedSchema,
  tableIdx: number,
  columnIdx: number,
  ordinalIdx: number,
  typeIdx: number,
): TableGroup[] {
  const order: string[] = []
  const map = new Map<string, TableGroup>()
  parsed.rows.forEach((row, i) => {
    const table = (row[tableIdx] ?? '').trim()
    const column = (row[columnIdx] ?? '').trim()
    if (!table || !column) return
    if (!map.has(table)) {
      map.set(table, { table, columns: [] })
      order.push(table)
    }
    const ordinal = ordinalIdx >= 0 ? Number(row[ordinalIdx]) : i + 1
    map.get(table)!.columns.push({
      name: column,
      ordinal: Number.isFinite(ordinal) ? ordinal : i + 1,
      dataType: typeIdx >= 0 ? (row[typeIdx] ?? '').trim() : '',
    })
  })
  for (const g of map.values()) g.columns.sort((a, b) => a.ordinal - b.ordinal)
  return order.map((t) => map.get(t)!)
}

export function guessColumn(headers: string[], patterns: RegExp[]): number {
  for (const p of patterns) {
    const i = headers.findIndex((h) => p.test(h))
    if (i >= 0) return i
  }
  return -1
}

export interface BuildResult {
  nodes: ModelNode[]
  tables: number
  columns: number
  layersCreated: number
}

/** Build the NEW nodes for the grouped schema under per-table layer choices. */
export function buildImportNodes(
  model: Model,
  groups: TableGroup[],
  assignments: Record<string, string>,
): BuildResult {
  const added: ModelNode[] = []
  const make = (type: NodeType, name: string, parentId: string | null): ModelNode => {
    const n: ModelNode = { id: uid(), type, name, parentId, properties: {}, transformation_logic: '' }
    added.push(n)
    return n
  }
  const find = (parentId: string | null, type: NodeType, name: string) =>
    model.nodes.find((n) => n.parentId === parentId && n.type === type && n.name === name) ||
    added.find((n) => n.parentId === parentId && n.type === type && n.name === name)
  const ensure = (parentId: string | null, type: NodeType, name: string) =>
    find(parentId, type, name) ?? make(type, name, parentId)

  let columnCount = 0
  const layersCreated = new Set<string>()

  for (const g of groups) {
    const layerName = (assignments[g.table] ?? '').trim()
    if (!layerName) continue
    if (!find(null, 'Layer', layerName)) layersCreated.add(layerName)
    const layer = ensure(null, 'Layer', layerName)
    const group = ensure(layer.id, 'Group', g.table)
    for (const col of g.columns) {
      if (find(group.id, 'Attribute', col.name)) continue
      const attr = make('Attribute', col.name, group.id)
      if (col.dataType) attr.properties = { dataType: col.dataType }
      columnCount++
    }
  }

  return {
    nodes: added,
    tables: groups.filter((g) => (assignments[g.table] ?? '').trim()).length,
    columns: columnCount,
    layersCreated: layersCreated.size,
  }
}
