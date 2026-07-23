// Modeling-mode domain types (Solidatus-like authored model, NOT derived
// lineage). This is a user-authored structure — distinct from the read-only
// `LineageGraph`/`AppModel` the other modes visualise.
//
// Shape: a ModelDoc has ordered Layers. Each Layer holds a tree of Nodes.
// A Node is either an Object (a leaf that owns Attributes) or a Group (a
// container that nests further Objects and Groups). Groups may nest to any
// depth; only Objects carry Attributes.

export interface Attribute {
  id: string
  name: string
  /** Optional free-text data type (e.g. "string", "decimal(18,2)"). */
  dataType?: string
}

export interface ModelObject {
  id: string
  kind: 'object'
  name: string
  attributes: Attribute[]
}

export interface Group {
  id: string
  kind: 'group'
  name: string
  collapsed?: boolean
  children: ModelNode[]
}

export type ModelNode = ModelObject | Group

export interface Layer {
  id: string
  name: string
  nodes: ModelNode[]
}

export interface ModelDoc {
  layers: Layer[]
}

export const emptyDoc = (): ModelDoc => ({ layers: [] })
