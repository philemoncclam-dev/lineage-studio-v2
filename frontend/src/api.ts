// Contract mirrors backend/app/models.py — keep in sync.

export type NodeKind = 'workspace' | 'notebook' | 'lakehouse' | 'table' | 'column'

export interface Column {
  name: string
  data_type?: string | null
}

export interface LineageNode {
  id: string
  kind: NodeKind
  name: string
  parent_id?: string | null
  columns: Column[]
  meta: Record<string, unknown>
}

export interface ColumnMapEvidence {
  notebook: string
  cell_index: number
  line: number
  snippet: string
}

export interface ColumnMap {
  from_column: string
  to_column: string
  transform?: string | null
  evidence?: ColumnMapEvidence | null
}

export interface LineageEdge {
  source: string
  target: string
  kind: 'reads' | 'writes' | 'calls' | 'derives'
  columns: ColumnMap[]
  via?: string | null
}

export interface LineageGraph {
  nodes: LineageNode[]
  edges: LineageEdge[]
}

// Where the FastAPI backend lives. Set VITE_API_BASE at build time to point a
// deployed frontend at a reachable backend; the default keeps `npm run dev`
// working with no configuration. Vite inlines this at build time, so it is
// baked into the bundle and is not a runtime secret.
const BASE = (import.meta.env.VITE_API_BASE ?? 'http://localhost:8000').replace(/\/$/, '')

export async function fetchSample(): Promise<LineageGraph> {
  const res = await fetch(`${BASE}/sample`)
  if (!res.ok) throw new Error(`sample failed: ${res.status}`)
  return res.json()
}

export async function fetchGraph(): Promise<LineageGraph> {
  // The root loader awaits this before first paint, so an unreachable or
  // cold-starting backend would otherwise hang boot on the "Loading graph…"
  // skeleton indefinitely. Bound it: on timeout the loader's catch falls back
  // to the bundled sample model, so the app always paints quickly.
  const res = await fetch(`${BASE}/graph`, { signal: AbortSignal.timeout(4000) })
  if (!res.ok) throw new Error(`graph failed: ${res.status}`)
  return res.json()
}

// ---- column definition import (backend/app/purview/definitions.py) ----

export type MatchStatus = 'exact' | 'fuzzy' | 'ambiguous' | 'unmatched'

/** One spreadsheet row paired with the Purview column we think it describes. */
export interface DefinitionProposal {
  source_name: string
  description: string
  column_guid: string | null
  column_name: string | null
  confidence: number
  status: MatchStatus
  /** Backend's suggestion; the user can override before applying. */
  selected: boolean
  alternatives: string[]
}

export interface PurviewColumn {
  guid: string
  name: string
  data_type?: string | null
  current_description?: string | null
}

export interface DefinitionMatch {
  table_guid: string
  columns: PurviewColumn[]
  proposals: DefinitionProposal[]
}

export interface WriteOperation {
  verb: string
  path: string
  describes: string
  body: unknown
}

/** Mirrors purview.writer.WriteResult.to_dict(). */
export interface WriteResult {
  dry_run: boolean
  ok: boolean
  operations: WriteOperation[]
  responses: Record<string, unknown>[]
  errors: string[]
}

export interface DefinitionAssignment {
  column_guid: string
  column_name?: string | null
  description: string
}

async function detail(res: Response, what: string): Promise<never> {
  let msg = `${what} failed: ${res.status}`
  try {
    const body = (await res.json()) as { detail?: string }
    if (body.detail) msg = body.detail
  } catch {
    /* non-JSON error body — keep the status text */
  }
  throw new Error(msg)
}

export async function matchDefinitions(tableGuid: string, file: File): Promise<DefinitionMatch> {
  const form = new FormData()
  form.append('table_guid', tableGuid)
  form.append('file', file)
  const res = await fetch(`${BASE}/purview/definitions/match`, { method: 'POST', body: form })
  if (!res.ok) return detail(res, 'match')
  return res.json()
}

export async function applyDefinitions(
  assignments: DefinitionAssignment[],
  apply: boolean,
): Promise<WriteResult> {
  const res = await fetch(`${BASE}/purview/definitions/apply`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ assignments, apply }),
  })
  if (!res.ok) return detail(res, 'apply')
  return res.json()
}

export interface PurviewStatus {
  configured: boolean
  write_enabled: boolean
}

export interface GovernanceDomain {
  id: string
  name: string
  status: string
}

export interface DataProduct {
  id: string
  name: string
  domain: string
  status: string
}

/** A `WriteResult` plus which notebooks Fabric actually gave us source for. */
export interface LineagePushResult extends WriteResult {
  notebooks_read: string[]
}

export async function fetchPurviewStatus(): Promise<PurviewStatus> {
  const res = await fetch(`${BASE}/purview/status`)
  if (!res.ok) return detail(res, 'purview status')
  return res.json()
}

/** Rebuild the graph from the live catalog. Also makes it the current graph. */
export async function fetchPurviewGraph(): Promise<LineageGraph> {
  const res = await fetch(`${BASE}/purview/graph`)
  if (!res.ok) return detail(res, 'purview graph')
  return res.json()
}

export async function pushLineage(apply: boolean): Promise<LineagePushResult> {
  const res = await fetch(`${BASE}/purview/lineage/push`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ apply }),
  })
  if (!res.ok) return detail(res, 'lineage push')
  return res.json()
}

export async function fetchDomains(): Promise<GovernanceDomain[]> {
  const res = await fetch(`${BASE}/purview/domains`)
  if (!res.ok) return detail(res, 'domains')
  return res.json()
}

export async function fetchDataProducts(): Promise<DataProduct[]> {
  const res = await fetch(`${BASE}/purview/dataproducts`)
  if (!res.ok) return detail(res, 'data products')
  return res.json()
}

export async function catalogDataProduct(body: {
  name: string
  domain_id: string
  description?: string
  asset_guids: string[]
  asset_names?: Record<string, string>
  apply: boolean
}): Promise<WriteResult & { data_product_id: string }> {
  const res = await fetch(`${BASE}/purview/dataproducts`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
  if (!res.ok) return detail(res, 'catalog data product')
  return res.json()
}

export async function ingest(payload: unknown): Promise<LineageGraph> {
  const res = await fetch(`${BASE}/ingest`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  })
  if (!res.ok) throw new Error(`ingest failed: ${res.status}`)
  return res.json()
}
