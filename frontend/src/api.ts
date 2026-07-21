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

export interface ColumnMap {
  from_column: string
  to_column: string
  transform?: string | null
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

const BASE = 'http://localhost:8000'

export async function fetchSample(): Promise<LineageGraph> {
  const res = await fetch(`${BASE}/sample`)
  if (!res.ok) throw new Error(`sample failed: ${res.status}`)
  return res.json()
}

export async function fetchGraph(): Promise<LineageGraph> {
  const res = await fetch(`${BASE}/graph`)
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

export async function ingest(payload: unknown): Promise<LineageGraph> {
  const res = await fetch(`${BASE}/ingest`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  })
  if (!res.ok) throw new Error(`ingest failed: ${res.status}`)
  return res.json()
}
