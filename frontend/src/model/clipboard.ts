// Copy / cut / paste of model subtrees.
//
// The clipboard holds a KIND-FREE tree. What a pasted node becomes is decided by
// where it lands, not by what it was: paste into blank canvas and the roots
// become layers; into a layer and they become objects; into an object or
// attribute and they become attributes. That is the documented behaviour — you
// can copy three objects and paste them as three layers — and it falls out
// naturally if the payload never records a kind in the first place.
//
// Transitions are carried in three buckets because they behave differently:
// edges wholly inside the copied set are duplicated between the clones, while
// edges crossing the boundary are re-attached to the still-existing outside
// entity, so a pasted copy arrives already wired into its neighbourhood.

import { buildIndex } from './index'
import type {
  Attribute,
  EntityId,
  Layer,
  LineageModel,
  ModelObject,
  PropertyBag,
} from './types'

export interface ClipNode {
  name: string
  /** Id in the model it was copied from — the key transitions are keyed by. */
  sourceId: EntityId
  properties: PropertyBag
  children: ClipNode[]
}

export interface Clipboard {
  nodes: ClipNode[]
  /** Both endpoints inside the copied set. */
  internal: { source: EntityId; target: EntityId }[]
  /** Source outside, target inside. */
  inbound: { from: EntityId; to: EntityId }[]
  /** Source inside, target outside. */
  outbound: { from: EntityId; to: EntityId }[]
}

export type PasteTarget =
  | { mode: 'canvas' }
  | { mode: 'into'; id: EntityId }
  | { mode: 'before'; id: EntityId }
  | { mode: 'after'; id: EntityId }

let counter = 0
const newId = (prefix: string) => `${prefix}-${Date.now().toString(36)}-${(counter += 1)}`

/** Finds an entity of any kind, plus enough context to rebuild around it. */
function locate(model: LineageModel, id: EntityId) {
  for (let li = 0; li < model.layers.length; li += 1) {
    const layer = model.layers[li]
    if (layer.id === id) return { kind: 'layer' as const, layer, layerIndex: li }
    for (let oi = 0; oi < layer.objects.length; oi += 1) {
      const object = layer.objects[oi]
      if (object.id === id) {
        return { kind: 'object' as const, layer, layerIndex: li, object, objectIndex: oi }
      }
      const found = locateAttribute(object.children, id)
      if (found) {
        return { kind: 'attribute' as const, layer, layerIndex: li, object, objectIndex: oi, ...found }
      }
    }
  }
  return null
}

function locateAttribute(
  attrs: Attribute[],
  id: EntityId,
  parent: Attribute | null = null,
): { attribute: Attribute; siblings: Attribute[]; index: number; parentAttribute: Attribute | null } | null {
  for (let i = 0; i < attrs.length; i += 1) {
    if (attrs[i].id === id) {
      return { attribute: attrs[i], siblings: attrs, index: i, parentAttribute: parent }
    }
    const found = locateAttribute(attrs[i].children, id, attrs[i])
    if (found) return found
  }
  return null
}

function toClipNode(
  model: LineageModel,
  node: { id: EntityId; name: string },
  children: ClipNode[],
): ClipNode {
  return {
    name: node.name,
    sourceId: node.id,
    properties: { ...(model.properties[node.id] ?? {}) },
    children,
  }
}

function captureAttribute(model: LineageModel, attr: Attribute): ClipNode {
  return toClipNode(model, attr, attr.children.map((c) => captureAttribute(model, c)))
}

/**
 * Snapshots the given entities. Ids that are descendants of another selected id
 * are dropped — copying a group and one of its children should not paste that
 * child twice.
 */
export function copyEntities(model: LineageModel, ids: Iterable<EntityId>): Clipboard | null {
  const index = buildIndex(model)
  const selected = new Set(ids)
  if (selected.size === 0) return null

  const roots = [...selected].filter((id) => {
    let cursor = index.entries.get(id)?.parentId ?? null
    while (cursor) {
      if (selected.has(cursor)) return false
      cursor = index.entries.get(cursor)?.parentId ?? null
    }
    return true
  })
  if (roots.length === 0) return null

  const nodes: ClipNode[] = []
  const covered = new Set<EntityId>()

  const cover = (id: EntityId) => {
    covered.add(id)
    for (const entry of index.entries.values()) {
      if (entry.parentId === id) cover(entry.id)
    }
  }

  // Preserve document order so a multi-select pastes in the order it appears.
  const ordered = [...index.entries.keys()].filter((id) => roots.includes(id))
  for (const id of ordered) {
    const found = locate(model, id)
    if (!found) continue
    cover(id)
    if (found.kind === 'layer') {
      nodes.push(
        toClipNode(
          model,
          found.layer,
          found.layer.objects.map((o) =>
            toClipNode(model, o, o.children.map((c) => captureAttribute(model, c))),
          ),
        ),
      )
    } else if (found.kind === 'object') {
      nodes.push(
        toClipNode(
          model,
          found.object,
          found.object.children.map((c) => captureAttribute(model, c)),
        ),
      )
    } else {
      nodes.push(captureAttribute(model, found.attribute))
    }
  }

  const internal: Clipboard['internal'] = []
  const inbound: Clipboard['inbound'] = []
  const outbound: Clipboard['outbound'] = []
  for (const t of model.transitions) {
    const fromInside = covered.has(t.source)
    const toInside = covered.has(t.target)
    if (fromInside && toInside) internal.push({ source: t.source, target: t.target })
    else if (toInside) inbound.push({ from: t.source, to: t.target })
    else if (fromInside) outbound.push({ from: t.source, to: t.target })
  }

  return { nodes, internal, inbound, outbound }
}

type Kind = 'layer' | 'object' | 'attribute'

interface Materialised {
  layers: Layer[]
  objects: ModelObject[]
  attributes: Attribute[]
  /** sourceId -> new id, for remapping transitions. */
  idMap: Map<EntityId, EntityId>
  properties: Record<EntityId, PropertyBag>
}

function materialise(nodes: ClipNode[], kind: Kind): Materialised {
  const out: Materialised = {
    layers: [],
    objects: [],
    attributes: [],
    idMap: new Map(),
    properties: {},
  }

  const buildAttribute = (node: ClipNode): Attribute => {
    const id = newId('a')
    out.idMap.set(node.sourceId, id)
    if (Object.keys(node.properties).length) out.properties[id] = { ...node.properties }
    return { id, name: node.name, children: node.children.map(buildAttribute) }
  }

  const buildObject = (node: ClipNode): ModelObject => {
    const id = newId('o')
    out.idMap.set(node.sourceId, id)
    if (Object.keys(node.properties).length) out.properties[id] = { ...node.properties }
    return { id, name: node.name, children: node.children.map(buildAttribute) }
  }

  const buildLayer = (node: ClipNode): Layer => {
    const id = newId('l')
    out.idMap.set(node.sourceId, id)
    if (Object.keys(node.properties).length) out.properties[id] = { ...node.properties }
    return { id, name: node.name, objects: node.children.map(buildObject) }
  }

  for (const node of nodes) {
    if (kind === 'layer') out.layers.push(buildLayer(node))
    else if (kind === 'object') out.objects.push(buildObject(node))
    else out.attributes.push(buildAttribute(node))
  }
  return out
}

/** Rebuilds the model with `mutate` applied to the located position. */
export function paste(
  model: LineageModel,
  clip: Clipboard,
  target: PasteTarget,
): LineageModel {
  // Decide what the pasted roots become from where they are going.
  let kind: Kind
  let insert: (m: LineageModel, made: Materialised) => LineageModel

  if (target.mode === 'canvas') {
    kind = 'layer'
    insert = (m, made) => ({ ...m, layers: [...m.layers, ...made.layers] })
  } else {
    const found = locate(model, target.id)
    if (!found) return model

    if (target.mode === 'into') {
      if (found.kind === 'layer') {
        kind = 'object'
        insert = (m, made) => ({
          ...m,
          layers: m.layers.map((l) =>
            l.id === target.id ? { ...l, objects: [...l.objects, ...made.objects] } : l,
          ),
        })
      } else {
        kind = 'attribute'
        insert = (m, made) => ({
          ...m,
          layers: m.layers.map((l) => ({
            ...l,
            objects: l.objects.map((o) =>
              o.id === target.id
                ? { ...o, children: [...o.children, ...made.attributes] }
                : { ...o, children: appendUnder(o.children, target.id, made.attributes) },
            ),
          })),
        })
      }
    } else {
      const offset = target.mode === 'after' ? 1 : 0
      if (found.kind === 'layer') {
        kind = 'layer'
        insert = (m, made) => {
          const at = m.layers.findIndex((l) => l.id === target.id)
          const layers = [...m.layers]
          layers.splice(at + offset, 0, ...made.layers)
          return { ...m, layers }
        }
      } else if (found.kind === 'object') {
        kind = 'object'
        insert = (m, made) => ({
          ...m,
          layers: m.layers.map((l) => {
            const at = l.objects.findIndex((o) => o.id === target.id)
            if (at < 0) return l
            const objects = [...l.objects]
            objects.splice(at + offset, 0, ...made.objects)
            return { ...l, objects }
          }),
        })
      } else {
        kind = 'attribute'
        insert = (m, made) => ({
          ...m,
          layers: m.layers.map((l) => ({
            ...l,
            objects: l.objects.map((o) => ({
              ...o,
              children: insertBeside(o.children, target.id, made.attributes, offset),
            })),
          })),
        })
      }
    }
  }

  const made = materialise(clip.nodes, kind)
  let next = insert(model, made)

  // Transitions. Internal edges are duplicated between the clones; boundary
  // edges re-attach to the outside entity, but only if it still exists.
  //
  // ONLY FOR LAYERS. An object or an attribute arrives with no transitions at
  // all, because pasting one duplicates a STRUCTURE, not a fact: the new
  // entity has not been derived from anything, nobody has run a notebook that
  // produces it, and no sandbox has verified it. Cloning its edges would mint
  // lineage claims by copy-paste, and the clones would be indistinguishable on
  // the canvas from edges the parser or the sandbox derived. Dropping them
  // says the honest thing — this copy is not wired yet — and leaves the
  // mapping to the person who knows where it should go.
  //
  // Properties still copy either way: a data type or a tag describes the
  // entity itself and stays true of a duplicate, while an edge describes a
  // relationship that does not yet exist.
  //
  // This holds for cut-and-paste too, which is copy + delete + paste: moving
  // an object into another layer re-parents it, and the edges it had in the
  // layer it came from are not claims about the one it landed in.
  //
  // A LAYER still carries its edges, and the difference is deliberate. Pasting
  // a layer is "another copy of this whole subgraph", where the internal edges
  // are part of the shape being duplicated rather than assertions about a new
  // entity's provenance. Pasting an object into a layer is "put this here",
  // and its old neighbourhood does not come with it.
  const alive = buildIndex(next).entries
  const transitions = [...next.transitions]
  const add = (source: EntityId, target_: EntityId) => {
    if (source === target_) return
    if (transitions.some((t) => t.source === source && t.target === target_)) return
    transitions.push({ id: newId('t'), source, target: target_ })
  }

  if (kind === 'layer') {
    for (const edge of clip.internal) {
      const from = made.idMap.get(edge.source)
      const to = made.idMap.get(edge.target)
      if (from && to) add(from, to)
    }
    for (const edge of clip.inbound) {
      const to = made.idMap.get(edge.to)
      if (to && alive.has(edge.from)) add(edge.from, to)
    }
    for (const edge of clip.outbound) {
      const from = made.idMap.get(edge.from)
      if (from && alive.has(edge.to)) add(from, edge.to)
    }
  }

  next = {
    ...next,
    transitions,
    properties: { ...next.properties, ...made.properties },
    updatedAt: Date.now(),
  }
  return next
}

function appendUnder(attrs: Attribute[], parentId: EntityId, added: Attribute[]): Attribute[] {
  return attrs.map((a) =>
    a.id === parentId
      ? { ...a, children: [...a.children, ...added] }
      : { ...a, children: appendUnder(a.children, parentId, added) },
  )
}

function insertBeside(
  attrs: Attribute[],
  siblingId: EntityId,
  added: Attribute[],
  offset: number,
): Attribute[] {
  const at = attrs.findIndex((a) => a.id === siblingId)
  if (at >= 0) {
    const next = [...attrs]
    next.splice(at + offset, 0, ...added)
    return next.map((a) => ({ ...a, children: a.children }))
  }
  return attrs.map((a) => ({
    ...a,
    children: insertBeside(a.children, siblingId, added, offset),
  }))
}
