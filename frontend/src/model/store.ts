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

  // --- Model Browser operations ---
  //
  // These edit browser metadata, never the graph. They are separate from
  // `save` so the browser can touch a model without loading, rewriting, and
  // re-summarizing its whole entity tree.

  /** Creates and persists an empty model, returning it. */
  create(name: string): Promise<LineageModel>
  /** Deep-copies a model under a new id and name. Versions are NOT copied. */
  duplicate(id: string, name?: string): Promise<LineageModel>
  /** Applies a partial metadata patch. Does not bump `updatedAt`. */
  patchMeta(id: string, patch: MetaPatch): Promise<void>
  /** Records that a model was opened. Does not bump `updatedAt`. */
  touch(id: string): Promise<void>
  removeMany(ids: string[]): Promise<void>
}

/** The browser-editable metadata subset. */
export interface MetaPatch {
  name?: string
  description?: string
  tags?: string[]
  starred?: boolean
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

/**
 * Dedupes case-insensitively while keeping the first spelling seen, so "Logical"
 * and "logical" collapse to one tag but the label the user typed survives.
 */
export function normalizeTags(tags: readonly string[]): string[] {
  const seen = new Set<string>()
  const out: string[] = []
  for (const raw of tags) {
    const tag = raw.trim()
    if (!tag) continue
    const key = tag.toLowerCase()
    if (seen.has(key)) continue
    seen.add(key)
    out.push(tag)
  }
  return out.sort((a, b) => a.localeCompare(b))
}

/**
 * Fills in browser metadata absent from models persisted before it existed.
 * Every read path goes through this, so nothing above the store has to guess.
 *
 * `lastViewedAt` defaults to `updatedAt` rather than 0: a pre-browser model has
 * no view history, and dropping it to the bottom of the default sort would hide
 * the user's real work behind whatever they created most recently.
 */
export function normalize(model: LineageModel): LineageModel {
  return {
    ...model,
    description: model.description ?? '',
    tags: normalizeTags(model.tags ?? []),
    starred: model.starred ?? false,
    lastViewedAt: model.lastViewedAt ?? model.updatedAt,
  }
}

export function summarize(model: LineageModel): ModelSummary {
  const full = normalize(model)
  return {
    id: full.id,
    name: full.name,
    createdAt: full.createdAt,
    updatedAt: full.updatedAt,
    layerCount: full.layers.length,
    entityCount: countEntities(full),
    transitionCount: full.transitions.length,
    description: full.description ?? '',
    tags: full.tags ?? [],
    starred: full.starred ?? false,
    lastViewedAt: full.lastViewedAt ?? full.updatedAt,
  }
}

/** Index rows written before the browser existed lack the metadata fields. */
function fillSummary(s: ModelSummary): ModelSummary {
  return {
    ...s,
    description: s.description ?? '',
    tags: normalizeTags(s.tags ?? []),
    starred: s.starred ?? false,
    lastViewedAt: s.lastViewedAt ?? s.updatedAt,
  }
}

function readIndex(): ModelSummary[] {
  return (readJson<ModelSummary[]>(INDEX_KEY) ?? []).map(fillSummary)
}

/** Rewrites one index row in place, leaving the rest untouched. */
function patchIndex(id: string, patch: Partial<ModelSummary>): void {
  const index = readIndex()
  const row = index.find((s) => s.id === id)
  if (!row) return
  writeJson(
    INDEX_KEY,
    index.map((s) => (s.id === id ? { ...s, ...patch } : s)),
  )
}

export const localStore: ModelStore = {
  async list() {
    return readIndex().sort((a, b) => b.updatedAt - a.updatedAt)
  },

  async get(id) {
    const model = readJson<LineageModel>(modelKey(id))
    return model ? normalize(model) : null
  },

  async save(model) {
    const next = normalize({ ...model, updatedAt: Date.now() })
    writeJson(modelKey(next.id), next)
    const index = readIndex()
    const without = index.filter((s) => s.id !== next.id)
    writeJson(INDEX_KEY, [...without, summarize(next)])
  },

  async remove(id) {
    localStorage.removeItem(modelKey(id))
    localStorage.removeItem(versionsKey(id))
    writeJson(
      INDEX_KEY,
      readIndex().filter((s) => s.id !== id),
    )
  },

  async removeMany(ids) {
    const drop = new Set(ids)
    for (const id of drop) {
      localStorage.removeItem(modelKey(id))
      localStorage.removeItem(versionsKey(id))
    }
    writeJson(
      INDEX_KEY,
      readIndex().filter((s) => !drop.has(s.id)),
    )
  },

  async create(name) {
    const model = emptyModel(name)
    await localStore.save(model)
    return model
  },

  async duplicate(id, name) {
    const source = await localStore.get(id)
    if (!source) throw new Error(`No model ${id} to duplicate`)
    const now = Date.now()
    // structuredClone, not a spread: layers/transitions/properties are deeply
    // nested, and a shallow copy would leave the two models sharing entity
    // objects — editing the copy would silently edit the original.
    const copy: LineageModel = {
      ...structuredClone(source),
      id: crypto.randomUUID(),
      name: name ?? `${source.name} (copy)`,
      createdAt: now,
      updatedAt: now,
      lastViewedAt: now,
    }
    await localStore.save(copy)
    return copy
  },

  async patchMeta(id, patch) {
    const model = readJson<LineageModel>(modelKey(id))
    if (!model) return
    const clean: MetaPatch = { ...patch }
    if (clean.tags) clean.tags = normalizeTags(clean.tags)
    // Deliberately NOT bumping updatedAt: starring a model or fixing a typo in
    // its tags is not a change to the model, and letting it reorder the
    // "recently modified" sort would make that sort useless.
    writeJson(modelKey(id), normalize({ ...model, ...clean }))
    patchIndex(id, clean as Partial<ModelSummary>)
  },

  async touch(id) {
    const model = readJson<LineageModel>(modelKey(id))
    if (!model) return
    const lastViewedAt = Date.now()
    writeJson(modelKey(id), normalize({ ...model, lastViewedAt }))
    patchIndex(id, { lastViewedAt })
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
    description: '',
    tags: [],
    starred: false,
    lastViewedAt: now,
  }
}
