// Pure model mutations. Every function returns a NEW model and never mutates
// its argument — that is what makes undo/redo a matter of keeping references,
// and what lets React see a changed identity and re-render.

import { buildIndex } from './index'
import type { Attribute, EntityId, LineageModel, ModelObject } from './types'

/** Collects `ids` plus every descendant, since deleting a parent takes its subtree. */
export function withDescendants(model: LineageModel, ids: Iterable<EntityId>): Set<EntityId> {
  const doomed = new Set<EntityId>(ids)

  const collectAttr = (attr: Attribute, inside: boolean): void => {
    const hit = inside || doomed.has(attr.id)
    if (hit) doomed.add(attr.id)
    for (const child of attr.children) collectAttr(child, hit)
  }

  for (const layer of model.layers) {
    const layerHit = doomed.has(layer.id)
    for (const obj of layer.objects) {
      const objHit = layerHit || doomed.has(obj.id)
      if (objHit) doomed.add(obj.id)
      for (const child of obj.children) collectAttr(child, objHit)
    }
  }
  return doomed
}

/**
 * Deletes entities and their subtrees.
 *
 * Transitions touching anything deleted go too. Properties are deliberately
 * left behind: property VALUES outlive the entity they were assigned to, so
 * they stay available in the property manager rather than being silently
 * destroyed by a delete the user may undo.
 */
export function deleteEntities(model: LineageModel, ids: Iterable<EntityId>): LineageModel {
  const doomed = withDescendants(model, ids)
  if (doomed.size === 0) return model

  const pruneAttrs = (attrs: Attribute[]): Attribute[] =>
    attrs
      .filter((a) => !doomed.has(a.id))
      .map((a) => ({ ...a, children: pruneAttrs(a.children) }))

  const layers = model.layers
    .filter((l) => !doomed.has(l.id))
    .map((l) => ({
      ...l,
      objects: l.objects
        .filter((o) => !doomed.has(o.id))
        .map((o): ModelObject => ({ ...o, children: pruneAttrs(o.children) })),
    }))

  return {
    ...model,
    layers,
    transitions: model.transitions.filter(
      (t) => !doomed.has(t.source) && !doomed.has(t.target),
    ),
    updatedAt: Date.now(),
  }
}

/**
 * Connects two entities.
 *
 * Rejects self-links and exact duplicates. Does NOT reject reversed pairs —
 * A→B and B→A are both meaningful in a lineage graph (a round trip through a
 * staging table is real), so the modeller decides, not this function.
 */
export function addTransition(
  model: LineageModel,
  source: EntityId,
  target: EntityId,
): LineageModel {
  if (source === target) return model
  const index = buildIndex(model)
  if (!index.entries.has(source) || !index.entries.has(target)) return model
  if (model.transitions.some((t) => t.source === source && t.target === target)) return model

  return {
    ...model,
    transitions: [
      ...model.transitions,
      { id: crypto.randomUUID(), source, target },
    ],
    updatedAt: Date.now(),
  }
}

export function removeTransitions(model: LineageModel, ids: Iterable<EntityId>): LineageModel {
  const doomed = new Set(ids)
  if (doomed.size === 0) return model
  return {
    ...model,
    transitions: model.transitions.filter((t) => !doomed.has(t.id)),
    updatedAt: Date.now(),
  }
}

export function renameEntity(
  model: LineageModel,
  id: EntityId,
  name: string,
): LineageModel {
  const renameAttrs = (attrs: Attribute[]): Attribute[] =>
    attrs.map((a) =>
      a.id === id ? { ...a, name, children: renameAttrs(a.children) } : { ...a, children: renameAttrs(a.children) },
    )

  return {
    ...model,
    layers: model.layers.map((l) => ({
      ...(l.id === id ? { ...l, name } : l),
      objects: l.objects.map((o) => ({
        ...(o.id === id ? { ...o, name } : o),
        children: renameAttrs(o.children),
      })),
    })),
    updatedAt: Date.now(),
  }
}
