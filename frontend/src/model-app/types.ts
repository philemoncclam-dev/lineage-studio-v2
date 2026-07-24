export type NodeType = "Layer" | "Group" | "Object" | "Attribute";

export interface LineageNode {
  id: string;
  type: NodeType;
  name: string;
  parentId: string | null;
  properties: Record<string, unknown>;
  transformation_logic: string;
  x: number;
  y: number;
  // Set when a node originated from an external connector sync (e.g. dbt); used
  // for exact cross-model matching in the catalog and to reconcile re-syncs.
  // Absent for hand-built nodes.
  externalId?: string;
  externalSource?: string; // connector id, e.g. "dbt"
  connectionId?: string; // disambiguates multiple synced sources of one type
}

// How an edge transforms data — annotated by the user (or "copy" by default
// visually). Rendered as distinct line styles on the canvas.
export type EdgeKind = "copy" | "aggregate" | "derive" | "filter";

export interface LineageEdge {
  id: string;
  sourceNodeId: string;
  targetNodeId: string;
  kind?: EdgeKind;
  note?: string;
  // True when the edge came from a connector sync (e.g. dbt) rather than being
  // drawn by hand — "verified" provenance shown in the edge inspector.
  verified?: boolean;
}

// A reusable tag definition. Attributes reference tags by `name` (stored in
// their properties.tags array); this registry holds the color so the same tag
// reads consistently everywhere.
export interface TagDef {
  name: string;
  color: string;
}

export interface Model {
  id: string;
  name: string;
  createdAt: string;
  updatedAt: string;
  nodes: LineageNode[];
  edges: LineageEdge[];
  tags?: TagDef[];
  // Free-text "about this model" blurb shown on the Model Overview page.
  description?: string;
  // Model-level tags/labels for categorizing whole models (e.g. "finance",
  // "production"). Distinct from `tags` above, which is the attribute-tag
  // registry. Stored in the data jsonb, so no schema change is needed.
  labels?: string[];
}

// A comment posted on a model (Model Overview page).
export interface Comment {
  id: string;
  model_id: string;
  author_email: string;
  body: string;
  created_at: string;
}

// "owner" for the creator, "editor"/"viewer" for invited collaborators, and
// "local" for browser-only models (signed-out / not uploaded).
export type ModelRole = "owner" | "editor" | "viewer" | "local";

export interface ModelSummary {
  id: string;
  name: string;
  createdAt: string;
  updatedAt: string;
  nodeCount: number;
  edgeCount: number;
  role?: ModelRole;
  // "About this model" blurb, surfaced on the home cards. Cheap to include:
  // both listModels paths already load the full row.
  description?: string;
  // How many nodes of each type, for the home card's type-breakdown dots.
  typeCounts?: Partial<Record<NodeType, number>>;
  // Model-level tags, shown as chips on the home cards.
  labels?: string[];
}

// Tally nodes by their type. Shared by the local and cloud listModels paths,
// which both already have the full node array in hand.
export function countByType(nodes: LineageNode[]): Partial<Record<NodeType, number>> {
  const out: Partial<Record<NodeType, number>> = {};
  for (const n of nodes) out[n.type] = (out[n.type] ?? 0) + 1;
  return out;
}

export interface ShareEntry {
  id: string;
  invited_email: string;
  role: "viewer" | "editor";
}

// A retained pre-edit snapshot of a model (see supabase/schema.sql's
// snapshot_model_version trigger). Summary form for the version list.
export interface ModelVersionSummary {
  id: string;
  modelId: string;
  name: string;
  createdAt: string;
  createdBy?: string; // email of whoever saved this version
  nodeCount: number;
  edgeCount: number;
}

// Full snapshot, fetched on demand for preview/restore.
export interface ModelVersion extends ModelVersionSummary {
  nodes: LineageNode[];
  edges: LineageEdge[];
  tags: TagDef[];
  description?: string;
}

// A model reduced to what the cross-model catalog search needs (its nodes).
export interface CatalogModelData {
  id: string;
  name: string;
  nodes: LineageNode[];
}

// A single node found in the catalog, with the model it belongs to.
export interface CatalogMatch {
  modelId: string;
  modelName: string;
  node: LineageNode;
}
