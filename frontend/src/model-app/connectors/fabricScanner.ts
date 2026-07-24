// Microsoft Fabric / Power BI Admin "Scanner API" client.
//
// This is the ENHANCEMENT path referenced from fabricConnector.ts's file
// header: the basic per-workspace REST APIs (items/tables/getDefinition) never
// expose column schema for Lakehouse/Warehouse tables. The tenant-wide admin
// Scanner API does, at the cost of needing a tenant-admin-scoped token and an
// async, rate-limited scan/poll/fetch workflow. It is opt-in (UI toggle) and
// additive: if it fails or times out, the basic-API sync result is untouched.
//
// Workflow (per Microsoft Learn — "Run metadata scanning", and the
// Admin - WorkspaceInfo GetInfo/GetScanStatus/GetScanResult REST reference):
//   1. POST /v1/admin/workspaces/getInfo?datasetSchema=true&datasetExpressions=true&lineage=true
//        body: { workspaces: [workspaceId, ...] }   (max 100 workspace ids per call)
//      -> 202 Accepted, body { id: scanId, createdDateTime, status: "NotStarted" }
//   2. GET /v1/admin/workspaces/scanStatus/{scanId}
//      -> { id, status: "NotStarted" | "Running" | "Succeeded" | "Failed" }
//      Poll until status is "Succeeded" (or "Failed" / we give up after a
//      bounded number of attempts). Docs recommend a 30-60s interval for a
//      real tenant; tests inject a fake clock/sleep so they never actually wait.
//   3. GET /v1/admin/workspaces/scanResult/{scanId}
//      -> { workspaces: [ { id, name, lakehouses?, warehouses?, datasets?, ... } ] }
//      Each lakehouse/warehouse entry carries its tables, each table its
//      columns ({ name, dataType }), mirroring the well-documented `Table`/
//      `Column` shape the same scanner surface already returns for dataset
//      tables (see the GetScanResult reference) — Fabric's Lakehouse/Warehouse
//      admin metadata is a newer, less-documented extension of that same
//      response envelope. *** ASSUMPTION flagged for real-tenant validation:
//      the exact property names `lakehouses`/`warehouses` (vs. e.g. a unified
//      `datamarts` list with a `type` discriminator) are inferred from public
//      docs/samples, not confirmed against a live tenant. The parsing code
//      below is defensive: it accepts either shape. ***
//
// No live Fabric tenant is available in this environment; every shape here is
// derived from the public REST reference. Call out any tenant-specific
// deviation you discover as a follow-up.

const ADMIN_API_ROOT = "https://api.fabric.microsoft.com/v1/admin";

export type ScanStatus = "NotStarted" | "Running" | "Succeeded" | "Failed";

export interface ScannerColumn {
  name: string;
  dataType?: string;
  isHidden?: boolean;
}

export interface ScannerTable {
  name: string;
  columns?: ScannerColumn[];
  // Lineage hint some tenants expose on lakehouse/warehouse tables: the
  // upstream object (e.g. a source table or notebook) it was populated from.
  // *** ASSUMPTION: field name/shape unconfirmed against a live tenant. ***
  source?: { entityName?: string; expression?: string };
}

// A lakehouse/warehouse/dataset entry as returned inside a scanned workspace.
export interface ScannerDataItem {
  id: string; // Fabric item id — matches the id from /v1/workspaces/{ws}/items
  name: string;
  tables?: ScannerTable[];
  schemaRetrievalError?: string;
}

export interface ScannedWorkspace {
  id: string;
  name?: string;
  lakehouses?: ScannerDataItem[];
  warehouses?: ScannerDataItem[];
  // Present in the classic Power BI scan surface; harmless to ignore here.
  datasets?: ScannerDataItem[];
}

export interface ScanResult {
  workspaces: ScannedWorkspace[];
}

interface GetInfoResponse {
  id: string;
  status?: ScanStatus;
}
interface ScanStatusResponse {
  id: string;
  status: ScanStatus;
}

export class ScanFailedError extends Error {}
export class ScanTimeoutError extends Error {}

// Injectable fetch + sleep so polling is fully synchronous/instant in tests.
export interface ScannerDeps {
  fetchImpl: typeof fetch;
  sleep: (ms: number) => Promise<void>;
}

export const realScannerDeps: ScannerDeps = {
  fetchImpl: (...args: Parameters<typeof fetch>) => fetch(...args),
  sleep: (ms: number) => new Promise((resolve) => setTimeout(resolve, ms)),
};

export interface ScanOptions {
  // Bounded backoff: attempt N waits pollIntervalMs (capped at maxIntervalMs),
  // doubling each time, up to maxAttempts total polls before giving up.
  pollIntervalMs?: number;
  maxIntervalMs?: number;
  maxAttempts?: number;
}

const DEFAULT_OPTIONS: Required<ScanOptions> = {
  pollIntervalMs: 1000,
  maxIntervalMs: 30000,
  maxAttempts: 20,
};

async function adminFetch<T>(
  deps: ScannerDeps,
  url: string,
  token: string,
  init?: RequestInit
): Promise<T> {
  const res = await deps.fetchImpl(url, {
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
        `Fabric Admin Scanner API auth failed (${res.status})${detail}. Deep scan requires a tenant-admin-scoped token (Tenant.Read.All).`
      );
    }
    throw new Error(`Fabric Admin Scanner API request to ${url} failed (${res.status})${detail}`);
  }
  return res.json() as Promise<T>;
}

async function initiateScan(
  deps: ScannerDeps,
  workspaceIds: string[],
  token: string
): Promise<string> {
  const url = `${ADMIN_API_ROOT}/workspaces/getInfo?datasetSchema=true&datasetExpressions=true&lineage=true`;
  const res = await adminFetch<GetInfoResponse>(deps, url, token, {
    method: "POST",
    body: JSON.stringify({ workspaces: workspaceIds }),
  });
  if (!res.id) throw new Error("Scanner API getInfo response did not include a scan id.");
  return res.id;
}

async function pollScanStatus(
  deps: ScannerDeps,
  scanId: string,
  token: string,
  options: Required<ScanOptions>
): Promise<void> {
  let interval = options.pollIntervalMs;
  for (let attempt = 0; attempt < options.maxAttempts; attempt++) {
    const res = await adminFetch<ScanStatusResponse>(
      deps,
      `${ADMIN_API_ROOT}/workspaces/scanStatus/${scanId}`,
      token
    );
    if (res.status === "Succeeded") return;
    if (res.status === "Failed") {
      throw new ScanFailedError(`Fabric admin scan ${scanId} failed.`);
    }
    // "NotStarted" | "Running" — keep polling with bounded backoff.
    await deps.sleep(interval);
    interval = Math.min(interval * 2, options.maxIntervalMs);
  }
  throw new ScanTimeoutError(
    `Fabric admin scan ${scanId} did not finish within ${options.maxAttempts} poll attempts.`
  );
}

async function fetchScanResult(
  deps: ScannerDeps,
  scanId: string,
  token: string
): Promise<ScanResult> {
  return adminFetch<ScanResult>(deps, `${ADMIN_API_ROOT}/workspaces/scanResult/${scanId}`, token);
}

// Runs the full initiate -> poll -> fetch workflow for one or more workspaces.
// Throws ScanFailedError / ScanTimeoutError (subclasses of Error) on failure —
// callers decide whether that should abort the sync or just skip enrichment.
export async function runWorkspaceScan(
  workspaceIds: string[],
  token: string,
  deps: ScannerDeps = realScannerDeps,
  options: ScanOptions = {}
): Promise<ScanResult> {
  const opts = { ...DEFAULT_OPTIONS, ...options };
  const scanId = await initiateScan(deps, workspaceIds, token);
  await pollScanStatus(deps, scanId, token, opts);
  return fetchScanResult(deps, scanId, token);
}

// ── Result flattening helpers used by fabricConnector.ts ───────────────────

export interface ScannedTableColumns {
  itemId: string;
  tableName: string;
  columns: ScannerColumn[];
  source?: { entityName?: string; expression?: string };
}

// Flatten every lakehouse/warehouse table across every scanned workspace into
// a simple list, tagged with the Fabric item id it belongs to (so the
// connector can match it back to the Group externalId it already built as
// `${itemId}::${tableName}`).
export function flattenScannedTables(result: ScanResult): ScannedTableColumns[] {
  const out: ScannedTableColumns[] = [];
  for (const ws of result.workspaces ?? []) {
    const groups: (ScannerDataItem[] | undefined)[] = [ws.lakehouses, ws.warehouses];
    for (const items of groups) {
      for (const item of items ?? []) {
        for (const table of item.tables ?? []) {
          out.push({
            itemId: item.id,
            tableName: table.name,
            columns: table.columns ?? [],
            source: table.source,
          });
        }
      }
    }
  }
  return out;
}
