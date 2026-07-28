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

import type { SavedView } from './views'

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
  /**
   * Named Views filters, saved with the model so they travel with it.
   *
   * Optional for the same reason the browser metadata below is: models written
   * before saved views existed do not carry the field. `model/views.ts` reads
   * it through `listViews`, which supplies the empty default.
   */
  views?: SavedView[]

  // --- Model Browser metadata ---
  //
  // All four are OPTIONAL on the document on purpose. Models persisted before
  // the browser existed don't carry them, and a required field would mean every
  // read of an old model is a type lie. `store.normalize()` fills the defaults
  // on the way out, so everything above the store may assume they are present —
  // but only ModelSummary states that in its types.

  /** Free text shown under the name in the browser. */
  description?: string
  /** Free-form labels. Lower-cased on write; compared case-insensitively. */
  tags?: string[]
  /** Personally starred — the browser's "Starred" filter reads this. */
  starred?: boolean
  /** Epoch ms of the last time the model was opened. Drives the default sort. */
  lastViewedAt?: number

  /**
   * House rules for the assistant — style, voice, formatting.
   *
   * Stored with the model rather than in the backend's environment: different
   * models want different conventions, the rules travel with an exported model,
   * and changing them is an edit (undoable, persisted) rather than a redeploy.
   * The backend places them after its cache breakpoint so editing them costs
   * nothing, and downstream of the fidelity rules so they cannot loosen them.
   */
  assistantInstructions?: string
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
  /** Normalized by the store — always present here, unlike on the document. */
  description: string
  tags: string[]
  starred: boolean
  lastViewedAt: number
}
