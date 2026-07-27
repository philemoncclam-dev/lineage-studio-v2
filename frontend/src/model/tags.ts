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
