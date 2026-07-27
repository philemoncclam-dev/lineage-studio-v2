// Entity tags — free-form labels on ANY entity: a layer, an object, or a
// single attribute.
//
// They live in the property bag under a reserved `Tags` key rather than in a
// new side table on LineageModel. Three reasons:
//
//  - the property bag is already the per-entity side table, already persisted,
//    already exported by the tabular formats, and already survives an entity
//    being deleted and restored;
//  - models saved before tags existed need no migration — an absent key is
//    simply no tags;
//  - the viewer already renders badges off properties (`CDE`, `Classification`),
//    so a tag is the same kind of thing rather than a parallel mechanism.
//
// The stored form is a comma-separated string, because a PropertyBag is
// Record<string, string> and widening it to hold arrays would ripple through
// the import/export formats and the property manager.
import { normalizeTags } from './store'
import type { EntityId, LineageModel } from './types'

/** The reserved property key. Nothing else may write it. */
export const TAGS_KEY = 'Tags'

export function parseTags(value: string | undefined): string[] {
  if (!value) return []
  return normalizeTags(value.split(',').map((t) => t.trim()))
}

export function tagsOf(model: LineageModel, id: EntityId): string[] {
  return parseTags(model.properties[id]?.[TAGS_KEY])
}

/**
 * Replaces the tags on every given entity. Empty clears the key entirely
 * rather than storing "" — an empty string would show up as a property with no
 * value in the property manager.
 */
export function setTags(
  model: LineageModel,
  ids: Iterable<EntityId>,
  tags: readonly string[],
): LineageModel {
  const clean = normalizeTags(tags)
  const properties = { ...model.properties }
  for (const id of ids) {
    const bag = { ...(properties[id] ?? {}) }
    if (clean.length) bag[TAGS_KEY] = clean.join(', ')
    else delete bag[TAGS_KEY]
    if (Object.keys(bag).length) properties[id] = bag
    else delete properties[id]
  }
  return { ...model, properties }
}

/** Every tag in use anywhere in the model — the dialog's suggestion list. */
export function allTags(model: LineageModel): string[] {
  const seen = new Set<string>()
  for (const bag of Object.values(model.properties))
    for (const tag of parseTags(bag[TAGS_KEY])) seen.add(tag)
  return normalizeTags([...seen])
}

/**
 * How many LIVE entities carry each tag.
 *
 * Counted by walking the model rather than the property table, because a bag
 * outlives the entity it described (see the note at the top of this file). A
 * tag whose only holders were deleted should read as gone from the manager, not
 * as a phantom with a count nobody can click through to.
 */
export function tagCounts(model: LineageModel): Map<string, number> {
  const out = new Map<string, number>()
  for (const id of liveIds(model))
    for (const tag of tagsOf(model, id)) out.set(tag, (out.get(tag) ?? 0) + 1)
  return out
}

/** Every entity id currently in the hierarchy, layers then objects then attributes. */
export function liveIds(model: LineageModel): EntityId[] {
  const out: EntityId[] = []
  const walk = (a: { id: EntityId; children: typeof a[] }) => {
    out.push(a.id)
    for (const c of a.children) walk(c)
  }
  for (const layer of model.layers) {
    out.push(layer.id)
    for (const obj of layer.objects) {
      out.push(obj.id)
      for (const a of obj.children) walk(a)
    }
  }
  return out
}

/** Every entity carrying `tag`, case-insensitively. */
export function entitiesWithTag(model: LineageModel, tag: string): EntityId[] {
  const want = tag.toLowerCase()
  return liveIds(model).filter((id) => tagsOf(model, id).some((t) => t.toLowerCase() === want))
}

/**
 * Renames a tag everywhere it appears.
 *
 * Renaming onto an existing tag MERGES rather than erroring: an entity holding
 * both ends up with one, because `normalizeTags` dedupes. That is the only
 * behaviour that can't leave the model in a state the manager can't show.
 */
export function renameTag(model: LineageModel, from: string, to: string): LineageModel {
  const want = from.toLowerCase()
  const clean = normalizeTags([to])[0]
  if (!clean || want === clean.toLowerCase()) return model
  let next = model
  for (const id of entitiesWithTag(model, from)) {
    const swapped = tagsOf(next, id).map((t) => (t.toLowerCase() === want ? clean : t))
    next = setTags(next, [id], swapped)
  }
  return next
}

/** Removes a tag from every entity that carries it. */
export function deleteTag(model: LineageModel, tag: string): LineageModel {
  const want = tag.toLowerCase()
  let next = model
  for (const id of entitiesWithTag(model, tag))
    next = setTags(next, [id], tagsOf(next, id).filter((t) => t.toLowerCase() !== want))
  return next
}

/** Adds a tag to every given entity, keeping whatever they already carry. */
export function addTagTo(
  model: LineageModel,
  ids: Iterable<EntityId>,
  tag: string,
): LineageModel {
  const clean = normalizeTags([tag])[0]
  if (!clean) return model
  let next = model
  for (const id of ids) next = setTags(next, [id], [...tagsOf(next, id), clean])
  return next
}
