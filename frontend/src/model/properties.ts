// Reading and writing the property bag — the side table every other feature
// has been writing into and nothing has been able to read back.
//
// By the time this file existed the bag already held provenance from three
// different producers: `Source`/`Step`/`Workspace`/`Access`/`Data type`/
// `Transform` from the sandbox importer, `Confidence`/`Mapped by`/`Algorithm`
// from the Auto-Mapper, and `Tags` from the tag editor. All of it was
// write-only in the UI — badged at best, invisible at worst. These are the
// operations the Properties panel reads and edits it through.
//
// Two shape facts drive everything here:
//
//  - Properties are keyed by ENTITY ID, and a Transition has an id, so a
//    transition's properties live in exactly the same table as an entity's.
//    Nothing below is entity-specific; `subject` is any id.
//  - A bag outlives the thing it described (see types.ts). So these operations
//    never garbage-collect a bag for an id they weren't asked about.
import { TAGS_KEY } from './tags'
import type { Attribute, EntityId, LineageModel, PropertyBag } from './types'

/**
 * Keys the generic key/value editor refuses to touch.
 *
 * `Tags` is stored as a comma-joined string with its own normalization, its own
 * editor and its own vocabulary manager. Letting it be typed as raw text here
 * would let `a,,B` past normalizeTags and desync the tag manager's counts from
 * what the badges show.
 */
export const RESERVED_KEYS: readonly string[] = [TAGS_KEY]

export function isReservedKey(key: string): boolean {
  return RESERVED_KEYS.some((k) => k.toLowerCase() === key.trim().toLowerCase())
}

/** One row in the panel: a key, and what the subjects say about it. */
export interface PropertyRow {
  key: string
  /** The shared value, or '' when the subjects disagree. */
  value: string
  /** True when the subjects hold different values (including "absent" vs set). */
  mixed: boolean
  /** How many of the subjects carry the key at all. */
  present: number
}

export function propertiesOf(model: LineageModel, id: EntityId): PropertyBag {
  return model.properties[id] ?? {}
}

/**
 * The rows to show for a selection, reserved keys excluded.
 *
 * A key present on only some of the selection reads as `mixed` rather than
 * being dropped: "three of these five are marked CDE" is the answer you opened
 * the panel for, and hiding the key would make it look like none of them were.
 * Sorted by key so the list doesn't reorder as values are edited.
 */
export function commonProperties(model: LineageModel, ids: readonly EntityId[]): PropertyRow[] {
  const keys = new Set<string>()
  for (const id of ids)
    for (const key of Object.keys(propertiesOf(model, id))) if (!isReservedKey(key)) keys.add(key)

  return [...keys].sort((a, b) => a.localeCompare(b)).map((key) => {
    const values = ids.map((id) => propertiesOf(model, id)[key])
    const present = values.filter((v) => v !== undefined).length
    const first = values[0]
    const mixed = values.some((v) => v !== first)
    return { key, value: mixed ? '' : (first ?? ''), mixed, present }
  })
}

/**
 * Sets `key` on every subject.
 *
 * An empty value DELETES the key rather than storing `''`. Same rule as
 * `setTags`: a key with no value is indistinguishable from an absent one to
 * every reader (the filter, the badges, the exporters), so storing it would
 * only create rows nothing can act on. Clearing the box is how you remove a
 * property, which is also what makes the delete button optional rather than
 * the only way out.
 */
export function setProperty(
  model: LineageModel,
  ids: Iterable<EntityId>,
  key: string,
  value: string,
): LineageModel {
  const clean = key.trim()
  if (!clean || isReservedKey(clean)) return model

  const properties = { ...model.properties }
  for (const id of ids) {
    const bag = { ...(properties[id] ?? {}) }
    if (value) bag[clean] = value
    else delete bag[clean]
    if (Object.keys(bag).length) properties[id] = bag
    else delete properties[id]
  }
  return { ...model, properties, updatedAt: Date.now() }
}

/** Removes `key` from every subject. */
export function removeProperty(
  model: LineageModel,
  ids: Iterable<EntityId>,
  key: string,
): LineageModel {
  return setProperty(model, ids, key, '')
}

/**
 * Renames a key on the given subjects, keeping each subject's own value.
 *
 * Scoped to the subjects rather than the whole model: unlike a tag, a property
 * key is not a shared vocabulary — `Source` on a transition and `Source` on an
 * object are the same word about different things, and a global rename would
 * silently rewrite bags the user never had on screen.
 *
 * Renaming ONTO an existing key overwrites it. There is no merge that isn't a
 * guess about which of two values wins, and the panel warns before offering it.
 */
export function renameProperty(
  model: LineageModel,
  ids: Iterable<EntityId>,
  from: string,
  to: string,
): LineageModel {
  const clean = to.trim()
  if (!clean || isReservedKey(clean) || isReservedKey(from) || clean === from) return model

  const properties = { ...model.properties }
  for (const id of ids) {
    const bag = properties[id]
    if (!bag || bag[from] === undefined) continue
    const next = { ...bag }
    next[clean] = next[from]
    delete next[from]
    properties[id] = next
  }
  return { ...model, properties, updatedAt: Date.now() }
}

/**
 * Every property key in use anywhere, ranked by how many LIVE things carry it.
 *
 * Counted over the whole property table rather than the hierarchy, because
 * transitions are subjects here too and they are not in the hierarchy. This
 * feeds the key suggestion list, where the point is "what does this model
 * already call things" — so frequency order beats alphabetical.
 */
export function propertyKeyCounts(model: LineageModel): Map<string, number> {
  const out = new Map<string, number>()
  for (const bag of Object.values(model.properties))
    for (const key of Object.keys(bag))
      if (!isReservedKey(key)) out.set(key, (out.get(key) ?? 0) + 1)
  return out
}

/** Values already used for `key`, so a second entity can be given the same one. */
export function valuesForKey(model: LineageModel, key: string): string[] {
  const seen = new Set<string>()
  for (const bag of Object.values(model.properties)) {
    const value = bag[key]
    if (value) seen.add(value)
  }
  return [...seen].sort((a, b) => a.localeCompare(b))
}

/**
 * The model with property bags for entities that no longer exist dropped.
 *
 * Deleting an entity deliberately LEAVES its properties behind — see
 * `deleteEntities` — so a value survives an accidental delete and stays in the
 * property manager. That is right for an open document and wrong for a payload:
 * a model edited for months carries the properties of everything it ever held,
 * and the share endpoint refuses anything over 2MB (`share/store.py`), so the
 * growth eventually turns into "this model cannot be shared" with no visible
 * cause.
 *
 * So this is not called on save. It is called where a model LEAVES the app —
 * share and export — which is exactly where dead weight costs something and
 * where nobody will undo a delete afterwards.
 */
export function compactProperties(model: LineageModel): LineageModel {
  const live = new Set<EntityId>()
  const walk = (attrs: readonly Attribute[]) => {
    for (const a of attrs) {
      live.add(a.id)
      walk(a.children)
    }
  }
  for (const layer of model.layers) {
    live.add(layer.id)
    for (const object of layer.objects) {
      live.add(object.id)
      walk(object.children)
    }
  }

  const properties: Record<EntityId, PropertyBag> = {}
  for (const [id, bag] of Object.entries(model.properties)) {
    if (live.has(id)) properties[id] = bag
  }
  return { ...model, properties }
}

/** How many property bags belong to entities that are gone. */
export function orphanedPropertyCount(model: LineageModel): number {
  return (
    Object.keys(model.properties).length -
    Object.keys(compactProperties(model).properties).length
  )
}
