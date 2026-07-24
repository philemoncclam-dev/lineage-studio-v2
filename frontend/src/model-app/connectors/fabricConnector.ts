// Microsoft Fabric connector: introspects a Fabric workspace over the REST API
// (user-supplied Azure AD bearer token — no OAuth flow is implemented here,
// same UX as the dbt connector's file/token input) and maps it into the app's
// Layer > Object > Group > Attribute hierarchy.
//
// APIs used:
//   1. GET /v1/workspaces/{workspaceId}/items
//      Lists every item in the workspace (Lakehouse, Warehouse, SemanticModel,
//      Notebook, etc). We keep Lakehouse/Warehouse/SemanticModel and ignore the
//      rest (compute artifacts with no tabular schema to surface as lineage).
//   2. GET /v1/workspaces/{workspaceId}/lakehouses/{itemId}/tables
//      Lists tables in a Lakehouse (name/type/format/location only — this API
//      does not return column schema). Used for Lakehouse items; Warehouse
//      items use the same shape of table list via the analogous endpoint but
//      Fabric doesn't currently expose a public per-warehouse "list tables"
//      REST call, so Warehouse column detail — like Lakehouse column detail —
//      falls back to whatever the semantic model's TMSL exposes for it (see
//      below). This is the "known limitation" flagged in the report.
//   3. POST /v1/workspaces/{workspaceId}/semanticModels/{itemId}/getDefinition
//      (format=TMSL) Returns the model.bim-style TMSL document: tables,
//      columns (with dataType), and each column's sourceColumn/source table —
//      which is the one place the Fabric REST surface exposes cross-item
//      lineage (semantic model table/column -> the lakehouse/warehouse table
//      it was sourced from). We use this for both column detail on semantic
//      models AND to synthesize lineage edges back to matching lakehouse/
//      warehouse tables (matched by table + column name, the same
//      best-effort name-matching strategy the dbt connector uses for
//      depends_on).
//
// Column detail for Lakehouse tables comes from two optional enrichments:
//   - OneLake Delta-log reading (oneLake.ts): no admin needed, reads each
//     table's _delta_log over the ADLS Gen2 surface with a storage-audience
//     user token. Enabled via options.oneLakeSchema (MSAL sign-in required).
//   - The Admin "Scanner API" (fabricScanner.ts): tenant-admin-scoped
//     scan/poll workflow behind the opt-in deep-scan toggle; still the only
//     source of Warehouse tables/columns.
import type {
  ApiTokenCredentials,
  Connector,
  ConnectorEdge,
  ConnectorNode,
  ConnectorParseResult,
} from "./types";
import {
  flattenScannedTables,
  runWorkspaceScan,
  ScanFailedError,
  ScanTimeoutError,
  realScannerDeps,
  type ScannerDeps,
} from "./fabricScanner";
import { isFabricMockMode, refreshFabricToken, getOneLakeTokenSilent } from "./fabricAuth";
import { mockFetch, mockSleep } from "./mockFabric";
import {
  fetchDeltaTableSchema,
  listOneLakeTables,
  realOneLakeDeps,
  type OneLakeDeps,
} from "./oneLake";
import {
  buildNotebookLineage,
  notebookCodeFromParts,
  type NotebookInput,
} from "./notebookLineage";

const API_ROOT = "https://api.fabric.microsoft.com/v1";

// ── REST response shapes (typed from the official API docs) ────────────────
export interface FabricItem {
  id: string;
  displayName: string;
  description?: string;
  type: string; // "Lakehouse" | "Warehouse" | "SemanticModel" | ... (open enum)
  workspaceId: string;
  folderId?: string;
}
interface FabricItemsResponse {
  value: FabricItem[];
  continuationToken?: string;
  continuationUri?: string;
}

interface FabricTable {
  type?: string; // "Managed" | "External"
  name: string;
  location?: string;
  format?: string;
}
interface FabricTablesResponse {
  data: FabricTable[];
  continuationToken?: string;
  continuationUri?: string;
}

// TMSL (model.bim-shaped) semantic model definition.
interface TmslColumn {
  name: string;
  dataType?: string;
  sourceColumn?: string;
  formatString?: string;
  isHidden?: boolean;
}
interface TmslPartitionSource {
  type?: string;
  expression?: string | string[];
  // Structured lineage some connectors emit: { schema, table } / entityName.
  entityName?: string;
  schemaName?: string;
}
interface TmslPartition {
  name?: string;
  source?: TmslPartitionSource;
}
interface TmslTable {
  name: string;
  columns?: TmslColumn[];
  partitions?: TmslPartition[];
}
interface TmslModel {
  tables?: TmslTable[];
}
interface TmslDocument {
  model?: TmslModel;
}
interface FabricDefinitionPart {
  path: string;
  payload: string; // base64
  payloadType?: string;
}
interface FabricDefinitionResponse {
  definition?: { parts?: FabricDefinitionPart[] };
}

const WANTED_ITEM_TYPES = new Set(["Lakehouse", "Warehouse", "SemanticModel"]);

async function fabricFetch<T>(url: string, token: string, init?: RequestInit): Promise<T> {
  const fetchImpl = isFabricMockMode() ? mockFetch : fetch;
  const res = await fetchImpl(url, {
    ...init,
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
      ...(init?.headers ?? {}),
    },
  });
  if (!res.ok) {
    let detail = "";
    try {
      const body = await res.json();
      detail = body?.message ? `: ${body.message}` : "";
    } catch {
      // ignore — not JSON
    }
    if (res.status === 401 || res.status === 403) {
      throw new Error(
        `Fabric API auth failed (${res.status})${detail}. Check the bearer token has Workspace.Read.All / Lakehouse.Read.All scope and hasn't expired.`
      );
    }
    throw new Error(`Fabric API request to ${url} failed (${res.status})${detail}`);
  }
  return res.json() as Promise<T>;
}

// Workspaces the signed-in user can access (GET /v1/workspaces) — used by the
// Sync dialog to offer a picker instead of a raw workspace-id input.
export interface FabricWorkspace {
  id: string;
  displayName: string;
  description?: string;
}
interface FabricWorkspacesResponse {
  value: FabricWorkspace[];
  continuationToken?: string;
}

export async function listFabricWorkspaces(token: string): Promise<FabricWorkspace[]> {
  const workspaces: FabricWorkspace[] = [];
  let url = `${API_ROOT}/workspaces`;
  for (;;) {
    const page = await fabricFetch<FabricWorkspacesResponse>(url, token);
    workspaces.push(...page.value);
    if (!page.continuationToken) break;
    url = `${API_ROOT}/workspaces?continuationToken=${encodeURIComponent(page.continuationToken)}`;
  }
  return workspaces.sort((a, b) => a.displayName.localeCompare(b.displayName));
}

async function listItems(workspaceId: string, token: string): Promise<FabricItem[]> {
  const items: FabricItem[] = [];
  let url = `${API_ROOT}/workspaces/${workspaceId}/items`;
  for (;;) {
    const page = await fabricFetch<FabricItemsResponse>(url, token);
    items.push(...page.value);
    if (!page.continuationToken) break;
    url = `${API_ROOT}/workspaces/${workspaceId}/items?continuationToken=${encodeURIComponent(
      page.continuationToken
    )}`;
  }
  return items.filter((i) => WANTED_ITEM_TYPES.has(i.type));
}

// List every item of one type in a workspace, following continuation pages.
async function listItemsOfType(
  workspaceId: string,
  token: string,
  itemType: string
): Promise<FabricItem[]> {
  const items: FabricItem[] = [];
  let url = `${API_ROOT}/workspaces/${workspaceId}/items?type=${itemType}`;
  for (;;) {
    const page = await fabricFetch<FabricItemsResponse>(url, token);
    items.push(...page.value);
    if (!page.continuationToken) break;
    url = `${API_ROOT}/workspaces/${workspaceId}/items?type=${itemType}&continuationToken=${encodeURIComponent(
      page.continuationToken
    )}`;
  }
  return items;
}

// Notebooks are excluded from WANTED_ITEM_TYPES (no tabular schema of their
// own), so they're listed separately via the API's ?type filter when the
// notebook-transformations option is on.
function listNotebookItems(workspaceId: string, token: string): Promise<FabricItem[]> {
  return listItemsOfType(workspaceId, token, "Notebook");
}

// Public wrappers used by the runtime notebook-lineage UI (Step 3): the
// notebooks to analyze and the Lakehouses that can host the extraction output.
export function listWorkspaceNotebooks(workspaceId: string, token: string): Promise<FabricItem[]> {
  return listItemsOfType(workspaceId, token, "Notebook");
}
export function listWorkspaceLakehouses(workspaceId: string, token: string): Promise<FabricItem[]> {
  return listItemsOfType(workspaceId, token, "Lakehouse");
}

// Fetch a notebook's source code via getDefinition (ipynb format) and decode it
// to a single code string for static read/write extraction.
async function getNotebookCode(
  workspaceId: string,
  itemId: string,
  token: string
): Promise<string> {
  const parts = await getDefinitionParts(workspaceId, "notebooks", itemId, token, "ipynb");
  return notebookCodeFromParts(parts);
}

const sleepMs = (ms: number) => new Promise((r) => setTimeout(r, ms));

// Raw fetch (returns the Response, unlike fabricFetch which parses/throws) so
// the long-running-operation path can inspect status + the Location header.
function fabricFetchRaw(url: string, token: string, init?: RequestInit): Promise<Response> {
  const fetchImpl = isFabricMockMode() ? mockFetch : fetch;
  return fetchImpl(url, {
    ...init,
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
      ...(init?.headers ?? {}),
    },
  });
}

interface OperationState {
  status?: string; // Succeeded | Failed | Running | NotStarted
  error?: { message?: string };
}

// getDefinition on Fabric items is a Long Running Operation: it can return the
// definition inline (200) OR a 202 with an operation Location to poll. The
// original code assumed 200-inline, so against a real tenant the 202 case made
// res.json() fail and the caller silently dropped every notebook. This handles
// both: inline when 200, poll-then-fetch-result when 202.
export async function getDefinitionParts(
  workspaceId: string,
  pathSegment: "notebooks" | "semanticModels",
  itemId: string,
  token: string,
  format: string
): Promise<FabricDefinitionPart[]> {
  const url = `${API_ROOT}/workspaces/${workspaceId}/${pathSegment}/${itemId}/getDefinition?format=${format}`;
  const res = await fabricFetchRaw(url, token, { method: "POST" });

  let body: FabricDefinitionResponse;
  if (res.status === 202) {
    const operationUrl = res.headers.get("Location");
    if (!operationUrl) throw new Error("Fabric getDefinition returned 202 without an operation Location.");
    body = await pollDefinition(operationUrl, token);
  } else if (res.ok) {
    body = (await res.json()) as FabricDefinitionResponse;
  } else {
    let detail = "";
    try {
      const b = await res.json();
      detail = b?.message ? `: ${b.message}` : "";
    } catch {
      // not JSON
    }
    throw new Error(`Fabric getDefinition failed (${res.status})${detail}`);
  }
  return body.definition?.parts ?? [];
}

async function pollDefinition(operationUrl: string, token: string): Promise<FabricDefinitionResponse> {
  const maxAttempts = 30;
  for (let i = 0; i < maxAttempts; i++) {
    const res = await fabricFetchRaw(operationUrl, token);
    if (!res.ok) throw new Error(`Fabric getDefinition operation poll failed (${res.status}).`);
    const op = (await res.json()) as OperationState;
    if (op.status === "Succeeded") {
      const resultRes = await fabricFetchRaw(`${operationUrl}/result`, token);
      if (!resultRes.ok) throw new Error(`Fabric getDefinition result fetch failed (${resultRes.status}).`);
      return (await resultRes.json()) as FabricDefinitionResponse;
    }
    if (op.status === "Failed") {
      throw new Error(`Fabric getDefinition operation failed${op.error?.message ? `: ${op.error.message}` : ""}.`);
    }
    await sleepMs(isFabricMockMode() ? 0 : 1500);
  }
  throw new Error("Timed out waiting for the Fabric getDefinition operation.");
}

async function listLakehouseTables(
  workspaceId: string,
  lakehouseId: string,
  token: string
): Promise<FabricTable[]> {
  const tables: FabricTable[] = [];
  let url = `${API_ROOT}/workspaces/${workspaceId}/lakehouses/${lakehouseId}/tables`;
  for (;;) {
    const page = await fabricFetch<FabricTablesResponse>(url, token);
    tables.push(...page.data);
    if (!page.continuationToken) break;
    url = `${API_ROOT}/workspaces/${workspaceId}/lakehouses/${lakehouseId}/tables?continuationToken=${encodeURIComponent(
      page.continuationToken
    )}`;
  }
  return tables;
}

function decodeBase64Json<T>(payload: string): T | null {
  try {
    // atob is available in browsers; Node's Buffer as a fallback for tests.
    const decoded =
      typeof atob === "function"
        ? atob(payload)
        : Buffer.from(payload, "base64").toString("utf-8");
    return JSON.parse(decoded) as T;
  } catch {
    return null;
  }
}

async function getSemanticModelTmsl(
  workspaceId: string,
  itemId: string,
  token: string
): Promise<TmslTable[]> {
  const parts = await getDefinitionParts(workspaceId, "semanticModels", itemId, token, "TMSL");
  const part = parts.find(
    (p) => p.path.endsWith("model.bim") || p.path.endsWith(".tmsl.json")
  );
  if (!part) return [];
  const doc = decodeBase64Json<TmslDocument>(part.payload);
  return doc?.model?.tables ?? [];
}

const layerIdFor = (type: string) => `fabric:layer:${type}`;
const layerName = (type: string) =>
  type === "SemanticModel" ? "Fabric: Semantic Models" : `Fabric: ${type}s`;

// Options read out of ApiTokenCredentials.options for this connector. Kept
// local (not part of the shared connector types) since it's Fabric-specific.
export interface FabricDeepScanOptions {
  // UI toggle: "Deep scan (requires admin permissions)". When true, run the
  // Admin Scanner API after the basic sync to enrich Lakehouse/Warehouse
  // tables with real column schema (+ any lineage the scan exposes).
  deepScan?: boolean;
  // Test-only hook to inject a fake fetch/sleep so scan polling never
  // actually waits in unit tests. Defaults to the real implementation.
  scannerDeps?: ScannerDeps;
  // Read Lakehouse column schema from OneLake Delta logs (no admin needed —
  // see oneLake.ts). Requires an MSAL session (storage-audience token), so
  // the UI enables it only when signed in via Microsoft or in mock mode.
  oneLakeSchema?: boolean;
  // Include notebooks as a "Transformations" layer: statically parse each
  // notebook's read/write tables and wire lineage edges through it (see
  // notebookLineage.ts). Read-only — uses the same getDefinition scope.
  notebooks?: boolean;
  // Test-only hook to inject a fake fetch for the OneLake DFS calls.
  oneLakeDeps?: OneLakeDeps;
  // Set by the UI when `token` was obtained via getFabricToken() (MSAL),
  // rather than pasted manually. Enables the 401-retry path below: on an
  // auth failure we attempt exactly one silent-refresh + retry (via
  // refreshFabricToken()) before surfacing an error telling the user to sign
  // in again. Manually-pasted tokens can't be refreshed, so this is a no-op
  // (falls straight through to the error) when unset.
  msalSignedIn?: boolean;
}

function isAuthError(err: unknown): boolean {
  return err instanceof Error && /\((401|403)\)/.test(err.message);
}

async function parseFromApiOnce({
  workspaceId,
  token,
  options,
}: ApiTokenCredentials): Promise<ConnectorParseResult> {
  if (!workspaceId.trim()) throw new Error("Workspace ID is required.");
  if (!token.trim()) throw new Error("Bearer token is required.");

  const items = await listItems(workspaceId, token);
  if (items.length === 0) {
    throw new Error(
      "No Lakehouse, Warehouse, or SemanticModel items found in this workspace (or the token lacks access)."
    );
  }

  const fabricOptions = options as FabricDeepScanOptions | undefined;

  // OneLake Delta-log schema enrichment (no admin needed): one storage-audience
  // token shared across every lakehouse table, acquired lazily on first use.
  // A null sentinel records that acquisition failed so we don't retry per table.
  let oneLakeToken: string | null | undefined;
  const getOneLakeTokenOnce = async (): Promise<string | null> => {
    if (oneLakeToken !== undefined) return oneLakeToken;
    // Silent-only: never open an interactive popup mid-sync (a Preview must not
    // spawn a login window). null → OneLake reads are skipped best-effort.
    oneLakeToken = await getOneLakeTokenSilent();
    return oneLakeToken;
  };
  const oneLakeDeps: OneLakeDeps =
    fabricOptions?.oneLakeDeps ??
    (isFabricMockMode() ? { fetchImpl: mockFetch } : realOneLakeDeps);

  const out: ConnectorNode[] = [];
  const seenLayers = new Set<string>();
  // table/column name -> externalId, scoped by item, for name-based lineage
  // matching against semantic model sourceColumn references.
  const attrIdByItemTable = new Map<string, Map<string, string>>(); // itemId -> table -> group externalId
  const attrIdByTableCol = new Map<string, string>(); // "itemId::table::col" -> attribute externalId

  for (const item of items) {
    const layerId = layerIdFor(item.type);
    if (!seenLayers.has(layerId)) {
      seenLayers.add(layerId);
      out.push({
        externalId: layerId,
        parentExternalId: null,
        type: "Layer",
        name: layerName(item.type),
      });
    }

    out.push({
      externalId: item.id,
      parentExternalId: layerId,
      type: "Object",
      name: item.displayName,
      metadata: {
        itemType: item.type,
        workspaceId: item.workspaceId,
        folderId: item.folderId,
      },
      seedDescription: item.description || undefined,
    });

    if (item.type === "Lakehouse") {
      // Each entry: display name, optional schema (schema-enabled lakehouses),
      // and any REST-only metadata. The REST "list tables" API is tried first;
      // if it returns nothing (e.g. a schema-enabled Lakehouse, which that API
      // doesn't support) we fall back to walking the OneLake Tables/ folder.
      interface LakeTable {
        name: string;
        schema?: string;
        tableType?: string;
        format?: string;
        location?: string;
      }
      let tables: LakeTable[] = [];
      let tablesError: string | null = null;
      try {
        tables = (await listLakehouseTables(workspaceId, item.id, token)).map((t) => ({
          name: t.name,
          tableType: t.type,
          format: t.format,
          location: t.location,
        }));
      } catch (err) {
        tablesError = err instanceof Error ? err.message : String(err);
      }

      // Fallback: discover tables over OneLake when the REST API returned none
      // (schema-enabled Lakehouses) or errored. Needs the storage-audience token.
      if (tables.length === 0 && fabricOptions?.oneLakeSchema) {
        const olToken = await getOneLakeTokenOnce();
        if (olToken) {
          try {
            tables = (await listOneLakeTables(oneLakeDeps, workspaceId, item.id, olToken)).map(
              (t) => ({ name: t.name, schema: t.schema })
            );
            if (tables.length > 0) tablesError = null;
          } catch {
            // keep whatever REST error we had
          }
        }
      }

      const tableMap = new Map<string, string>();
      attrIdByItemTable.set(item.id, tableMap);

      if (tables.length === 0 && tablesError) {
        out.push({
          externalId: `${item.id}::error`,
          parentExternalId: item.id,
          type: "Group",
          name: "(tables unavailable)",
          metadata: { error: tablesError },
        });
        continue;
      }

      for (const table of tables) {
        // Schema-qualify the external id + display when a schema is present, but
        // key the name map on the bare table name so notebook references (which
        // are usually unqualified) still match.
        const display = table.schema ? `${table.schema}.${table.name}` : table.name;
        const groupExtId = `${item.id}::${display}`;
        tableMap.set(table.name, groupExtId);
        out.push({
          externalId: groupExtId,
          parentExternalId: item.id,
          type: "Group",
          name: display,
          metadata: {
            schema: table.schema,
            tableType: table.tableType,
            format: table.format,
            location: table.location,
          },
        });
        // Lakehouse "list tables" doesn't return column schema, but the
        // table's Delta transaction log in OneLake does — readable with an
        // ordinary user token (storage audience). Best-effort per table:
        // a failure just leaves the table column-less, like before.
        if (fabricOptions?.oneLakeSchema) {
          const olToken = await getOneLakeTokenOnce();
          if (olToken) {
            try {
              const cols = await fetchDeltaTableSchema(
                oneLakeDeps,
                workspaceId,
                item.id,
                table.name,
                olToken,
                table.schema
              );
              for (const col of cols) {
                const attrExtId = `${groupExtId}::${col.name}`;
                out.push({
                  externalId: attrExtId,
                  parentExternalId: groupExtId,
                  type: "Attribute",
                  name: col.name,
                  metadata: {
                    dataType: col.dataType,
                    nullable: col.nullable,
                    source: "onelake-delta",
                  },
                });
                attrIdByTableCol.set(`${item.id}::${table.name}::${col.name}`, attrExtId);
              }
            } catch {
              // Non-Delta/external table, or OneLake unreachable — skip quietly.
            }
          }
        }
      }
    }

    if (item.type === "Warehouse") {
      // No public per-warehouse "list tables" REST endpoint today; the item
      // is still synced as an Object so it's visible and linkable, but its
      // tables only materialize if a semantic model references them (below),
      // or — when deep scan is enabled — from the Admin Scanner API result.
      // Register an (empty for now) table map so the scan-enrichment step
      // below can add Groups directly under this Warehouse Object.
      attrIdByItemTable.set(item.id, new Map());
    }

    if (item.type === "SemanticModel") {
      let tmslTables: TmslTable[] = [];
      try {
        tmslTables = await getSemanticModelTmsl(workspaceId, item.id, token);
      } catch (err) {
        out.push({
          externalId: `${item.id}::error`,
          parentExternalId: item.id,
          type: "Group",
          name: "(definition unavailable)",
          metadata: { error: err instanceof Error ? err.message : String(err) },
        });
        continue;
      }
      for (const table of tmslTables) {
        const groupExtId = `${item.id}::${table.name}`;
        out.push({
          externalId: groupExtId,
          parentExternalId: item.id,
          type: "Group",
          name: table.name,
        });
        for (const col of table.columns ?? []) {
          if (col.isHidden) continue;
          const attrExtId = `${groupExtId}::${col.name}`;
          out.push({
            externalId: attrExtId,
            parentExternalId: groupExtId,
            type: "Attribute",
            name: col.name,
            metadata: { dataType: col.dataType, sourceColumn: col.sourceColumn },
          });
          attrIdByTableCol.set(`${item.id}::${table.name}::${col.name}`, attrExtId);
        }
      }
    }
  }

  // ── Lineage edges ─────────────────────────────────────────────────────
  // Semantic model tables reference their source table by name via each
  // partition's `source.entityName` (or the table name itself when it's a
  // pass-through). We connect a semantic model column to the same-named
  // lakehouse table's Group (attribute-level detail isn't available for
  // lakehouse columns via this API set — see header), or to the matching
  // attribute when the source happens to be another semantic model.
  const edges: ConnectorEdge[] = [];
  for (const item of items) {
    if (item.type !== "SemanticModel") continue;
    let tmslTables: TmslTable[];
    try {
      tmslTables = await getSemanticModelTmsl(workspaceId, item.id, token);
    } catch {
      continue;
    }
    for (const table of tmslTables) {
      const sourceEntity = table.partitions?.[0]?.source?.entityName ?? table.name;
      // Look across every Lakehouse's known tables for a name match.
      for (const [lakehouseId, tableMap] of attrIdByItemTable) {
        const groupExtId = tableMap.get(sourceEntity);
        if (!groupExtId) continue;
        for (const col of table.columns ?? []) {
          const targetAttrId = attrIdByTableCol.get(`${item.id}::${table.name}::${col.name}`);
          if (!targetAttrId) continue;
          // Prefer a column-level edge when the lakehouse side has real
          // attributes (OneLake Delta-log or deep-scan enrichment) and the
          // TMSL column names its sourceColumn; otherwise fall back to the
          // lakehouse table's Group as the source stand-in.
          const sourceAttrId = col.sourceColumn
            ? attrIdByTableCol.get(`${lakehouseId}::${sourceEntity}::${col.sourceColumn}`)
            : undefined;
          edges.push({
            sourceExternalId: sourceAttrId ?? groupExtId,
            targetExternalId: targetAttrId,
          });
        }
      }
    }
  }

  // ── Deep scan enrichment (Admin Scanner API) ────────────────────────────
  // Opt-in, additive: pulls real column-level schema for Lakehouse/Warehouse
  // tables via the tenant-admin-scoped getInfo/scanStatus/scanResult flow
  // (see fabricScanner.ts). If it's disabled, fails, or times out, the
  // basic-API result above is returned unchanged — this is a pure enhancement.
  if (fabricOptions?.deepScan) {
    try {
      const scannerDeps: ScannerDeps =
        fabricOptions.scannerDeps ??
        (isFabricMockMode()
          ? { fetchImpl: mockFetch, sleep: mockSleep }
          : realScannerDeps);
      const scanResult = await runWorkspaceScan(
        [workspaceId],
        token,
        scannerDeps
      );
      const scannedTables = flattenScannedTables(scanResult);
      for (const scanned of scannedTables) {
        const tableMap = attrIdByItemTable.get(scanned.itemId);
        if (!tableMap) continue; // scan returned an item we didn't sync via the basic API
        let groupExtId = tableMap.get(scanned.tableName);
        if (!groupExtId) {
          // Table only visible via the scan (e.g. a Warehouse table, which the
          // basic API set can't list at all) — create its Group now.
          groupExtId = `${scanned.itemId}::${scanned.tableName}`;
          tableMap.set(scanned.tableName, groupExtId);
          out.push({
            externalId: groupExtId,
            parentExternalId: scanned.itemId,
            type: "Group",
            name: scanned.tableName,
          });
        }
        for (const col of scanned.columns) {
          if (col.isHidden) continue;
          const attrExtId = `${groupExtId}::${col.name}`;
          // Don't clobber an Attribute already added from this same sync pass
          // (avoids duplicate nodes if a table appears in both the basic API
          // and the scan — Groups are matched by name, columns are additive).
          if (out.some((n) => n.externalId === attrExtId)) continue;
          out.push({
            externalId: attrExtId,
            parentExternalId: groupExtId,
            type: "Attribute",
            name: col.name,
            metadata: { dataType: col.dataType, source: "fabric-scanner" },
          });
          attrIdByTableCol.set(`${scanned.itemId}::${scanned.tableName}::${col.name}`, attrExtId);
        }
        // Any lineage hint the scan exposes on the table (upstream entity it
        // was populated from) — best-effort name match against another known
        // table's Group, same convention as the TMSL-derived edges above.
        // *** ASSUMPTION: `table.source.entityName` shape unconfirmed against
        // a live tenant (see fabricScanner.ts header). ***
        const sourceEntity = scanned.source?.entityName;
        if (sourceEntity) {
          for (const tm of attrIdByItemTable.values()) {
            const upstreamGroupExtId = tm.get(sourceEntity);
            if (upstreamGroupExtId && upstreamGroupExtId !== groupExtId) {
              edges.push({ sourceExternalId: upstreamGroupExtId, targetExternalId: groupExtId });
            }
          }
        }
      }
    } catch (err) {
      // Deep scan is best-effort: surface the failure as metadata on the
      // workspace-level Layer rather than throwing, so a slow/failed/
      // unauthorized admin scan never blocks the basic sync from applying.
      const message =
        err instanceof ScanFailedError || err instanceof ScanTimeoutError
          ? err.message
          : err instanceof Error
            ? err.message
            : String(err);
      out.push({
        externalId: "fabric:deepscan::error",
        parentExternalId: null,
        type: "Layer",
        name: "Fabric: Deep scan unavailable",
        metadata: { error: message },
      });
    }
  }

  // ── Notebook transformations (static analysis) ──────────────────────────
  // Opt-in, additive, read-only: list notebooks, pull each one's source via
  // getDefinition, statically extract its read/write tables, and synthesize a
  // Transformations layer wired to the tables above (matched by name) or to
  // staged tables for anything not otherwise known. Best-effort — a failure
  // surfaces as a note Layer rather than aborting the basic sync.
  if (fabricOptions?.notebooks) {
    try {
      const notebookItems = await listNotebookItems(workspaceId, token);
      const notebooks: NotebookInput[] = [];
      let lastCodeError: string | null = null;
      for (const nb of notebookItems) {
        try {
          const code = await getNotebookCode(workspaceId, nb.id, token);
          notebooks.push({ id: nb.id, name: nb.displayName, code });
        } catch (err) {
          // Still include the notebook so it appears in the Transformations
          // layer (just without parsed lineage), and remember why — a silent
          // drop previously made the whole layer vanish with no explanation.
          lastCodeError = err instanceof Error ? err.message : String(err);
          notebooks.push({ id: nb.id, name: nb.displayName, code: "" });
        }
      }
      // Flatten every known table name → its Group externalId for edge matching
      // (includes deep-scan/OneLake-enriched tables added above).
      const knownTableByName = new Map<string, string>();
      for (const tableMap of attrIdByItemTable.values()) {
        for (const [name, groupExtId] of tableMap) {
          knownTableByName.set(name.toLowerCase(), groupExtId);
        }
      }
      const nb = buildNotebookLineage(notebooks, knownTableByName);
      out.push(...nb.nodes);
      edges.push(...nb.edges);
      // If some notebooks couldn't be read, surface it as a note rather than
      // leaving the user wondering why a notebook has no lineage.
      if (lastCodeError) {
        out.push({
          externalId: "fabric:notebooks::readwarning",
          parentExternalId: null,
          type: "Layer",
          name: "Fabric: Some notebooks couldn't be read",
          metadata: { error: lastCodeError },
        });
      }
    } catch (err) {
      out.push({
        externalId: "fabric:notebooks::error",
        parentExternalId: null,
        type: "Layer",
        name: "Fabric: Notebooks unavailable",
        metadata: { error: err instanceof Error ? err.message : String(err) },
      });
    }
  }

  return { nodes: out, edges };
}

// Token-expiry UX: if signed in via MSAL and the sync fails with a 401/403,
// attempt one silent refresh + retry before surfacing the error. Manually
// pasted tokens (msalSignedIn unset) just get the original error — there's
// nothing to refresh.
async function parseFromApi(creds: ApiTokenCredentials): Promise<ConnectorParseResult> {
  const deepScanOptions = creds.options as FabricDeepScanOptions | undefined;
  try {
    return await parseFromApiOnce(creds);
  } catch (err) {
    if (!deepScanOptions?.msalSignedIn || !isAuthError(err)) throw err;
    const freshToken = await refreshFabricToken();
    return parseFromApiOnce({ ...creds, token: freshToken });
  }
}

// The file-based `parse` is unused for this connector (authMode: "token"), but
// the Connector interface requires it — keep it explicit and clearly an error
// rather than silently accepting a File.
async function parse(): Promise<ConnectorParseResult> {
  throw new Error(
    "The Fabric connector is token-based — use parseFromApi with a workspace id and bearer token, not a file upload."
  );
}

export const fabricConnector: Connector = {
  id: "fabric",
  label: "Microsoft Fabric (workspace)",
  fileHint: "",
  authMode: "token",
  parse,
  parseFromApi,
};
