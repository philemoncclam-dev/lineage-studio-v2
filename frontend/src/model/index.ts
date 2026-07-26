// Derived read-side index over a LineageModel.
//
// The persisted document is a nested tree because that's what render order and
// import/export both want. Almost every other operation — resolving a
// transition endpoint, walking to an ancestor, computing a path, answering
// "what layer is this in" — is a random-access question the tree answers in
// O(n). So we build a flat index once per model revision and read from that.
//
// Nothing here mutates the model; the editor produces new models and rebuilds.

import type {
  Attribute,
  EntityId,
  EntityKind,
  Layer,
  LineageModel,
  ModelObject,
} from './types'

export interface IndexEntry {
  id: EntityId
  kind: EntityKind
  name: string
  /** null for layers, which sit at the root. */
  parentId: EntityId | null
  /** 0 for an Object's direct attributes, +1 per nesting level. Layers/objects are -1/0. */
  depth: number
  /** The layer this entity belongs to (itself, if it is a layer). */
  layerId: EntityId
  /** The object this entity belongs to; null for layers and for the object itself. */
  objectId: EntityId | null
  /** True when this entity has children — i.e. it is collapsible. */
  hasChildren: boolean
}

export interface ModelIndex {
  entries: Map<EntityId, IndexEntry>
  /** Transitions grouped by endpoint, for trace/highlight without a full scan. */
  outgoing: Map<EntityId, EntityId[]>
  incoming: Map<EntityId, EntityId[]>
}

export function buildIndex(model: LineageModel): ModelIndex {
  const entries = new Map<EntityId, IndexEntry>()

  const visitAttribute = (
    attr: Attribute,
    parentId: EntityId,
    depth: number,
    layerId: EntityId,
    objectId: EntityId,
  ): void => {
    entries.set(attr.id, {
      id: attr.id,
      kind: 'attribute',
      name: attr.name,
      parentId,
      depth,
      layerId,
      objectId,
      hasChildren: attr.children.length > 0,
    })
    for (const child of attr.children) {
      visitAttribute(child, attr.id, depth + 1, layerId, objectId)
    }
  }

  const visitObject = (obj: ModelObject, layerId: EntityId): void => {
    entries.set(obj.id, {
      id: obj.id,
      kind: 'object',
      name: obj.name,
      parentId: layerId,
      depth: 0,
      layerId,
      objectId: null,
      hasChildren: obj.children.length > 0,
    })
    for (const child of obj.children) visitAttribute(child, obj.id, 0, layerId, obj.id)
  }

  const visitLayer = (layer: Layer): void => {
    entries.set(layer.id, {
      id: layer.id,
      kind: 'layer',
      name: layer.name,
      parentId: null,
      depth: -1,
      layerId: layer.id,
      objectId: null,
      hasChildren: layer.objects.length > 0,
    })
    for (const obj of layer.objects) visitObject(obj, layer.id)
  }

  for (const layer of model.layers) visitLayer(layer)

  const outgoing = new Map<EntityId, EntityId[]>()
  const incoming = new Map<EntityId, EntityId[]>()
  for (const t of model.transitions) {
    push(outgoing, t.source, t.target)
    push(incoming, t.target, t.source)
  }

  return { entries, outgoing, incoming }
}

function push(map: Map<EntityId, EntityId[]>, key: EntityId, value: EntityId): void {
  const existing = map.get(key)
  if (existing) existing.push(value)
  else map.set(key, [value])
}

/** Ancestors nearest-first, excluding the entity itself. */
export function ancestorsOf(index: ModelIndex, id: EntityId): IndexEntry[] {
  const out: IndexEntry[] = []
  let cursor = index.entries.get(id)?.parentId ?? null
  while (cursor) {
    const entry = index.entries.get(cursor)
    if (!entry) break
    out.push(entry)
    cursor = entry.parentId
  }
  return out
}

/**
 * The entity's address within the model, e.g. `Object/Group/Attribute`.
 *
 * The layer name is excluded: paths are used to match entities ACROSS layers
 * (an attribute keeps its path as it flows left to right), so including the
 * layer would make every path unique and useless for matching.
 *
 * `/` in a name is escaped as `\/` so a path always round-trips.
 */
export function pathOf(index: ModelIndex, id: EntityId): string {
  const entry = index.entries.get(id)
  if (!entry || entry.kind === 'layer') return ''
  const parts = [entry, ...ancestorsOf(index, id)]
    .filter((e) => e.kind !== 'layer')
    .map((e) => e.name.replace(/([/\\])/g, '\\$1'))
    .reverse()
  return parts.join('/')
}

export function countEntities(model: LineageModel): number {
  let total = 0
  const countAttrs = (attrs: Attribute[]): void => {
    for (const a of attrs) {
      total += 1
      countAttrs(a.children)
    }
  }
  for (const layer of model.layers) {
    total += 1
    for (const obj of layer.objects) {
      total += 1
      countAttrs(obj.children)
    }
  }
  return total
}

/** Direct + transitive descendant counts, as shown in the `3(26)` header badge. */
export function descendantCounts(node: ModelObject | Attribute): {
  direct: number
  total: number
} {
  let total = 0
  const walk = (attrs: Attribute[]): void => {
    for (const a of attrs) {
      total += 1
      walk(a.children)
    }
  }
  walk(node.children)
  return { direct: node.children.length, total }
}
