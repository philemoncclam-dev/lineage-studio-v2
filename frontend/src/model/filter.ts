// The Views filter: which entities the viewer should call "matching".
//
// Kept out of ModelViewer so the rule is one testable function rather than a
// condition spread through the render. The viewer decides what to DO with a
// match (dim the rest, or hide them); this file only decides what matches.
//
// Everything is AND-ed across the fields and OR-ed within a field: picking two
// tags means "either tag", but adding a name narrows that to "either tag AND
// this name". That is what people expect from a faceted filter, and it is the
// only combination where adding a control can never widen the result.
import { parseTags, TAGS_KEY } from './tags'
import type { EntityId, LineageModel } from './types'

export type EntityKind = 'layer' | 'object' | 'attribute'
export type AccessValue = 'Read' | 'Write'

export interface ViewFilter {
  /** Substring, case-insensitive, matched against the entity name. */
  name: string
  /** Entity carries ANY of these tags. Empty means "don't care". */
  tags: string[]
  /** Entity is one of these kinds. Empty means "don't care". */
  kinds: EntityKind[]
  /**
   * Entity's `Access` property is one of these. Empty means "don't care".
   *
   * Access is a PROPERTY, not a tag — it is what the sandbox observed rather
   * than a label anyone assigned — so it gets its own control instead of being
   * folded into `tags`, where it would be unremovable and would pollute the
   * tag vocabulary.
   */
  access: AccessValue[]
  /** Property key -> substring its value must contain. */
  properties: { key: string; value: string }[]
  /** Hide non-matching entities outright rather than dimming them. */
  hide: boolean
}

export const EMPTY_FILTER: ViewFilter = {
  name: '',
  tags: [],
  kinds: [],
  access: [],
  properties: [],
  hide: false,
}

/** True when the filter would not narrow anything, so the viewer can skip it. */
export function isEmptyFilter(f: ViewFilter): boolean {
  return (
    !f.name.trim() &&
    f.tags.length === 0 &&
    f.kinds.length === 0 &&
    f.access.length === 0 &&
    f.properties.every((p) => !p.key.trim())
  )
}

/** How many controls are narrowing — shown on the rail button and the panel. */
export function activeFilterCount(f: ViewFilter): number {
  let n = 0
  if (f.name.trim()) n++
  if (f.tags.length) n++
  if (f.kinds.length) n++
  if (f.access.length) n++
  n += f.properties.filter((p) => p.key.trim()).length
  return n
}

interface Candidate {
  id: EntityId
  name: string
  kind: EntityKind
}

/** Every entity in the model, flattened, with the kind the filter tests against. */
export function allEntities(model: LineageModel): Candidate[] {
  const out: Candidate[] = []
  const walkAttr = (a: { id: EntityId; name: string; children: typeof a[] }) => {
    out.push({ id: a.id, name: a.name, kind: 'attribute' })
    for (const c of a.children) walkAttr(c)
  }
  for (const layer of model.layers) {
    out.push({ id: layer.id, name: layer.name, kind: 'layer' })
    for (const obj of layer.objects) {
      out.push({ id: obj.id, name: obj.name, kind: 'object' })
      for (const a of obj.children) walkAttr(a)
    }
  }
  return out
}

function matches(model: LineageModel, c: Candidate, f: ViewFilter): boolean {
  const bag = model.properties[c.id] ?? {}

  const needle = f.name.trim().toLowerCase()
  if (needle && !c.name.toLowerCase().includes(needle)) return false

  if (f.kinds.length && !f.kinds.includes(c.kind)) return false

  if (f.access.length) {
    const access = bag.Access
    if (access !== 'Read' && access !== 'Write') return false
    if (!f.access.includes(access)) return false
  }

  if (f.tags.length) {
    const own = parseTags(bag[TAGS_KEY]).map((t) => t.toLowerCase())
    if (!f.tags.some((t) => own.includes(t.toLowerCase()))) return false
  }

  for (const p of f.properties) {
    const key = p.key.trim()
    if (!key) continue
    const value = bag[key]
    if (value === undefined) return false
    // An empty value box means "has this property at all", which is the useful
    // reading — you reach for a property filter to find what carries it.
    const want = p.value.trim().toLowerCase()
    if (want && !value.toLowerCase().includes(want)) return false
  }

  return true
}

/**
 * The ids the filter matches.
 *
 * An ANCESTOR of a match is itself kept, always. Hiding the object that holds a
 * matching column would take the match off screen with it, and dimming it would
 * leave a lit row inside a greyed card — so a parent is kept as a container
 * whether or not it matches on its own. The reverse does NOT hold: a matching
 * object does not light up its columns, or filtering for one table would
 * "match" its whole schema and the count would stop meaning anything.
 */
export function applyFilter(model: LineageModel, f: ViewFilter): ReadonlySet<EntityId> {
  const out = new Set<EntityId>()
  if (isEmptyFilter(f)) return out

  // Walk with the ancestor chain in hand so a hit can light its parents.
  const walkAttr = (
    a: { id: EntityId; name: string; children: typeof a[] },
    ancestors: EntityId[],
  ) => {
    if (matches(model, { id: a.id, name: a.name, kind: 'attribute' }, f)) {
      out.add(a.id)
      for (const up of ancestors) out.add(up)
    }
    for (const c of a.children) walkAttr(c, [...ancestors, a.id])
  }

  for (const layer of model.layers) {
    if (matches(model, { id: layer.id, name: layer.name, kind: 'layer' }, f)) out.add(layer.id)
    for (const obj of layer.objects) {
      if (matches(model, { id: obj.id, name: obj.name, kind: 'object' }, f)) {
        out.add(obj.id)
        out.add(layer.id)
      }
      for (const a of obj.children) walkAttr(a, [layer.id, obj.id])
    }
  }
  return out
}

/**
 * An edge is a match only when BOTH its endpoints are.
 *
 * A transition is a statement about a pair; one end being filtered out makes
 * the whole statement out of view. In dim mode these fade with their rows; in
 * hide mode they must be dropped, because the row they anchored to is no longer
 * painted and the line would hang in empty space pointing at nothing.
 */
export function visibleTransitions<T extends { source: EntityId; target: EntityId }>(
  transitions: T[],
  matched: ReadonlySet<EntityId>,
  filtering: boolean,
  hide: boolean,
): T[] {
  if (!filtering || !hide) return transitions
  return transitions.filter((t) => matched.has(t.source) && matched.has(t.target))
}

/** Every property key in use, for the property filter's datalist. */
export function allPropertyKeys(model: LineageModel): string[] {
  const seen = new Set<string>()
  for (const bag of Object.values(model.properties))
    for (const key of Object.keys(bag)) if (key !== TAGS_KEY) seen.add(key)
  return [...seen].sort((a, b) => a.localeCompare(b))
}
