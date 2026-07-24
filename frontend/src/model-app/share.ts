// Link sharing — publishes a model snapshot to the public `shared_models` table
// using the anonymous Supabase key. No account/sign-in is required: anyone with
// the unguessable token in the URL can open the shared model (read-only), the
// same trust model as a Google Docs "anyone with the link" share.
import { supabase, isCloudConfigured } from "./supabase";
import type { Model } from "./types";

export const isSharingConfigured = isCloudConfigured;

export interface SharedModel {
  name: string;
  description?: string;
  nodes: Model["nodes"];
  edges: Model["edges"];
  tags: Model["tags"];
  createdAt: string;
  updatedAt: string;
  // When true, anyone with the link may edit the model (writes back to this same
  // shared_models row via updateShare). Defaults to false — a plain snapshot.
  editable: boolean;
}

// 22-char URL-safe token (~131 bits) — unguessable, like a Google Docs link id.
function newToken(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  return btoa(String.fromCharCode(...bytes))
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
}

function sb() {
  if (!supabase) throw new Error("Sharing is not configured.");
  return supabase;
}

// Supabase/PostgREST errors are plain objects (not Error instances), so
// String(e) yields "[object Object]". Pull out a readable message instead.
export function errorText(e: unknown): string {
  if (e instanceof Error) return e.message;
  if (e && typeof e === "object") {
    const o = e as Record<string, unknown>;
    const parts = [o.message, o.details, o.hint].filter(Boolean);
    if (parts.length) return parts.join(" — ");
  }
  return String(e);
}

// Publish a brand-new shared snapshot; returns the token for the share URL.
// `editable` opts the link into "anyone with the link can edit" (default false).
export async function publishShare(
  model: Pick<Model, "name" | "nodes" | "edges" | "tags" | "description">,
  opts: { editable?: boolean } = {}
): Promise<string> {
  const token = newToken();
  const { error } = await sb()
    .from("shared_models")
    .insert({
      token,
      name: model.name,
      // `editable` lives inside the `data` jsonb rather than a dedicated column
      // so the feature needs no schema migration on existing deployments.
      data: {
        nodes: model.nodes,
        edges: model.edges,
        tags: model.tags ?? [],
        description: model.description ?? "",
        editable: opts.editable ?? false,
      },
    });
  if (error) throw error;
  return token;
}

// Flip an existing share between view-only and editable without re-publishing.
// Read-modify-write on the `data` jsonb so the rest of the snapshot is untouched.
export async function setShareEditable(token: string, editable: boolean): Promise<void> {
  const { data: cur, error: readErr } = await sb()
    .from("shared_models")
    .select("data")
    .eq("token", token)
    .maybeSingle();
  if (readErr) throw readErr;
  const { error } = await sb()
    .from("shared_models")
    .update({ data: { ...(cur?.data ?? {}), editable }, updated_at: new Date().toISOString() })
    .eq("token", token);
  if (error) throw error;
}

// Re-push the latest model state to an existing share token.
export async function updateShare(
  token: string,
  model: Pick<Model, "name" | "nodes" | "edges" | "tags" | "description">
): Promise<void> {
  // Replacing `data` wholesale would drop the editable flag stored inside it, so
  // read the current flag first and carry it forward.
  const { data: cur, error: readErr } = await sb()
    .from("shared_models")
    .select("data")
    .eq("token", token)
    .maybeSingle();
  if (readErr) throw readErr;
  const { error } = await sb()
    .from("shared_models")
    .update({
      name: model.name,
      data: {
        nodes: model.nodes,
        edges: model.edges,
        tags: model.tags ?? [],
        description: model.description ?? "",
        editable: cur?.data?.editable ?? false,
      },
      updated_at: new Date().toISOString(),
    })
    .eq("token", token);
  if (error) throw error;
}

// Stop sharing — anyone with the link can no longer open it.
export async function deleteShare(token: string): Promise<void> {
  const { error } = await sb().from("shared_models").delete().eq("token", token);
  if (error) throw error;
}

// Load a shared model by token (public read). Throws if the token is unknown.
export async function fetchShare(token: string): Promise<SharedModel> {
  const { data, error } = await sb()
    .from("shared_models")
    .select("name,data,created_at,updated_at")
    .eq("token", token)
    .maybeSingle();
  if (error) throw error;
  if (!data) throw new Error("This shared link is invalid or has been removed.");
  return {
    name: data.name,
    description: data.data?.description ?? "",
    nodes: data.data?.nodes ?? [],
    edges: data.data?.edges ?? [],
    tags: data.data?.tags ?? [],
    createdAt: data.created_at,
    updatedAt: data.updated_at,
    editable: data.data?.editable ?? false,
  };
}

// ── Local bookkeeping ───────────────────────────────────────────────────────
// Remember which token a given local model was published under, so the Share
// dialog can offer "copy existing link" / "update" instead of always making a
// new one. Keyed by model id in localStorage.
const KEY = "lineage:shareTokens";

type TokenMap = Record<string, string>;

function readMap(): TokenMap {
  try {
    return JSON.parse(localStorage.getItem(KEY) || "{}");
  } catch {
    return {};
  }
}

export function getShareToken(modelId: string): string | null {
  return readMap()[modelId] ?? null;
}

export function rememberShareToken(modelId: string, token: string): void {
  const map = readMap();
  map[modelId] = token;
  localStorage.setItem(KEY, JSON.stringify(map));
}

export function forgetShareToken(modelId: string): void {
  const map = readMap();
  delete map[modelId];
  localStorage.setItem(KEY, JSON.stringify(map));
}

export function shareUrl(token: string): string {
  return `${window.location.origin}/share/${token}`;
}

export function editShareUrl(token: string): string {
  return `${window.location.origin}/share/${token}/edit`;
}
