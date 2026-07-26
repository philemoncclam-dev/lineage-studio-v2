// Tabular (CSV / Excel) import.
//
// Takes a grid of cells and produces the RESULTING model plus a diff summary,
// rather than a list of operations. The import flow has a preview step that must
// state exactly how many entities would be added and updated; deriving those
// counts from an operation list would mean simulating the apply twice and
// risking the preview disagreeing with the commit. Planning straight to the
// finished model makes the preview a description of the very object that gets
// saved.
//
// Supported column layouts, detected from the header row:
//
//   Simple      Layer | Object | Attribute [| PROPERTIES: | <names>]
//   Full        ID | TYPE | PARENT | NAME | SOURCE | TARGET [| PROPERTIES: | ...]
//   Transitions SOURCE[_Layer|_Object] | TARGET[_Layer|_Object] [| PROPERTIES: ...]
//   Headerless  a bare list of attribute names
//
// Names are CASE-SENSITIVE when matching, matching the documented behaviour:
// `contacts1.csv` and `Contacts1.csv` are different objects.

import type {
  Attribute,
  EntityId,
  Layer,
  LineageModel,
  ModelObject,
} from './types'

export interface ImportOptions {
  /** Create transitions from SOURCE/TARGET cells on entity rows. */
  generateImplicitTransitions: boolean
  /** Delimiter for PATH columns. */
  pathDelimiter: string
}

export const DEFAULT_IMPORT_OPTIONS: ImportOptions = {
  generateImplicitTransitions: true,
  pathDelimiter: '/',
}

export interface ImportPreview {
  /** The model as it would be after importing. */
  model: LineageModel
  added: { layers: number; objects: number; attributes: number; transitions: number }
  updated: { entities: number; properties: number }
  warnings: string[]
  /** Which layout was detected, for display in the preview step. */
  format: 'simple' | 'full' | 'transitions' | 'headerless' | 'unknown'
}

const KNOWN_HEADERS = new Set([
  'id',
  'type',
  'parent',
  'name',
  'source',
  'target',
  'layer',
  'object',
  'attribute',
  'group',
  'path',
  'properties:',
  'source_layer',
  'source_object',
  'target_layer',
  'target_object',
])

function normalise(cell: string): string {
  return cell.trim().toLowerCase()
}

/** True when the first row looks like column headings rather than data. */
export function looksLikeHeaderRow(row: string[]): boolean {
  return row.some((cell) => {
    const key = normalise(cell)
    return KNOWN_HEADERS.has(key) || key.startsWith('property:')
  })
}

interface HeaderMap {
  /** Lower-cased header name -> column index, for the structural columns. */
  columns: Map<string, number>
  /** Column index -> property name, for everything right of `PROPERTIES:`. */
  properties: Map<number, string>
}

function readHeaders(row: string[]): HeaderMap {
  const columns = new Map<string, number>()
  const properties = new Map<number, string>()
  let propertiesFrom = -1

  row.forEach((raw, i) => {
    const key = normalise(raw)
    if (key === 'properties:') {
      propertiesFrom = i
      return
    }
    // `PROPERTY:name` is the alternative single-column form.
    if (key.startsWith('property:')) {
      properties.set(i, raw.trim().slice('property:'.length))
      return
    }
    if (propertiesFrom >= 0 && i > propertiesFrom) {
      if (raw.trim()) properties.set(i, raw.trim())
      return
    }
    if (key) columns.set(key, i)
  })

  return { columns, properties }
}

/** Mutable working copy of the model, so a plan can build incrementally. */
interface Draft {
  layers: Layer[]
  transitions: LineageModel['transitions']
  properties: LineageModel['properties']
}

let counter = 0
const newId = (prefix: string) => `${prefix}-imp-${Date.now().toString(36)}-${(counter += 1)}`

export function planImport(
  base: LineageModel,
  rows: string[][],
  options: ImportOptions = DEFAULT_IMPORT_OPTIONS,
): ImportPreview {
  // Deep-ish clone: layers are rebuilt, so mutating the draft cannot touch the
  // caller's model even though leaf attributes are shared until replaced.
  const draft: Draft = {
    layers: base.layers.map(cloneLayer),
    transitions: [...base.transitions],
    properties: { ...base.properties },
  }

  const added = { layers: 0, objects: 0, attributes: 0, transitions: 0 }
  const updated = { entities: 0, properties: 0 }
  const warnings: string[] = []

  const grid = rows.filter((r) => r.some((c) => c.trim() !== ''))
  if (grid.length === 0) {
    return { model: base, added, updated, warnings: ['Nothing to import.'], format: 'unknown' }
  }

  const hasHeaders = looksLikeHeaderRow(grid[0])
  const headers = hasHeaders ? readHeaders(grid[0]) : null
  const body = hasHeaders ? grid.slice(1) : grid
  const columns = headers?.columns ?? new Map<string, number>()

  const format: ImportPreview['format'] = !hasHeaders
    ? 'headerless'
    : columns.has('type')
      ? 'full'
      : columns.has('layer') || columns.has('object') || columns.has('attribute')
        ? 'simple'
        : columns.has('source') || columns.has('target')
          ? 'transitions'
          : 'unknown'

  if (format === 'unknown') {
    warnings.push(
      'No recognised columns. Expected some combination of Layer/Object/Attribute, ' +
        'or TYPE/NAME/PARENT, or SOURCE/TARGET.',
    )
    return { model: base, added, updated, warnings, format }
  }

  // ---- helpers over the draft -------------------------------------------

  const cell = (row: string[], key: string): string => {
    const i = columns.get(key)
    return i === undefined ? '' : (row[i] ?? '').trim()
  }

  const ensureLayer = (name: string): Layer => {
    const existing = draft.layers.find((l) => l.name === name)
    if (existing) return existing
    const created: Layer = { id: newId('l'), name, objects: [] }
    draft.layers.push(created)
    added.layers += 1
    return created
  }

  const ensureObject = (layer: Layer, name: string): ModelObject => {
    const existing = layer.objects.find((o) => o.name === name)
    if (existing) return existing
    const created: ModelObject = { id: newId('o'), name, children: [] }
    layer.objects.push(created)
    added.objects += 1
    return created
  }

  const ensureAttribute = (
    parent: ModelObject | Attribute,
    name: string,
  ): Attribute => {
    const existing = parent.children.find((a) => a.name === name)
    if (existing) return existing
    const created: Attribute = { id: newId('a'), name, children: [] }
    parent.children.push(created)
    added.attributes += 1
    return created
  }

  /** Every entity in the draft, for name/id lookups. */
  const allEntities = (): { id: EntityId; name: string }[] => {
    const out: { id: EntityId; name: string }[] = []
    const walk = (attrs: Attribute[]) => {
      for (const a of attrs) {
        out.push({ id: a.id, name: a.name })
        walk(a.children)
      }
    }
    for (const l of draft.layers) {
      out.push({ id: l.id, name: l.name })
      for (const o of l.objects) {
        out.push({ id: o.id, name: o.name })
        walk(o.children)
      }
    }
    return out
  }

  /** Row-local ids (the ID column, or a 1-based row number) -> entity id. */
  const rowIds = new Map<string, EntityId>()

  const resolveRef = (ref: string): EntityId | null => {
    const key = ref.trim()
    if (!key) return null
    const local = rowIds.get(key)
    if (local) return local
    const entities = allEntities()
    const byId = entities.find((e) => e.id === key)
    if (byId) return byId.id
    const byName = entities.filter((e) => e.name === key)
    if (byName.length === 1) return byName[0].id
    if (byName.length > 1) {
      warnings.push(`"${key}" matches ${byName.length} entities — using the first.`)
      return byName[0].id
    }
    return null
  }

  const connect = (source: EntityId, target: EntityId): void => {
    if (source === target) return
    if (draft.transitions.some((t) => t.source === source && t.target === target)) return
    draft.transitions.push({ id: newId('t'), source, target })
    added.transitions += 1
  }

  const applyProperties = (row: string[], entityId: EntityId): void => {
    if (!headers) return
    for (const [column, propertyName] of headers.properties) {
      const value = (row[column] ?? '').trim()
      if (!value) continue
      const bag = draft.properties[entityId] ?? {}
      if (bag[propertyName] !== value) updated.properties += 1
      draft.properties[entityId] = { ...bag, [propertyName]: value }
    }
  }

  // ---- row processing ----------------------------------------------------

  // Two passes for the FULL format: entities first, then transitions, so a
  // transition row may reference an entity defined further down the sheet.
  const deferredTransitions: { row: string[]; rowNumber: number }[] = []

  body.forEach((row, i) => {
    const rowNumber = hasHeaders ? i + 2 : i + 1

    if (format === 'headerless') {
      const name = (row[0] ?? '').trim()
      if (!name) return
      // No layer or object given, so everything lands in one holding object —
      // the alternative is silently discarding the rows.
      const layer = ensureLayer('Imported')
      const object = ensureObject(layer, 'Imported')
      ensureAttribute(object, name)
      return
    }

    if (format === 'simple') {
      const layerName = cell(row, 'layer')
      const objectName = cell(row, 'object')
      const attributeName = cell(row, 'attribute')

      // A row with only SOURCE/TARGET is a transition row even in simple mode.
      if (!layerName && !objectName && !attributeName) {
        deferredTransitions.push({ row, rowNumber })
        return
      }

      const layer = ensureLayer(layerName || 'Imported')
      let deepest: EntityId = layer.id
      if (objectName) {
        const object = ensureObject(layer, objectName)
        deepest = object.id
        if (attributeName) deepest = ensureAttribute(object, attributeName).id
      } else if (attributeName) {
        const object = ensureObject(layer, 'Imported')
        deepest = ensureAttribute(object, attributeName).id
      }

      rowIds.set(String(rowNumber), deepest)
      applyProperties(row, deepest)
      deferredTransitions.push({ row, rowNumber })
      return
    }

    if (format === 'full') {
      const type = cell(row, 'type').toLowerCase()
      const name = cell(row, 'name')
      const declaredId = cell(row, 'id')

      if (type === 'transition') {
        deferredTransitions.push({ row, rowNumber })
        return
      }
      if (!name) {
        warnings.push(`Row ${rowNumber}: no NAME — skipped.`)
        return
      }

      const parentRef = cell(row, 'parent')
      let entityId: EntityId

      if (type === 'layer') {
        entityId = ensureLayer(name).id
      } else if (type === 'object') {
        const parentLayer = parentRef
          ? draft.layers.find((l) => l.id === resolveRef(parentRef) || l.name === parentRef)
          : undefined
        entityId = ensureObject(parentLayer ?? ensureLayer('Imported'), name).id
      } else {
        // Attribute or Group — Group is just an Attribute that gains children.
        const parentId = parentRef ? resolveRef(parentRef) : null
        const parent = parentId ? findAttributeParent(draft, parentId) : null
        if (!parent) {
          warnings.push(
            `Row ${rowNumber}: could not resolve PARENT "${parentRef}" — placed in Imported.`,
          )
          entityId = ensureAttribute(ensureObject(ensureLayer('Imported'), 'Imported'), name).id
        } else {
          entityId = ensureAttribute(parent, name).id
        }
      }

      if (declaredId) rowIds.set(declaredId, entityId)
      rowIds.set(String(rowNumber), entityId)
      applyProperties(row, entityId)
      deferredTransitions.push({ row, rowNumber })
      return
    }

    // transitions-only sheet
    deferredTransitions.push({ row, rowNumber })
  })

  // ---- transitions -------------------------------------------------------

  for (const { row, rowNumber } of deferredTransitions) {
    const isExplicit = format === 'transitions' || cell(row, 'type').toLowerCase() === 'transition'
    if (!isExplicit && !options.generateImplicitTransitions) continue

    const sources = splitRefs(cell(row, 'source'))
    const targets = splitRefs(cell(row, 'target'))
    if (sources.length === 0 && targets.length === 0) continue

    const self = rowIds.get(String(rowNumber)) ?? null

    if (isExplicit) {
      if (sources.length === 0 || targets.length === 0) {
        warnings.push(`Row ${rowNumber}: a transition needs both SOURCE and TARGET.`)
        continue
      }
      for (const s of sources) {
        for (const t of targets) {
          const from = resolveScoped(row, s, 'source')
          const to = resolveScoped(row, t, 'target')
          if (!from || !to) {
            warnings.push(`Row ${rowNumber}: failed to find transition endpoint.`)
            continue
          }
          connect(from, to)
        }
      }
      continue
    }

    // Implicit: this row's entity is the other end.
    if (!self) continue
    for (const s of sources) {
      const from = resolveScoped(row, s, 'source')
      if (from) connect(from, self)
      else warnings.push(`Row ${rowNumber}: unknown SOURCE "${s}".`)
    }
    for (const t of targets) {
      const to = resolveScoped(row, t, 'target')
      if (to) connect(self, to)
      else warnings.push(`Row ${rowNumber}: unknown TARGET "${t}".`)
    }
  }

  /** Resolves a ref, narrowing by the row's SOURCE_/TARGET_ scope columns. */
  function resolveScoped(row: string[], ref: string, side: 'source' | 'target'): EntityId | null {
    const layerName = cell(row, `${side}_layer`)
    const objectName = cell(row, `${side}_object`)
    if (!layerName && !objectName) return resolveRef(ref)

    for (const layer of draft.layers) {
      if (layerName && layer.name !== layerName) continue
      for (const object of layer.objects) {
        if (objectName && object.name !== objectName) continue
        if (object.name === ref) return object.id
        const found = findAttributeByName(object.children, ref)
        if (found) return found
      }
    }
    return resolveRef(ref)
  }

  const model: LineageModel = {
    ...base,
    layers: draft.layers,
    transitions: draft.transitions,
    properties: draft.properties,
    updatedAt: Date.now(),
  }

  return { model, added, updated, warnings, format }
}

function splitRefs(value: string): string[] {
  return value
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean)
}

function cloneLayer(layer: Layer): Layer {
  return {
    ...layer,
    objects: layer.objects.map((o) => ({ ...o, children: o.children.map(cloneAttribute) })),
  }
}

function cloneAttribute(attr: Attribute): Attribute {
  return { ...attr, children: attr.children.map(cloneAttribute) }
}

/** The object or attribute with this id, i.e. something that can hold attributes. */
function findAttributeParent(draft: Draft, id: EntityId): ModelObject | Attribute | null {
  const search = (attrs: Attribute[]): Attribute | null => {
    for (const a of attrs) {
      if (a.id === id) return a
      const found = search(a.children)
      if (found) return found
    }
    return null
  }
  for (const layer of draft.layers) {
    for (const object of layer.objects) {
      if (object.id === id) return object
      const found = search(object.children)
      if (found) return found
    }
  }
  return null
}

function findAttributeByName(attrs: Attribute[], name: string): EntityId | null {
  for (const a of attrs) {
    if (a.name === name) return a.id
    const found = findAttributeByName(a.children, name)
    if (found) return found
  }
  return null
}

/** Minimal RFC4180-ish CSV parser: quoted fields, embedded commas and newlines. */
export function parseCsv(text: string): string[][] {
  const rows: string[][] = []
  let row: string[] = []
  let field = ''
  let quoted = false

  for (let i = 0; i < text.length; i += 1) {
    const char = text[i]
    if (quoted) {
      if (char === '"') {
        if (text[i + 1] === '"') {
          field += '"'
          i += 1
        } else quoted = false
      } else field += char
      continue
    }
    if (char === '"') {
      quoted = true
    } else if (char === ',' || char === '\t') {
      row.push(field)
      field = ''
    } else if (char === '\n') {
      row.push(field)
      rows.push(row)
      row = []
      field = ''
    } else if (char !== '\r') {
      field += char
    }
  }
  row.push(field)
  rows.push(row)
  return rows
}
