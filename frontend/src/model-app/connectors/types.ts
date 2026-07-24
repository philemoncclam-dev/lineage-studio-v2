// Pluggable connector interface. A connector parses some external source (a dbt
// manifest.json today; a Fabric/Purview API in future) into a flat list of
// ConnectorNodes keyed by a stable externalId. The connector-agnostic
// reconcile engine (reconcile.ts) then merges that list into a model, so adding
// a new connector never touches the merge logic.
import type { NodeType } from "../types";

export interface ConnectorNode {
  externalId: string; // stable id from the source system
  parentExternalId: string | null; // null = top level (a Layer)
  type: NodeType;
  name: string;
  transformationLogic?: string;
  // Source-owned metadata (materialization, schema, dbt description, …). Stored
  // namespaced under properties[connectorId] so it never collides with the
  // user's own tags/description.
  metadata?: Record<string, unknown>;
  // Optional description to seed the user-facing description on first creation
  // only (never overwritten on re-sync).
  seedDescription?: string;
}

// A lineage edge between two connector nodes, referenced by their externalIds.
export interface ConnectorEdge {
  sourceExternalId: string;
  targetExternalId: string;
}

export interface ConnectorParseResult {
  nodes: ConnectorNode[];
  edges: ConnectorEdge[];
}

// Credentials for a token-based API connector (Fabric today). The bearer token
// is a user-supplied Azure AD access token — this app never runs an OAuth flow
// itself, mirroring the "paste a token" UX of the dbt file-based connector.
export interface ApiTokenCredentials {
  workspaceId: string;
  token: string;
  // Optional per-connector enhancement flags. Today only the Fabric connector
  // reads this (Admin Scanner API deep scan for lakehouse/warehouse columns) —
  // other connectors ignore it. Kept generic/untyped here so the shared
  // Connector interface doesn't grow a Fabric-specific field.
  options?: Record<string, unknown>;
}

export interface Connector {
  id: string; // stored as externalSource on every node, e.g. "dbt"
  label: string; // shown in the UI
  fileHint: string; // e.g. "manifest.json" — unused when authMode is "token"
  // "file" (dbt: upload a manifest.json) or "token" (Fabric: workspace id +
  // bearer token, calling the REST API directly). The Sync UI branches on this
  // to show a file picker or a workspace/token form.
  authMode?: "file" | "token";
  parse(input: File): Promise<ConnectorParseResult>;
  // Only present when authMode === "token".
  parseFromApi?(creds: ApiTokenCredentials): Promise<ConnectorParseResult>;
}
