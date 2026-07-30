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

/**
 * Where the *Spark* sandbox lives, which is not necessarily where the rest of
 * the API lives.
 *
 * The sandbox is the one endpoint that needs a JVM, so in production it runs on
 * a container host rather than alongside the other routes. That host scales to
 * zero to stay affordable, which means a run can pay a cold start of minutes
 * while every other route stays fast — so only this one call is pointed at it.
 * Unset (dev, or a deployment with no container) falls back to `BASE`, where
 * the backend answers with whichever engine it can reach.
 */
const SANDBOX_BASE = (import.meta.env.VITE_SANDBOX_API_BASE ?? BASE).replace(/\/$/, '')

/**
 * How to get the signed-in user's Fabric token, installed by `AuthProvider`.
 *
 * A module variable rather than a parameter because these are plain async
 * functions called from loaders, effects and event handlers alike; threading a
 * hook result through every one of them would put auth in the signature of
 * code that has no other reason to know about it.
 *
 * Null means nobody is signed in, and that is a supported state — the backend
 * falls back to its service principal. It is also the safe default: a missing
 * source sends no header rather than a stale one.
 */
export interface FabricTokens {
  /** For `api.fabric.microsoft.com` — workspaces, items, tables. */
  fabric: string | null
  /** For `storage.azure.com` — the OneLake Delta log behind table schemas. */
  onelake: string | null
}

let tokenSource: (() => Promise<FabricTokens>) | null = null

export function setTokenSource(source: (() => Promise<FabricTokens>) | null): void {
  tokenSource = source
}

/**
 * A `/fabric/*` request carrying the caller's identity when there is one.
 *
 * The token is fetched per request, not cached here: MSAL already caches it
 * and renews it near expiry, so asking each time is how a long-lived tab keeps
 * working instead of failing an hour in with a token it decided to hold onto.
 */
export async function fabricFetch(url: string, init: RequestInit = {}): Promise<Response> {
  const tokens = tokenSource ? await tokenSource() : null
  if (!tokens?.fabric && !tokens?.onelake) return fetch(url, init)
  const headers = new Headers(init.headers)
  if (tokens.fabric) headers.set('Authorization', `Bearer ${tokens.fabric}`)
  // A separate header, because this is a token for a DIFFERENT audience —
  // `storage.azure.com`, not `api.fabric.microsoft.com`. Each API rejects the
  // other's token, so folding them into one field would surface as a 401 that
  // reads like a permissions problem rather than the wrong-audience bug it is.
  if (tokens.onelake) headers.set('X-OneLake-Authorization', `Bearer ${tokens.onelake}`)
  return fetch(url, { ...init, headers })
}

export async function fetchSample(): Promise<LineageGraph> {
  const res = await fetch(`${BASE}/sample`)
  if (!res.ok) throw new Error(`sample failed: ${res.status}`)
  return res.json()
}

/**
 * The whole lineage graph, in one request.
 *
 * NO CALLER TODAY. The root route used to await this before first paint and
 * hand the result down through RouterContext; nothing ever read it, so the
 * call was removed (see routes/__root.tsx) and boot no longer waits on the
 * backend at all. Kept because `/graph` is a live backend endpoint and this is
 * the client for it — but it is unreferenced, so treat it as unproven against
 * the current backend until something calls it again.
 *
 * The timeout is what kept the old boot bounded: an unreachable or
 * cold-starting backend would otherwise hang the loader indefinitely.
 */
export async function fetchGraph(): Promise<LineageGraph> {
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
  const res = await fabricFetch(`${BASE}/fabric/status`)
  if (!res.ok) return detail(res, 'fabric status')
  return res.json()
}

export async function fetchFabricWorkspaces(): Promise<FabricWorkspace[]> {
  const res = await fabricFetch(`${BASE}/fabric/workspaces`)
  if (!res.ok) return detail(res, 'fabric workspaces')
  return res.json()
}

export async function fetchFabricItems(workspaceId: string): Promise<FabricWorkspaceItems> {
  const res = await fabricFetch(`${BASE}/fabric/workspaces/${workspaceId}/items`)
  if (!res.ok) return detail(res, 'fabric items')
  return res.json()
}

export async function fetchFabricTables(
  workspaceId: string,
  lakehouseId: string,
): Promise<FabricTable[]> {
  const res = await fabricFetch(`${BASE}/fabric/workspaces/${workspaceId}/lakehouses/${lakehouseId}/tables`)
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
  const res = await fabricFetch(`${BASE}/fabric/catalog`)
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
  /**
   * Lineage a Copy activity declares inline, parsed from the definition.
   *
   * A pipeline is not Spark, so there is nothing to execute for one — but a
   * Copy states its source and sink datasets and, when it has a translator, a
   * literal column-to-column mapping. Empty for every other activity type.
   */
  reads: string[]
  writes: string[]
  column_lineage: SandboxColumnFlow[]
}

export async function fetchFabricPipelineDefinition(
  workspaceId: string,
  itemId: string,
): Promise<FabricPipelineActivity[]> {
  const res = await fabricFetch(`${BASE}/fabric/workspaces/${workspaceId}/pipelines/${itemId}/definition`)
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
  /**
   * The source column's owning table, when the deriving engine knew it.
   *
   * The Spark path resolves attributes by name and cannot say; the sqlglot path
   * qualifies every column against the schemas and knows exactly. Absent means
   * "not known" — never "no table" — so the reader falls back to matching on
   * the column name rather than dropping the flow.
   */
  from_table?: string | null
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
  /**
   * `file` for the raw layer — a `Files/…` path rather than a Delta table.
   *
   * The landing layer is files, and it must not be drawn as a table: it has no
   * schema to disclose, and a landing folder named `orders` is not the table
   * named `orders`. Optional so a model saved before the raw layer was tracked
   * still renders; absent means `table`.
   */
  kind?: 'table' | 'file'
}

/**
 * What the run could and could not analyse — the code-side counterpart to
 * `schema_resolution` (backend/app/sandbox/_coverage.py).
 *
 * An empty `column_lineage` has four causes and the result could not tell them
 * apart: nothing to find; the DataFrame API on an engine that reads only SQL
 * (the stub — which is production); a query built from an f-string or variable,
 * skipped because its text is unknowable without running the cell; a cell that
 * would not parse. Only the first is a finding; the rest are missing answers.
 */
export interface SandboxCoverage {
  cells: number
  sql_cells: number
  sql_statements: number
  /** Cells writing via the DataFrame API and issuing no SQL — the stub's blind spot. */
  dataframe_write_cells: number
  dynamic_sql_cells: number
  unparsable_cells: number
  writes: number
  writes_with_column_lineage: number
  /** The load-bearing field: a run can look healthy with every write bare. */
  writes_without_column_lineage: string[]
}

export interface SandboxRunResult {
  ok: boolean
  /**
   * How the lineage was derived.
   *
   * `spark` — Catalyst's analyzed plans. `stub` — static analysis plus sqlglot
   * over the SQL cells. `definition` — nothing ran at all: a pipeline Copy
   * activity declares its datasets and column mapping inline, so the lineage is
   * read out of the JSON. Synthesized on the client (see `copyActivityRun`),
   * which is why this value never comes back from `/sandbox/run`.
   */
  engine: 'stub' | 'spark' | 'definition'
  cells: SandboxCellResult[]
  reads: string[]
  writes: string[]
  /**
   * Schema per touched table.
   *
   * The Spark engine fills both sides from the analyzer. The stub engine echoes
   * back the schemas it was given (so read tables carry real columns and types)
   * and derives a written table's columns from the projection that produced it
   * (names only — nothing off-engine knows their types).
   */
  table_schemas: Record<string, SandboxColumn[]>
  /**
   * Whether the input schemas the run needed were readable from OneLake.
   *
   * Off-engine column lineage is derived by resolving each column against
   * these, so an unreadable OneLake — a service principal without workspace
   * access, most often — yields empty `column_lineage` that looks exactly like
   * a notebook with no SQL in it. `unresolved` is how the two are told apart.
   *
   * Undefined when no fetch was attempted (cells or schemas supplied by the
   * caller), which is a third state and not the same as "found nothing".
   */
  schema_resolution?: {
    requested: string[]
    resolved: string[]
    unresolved: string[]
    /** Refs whose columns came from an earlier step of the sequence, not OneLake. */
    carried?: string[]
    /** Empty with a non-empty `unresolved` means not-found, not refused. */
    failures: string[]
  } | null
  /** Column-level lineage from the analyzed plans (Spark engine only). */
  column_lineage: SandboxColumnFlow[]
  /**
   * What the run could and could not analyse. Undefined from a backend deployed
   * before it existed — which must not read as "coverage was total".
   */
  coverage?: SandboxCoverage | null
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
  // The fallback parses rather than splitting on the last separator: a leaf may
  // legitimately contain an escaped `/` — every raw file path does — and
  // `split('/').pop()` returns it still escaped, so the card read
  // `Files%2Forders%2F*.csv`. Only refs with no side table were affected, which
  // is a pipeline Copy activity and any model saved before one was sent.
  return tables?.[ref]?.table || refParts(ref).table || ref
}

/**
 * Whether a ref names the raw file layer or a Delta table.
 *
 * Prefers what the run said; falls back to the ref's own shape for lineage that
 * never went through the sandbox (a pipeline Copy activity, a model saved
 * before the raw layer was tracked).
 */
export function refKind(ref: string, tables?: Record<string, SandboxTableRef>): 'table' | 'file' {
  return tables?.[ref]?.kind ?? refParts(ref).kind ?? 'table'
}

/** The workspace a ref belongs to, or `''` when it could not be resolved. */
export function refWorkspace(ref: string, tables?: Record<string, SandboxTableRef>): string {
  const t = tables?.[ref]
  return t?.resolved ? t.workspace : ''
}

/**
 * A canonical ref → its parts, mirroring `_refs.parse_ref`/`table_refs`.
 *
 * The backend normally sends this side table with a run, so this exists for
 * lineage that never went through the sandbox — a pipeline Copy activity, whose
 * refs are built from its definition on the client. Kept in step with the
 * Python: segments escape only `%` and `/`, and `resolved` means the WORKSPACE
 * is known, not that all three parts are.
 */
export function refParts(ref: string): SandboxTableRef {
  const unescape = (s: string) => s.replace(/%2F/gi, '/').replace(/%25/g, '%')
  const parts = ref.split('/')
  const [workspace, lakehouse, ...rest] =
    parts.length >= 3 ? parts : ['', ...(parts.length === 2 ? parts : ['', ...parts])]
  const table = unescape(rest.join('/'))
  return {
    workspace: unescape(workspace),
    lakehouse: unescape(lakehouse),
    table,
    resolved: Boolean(workspace && table),
    // Mirrors `_refs.is_file_ref` — the leaf keeps its `Files/` head precisely
    // so the distinction survives the ref round-trip.
    kind: table === 'Files' || table.toLowerCase().startsWith('files/') ? 'file' : 'table',
  }
}

// --- the model assistant (backend/app/chat) -------------------------------
// Phase 1 is a deterministic graph walk in Python; phase 2 is the LLM that
// picks which walk answers the question and says the result in a sentence.
//
// The MODEL TRAVELS IN THE REQUEST. It lives in this browser's localStorage and
// the backend has no store for it, so `/chat/ask` is a pure function of what it
// is sent — which is also why there is no session: the conversation is held
// here and replayed each turn.

/** One turn as this browser holds it. Assistant turns are prose, not tool blocks. */
export interface ChatMessage {
  role: 'user' | 'assistant'
  content: string
}

/** One traversal the assistant ran, so the prose can be checked against it. */
export interface AssistantToolCall {
  name: string
  input: Record<string, unknown>
  /** A one-line summary — carries the walk's own caveats ("object level", "truncated"). */
  result: string
}

/**
 * A change the assistant wants made — VALIDATED by the backend, NOT applied.
 *
 * The backend cannot apply anything: the model lives in this browser. So a
 * proposal is a suggestion with an Apply button, and accepting one runs the
 * ordinary editor function through the ordinary undo history.
 */
export interface ProposedEdit {
  kind: 'add_transition' | 'set_property' | 'add_tag' | 'rename'
  /** One sentence, written by the assistant. This is what the user reads before approving. */
  describes: string
  source_id?: string | null
  target_id?: string | null
  entity_id?: string | null
  key?: string | null
  value?: string | null
  /** Display paths, resolved by the backend, so the UI shows names not uuids. */
  source_path?: string | null
  target_path?: string | null
  entity_path?: string | null
}

export interface AssistantAnswer {
  text: string
  /** Awaiting the user's approval. Empty on a read-only turn. */
  proposals: ProposedEdit[]
  /**
   * In call order. EMPTY ON A SUBSTANTIVE ANSWER IS A RED FLAG: it means the
   * model replied without reading the graph, and the UI marks it as such rather
   * than presenting it with the same authority as a traced one.
   */
  trace: AssistantToolCall[]
  stop_reason: 'end_turn' | 'max_rounds' | 'refusal'
}

export async function fetchChatStatus(): Promise<{
  configured: boolean
  model: string
  /** Whether this backend refuses an anonymous question — see `askAssistant`. */
  requires_auth?: boolean
}> {
  const res = await fetch(`${BASE}/chat/status`)
  if (!res.ok) return detail(res, 'assistant status')
  return res.json()
}

/**
 * How long a question may run before this browser gives up on it.
 *
 * Generous on purpose: a turn is several model calls plus the traversals
 * between them, and the backend's own budget (`assistant.TURN_BUDGET_SECONDS`)
 * is meant to end a slow turn first, with an answer. This is the backstop for
 * when nothing comes back at all.
 */
const ASSISTANT_TIMEOUT_MS = 150_000

export async function askAssistant(
  model: unknown,
  messages: ChatMessage[],
  /**
   * Entity ids selected on the canvas. This is what lets "this column" mean
   * something — without it the assistant resolves a pronoun by searching for a
   * name, which can match a dozen entities and pick the wrong one.
   */
  selection: string[] = [],
): Promise<AssistantAnswer> {
  // `fabricFetch`, not a bare fetch: the assistant's Fabric tools read the
  // tenant as WHOEVER IS ASKING, so an unauthenticated question would be
  // answered from the service principal's view and could describe workspaces
  // this user cannot open in Explore. A deployed backend also refuses an
  // anonymous question outright — it is the only route that spends money.
  let res: Response
  try {
    res = await fabricFetch(`${BASE}/chat/ask`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ model, messages, selection }),
      // A question runs a tool loop server-side and can legitimately take a
      // minute. Without a bound the panel spins forever on a backend that has
      // gone away; with one that is too tight it kills answers that were
      // coming.
      signal: AbortSignal.timeout(ASSISTANT_TIMEOUT_MS),
    })
  } catch (err) {
    // A fetch rejects — rather than resolving with a bad status — only when the
    // request never completed at all, and the browser's own message for that
    // ("Failed to fetch", "NetworkError…") tells the user nothing they can act
    // on. It is worth naming the causes, because on a small instance the usual
    // one is the API restarting mid-answer, which looks identical from here to
    // being offline.
    if (err instanceof DOMException && err.name === 'TimeoutError') {
      throw new Error(
        `The assistant didn't answer within ${Math.round(ASSISTANT_TIMEOUT_MS / 1000)}s. ` +
          'Long questions can outrun it — try a narrower one.',
      )
    }
    throw new Error(
      "Couldn't reach the assistant — the connection dropped before an answer " +
        'came back. If the backend is up, check its logs: a request that dies ' +
        'mid-answer is usually the instance restarting or running out of memory.',
    )
  }
  if (!res.ok) return detail(res, 'assistant')
  return res.json()
}

// --- shared models (backend/app/share) ------------------------------------
// Publishing turns a model into a link ANYONE can open — the token is the
// credential, so a share link is exactly as private as the people it reaches.
// What is stored is a SNAPSHOT: later edits stay local until you publish again.

export interface ShareCreated {
  token: string
  expires_at: number | null
  /** `sqlite` means the host may lose these links on its next deploy. */
  storage: string
}

export interface SharedModel {
  name: string
  model: unknown
  created_at: number
  expires_at: number | null
}

export async function fetchShareStatus(): Promise<{
  storage: string
  durable: boolean
  /** Present when DATABASE_URL is set but the database did not answer. */
  error?: string
}> {
  const res = await fetch(`${BASE}/shares/status`)
  if (!res.ok) return detail(res, 'sharing status')
  return res.json()
}

export async function shareModel(
  model: unknown,
  name: string,
  ttlDays: number | null,
): Promise<ShareCreated> {
  // Signed-in only: an open endpoint that stores megabytes is free hosting for
  // whoever finds the URL. `fabricFetch` carries the token.
  const res = await fabricFetch(`${BASE}/shares`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ model, name, ttl_days: ttlDays }),
  })
  if (!res.ok) return detail(res, 'share')
  return res.json()
}

/** Open a shared model. Deliberately a plain fetch — a recipient has no token. */
export async function fetchSharedModel(token: string): Promise<SharedModel> {
  const res = await fetch(`${BASE}/shares/${encodeURIComponent(token)}`)
  if (!res.ok) return detail(res, 'shared model')
  return res.json()
}

export async function revokeShare(token: string): Promise<void> {
  const res = await fabricFetch(`${BASE}/shares/${encodeURIComponent(token)}`, {
    method: 'DELETE',
  })
  if (!res.ok) return detail(res, 'revoke share')
}

/** Gateway statuses a scaled-to-zero host returns while it is still waking. */
const COLD_START_STATUS = new Set([502, 503, 504])

export async function runSandbox(body: {
  name?: string
  workspace_id?: string
  item_id?: string
  cells?: string[]
  /** The notebook's own workspace/lakehouse — the defaults bare names resolve against. */
  workspace?: string
  lakehouse?: string
  /**
   * Schemas observed by earlier steps of the same sequence. They fill gaps the
   * OneLake fetch could not answer — a table an upstream notebook just created
   * may not exist there yet — and never override what it did answer.
   */
  carried_schemas?: Record<string, SandboxColumn[]>
}): Promise<SandboxRunResult> {
  // A scaled-to-zero host answers the first request after idle with a gateway
  // error, not a result: the ingress gives up before the container has pulled
  // its image and started a JVM. That is a cold start, not a failed run, and
  // retrying it succeeds — so retry rather than showing the user an error for
  // something that is only slow. Anything that is not a gateway error (a 4xx, a
  // real 500) is reported the first time, because retrying will not change it.
  let res = await fabricFetch(`${SANDBOX_BASE}/fabric/sandbox/run`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
  for (let attempt = 0; attempt < 2 && COLD_START_STATUS.has(res.status); attempt++) {
    res = await fabricFetch(`${SANDBOX_BASE}/fabric/sandbox/run`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    })
  }
  if (!res.ok) return detail(res, 'sandbox run')
  return res.json()
}
