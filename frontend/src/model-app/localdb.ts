// Client-side model storage in the browser (localStorage). One key per model.
// Replaces the previous FastAPI backend so the app runs as a static site.
import type { Model, ModelSummary, Comment, CatalogModelData } from "./types";
import { countByType } from "./types";

const PREFIX = "lineage:model:";
const COMMENTS_PREFIX = "lineage:comments:";

const newId = () =>
  (crypto.randomUUID?.() ?? Math.random().toString(36).slice(2)).replace(/-/g, "");

const now = () => new Date().toISOString();

function read(id: string): Model | null {
  const raw = localStorage.getItem(PREFIX + id);
  if (!raw) return null;
  try {
    return JSON.parse(raw) as Model;
  } catch {
    return null;
  }
}

function write(model: Model): void {
  localStorage.setItem(PREFIX + model.id, JSON.stringify(model));
}

export function listModels(): ModelSummary[] {
  const out: ModelSummary[] = [];
  for (let i = 0; i < localStorage.length; i++) {
    const k = localStorage.key(i);
    if (!k || !k.startsWith(PREFIX)) continue;
    const m = read(k.slice(PREFIX.length));
    if (!m) continue;
    out.push({
      id: m.id,
      name: m.name,
      createdAt: m.createdAt,
      updatedAt: m.updatedAt,
      nodeCount: m.nodes.length,
      edgeCount: m.edges.length,
      description: m.description ?? "",
      labels: m.labels ?? [],
      typeCounts: countByType(m.nodes),
    });
  }
  out.sort((a, b) => (a.updatedAt < b.updatedAt ? 1 : -1));
  return out;
}

export function getModel(id: string): Model | null {
  return read(id);
}

// Every locally-stored model reduced to (id, name, nodes) for catalog search.
export function catalogModels(): CatalogModelData[] {
  const out: CatalogModelData[] = [];
  for (let i = 0; i < localStorage.length; i++) {
    const k = localStorage.key(i);
    if (!k || !k.startsWith(PREFIX)) continue;
    const m = read(k.slice(PREFIX.length));
    if (m) out.push({ id: m.id, name: m.name, nodes: m.nodes });
  }
  return out;
}

export function createModel(name: string): Model {
  const model: Model = {
    id: newId(),
    name,
    createdAt: now(),
    updatedAt: now(),
    nodes: [],
    edges: [],
  };
  write(model);
  return model;
}

// Persist a pre-built model (e.g. the sample), assigning ids/timestamps.
export function saveNew(partial: Pick<Model, "name" | "nodes" | "edges" | "tags">): Model {
  const model: Model = {
    id: newId(),
    name: partial.name,
    createdAt: now(),
    updatedAt: now(),
    nodes: partial.nodes,
    edges: partial.edges,
    tags: partial.tags ?? [],
  };
  write(model);
  return model;
}

export function updateModel(
  id: string,
  patch: Partial<Pick<Model, "name" | "nodes" | "edges" | "tags" | "labels" | "description">>
): Model {
  const model = read(id);
  if (!model) throw new Error("404: Model not found");
  if (patch.name !== undefined) model.name = patch.name;
  if (patch.nodes !== undefined) model.nodes = patch.nodes;
  if (patch.edges !== undefined) model.edges = patch.edges;
  if (patch.tags !== undefined) model.tags = patch.tags;
  if (patch.labels !== undefined) model.labels = patch.labels;
  if (patch.description !== undefined) model.description = patch.description;
  model.updatedAt = now();
  write(model);
  return model;
}

export function deleteModel(id: string): void {
  localStorage.removeItem(PREFIX + id);
  localStorage.removeItem(COMMENTS_PREFIX + id);
}

// ── Comments (browser-local, signed-out mode) ──────────────────────────────
export function listComments(modelId: string): Comment[] {
  const raw = localStorage.getItem(COMMENTS_PREFIX + modelId);
  if (!raw) return [];
  try {
    return JSON.parse(raw) as Comment[];
  } catch {
    return [];
  }
}

export function addComment(modelId: string, body: string): Comment {
  const list = listComments(modelId);
  const comment: Comment = {
    id: newId(),
    model_id: modelId,
    author_email: "you (local)",
    body,
    created_at: now(),
  };
  list.push(comment);
  localStorage.setItem(COMMENTS_PREFIX + modelId, JSON.stringify(list));
  return comment;
}
