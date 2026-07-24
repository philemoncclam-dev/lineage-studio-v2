// OneLake Delta-log schema reader: column-level schema for Lakehouse tables
// WITHOUT tenant-admin rights.
//
// Every managed Lakehouse table is a Delta table stored in OneLake, and
// OneLake exposes the workspace's files over the ADLS Gen2 REST surface
// (https://onelake.dfs.fabric.microsoft.com — see "OneLake access and APIs"
// on Microsoft Learn). A Delta table's schema lives in its transaction log:
// the `metaData` action of a commit file (`_delta_log/<20-digit>.json`)
// carries `schemaString`, a JSON struct of {name, type, nullable} fields.
// The newest commit containing a metaData action holds the current schema.
//
// So, per table:
//   1. LIST  {root}/{workspaceId}?resource=filesystem&recursive=false
//            &directory={itemId}/Tables/{tableName}/_delta_log
//      (ADLS Gen2 "Filesystem – List Paths") -> { paths: [{ name }, ...] }
//   2. READ the commit JSON files newest-first (capped) until a line with a
//      `metaData.schemaString` action is found; commit 0 always has one, so
//      the cap only limits how far back we look before jumping to commit 0.
//
// Auth: OneLake accepts Microsoft Entra tokens with the *Azure Storage*
// audience (scope https://storage.azure.com/user_impersonation) — a Fabric
// API token (audience api.fabric.microsoft.com) is NOT valid here. See
// getOneLakeToken() in fabricAuth.ts.

export const ONELAKE_DFS_ROOT = "https://onelake.dfs.fabric.microsoft.com";

export interface DeltaColumn {
  name: string;
  // Delta primitive type name ("string", "long", ...); complex types
  // (struct/array/map) are serialized to their JSON form.
  dataType: string;
  nullable?: boolean;
}

export interface OneLakeDeps {
  fetchImpl: typeof fetch;
}
export const realOneLakeDeps: OneLakeDeps = {
  fetchImpl: (...args) => fetch(...args),
};

interface ListPathsResponse {
  paths?: { name: string; contentLength?: string | number }[];
}

interface DeltaSchemaField {
  name: string;
  type: unknown;
  nullable?: boolean;
}

// How many commit files to scan (newest-first) before falling back to
// commit 0. Schema changes are rare, so this is almost never exhausted.
const MAX_COMMITS_SCANNED = 15;

async function oneLakeFetch(deps: OneLakeDeps, url: string, token: string): Promise<Response> {
  const res = await deps.fetchImpl(url, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!res.ok) {
    if (res.status === 401 || res.status === 403) {
      throw new Error(
        `OneLake auth failed (${res.status}). The token must carry the Azure Storage audience (https://storage.azure.com) — a Fabric API token won't work here.`
      );
    }
    throw new Error(`OneLake request to ${url} failed (${res.status})`);
  }
  return res;
}

// A table discovered by walking OneLake's Tables/ folder. `schema` is set for
// schema-enabled Lakehouses (Tables/<schema>/<table>), empty for the classic
// flat layout (Tables/<table>).
export interface OneLakeTable {
  name: string;
  schema?: string;
}

interface DfsPath {
  name: string; // filesystem-relative, e.g. "<itemId>/Tables/dbo/orders"
  isDirectory?: string | boolean;
}

const lastSegment = (p: string) => p.split("/").filter(Boolean).pop() ?? p;
const isDir = (p: DfsPath) => p.isDirectory === true || p.isDirectory === "true";

// List the immediate children of a OneLake directory (ADLS Gen2 List Paths,
// non-recursive). Returns [] when the directory doesn't exist.
async function listPaths(
  deps: OneLakeDeps,
  workspaceId: string,
  directory: string,
  token: string
): Promise<DfsPath[]> {
  const url = `${ONELAKE_DFS_ROOT}/${workspaceId}?resource=filesystem&recursive=false&directory=${encodeURIComponent(directory)}`;
  const res = await oneLakeFetch(deps, url, token);
  const body = (await res.json()) as { paths?: DfsPath[] };
  return body.paths ?? [];
}

/**
 * Discover a Lakehouse's tables by walking its OneLake Tables/ folder — the
 * fallback for schema-enabled Lakehouses, which Fabric's List Tables REST API
 * doesn't support. Handles both layouts: a first-level directory that itself
 * contains a `_delta_log` is a (flat) table; otherwise it's a schema folder
 * whose child directories are the tables.
 */
export async function listOneLakeTables(
  deps: OneLakeDeps,
  workspaceId: string,
  itemId: string,
  token: string
): Promise<OneLakeTable[]> {
  const tablesDir = `${itemId}/Tables`;
  let firstLevel: DfsPath[];
  try {
    firstLevel = await listPaths(deps, workspaceId, tablesDir, token);
  } catch {
    return [];
  }
  const out: OneLakeTable[] = [];
  for (const entry of firstLevel) {
    if (!isDir(entry)) continue;
    const name = lastSegment(entry.name);
    if (name === "_delta_log") continue;
    let children: DfsPath[];
    try {
      children = await listPaths(deps, workspaceId, `${tablesDir}/${name}`, token);
    } catch {
      continue;
    }
    const hasDeltaLog = children.some((c) => lastSegment(c.name) === "_delta_log");
    if (hasDeltaLog) {
      out.push({ name }); // flat table directly under Tables/
    } else {
      // Schema directory: its child directories are the tables.
      for (const c of children) {
        if (!isDir(c)) continue;
        const t = lastSegment(c.name);
        if (t === "_delta_log") continue;
        out.push({ name: t, schema: name });
      }
    }
  }
  return out;
}

/**
 * Read a single file's text from OneLake by workspace-relative path (e.g.
 * "<itemId>/Files/lineage/result.json"). Used by the Phase 2 runtime path to
 * fetch the lineage JSON the helper notebook writes back. Throws on auth/network
 * errors; the caller decides how to parse the body.
 */
export async function readOneLakeFile(
  deps: OneLakeDeps,
  workspaceId: string,
  path: string,
  token: string
): Promise<string> {
  const url = `${ONELAKE_DFS_ROOT}/${workspaceId}/${path.split("/").map(encodeURIComponent).join("/")}`;
  const res = await oneLakeFetch(deps, url, token);
  return res.text();
}

function parseSchemaString(schemaString: string): DeltaColumn[] {
  const schema = JSON.parse(schemaString) as { fields?: DeltaSchemaField[] };
  return (schema.fields ?? []).map((f) => ({
    name: f.name,
    dataType: typeof f.type === "string" ? f.type : JSON.stringify(f.type),
    nullable: f.nullable,
  }));
}

// Scan one commit file's NDJSON actions for a metaData.schemaString.
function schemaFromCommitText(text: string): DeltaColumn[] | null {
  for (const line of text.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    try {
      const action = JSON.parse(trimmed) as {
        metaData?: { schemaString?: string };
      };
      if (action.metaData?.schemaString) {
        return parseSchemaString(action.metaData.schemaString);
      }
    } catch {
      // skip malformed lines — forgiving by design
    }
  }
  return null;
}

/**
 * Read the current column schema of one Lakehouse Delta table from its
 * OneLake transaction log. Throws on auth/network errors; returns [] when the
 * table has no discoverable commit files (e.g. a non-Delta external table).
 */
export async function fetchDeltaTableSchema(
  deps: OneLakeDeps,
  workspaceId: string,
  itemId: string,
  tableName: string,
  token: string,
  // Schema folder for schema-enabled Lakehouses (Tables/<schema>/<table>).
  schema?: string
): Promise<DeltaColumn[]> {
  const tablePath = schema
    ? `${encodeURIComponent(schema)}/${encodeURIComponent(tableName)}`
    : encodeURIComponent(tableName);
  const dir = `${itemId}/Tables/${tablePath}/_delta_log`;
  const listUrl = `${ONELAKE_DFS_ROOT}/${workspaceId}?resource=filesystem&recursive=false&directory=${encodeURIComponent(dir)}`;
  const listRes = await oneLakeFetch(deps, listUrl, token);
  const listing = (await listRes.json()) as ListPathsResponse;

  // Commit files are 20-digit zero-padded versions; newest = current state.
  const commits = (listing.paths ?? [])
    .map((p) => p.name)
    .filter((n) => /\/\d{20}\.json$/.test(n))
    .sort()
    .reverse();
  if (commits.length === 0) return [];

  const tryRead = async (path: string): Promise<DeltaColumn[] | null> => {
    const res = await oneLakeFetch(deps, `${ONELAKE_DFS_ROOT}/${workspaceId}/${path}`, token);
    return schemaFromCommitText(await res.text());
  };

  for (const path of commits.slice(0, MAX_COMMITS_SCANNED)) {
    const cols = await tryRead(path);
    if (cols) return cols;
  }
  // Fallback: commit 0 always carries the initial metaData action.
  const oldest = commits[commits.length - 1];
  if (!commits.slice(0, MAX_COMMITS_SCANNED).includes(oldest)) {
    const cols = await tryRead(oldest);
    if (cols) return cols;
  }
  return [];
}
