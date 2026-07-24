// Client-side data layer. Dispatches to Supabase when the user is signed in,
// otherwise to localStorage — so signed-out / unconfigured use keeps working
// exactly as the original static site.
import type { Model, ModelRole } from "./types";
import * as db from "./localdb";
import * as cloud from "./cloudApi";
import { isSignedIn } from "./supabase";
import { buildSampleModel } from "./sample";
import { downloadModelXlsx } from "./exportXlsx";

function localOpen(id: string): { model: Model; role: ModelRole } {
  const model = db.getModel(id);
  if (!model) throw new Error("404: Model not found");
  return { model, role: "local" };
}

export const api = {
  listModels: async () => (isSignedIn() ? cloud.listModels() : db.listModels()),

  createModel: async (name: string) =>
    isSignedIn() ? cloud.createModel(name) : db.createModel(name),

  createSampleModel: async () =>
    isSignedIn() ? cloud.saveNew(buildSampleModel()) : db.saveNew(buildSampleModel()),

  // Load a model plus the caller's role (drives read-only gating).
  openModel: async (id: string): Promise<{ model: Model; role: ModelRole }> =>
    isSignedIn() ? cloud.openModel(id) : localOpen(id),

  updateModel: async (
    id: string,
    patch: Partial<Pick<Model, "name" | "nodes" | "edges" | "tags" | "labels" | "description">>
  ) => (isSignedIn() ? cloud.updateModel(id, patch) : db.updateModel(id, patch)),

  deleteModel: async (id: string) =>
    isSignedIn() ? cloud.deleteModel(id) : db.deleteModel(id),

  // Persist a fully-formed model (imported from JSON or Excel).
  importModel: async (model: Model) =>
    isSignedIn() ? cloud.saveNew(model) : db.saveNew(model),

  // Upload a local model to the cloud (used by Share when signed in).
  uploadToCloud: async (model: Pick<Model, "name" | "nodes" | "edges" | "tags">) =>
    cloud.saveNew(model),

  // Generates and downloads the Solidatus-format .xlsx entirely in-browser.
  exportModel: (model: Model) => downloadModelXlsx(model),

  // ── Sharing (cloud only) ──
  listShares: cloud.listShares,
  inviteShare: cloud.inviteShare,
  updateShareRole: cloud.updateShareRole,
  removeShare: cloud.removeShare,

  // ── Comments (cloud or local) ──
  listComments: async (modelId: string) =>
    isSignedIn() ? cloud.listComments(modelId) : db.listComments(modelId),
  addComment: async (modelId: string, body: string) =>
    isSignedIn() ? cloud.addComment(modelId, body) : db.addComment(modelId, body),

  // ── Catalog (cross-model search) ──
  catalogModels: async () =>
    isSignedIn() ? cloud.catalogModels() : db.catalogModels(),

  // ── Version history (cloud only — local models have no server-side
  // snapshot trigger, so there's nothing to list/restore) ──
  listVersions: async (modelId: string) =>
    isSignedIn() ? cloud.listVersions(modelId) : [],
  getVersion: async (versionId: string) => {
    if (!isSignedIn()) throw new Error("Version history is not available in local mode.");
    return cloud.getVersion(versionId);
  },
  restoreVersion: async (modelId: string, versionId: string) => {
    if (!isSignedIn()) throw new Error("Version history is not available in local mode.");
    return cloud.restoreVersion(modelId, versionId);
  },
};
