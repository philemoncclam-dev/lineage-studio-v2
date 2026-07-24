// Supabase-backed persistence + sharing. Mirrors localdb.ts but operates on the
// `models` (data jsonb) and `model_shares` tables. Access is enforced by RLS;
// this layer just maps rows <-> the app's Model type and resolves roles.
import { supabase } from "./supabase";
import type {
  Model,
  ModelSummary,
  ModelRole,
  ShareEntry,
  Comment,
  ModelVersionSummary,
  ModelVersion,
  CatalogModelData,
} from "./types";
import { countByType } from "./types";
import {
  rowToPreset,
  stripSecretFields,
  validatePresetInput,
  type ConnectionPreset,
  type ConnectionPresetRow,
  type PresetConfig,
} from "./connectors/presets";

interface Row {
  id: string;
  owner: string;
  name: string;
  data: {
    nodes: Model["nodes"];
    edges: Model["edges"];
    tags?: Model["tags"];
    labels?: string[];
  } | null;
  description: string | null;
  created_at: string;
  updated_at: string;
}

const COLS = "id,owner,name,data,description,created_at,updated_at";

function sb() {
  if (!supabase) throw new Error("Cloud is not configured.");
  return supabase;
}

const toModel = (r: Row): Model => ({
  id: r.id,
  name: r.name,
  createdAt: r.created_at,
  updatedAt: r.updated_at,
  nodes: r.data?.nodes ?? [],
  edges: r.data?.edges ?? [],
  tags: r.data?.tags ?? [],
  labels: r.data?.labels ?? [],
  description: r.description ?? "",
});

async function uid(): Promise<string> {
  const { data } = await sb().auth.getUser();
  if (!data.user) throw new Error("Not signed in.");
  return data.user.id;
}

export async function listModels(): Promise<ModelSummary[]> {
  const me = await uid();
  const { data: rows, error } = await sb()
    .from("models")
    .select(COLS)
    .order("updated_at", { ascending: false });
  if (error) throw error;
  // The user's invitee rows resolve their role on models they don't own.
  const { data: shares } = await sb().from("model_shares").select("model_id,role");
  const roleByModel = new Map((shares ?? []).map((s) => [s.model_id, s.role]));
  return (rows ?? []).map((r: Row) => ({
    id: r.id,
    name: r.name,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
    nodeCount: r.data?.nodes?.length ?? 0,
    edgeCount: r.data?.edges?.length ?? 0,
    description: r.description ?? "",
    labels: r.data?.labels ?? [],
    typeCounts: countByType(r.data?.nodes ?? []),
    role: (r.owner === me ? "owner" : roleByModel.get(r.id) ?? "viewer") as ModelRole,
  }));
}

// Every accessible model reduced to (id, name, nodes) for the cross-model
// catalog. Reuses the same COLS select as listModels — the node data is
// already fetched there and discarded, so this adds no extra round-trip cost
// beyond a second query.
export async function catalogModels(): Promise<CatalogModelData[]> {
  const { data, error } = await sb()
    .from("models")
    .select(COLS)
    .order("updated_at", { ascending: false });
  if (error) throw error;
  return (data ?? []).map((r: Row) => ({
    id: r.id,
    name: r.name,
    nodes: r.data?.nodes ?? [],
  }));
}

// Load a model together with the caller's role (drives read-only gating).
export async function openModel(id: string): Promise<{ model: Model; role: ModelRole }> {
  const me = await uid();
  const { data, error } = await sb()
    .from("models")
    .select(COLS)
    .eq("id", id)
    .maybeSingle();
  if (error) throw error;
  if (!data) throw new Error("403: You don't have access to this model.");
  let role: ModelRole = "viewer";
  if (data.owner === me) role = "owner";
  else {
    const { data: s } = await sb()
      .from("model_shares")
      .select("role")
      .eq("model_id", id)
      .maybeSingle();
    role = (s?.role as ModelRole) ?? "viewer";
  }
  return { model: toModel(data as Row), role };
}

export async function createModel(name: string): Promise<Model> {
  const owner = await uid();
  const { data, error } = await sb()
    .from("models")
    .insert({ owner, name, data: { nodes: [], edges: [] } })
    .select()
    .single();
  if (error) throw error;
  return toModel(data as Row);
}

// Persist a fully-formed model (sample / import / upload-to-cloud).
export async function saveNew(
  partial: Pick<Model, "name" | "nodes" | "edges" | "tags">
): Promise<Model> {
  const owner = await uid();
  const { data, error } = await sb()
    .from("models")
    .insert({
      owner,
      name: partial.name,
      data: { nodes: partial.nodes, edges: partial.edges, tags: partial.tags ?? [] },
    })
    .select()
    .single();
  if (error) throw error;
  return toModel(data as Row);
}

export async function updateModel(
  id: string,
  patch: Partial<Pick<Model, "name" | "nodes" | "edges" | "tags" | "labels" | "description">>
): Promise<Model> {
  const upd: Record<string, unknown> = { updated_at: new Date().toISOString() };
  if (patch.name !== undefined) upd.name = patch.name;
  if (patch.description !== undefined) upd.description = patch.description;
  if (
    patch.nodes !== undefined ||
    patch.edges !== undefined ||
    patch.tags !== undefined ||
    patch.labels !== undefined
  ) {
    // Merge into the existing data jsonb if only some parts were provided.
    let nodes = patch.nodes;
    let edges = patch.edges;
    let tags = patch.tags;
    let labels = patch.labels;
    if (
      nodes === undefined ||
      edges === undefined ||
      tags === undefined ||
      labels === undefined
    ) {
      const { data: cur } = await sb().from("models").select("data").eq("id", id).single();
      nodes = nodes ?? cur?.data?.nodes ?? [];
      edges = edges ?? cur?.data?.edges ?? [];
      tags = tags ?? cur?.data?.tags ?? [];
      labels = labels ?? cur?.data?.labels ?? [];
    }
    upd.data = { nodes, edges, tags, labels };
  }
  const { data, error } = await sb().from("models").update(upd).eq("id", id).select().single();
  if (error) throw error;
  return toModel(data as Row);
}

export async function deleteModel(id: string): Promise<void> {
  const { error } = await sb().from("models").delete().eq("id", id);
  if (error) throw error;
}

// ── Sharing ──────────────────────────────────────────────────────────────
export async function listShares(modelId: string): Promise<ShareEntry[]> {
  const { data, error } = await sb()
    .from("model_shares")
    .select("id,invited_email,role")
    .eq("model_id", modelId)
    .order("created_at");
  if (error) throw error;
  return (data ?? []) as ShareEntry[];
}

export async function inviteShare(
  modelId: string,
  email: string,
  role: "viewer" | "editor"
): Promise<void> {
  const { error } = await sb()
    .from("model_shares")
    .upsert(
      { model_id: modelId, invited_email: email.trim().toLowerCase(), role },
      { onConflict: "model_id,invited_email" }
    );
  if (error) throw error;
}

export async function updateShareRole(
  shareId: string,
  role: "viewer" | "editor"
): Promise<void> {
  const { error } = await sb().from("model_shares").update({ role }).eq("id", shareId);
  if (error) throw error;
}

export async function removeShare(shareId: string): Promise<void> {
  const { error } = await sb().from("model_shares").delete().eq("id", shareId);
  if (error) throw error;
}

// ── Comments ─────────────────────────────────────────────────────────────
export async function listComments(modelId: string): Promise<Comment[]> {
  const { data, error } = await sb()
    .from("model_comments")
    .select("id,model_id,author_email,body,created_at")
    .eq("model_id", modelId)
    .order("created_at");
  if (error) throw error;
  return (data ?? []) as Comment[];
}

export async function addComment(modelId: string, body: string): Promise<Comment> {
  const { data: u } = await sb().auth.getUser();
  const author_email = u.user?.email ?? "";
  const { data, error } = await sb()
    .from("model_comments")
    .insert({ model_id: modelId, author_email, body })
    .select("id,model_id,author_email,body,created_at")
    .single();
  if (error) throw error;
  return data as Comment;
}

// ── Version history ─────────────────────────────────────────────────────────
interface VersionRow {
  id: string;
  model_id: string;
  data: { nodes: Model["nodes"]; edges: Model["edges"]; tags?: Model["tags"] } | null;
  name: string;
  description: string | null;
  created_at: string;
  created_by_email: string | null;
}

const VERSION_COLS = "id,model_id,data,name,description,created_at,created_by_email";

const toVersionSummary = (r: VersionRow): ModelVersionSummary => ({
  id: r.id,
  modelId: r.model_id,
  name: r.name,
  createdAt: r.created_at,
  createdBy: r.created_by_email ?? undefined,
  nodeCount: r.data?.nodes?.length ?? 0,
  edgeCount: r.data?.edges?.length ?? 0,
});

export async function listVersions(modelId: string): Promise<ModelVersionSummary[]> {
  const { data, error } = await sb()
    .from("model_versions")
    .select(VERSION_COLS)
    .eq("model_id", modelId)
    .order("created_at", { ascending: false });
  if (error) throw error;
  return (data ?? []).map((r) => toVersionSummary(r as VersionRow));
}

export async function getVersion(versionId: string): Promise<ModelVersion> {
  const { data, error } = await sb()
    .from("model_versions")
    .select(VERSION_COLS)
    .eq("id", versionId)
    .single();
  if (error) throw error;
  const r = data as VersionRow;
  return {
    ...toVersionSummary(r),
    nodes: r.data?.nodes ?? [],
    edges: r.data?.edges ?? [],
    tags: r.data?.tags ?? [],
    description: r.description ?? "",
  };
}

// Roll a model back to a past version's content. Restoring is itself an
// ordinary update, so the pre-restore state gets snapshotted too (via the
// models_before_update_snapshot trigger) — nothing about restore is
// destructive.
export async function restoreVersion(modelId: string, versionId: string): Promise<Model> {
  const version = await getVersion(versionId);
  return updateModel(modelId, {
    name: version.name,
    nodes: version.nodes,
    edges: version.edges,
    tags: version.tags,
    description: version.description,
  });
}

// ── Connection presets ───────────────────────────────────────────────────────
// Saved connector configuration per account (see connectors/presets.ts for the
// secret-stripping and validation logic, which is kept pure/connector-agnostic
// and unit-tested separately from this Supabase-backed layer).
const PRESET_COLS = "id,owner,connector_type,name,config,created_at";

export async function listPresets(connectorType?: string): Promise<ConnectionPreset[]> {
  let query = sb().from("connection_presets").select(PRESET_COLS).order("created_at", { ascending: false });
  if (connectorType) query = query.eq("connector_type", connectorType);
  const { data, error } = await query;
  if (error) throw error;
  return (data ?? []).map((r) => rowToPreset(r as ConnectionPresetRow));
}

export async function savePreset(
  connectorType: string,
  name: string,
  config: PresetConfig
): Promise<ConnectionPreset> {
  const safeConfig = stripSecretFields(config);
  const validationError = validatePresetInput(connectorType, name, safeConfig);
  if (validationError) throw new Error(validationError);
  const owner = await uid();
  const { data, error } = await sb()
    .from("connection_presets")
    .insert({ owner, connector_type: connectorType, name: name.trim(), config: safeConfig })
    .select(PRESET_COLS)
    .single();
  if (error) throw error;
  return rowToPreset(data as ConnectionPresetRow);
}

export async function deletePreset(id: string): Promise<void> {
  const { error } = await sb().from("connection_presets").delete().eq("id", id);
  if (error) throw error;
}

// ── Drift notification config (Slack / Teams webhook) ───────────────────────
// One row per model, owner-scoped (see Claude App/supabase/schema.sql:
// model_notifications). The webhook URL is a secret-ish value — it is stored
// as-is (no field to strip it into, unlike connection_presets' tokens) and
// protected only by RLS; see the schema comment for the full caveat.
interface NotificationRow {
  id: string;
  model_id: string;
  owner: string;
  provider: "slack" | "teams";
  webhook_url: string;
  enabled: boolean;
  created_at: string;
  updated_at: string;
}

const NOTIF_COLS = "id,model_id,owner,provider,webhook_url,enabled,created_at,updated_at";

export interface ModelNotificationConfig {
  id: string;
  modelId: string;
  provider: "slack" | "teams";
  webhookUrl: string;
  enabled: boolean;
}

const rowToNotificationConfig = (r: NotificationRow): ModelNotificationConfig => ({
  id: r.id,
  modelId: r.model_id,
  provider: r.provider,
  webhookUrl: r.webhook_url,
  enabled: r.enabled,
});

// Returns null if no config has been saved for this model yet.
export async function getNotificationConfig(
  modelId: string
): Promise<ModelNotificationConfig | null> {
  const { data, error } = await sb()
    .from("model_notifications")
    .select(NOTIF_COLS)
    .eq("model_id", modelId)
    .maybeSingle();
  if (error) throw error;
  return data ? rowToNotificationConfig(data as NotificationRow) : null;
}

export async function setNotificationConfig(
  modelId: string,
  config: { provider: "slack" | "teams"; webhookUrl: string; enabled: boolean }
): Promise<ModelNotificationConfig> {
  const url = config.webhookUrl.trim();
  if (!url) throw new Error("Webhook URL is required.");
  const owner = await uid();
  const { data, error } = await sb()
    .from("model_notifications")
    .upsert(
      {
        model_id: modelId,
        owner,
        provider: config.provider,
        webhook_url: url,
        enabled: config.enabled,
        updated_at: new Date().toISOString(),
      },
      { onConflict: "model_id" }
    )
    .select(NOTIF_COLS)
    .single();
  if (error) throw error;
  return rowToNotificationConfig(data as NotificationRow);
}
