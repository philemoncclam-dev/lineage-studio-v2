// Model Browser logic — everything the browser does that isn't rendering.
//
// Kept out of the component for the usual reason: filtering, sorting, and the
// two file formats are the parts with actual rules, and they are far cheaper to
// test as functions than through a DOM.
//
// Scope note: the Solidatus-style browser this is modelled on also filters by
// owner / editable-by / created-by / group, and its sidebar carries trending
// and shared-with-me. All of those are multi-user concepts. Lineage Studio has
// no auth and no server yet — every model in local storage belongs to the one
// person using the browser — so they are deliberately absent rather than
// stubbed with fake data. The filters below are the ones that mean something
// for a single local user.

import type { LineageModel, ModelSummary } from './types'

// ===== Filtering =====

export type SortKey = 'viewed' | 'modified' | 'created' | 'name'

export interface BrowserFilter {
  /** Matched case-insensitively against name and description. */
  search: string
  /** A model must carry at least ONE of these (OR within the facet). */
  tags: string[]
  /** When true, only starred models. */
  starredOnly: boolean
}

export const EMPTY_FILTER: BrowserFilter = { search: '', tags: [], starredOnly: false }

export const SORT_LABELS: Record<SortKey, string> = {
  viewed: 'Recently viewed',
  modified: 'Recently modified',
  created: 'Recently created',
  name: 'Name (A–Z)',
}

export function isFilterActive(filter: BrowserFilter): boolean {
  return filter.search.trim() !== '' || filter.tags.length > 0 || filter.starredOnly
}

function matchesSearch(model: ModelSummary, search: string): boolean {
  const q = search.trim().toLowerCase()
  if (!q) return true
  return (
    model.name.toLowerCase().includes(q) ||
    model.description.toLowerCase().includes(q) ||
    // Searching a tag name from the search box is the obvious thing to try, and
    // it costs nothing to make it work alongside the tag facet.
    model.tags.some((t) => t.toLowerCase().includes(q))
  )
}

/**
 * Facets are ANDed with each other and ORed within themselves — the same rule
 * the reference browser documents ("Tags include A OR B AND editable-by = ...").
 */
export function filterModels(models: readonly ModelSummary[], filter: BrowserFilter): ModelSummary[] {
  const wanted = new Set(filter.tags.map((t) => t.toLowerCase()))
  return models.filter((m) => {
    if (filter.starredOnly && !m.starred) return false
    if (wanted.size > 0 && !m.tags.some((t) => wanted.has(t.toLowerCase()))) return false
    return matchesSearch(m, filter.search)
  })
}

/** Stable: ties break on name so the list never reshuffles between renders. */
export function sortModels(models: readonly ModelSummary[], key: SortKey): ModelSummary[] {
  const byName = (a: ModelSummary, b: ModelSummary) => a.name.localeCompare(b.name)
  const desc = (field: (m: ModelSummary) => number) => (a: ModelSummary, b: ModelSummary) =>
    field(b) - field(a) || byName(a, b)

  const compare =
    key === 'name'
      ? byName
      : key === 'created'
        ? desc((m) => m.createdAt)
        : key === 'modified'
          ? desc((m) => m.updatedAt)
          : desc((m) => m.lastViewedAt)

  return [...models].sort(compare)
}

export interface TagCount {
  tag: string
  count: number
}

/**
 * Tag frequency across the whole library — the sidebar's "most used tags".
 * Counted over ALL models, not the filtered view, so selecting a tag doesn't
 * make the other tags vanish from the list you're selecting from.
 */
export function tagCounts(models: readonly ModelSummary[]): TagCount[] {
  const counts = new Map<string, { label: string; count: number }>()
  for (const model of models) {
    for (const tag of model.tags) {
      const key = tag.toLowerCase()
      const entry = counts.get(key)
      if (entry) entry.count += 1
      else counts.set(key, { label: tag, count: 1 })
    }
  }
  return [...counts.values()]
    .map(({ label, count }) => ({ tag: label, count }))
    .sort((a, b) => b.count - a.count || a.tag.localeCompare(b.tag))
}

// ===== The model-list CSV =====

const CSV_COLUMNS = [
  'Model ID',
  'Name',
  'Description',
  'Tags',
  'Starred',
  'Layers',
  'Entities',
  'Transitions',
  'Created',
  'Last updated',
  'Last viewed',
] as const

const iso = (ms: number) => new Date(ms).toISOString()

/** RFC 4180: quote everything, double any embedded quote. */
function csvCell(value: string | number | boolean): string {
  return `"${String(value).replace(/"/g, '""')}"`
}

/** Exports the models CURRENTLY VISIBLE in the list, in their displayed order. */
export function modelsToCsv(models: readonly ModelSummary[]): string {
  const rows = [
    CSV_COLUMNS.map(csvCell).join(','),
    ...models.map((m) =>
      [
        m.id,
        m.name,
        m.description,
        m.tags.join('; '),
        m.starred,
        m.layerCount,
        m.entityCount,
        m.transitionCount,
        iso(m.createdAt),
        iso(m.updatedAt),
        iso(m.lastViewedAt),
      ]
        .map(csvCell)
        .join(','),
    ),
  ]
  return rows.join('\r\n')
}

// ===== The SOL bundle =====
//
// A SOL file is one or more complete models in a single JSON envelope, for
// moving models between installs. It is NOT the tabular export in
// exportTabular.ts — that one is for spreadsheets and drops anything a
// spreadsheet can't hold. This keeps the model byte-for-byte.

export const SOL_KIND = 'lineage-studio/sol'
export const SOL_VERSION = 1

export interface SolBundle {
  kind: typeof SOL_KIND
  version: number
  exportedAt: string
  models: LineageModel[]
}

export function toSolBundle(models: readonly LineageModel[]): SolBundle {
  return {
    kind: SOL_KIND,
    version: SOL_VERSION,
    exportedAt: new Date().toISOString(),
    models: [...models],
  }
}

function looksLikeModel(value: unknown): value is LineageModel {
  if (typeof value !== 'object' || value === null) return false
  const m = value as Partial<LineageModel>
  return typeof m.name === 'string' && Array.isArray(m.layers) && Array.isArray(m.transitions)
}

/**
 * Parses a SOL file, tolerating a bare model or a bare array as well as the
 * envelope — people will hand this the single-model JSON that the Model
 * Viewer's own export produces, and refusing that would be pedantry.
 *
 * Throws with a readable message rather than returning null: every caller is a
 * file picker that has to tell the user what was wrong with their file.
 */
export function parseSolBundle(text: string): LineageModel[] {
  let parsed: unknown
  try {
    parsed = JSON.parse(text)
  } catch {
    throw new Error('That file isn’t valid JSON.')
  }

  const candidates: unknown[] = Array.isArray(parsed)
    ? parsed
    : looksLikeModel(parsed)
      ? [parsed]
      : Array.isArray((parsed as Partial<SolBundle>)?.models)
        ? (parsed as SolBundle).models
        : []

  const models = candidates.filter(looksLikeModel)
  if (models.length === 0) {
    throw new Error('No models found in that file.')
  }
  return models
}

/**
 * Imported models always get fresh ids. Re-importing a file you exported from
 * this same install must not silently overwrite the originals — the browser has
 * no merge UI, so the safe outcome is a second copy the user can delete.
 */
export function prepareImport(models: readonly LineageModel[], now = Date.now()): LineageModel[] {
  return models.map((model) => ({
    ...model,
    id: crypto.randomUUID(),
    createdAt: model.createdAt ?? now,
    updatedAt: now,
    lastViewedAt: now,
  }))
}
