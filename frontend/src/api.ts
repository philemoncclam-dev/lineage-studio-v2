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

export async function ingest(payload: unknown): Promise<LineageGraph> {
  const res = await fetch(`${BASE}/ingest`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  })
  if (!res.ok) throw new Error(`ingest failed: ${res.status}`)
  return res.json()
}
