// Model -> tabular export.
//
// The Default column set is deliberately the same shape the Full importer
// accepts, so an export can be edited in a spreadsheet and reimported without
// rearranging anything. That round trip is the main reason to export at all —
// bulk property and transition edits are far easier in a grid than on a canvas.
//
// Entity identity travels as the real entity ID, so a reimport UPDATES rather
// than duplicating. Change a name in the sheet and the entity is renamed;
// delete the ID and it becomes a new entity.

import type { LineageModel } from './types'

export const DEFAULT_COLUMNS = ['ID', 'TYPE', 'PARENT', 'NAME', 'SOURCE', 'TARGET'] as const

export interface ExportOptions {
  includeLayers: boolean
  includeObjects: boolean
  includeAttributes: boolean
  includeTransitions: boolean
  includeProperties: boolean
}

export const DEFAULT_EXPORT_OPTIONS: ExportOptions = {
  includeLayers: true,
  includeObjects: true,
  includeAttributes: true,
  includeTransitions: true,
  includeProperties: true,
}

/** Every property name used anywhere in the model, sorted for stable columns. */
export function propertyNames(model: LineageModel): string[] {
  const names = new Set<string>()
  for (const bag of Object.values(model.properties)) {
    for (const key of Object.keys(bag)) names.add(key)
  }
  return [...names].sort((a, b) => a.localeCompare(b))
}

export function toRows(model: LineageModel, options: ExportOptions): string[][] {
  const props = options.includeProperties ? propertyNames(model) : []
  // Ids actually written out. Transitions are filtered against THIS, not against
  // the whole model: excluding attributes must also drop the attribute-level
  // transitions, or the export carries edges that cannot resolve on reimport.
  const emitted = new Set<string>()
  // The empty `PROPERTIES:` column is the marker the importer looks for —
  // everything to its right is a property name.
  const header = [...DEFAULT_COLUMNS, ...(props.length ? ['PROPERTIES:', ...props] : [])]
  const rows: string[][] = [header]

  const propertyCells = (id: string): string[] => {
    if (props.length === 0) return []
    const bag = model.properties[id] ?? {}
    return ['', ...props.map((name) => bag[name] ?? '')]
  }

  const wanted = (kind: string) =>
    (kind === 'layer' && options.includeLayers) ||
    (kind === 'object' && options.includeObjects) ||
    (kind === 'attribute' && options.includeAttributes)

  // Document order, so the sheet reads like the canvas rather than like a hash.
  for (const layer of model.layers) {
    if (wanted('layer')) {
      rows.push([layer.id, 'Layer', '', layer.name, '', '', ...propertyCells(layer.id)])
      emitted.add(layer.id)
    }
    for (const object of layer.objects) {
      if (wanted('object')) {
        rows.push([object.id, 'Object', layer.id, object.name, '', '', ...propertyCells(object.id)])
        emitted.add(object.id)
      }
      if (!options.includeAttributes) continue

      const walk = (attrs: typeof object.children, parentId: string): void => {
        for (const attr of attrs) {
          rows.push([
            attr.id,
            // Group vs Attribute is a presentational distinction on export; the
            // importer treats both identically.
            attr.children.length > 0 ? 'Group' : 'Attribute',
            parentId,
            attr.name,
            '',
            '',
            ...propertyCells(attr.id),
          ])
          emitted.add(attr.id)
          walk(attr.children, attr.id)
        }
      }
      walk(object.children, object.id)
    }
  }

  if (options.includeTransitions) {
    for (const t of model.transitions) {
      if (!emitted.has(t.source) || !emitted.has(t.target)) continue
      rows.push([t.id, 'Transition', '', '', t.source, t.target, ...propertyCells(t.id)])
    }
  }

  return rows
}

export function toCsv(rows: string[][]): string {
  return rows.map((row) => row.map(escapeCsv).join(',')).join('\r\n')
}

function escapeCsv(value: string): string {
  // Quote when the value contains a delimiter, a quote, or a line break —
  // and double any embedded quotes.
  if (/[",\r\n]/.test(value)) return `"${value.replace(/"/g, '""')}"`
  return value
}

export function download(filename: string, content: BlobPart, mime: string): void {
  const url = URL.createObjectURL(new Blob([content], { type: mime }))
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = filename
  anchor.click()
  URL.revokeObjectURL(url)
}

/** Filename-safe slug of the model name. */
export function slugify(name: string): string {
  return name.trim().replace(/[^\w.-]+/g, '-').replace(/^-|-$/g, '').toLowerCase() || 'model'
}

/** A ready-to-fill Simple-format template, offered from the import dialog. */
export function templateRows(): string[][] {
  return [
    ['Layer', 'Object', 'Attribute', 'PROPERTIES:', 'Description', 'Classification'],
    ['Source System', 'customers', '', '', 'Raw customer table', ''],
    ['Source System', 'customers', 'customer_id', '', 'Primary key', ''],
    ['Source System', 'customers', 'email', '', '', 'PII'],
    ['Warehouse', 'dim_customer', '', '', 'Conformed dimension', ''],
    ['Warehouse', 'dim_customer', 'customer_key', '', '', ''],
    ['Warehouse', 'dim_customer', 'email_address', '', '', 'PII'],
    [],
    ['SOURCE_Layer', 'SOURCE_Object', 'SOURCE', 'TARGET_Layer', 'TARGET_Object', 'TARGET'],
    ['Source System', 'customers', 'customer_id', 'Warehouse', 'dim_customer', 'customer_key'],
    ['Source System', 'customers', 'email', 'Warehouse', 'dim_customer', 'email_address'],
  ]
}
