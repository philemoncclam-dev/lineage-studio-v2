// Model persistence.
//
// The interface is async even though the only implementation today is
// localStorage (which is synchronous). That is deliberate: localStorage caps
// out around 5MB and blocks the main thread on write, so this will need to
// become IndexedDB before models get large. Making callers await now means that
// swap is a change to this file alone, not a refactor of every call site.
//
// Storage layout — one key per model plus one index key, rather than a single
// blob, so opening a model doesn't deserialize every other model:
//   lineage-studio:models          -> ModelSummary[]
//   lineage-studio:model:<id>      -> LineageModel
//   lineage-studio:versions:<id>   -> ModelVersion[]

import { countEntities } from './index'
import type { LineageModel, ModelSummary } from './types'

const INDEX_KEY = 'lineage-studio:models'
const modelKey = (id: string) => `lineage-studio:model:${id}`
const versionsKey = (id: string) => `lineage-studio:versions:${id}`

/** A saved snapshot. Valid time only — no transaction time, by scope decision. */
export interface ModelVersion {
  id: string
  savedAt: number
  label: string
  model: LineageModel
}

export interface ModelStore {
  list(): Promise<ModelSummary[]>
  get(id: string): Promise<LineageModel | null>
  save(model: LineageModel): Promise<void>
  remove(id: string): Promise<void>
  listVersions(id: string): Promise<Omit<ModelVersion, 'model'>[]>
  saveVersion(id: string, label: string): Promise<void>
  getVersion(modelId: string, versionId: string): Promise<LineageModel | null>
}

function readJson<T>(key: string): T | null {
  try {
    const raw = localStorage.getItem(key)
    return raw ? (JSON.parse(raw) as T) : null
  } catch {
    // A corrupt or partially-written entry must not take the whole editor down;
    // treat it as absent so the caller falls back to its empty/default path.
    return null
  }
}

function writeJson(key: string, value: unknown): void {
  try {
    localStorage.setItem(key, JSON.stringify(value))
  } catch (err) {
    // QuotaExceededError is the expected failure here, and it is not something
    // the caller can meaningfully retry — surface it rather than failing silently.
    throw new Error(
      `Could not save to local storage — it is full or unavailable. ${
        err instanceof Error ? err.message : String(err)
      }`,
    )
  }
}

export function summarize(model: LineageModel): ModelSummary {
  return {
    id: model.id,
    name: model.name,
    createdAt: model.createdAt,
    updatedAt: model.updatedAt,
    layerCount: model.layers.length,
    entityCount: countEntities(model),
    transitionCount: model.transitions.length,
  }
}

export const localStore: ModelStore = {
  async list() {
    return (readJson<ModelSummary[]>(INDEX_KEY) ?? []).sort((a, b) => b.updatedAt - a.updatedAt)
  },

  async get(id) {
    return readJson<LineageModel>(modelKey(id))
  },

  async save(model) {
    const next: LineageModel = { ...model, updatedAt: Date.now() }
    writeJson(modelKey(next.id), next)
    const index = readJson<ModelSummary[]>(INDEX_KEY) ?? []
    const without = index.filter((s) => s.id !== next.id)
    writeJson(INDEX_KEY, [...without, summarize(next)])
  },

  async remove(id) {
    localStorage.removeItem(modelKey(id))
    localStorage.removeItem(versionsKey(id))
    const index = readJson<ModelSummary[]>(INDEX_KEY) ?? []
    writeJson(
      INDEX_KEY,
      index.filter((s) => s.id !== id),
    )
  },

  async listVersions(id) {
    const versions = readJson<ModelVersion[]>(versionsKey(id)) ?? []
    // Drop the model payload — callers listing history don't need it, and it is
    // by far the largest part of each entry.
    return versions
      .map(({ model: _model, ...meta }) => meta)
      .sort((a, b) => b.savedAt - a.savedAt)
  },

  async saveVersion(id, label) {
    const model = readJson<LineageModel>(modelKey(id))
    if (!model) throw new Error(`No model ${id} to snapshot`)
    const versions = readJson<ModelVersion[]>(versionsKey(id)) ?? []
    versions.push({ id: crypto.randomUUID(), savedAt: Date.now(), label, model })
    writeJson(versionsKey(id), versions)
  },

  async getVersion(modelId, versionId) {
    const versions = readJson<ModelVersion[]>(versionsKey(modelId)) ?? []
    return versions.find((v) => v.id === versionId)?.model ?? null
  },
}

export function emptyModel(name: string): LineageModel {
  const now = Date.now()
  return {
    id: crypto.randomUUID(),
    name,
    createdAt: now,
    updatedAt: now,
    layers: [],
    transitions: [],
    properties: {},
  }
}
