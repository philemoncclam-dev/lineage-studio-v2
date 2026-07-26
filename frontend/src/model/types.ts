// The authored lineage model — a directed property graph over a hierarchy.
//
// Shape rules that the rest of the editor depends on:
//
//  - The hierarchy is Layer > Object > Attribute, and an Attribute nests other
//    Attributes without limit. There is no distinct `Group` type at runtime: a
//    "Group" is simply an Attribute with children. (Interchange formats name
//    Group as its own type; that's an import/export concern, not a shape one.)
//  - A Transition connects ANY two entities, not just attribute-to-attribute —
//    object-to-object and layer-to-layer transitions are legal and common.
//    Endpoints are therefore plain EntityIds, never typed to a subtype.
//  - Properties live in a side table keyed by entity id rather than on the
//    entities themselves. Two reasons: property values outlive the entity they
//    were assigned to (deleting an entity must not silently drop its values),
//    and a flat table is what the property manager and display rules read.
//
// Deliberately NOT modelled yet (scoped out with the user):
//  - transaction time. Versions are a linear snapshot history, not bi-temporal.
//  - reference models and reference relationships. Lineage models only.

export type EntityId = string

export type EntityKind = 'layer' | 'object' | 'attribute'

/** An Attribute; `children.length > 0` makes it a Group. */
export interface Attribute {
  id: EntityId
  name: string
  children: Attribute[]
}

export interface ModelObject {
  id: EntityId
  name: string
  children: Attribute[]
}

export interface Layer {
  id: EntityId
  name: string
  objects: ModelObject[]
}

export interface Transition {
  id: EntityId
  /** Any entity id — layer, object, or attribute. */
  source: EntityId
  /** Any entity id — layer, object, or attribute. */
  target: EntityId
}

/** Property values for one entity: property name -> value. */
export type PropertyBag = Record<string, string>

export interface LineageModel {
  id: string
  name: string
  /** Epoch ms. */
  createdAt: number
  /** Epoch ms. */
  updatedAt: number
  /** Array order is column order, left to right. */
  layers: Layer[]
  transitions: Transition[]
  /** Keyed by entity id. Entries may outlive their entity — see the note above. */
  properties: Record<EntityId, PropertyBag>
}

/** Summary row for the model list, so the browser needn't parse every model. */
export interface ModelSummary {
  id: string
  name: string
  createdAt: number
  updatedAt: number
  layerCount: number
  entityCount: number
  transitionCount: number
}
