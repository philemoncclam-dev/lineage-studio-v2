// Modeling-mode domain types — a user-AUTHORED Solidatus-style model, distinct
// from the read-only derived `LineageGraph` the other modes visualise.
//
// Ported (high-level shape) from the lineage-studio repo: a flat node table
// with parent pointers instead of a nested tree. Hierarchy is
// Layer > Object > Group (table) > Attribute (column); Objects are optional —
// a Group may sit directly under a Layer. Attribute-level lineage is a flat
// edge list between Attribute node ids.

export type NodeType = 'Layer' | 'Object' | 'Group' | 'Attribute'

export interface ModelNode {
  id: string
  type: NodeType
  name: string
  parentId: string | null
  /** Free-form extras, e.g. { dataType: "decimal(18,2)" } on Attributes. */
  properties: Record<string, unknown>
  /** Per-attribute derivation description — Solidatus's transformation_logic. */
  transformation_logic: string
}

/** How an edge transforms data; rendered as distinct stroke styles. */
export type EdgeKind = 'copy' | 'derive' | 'aggregate' | 'filter'

export const EDGE_KINDS: EdgeKind[] = ['copy', 'derive', 'aggregate', 'filter']

export interface ModelEdge {
  id: string
  sourceNodeId: string
  targetNodeId: string
  kind?: EdgeKind
  note?: string
}

export interface Model {
  id: string
  name: string
  description?: string
  createdAt: string
  updatedAt: string
  nodes: ModelNode[]
  edges: ModelEdge[]
}

export interface ModelSummary {
  id: string
  name: string
  description?: string
  createdAt: string
  updatedAt: string
  nodeCount: number
  edgeCount: number
  typeCounts: Partial<Record<NodeType, number>>
}

export const uid = (): string =>
  typeof crypto !== 'undefined' && 'randomUUID' in crypto
    ? crypto.randomUUID()
    : `id-${Math.random().toString(36).slice(2)}-${Date.now().toString(36)}`

export function countByType(nodes: ModelNode[]): Partial<Record<NodeType, number>> {
  const out: Partial<Record<NodeType, number>> = {}
  for (const n of nodes) out[n.type] = (out[n.type] ?? 0) + 1
  return out
}

export function newModel(name: string): Model {
  const now = new Date().toISOString()
  return { id: uid(), name, createdAt: now, updatedAt: now, nodes: [], edges: [] }
}
