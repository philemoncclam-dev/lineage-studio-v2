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

// --- Data Products section ------------------------------------------------
// Products, their metadata and the request workflow are served from the
// backend's local store (always available); domains prefer live Purview.

export interface ProductDomain {
  id: string
  name: string
  parent_id: string | null
  description?: string | null
}

export interface ProductOwner {
  name: string
  email: string
  object_id?: string | null
}

export interface ProductColumn {
  name: string
  data_type?: string | null
  description?: string | null
}

export type ProductAssetKind = 'table' | 'powerbi' | 'notebook' | 'lakehouse' | 'other'

export interface ProductAsset {
  id: string
  name: string
  kind: ProductAssetKind
  node_id?: string | null
  purview_guid?: string | null
  columns: ProductColumn[]
}

export type ProductStatus = 'draft' | 'published' | 'deprecated'

export interface ProductRecord {
  id: string
  name: string
  domain_id: string
  description: string
  use_cases: string[]
  owners: ProductOwner[]
  assets: ProductAsset[]
  workspace_id?: string | null
  workspace_name?: string | null
  model_id?: string | null
  model_name?: string | null
  status: ProductStatus
  purview_id?: string | null
  created_at: string
  updated_at: string
}

export type AccessRequestStatus = 'pending' | 'approved' | 'denied'

export interface GrantRecord {
  applied: boolean
  dry_run: boolean
  describes: string
  role: string
  error?: string | null
}

export interface AccessRequest {
  id: string
  product_id: string
  product_name: string
  requester_name: string
  requester_email: string
  requester_object_id?: string | null
  justification: string
  status: AccessRequestStatus
  created_at: string
  decided_at?: string | null
  decided_by?: string | null
  grant?: GrantRecord | null
}

export interface ProductWrite {
  name: string
  domain_id: string
  description?: string
  use_cases?: string[]
  owners?: ProductOwner[]
  assets?: ProductAsset[]
  workspace_id?: string | null
  workspace_name?: string | null
  model_id?: string | null
  model_name?: string | null
  status?: ProductStatus
}

export async function fetchProductDomains(): Promise<ProductDomain[]> {
  const res = await fetch(`${BASE}/products/domains`)
  if (!res.ok) return detail(res, 'product domains')
  return res.json()
}

export async function fetchProducts(): Promise<ProductRecord[]> {
  const res = await fetch(`${BASE}/products`)
  if (!res.ok) return detail(res, 'products')
  return res.json()
}

export async function fetchProduct(id: string): Promise<ProductRecord> {
  const res = await fetch(`${BASE}/products/${id}`)
  if (!res.ok) return detail(res, 'product')
  return res.json()
}

export async function createProduct(body: ProductWrite): Promise<ProductRecord> {
  const res = await fetch(`${BASE}/products`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
  if (!res.ok) return detail(res, 'create product')
  return res.json()
}

export async function fetchProductRequests(productId: string): Promise<AccessRequest[]> {
  const res = await fetch(`${BASE}/products/${productId}/requests`)
  if (!res.ok) return detail(res, 'product requests')
  return res.json()
}

export async function fetchAllRequests(status?: AccessRequestStatus): Promise<AccessRequest[]> {
  const qs = status ? `?status=${status}` : ''
  const res = await fetch(`${BASE}/products/requests/all${qs}`)
  if (!res.ok) return detail(res, 'requests')
  return res.json()
}

export async function requestAccess(
  productId: string,
  body: { requester_name: string; requester_email: string; requester_object_id?: string; justification?: string },
): Promise<AccessRequest> {
  const res = await fetch(`${BASE}/products/${productId}/requests`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
  if (!res.ok) return detail(res, 'request access')
  return res.json()
}

export async function decideRequest(
  requestId: string,
  body: { approve: boolean; decided_by?: string; apply?: boolean },
): Promise<AccessRequest> {
  const res = await fetch(`${BASE}/products/requests/${requestId}/decide`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
  if (!res.ok) return detail(res, 'decide request')
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

// --- Fabric toolkit: workspace explorer (backend/app/fabric/router.py) -----
// Read-only walk of the live Fabric REST surface: workspaces → items → tables.
// A refused call throws via detail() (empty-means-no-permission), so callers
// can show "couldn't read" distinctly from a genuinely empty workspace.

export interface FabricWorkspace {
  id: string
  name: string
  description?: string | null
}

export interface FabricFolder {
  id: string
  name: string
  parent_id: string | null
}

export interface FabricItem {
  id: string
  name: string
  type: string
  folder_id: string | null
  description?: string | null
}

export interface FabricWorkspaceItems {
  folders: FabricFolder[]
  notebooks: FabricItem[]
  lakehouses: FabricItem[]
  others: FabricItem[]
}

export interface FabricTable {
  name: string
  type?: string | null
  format?: string | null
}

export async function fetchFabricStatus(): Promise<{ configured: boolean }> {
  const res = await fetch(`${BASE}/fabric/status`)
  if (!res.ok) return detail(res, 'fabric status')
  return res.json()
}

export async function fetchFabricWorkspaces(): Promise<FabricWorkspace[]> {
  const res = await fetch(`${BASE}/fabric/workspaces`)
  if (!res.ok) return detail(res, 'fabric workspaces')
  return res.json()
}

export async function fetchFabricItems(workspaceId: string): Promise<FabricWorkspaceItems> {
  const res = await fetch(`${BASE}/fabric/workspaces/${workspaceId}/items`)
  if (!res.ok) return detail(res, 'fabric items')
  return res.json()
}

export async function fetchFabricTables(
  workspaceId: string,
  lakehouseId: string,
): Promise<FabricTable[]> {
  const res = await fetch(`${BASE}/fabric/workspaces/${workspaceId}/lakehouses/${lakehouseId}/tables`)
  if (!res.ok) return detail(res, 'fabric tables')
  return res.json()
}

export type FabricCatalogKind = 'workspace' | 'notebook' | 'lakehouse' | 'table' | 'item'

export interface FabricCatalogEntry {
  kind: FabricCatalogKind
  workspace_id: string
  workspace_name: string
  id: string
  name: string
  item_type?: string | null
  lakehouse_id?: string | null
  lakehouse_name?: string | null
}

export async function fetchFabricCatalog(): Promise<FabricCatalogEntry[]> {
  const res = await fetch(`${BASE}/fabric/catalog`)
  if (!res.ok) return detail(res, 'fabric catalog')
  return res.json()
}

export interface FabricNotebookSource {
  name: string
  lakehouse_default: string | null
  cells: string[]
}

export async function fetchFabricNotebookSource(
  workspaceId: string,
  itemId: string,
  name: string,
): Promise<FabricNotebookSource> {
  const res = await fetch(
    `${BASE}/fabric/workspaces/${workspaceId}/notebooks/${itemId}/source?name=${encodeURIComponent(name)}`,
  )
  if (!res.ok) return detail(res, 'notebook source')
  return res.json()
}

export interface FabricPipelineActivity {
  name: string
  type: string
  depends_on: string[]
  notebook_id?: string | null
  workspace_id?: string | null
}

export async function fetchFabricPipelineDefinition(
  workspaceId: string,
  itemId: string,
): Promise<FabricPipelineActivity[]> {
  const res = await fetch(`${BASE}/fabric/workspaces/${workspaceId}/pipelines/${itemId}/definition`)
  if (!res.ok) return detail(res, 'pipeline definition')
  return res.json()
}

export interface FabricColumn {
  name: string
  type?: string | null
}

export async function fetchFabricTableSchema(
  workspaceId: string,
  lakehouseId: string,
  tableName: string,
): Promise<FabricColumn[]> {
  const res = await fetch(
    `${BASE}/fabric/workspaces/${workspaceId}/lakehouses/${lakehouseId}/tables/${encodeURIComponent(tableName)}/schema`,
  )
  if (!res.ok) return detail(res, 'table schema')
  return res.json()
}

// --- Fabric toolkit: notebook sandbox (backend/app/sandbox/router.py) ------
// Runs a notebook in an isolated subprocess — scrubbed env, no Fabric creds,
// no writes to real Fabric. M2a returns a stub (static) result; M2b swaps in
// real local-Spark execution behind the same shape.

export interface SandboxCellResult {
  index: number
  status: 'ok' | 'error' | 'skipped'
  reads: string[]
  writes: string[]
  stdout: string
  error: string | null
}

export interface SandboxColumn {
  name: string
  type?: string | null
}

export interface SandboxColumnFlow {
  to_table: string
  to_column: string
  from_column: string
  transform?: string | null
}

/**
 * The parts behind a table ref.
 *
 * `reads`, `writes` and `table_schemas` are keyed by an opaque canonical ref,
 * because a notebook can read and write across workspaces and a bare table name
 * is therefore not an identity. This is the side table that turns a ref back
 * into something displayable — and `resolved: false` means the workspace could
 * not be determined, which must render as unknown rather than as the notebook's
 * own.
 */
export interface SandboxTableRef {
  workspace: string
  lakehouse: string
  table: string
  resolved: boolean
}

export interface SandboxRunResult {
  ok: boolean
  engine: 'stub' | 'spark'
  cells: SandboxCellResult[]
  reads: string[]
  writes: string[]
  /** Schema per touched table (Spark engine only; empty for stub). */
  table_schemas: Record<string, SandboxColumn[]>
  /** Column-level lineage from the analyzed plans (Spark engine only). */
  column_lineage: SandboxColumnFlow[]
  /**
   * ref → its parts, for every ref named anywhere in this result.
   *
   * Optional because a backend deployed before workspace-qualified refs does
   * not send it (or `workspace`). Consumers fall back to the leaf name and an
   * unresolved workspace, so an older API degrades instead of breaking.
   */
  tables?: Record<string, SandboxTableRef>
  /** The notebook's own workspace, for spotting cross-workspace access. */
  workspace?: string
  log: string[]
  saw_credentials: boolean
  error: string | null
}

/** Display name for a ref, falling back to the ref when it is unknown to us. */
export function refLabel(ref: string, tables?: Record<string, SandboxTableRef>): string {
  return tables?.[ref]?.table || ref.split('/').pop() || ref
}

/** The workspace a ref belongs to, or `''` when it could not be resolved. */
export function refWorkspace(ref: string, tables?: Record<string, SandboxTableRef>): string {
  const t = tables?.[ref]
  return t?.resolved ? t.workspace : ''
}

export async function runSandbox(body: {
  name?: string
  workspace_id?: string
  item_id?: string
  cells?: string[]
  /** The notebook's own workspace/lakehouse — the defaults bare names resolve against. */
  workspace?: string
  lakehouse?: string
}): Promise<SandboxRunResult> {
  const res = await fetch(`${BASE}/fabric/sandbox/run`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
  if (!res.ok) return detail(res, 'sandbox run')
  return res.json()
}
