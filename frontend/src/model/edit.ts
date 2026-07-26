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

let addCounter = 0
const freshId = (prefix: string) =>
  `${prefix}-${Date.now().toString(36)}-${(addCounter += 1)}`

/** Name given to newly created entities, matching the Model Viewer's own default. */
export const UNNAMED = 'Unnamed'

export interface AddResult {
  model: LineageModel
  /** The created entity, so the caller can select it and open it for renaming. */
  id: EntityId
}

export function addLayer(
  model: LineageModel,
  position?: { relativeTo: EntityId; side: 'before' | 'after' },
): AddResult {
  const layer = { id: freshId('l'), name: UNNAMED, objects: [] }
  const layers = [...model.layers]
  if (position) {
    const at = layers.findIndex((l) => l.id === position.relativeTo)
    layers.splice(at < 0 ? layers.length : at + (position.side === 'after' ? 1 : 0), 0, layer)
  } else {
    layers.push(layer)
  }
  return { model: { ...model, layers, updatedAt: Date.now() }, id: layer.id }
}

export function addObject(
  model: LineageModel,
  layerId: EntityId,
  position?: { relativeTo: EntityId; side: 'before' | 'after' },
): AddResult {
  const object: ModelObject = { id: freshId('o'), name: UNNAMED, children: [] }
  return {
    model: {
      ...model,
      layers: model.layers.map((l) => {
        if (l.id !== layerId) return l
        const objects = [...l.objects]
        if (position) {
          const at = objects.findIndex((o) => o.id === position.relativeTo)
          objects.splice(
            at < 0 ? objects.length : at + (position.side === 'after' ? 1 : 0),
            0,
            object,
          )
        } else {
          objects.push(object)
        }
        return { ...l, objects }
      }),
      updatedAt: Date.now(),
    },
    id: object.id,
  }
}

/**
 * Adds an attribute under `parentId` (an object or an attribute — nesting under
 * an attribute is what turns it into a Group), or beside `position.relativeTo`.
 */
export function addAttribute(
  model: LineageModel,
  parentId: EntityId,
  position?: { relativeTo: EntityId; side: 'before' | 'after' },
): AddResult {
  const attribute: Attribute = { id: freshId('a'), name: UNNAMED, children: [] }

  const insertBeside = (attrs: Attribute[]): Attribute[] => {
    if (!position) return attrs
    const at = attrs.findIndex((a) => a.id === position.relativeTo)
    if (at >= 0) {
      const next = [...attrs]
      next.splice(at + (position.side === 'after' ? 1 : 0), 0, attribute)
      return next
    }
    return attrs.map((a) => ({ ...a, children: insertBeside(a.children) }))
  }

  const appendUnder = (attrs: Attribute[]): Attribute[] =>
    attrs.map((a) =>
      a.id === parentId
        ? { ...a, children: [...a.children, attribute] }
        : { ...a, children: appendUnder(a.children) },
    )

  return {
    model: {
      ...model,
      layers: model.layers.map((l) => ({
        ...l,
        objects: l.objects.map((o) => {
          if (position) return { ...o, children: insertBeside(o.children) }
          if (o.id === parentId) return { ...o, children: [...o.children, attribute] }
          return { ...o, children: appendUnder(o.children) }
        }),
      })),
      updatedAt: Date.now(),
    },
    id: attribute.id,
  }
}

/**
 * Deletes entities but bridges the lineage across them: every incoming edge is
 * reconnected to every outgoing edge, so flow through the deleted entity is
 * preserved rather than severed.
 */
export function deletePreservingTransitions(
  model: LineageModel,
  ids: Iterable<EntityId>,
): LineageModel {
  const doomed = withDescendants(model, ids)
  if (doomed.size === 0) return model

  const bridged = [...model.transitions]
  const add = (source: EntityId, target: EntityId) => {
    if (source === target) return
    if (doomed.has(source) || doomed.has(target)) return
    if (bridged.some((t) => t.source === source && t.target === target)) return
    bridged.push({ id: freshId('t'), source, target })
  }

  for (const id of doomed) {
    const upstream = model.transitions.filter((t) => t.target === id).map((t) => t.source)
    const downstream = model.transitions.filter((t) => t.source === id).map((t) => t.target)
    for (const from of upstream) for (const to of downstream) add(from, to)
  }

  return deleteEntities({ ...model, transitions: bridged }, ids)
}

/** Sorts an entity's direct children by name. Deeper levels are untouched. */
export function sortChildren(
  model: LineageModel,
  parentId: EntityId,
  direction: 'asc' | 'desc',
): LineageModel {
  // Numbers before letters, matching the documented ordering.
  const compare = (a: { name: string }, b: { name: string }) => {
    const result = a.name.localeCompare(b.name, undefined, { numeric: true })
    return direction === 'asc' ? result : -result
  }

  const sortAttrs = (attrs: Attribute[]): Attribute[] =>
    attrs.map((a) =>
      a.id === parentId
        ? { ...a, children: [...a.children].sort(compare) }
        : { ...a, children: sortAttrs(a.children) },
    )

  return {
    ...model,
    layers: model.layers.map((l) => ({
      ...l,
      objects:
        l.id === parentId
          ? [...l.objects].sort(compare)
          : l.objects.map((o) =>
              o.id === parentId
                ? { ...o, children: [...o.children].sort(compare) }
                : { ...o, children: sortAttrs(o.children) },
            ),
    })),
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
