// How the overview dashboard buckets a flat /fabric/catalog entry into the
// four headline counts. Leading `-` keeps this out of the generated route tree.
//
// The catalog is deliberately thin (kind + Fabric item_type), so bucketing is a
// pure function of those two fields — no extra REST calls to count anything.
//
// The buckets follow how a Fabric user thinks about their tenant, not how the
// REST API types things:
//   data asset — something that holds or presents data: every lakehouse table,
//                the storage items themselves, and the BI layer (reports,
//                semantic models, dashboards). This is the number the user
//                asked for: "anything that is a table, or a Power BI report".
//   notebook   — Notebook items (Spark job definitions are code, but they are
//                not notebooks, so they stay in `other`).
//   pipeline   — DataPipeline plus Dataflow, since both are orchestrated data
//                movement and users count them together.
//   other      — everything else (environments, ML models, eventstreams…),
//                surfaced as its own tile so nothing is silently dropped.
import type { FabricCatalogEntry } from '../../api'

export type AssetBucket = 'data' | 'notebook' | 'pipeline' | 'other'

/** Fine-grained slice within `data`, for the composition breakdown. */
export type DataSlice = 'table' | 'store' | 'bi'

const STORE_TYPES = new Set([
  'lakehouse',
  'warehouse',
  'datamart',
  'kqldatabase',
  'eventhouse',
  'sqldatabase',
  'mirroreddatabase',
  'mirroredwarehouse',
])

const BI_TYPES = new Set(['report', 'paginatedreport', 'dashboard', 'semanticmodel'])

const PIPELINE_TYPES = new Set(['datapipeline', 'dataflow'])

function typeKey(e: FabricCatalogEntry): string {
  return (e.item_type ?? '').toLowerCase()
}

/** Which headline tile an entry counts towards. Workspaces count towards none. */
export function bucketOf(e: FabricCatalogEntry): AssetBucket | null {
  if (e.kind === 'workspace') return null
  if (e.kind === 'table') return 'data'
  if (e.kind === 'notebook') return 'notebook'
  if (e.kind === 'lakehouse') return 'data'
  const t = typeKey(e)
  if (PIPELINE_TYPES.has(t)) return 'pipeline'
  if (STORE_TYPES.has(t) || BI_TYPES.has(t)) return 'data'
  return 'other'
}

/** Which slice of the data-asset composition an entry belongs to (or null). */
export function dataSliceOf(e: FabricCatalogEntry): DataSlice | null {
  if (bucketOf(e) !== 'data') return null
  if (e.kind === 'table') return 'table'
  if (e.kind === 'lakehouse') return 'store'
  return STORE_TYPES.has(typeKey(e)) ? 'store' : 'bi'
}

export interface Counts {
  data: number
  notebook: number
  pipeline: number
  other: number
  /** Composition of `data`. */
  table: number
  store: number
  bi: number
  total: number
}

export const EMPTY_COUNTS: Counts = {
  data: 0,
  notebook: 0,
  pipeline: 0,
  other: 0,
  table: 0,
  store: 0,
  bi: 0,
  total: 0,
}

export function countEntries(entries: FabricCatalogEntry[]): Counts {
  const c: Counts = { ...EMPTY_COUNTS }
  for (const e of entries) {
    const b = bucketOf(e)
    if (!b) continue
    c[b] += 1
    c.total += 1
    const slice = dataSliceOf(e)
    if (slice) c[slice] += 1
  }
  return c
}

/** Per-workspace counts, richest first — the breakdown table's row order. */
export interface WorkspaceRow extends Counts {
  id: string
  name: string
}

export function countByWorkspace(entries: FabricCatalogEntry[]): WorkspaceRow[] {
  const byId = new Map<string, WorkspaceRow>()
  const ensure = (id: string, name: string): WorkspaceRow => {
    let row = byId.get(id)
    if (!row) {
      row = { id, name, ...EMPTY_COUNTS }
      byId.set(id, row)
    }
    return row
  }
  // Workspaces are seeded first so an empty-but-visible workspace still gets a
  // row — "no items" and "no permission to see items" both matter to the user.
  for (const e of entries) {
    if (e.kind === 'workspace') ensure(e.workspace_id, e.workspace_name)
  }
  for (const e of entries) {
    const b = bucketOf(e)
    if (!b) continue
    const row = ensure(e.workspace_id, e.workspace_name)
    row[b] += 1
    row.total += 1
    const slice = dataSliceOf(e)
    if (slice) row[slice] += 1
  }
  return [...byId.values()].sort((a, b) => b.total - a.total || a.name.localeCompare(b.name))
}
