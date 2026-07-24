// Phase 2 runtime client: create + run a helper notebook in a Fabric workspace
// and wait for it to finish. This is the plumbing the runtime lineage path needs
// on top of the read-only client in fabricConnector.ts; it is deliberately kept
// separate because it requires the write/execute scopes (getFabricWriteToken)
// and, unlike everything else in this connector, MUTATES the target workspace.
//
// APIs (Microsoft Fabric REST):
//   - Create item:  POST /v1/workspaces/{ws}/notebooks   (Items - Create)
//       Returns 201 with the item body, or 202 + an operation Location for the
//       long-running case; we handle both.
//   - Run on demand: POST /v1/workspaces/{ws}/items/{id}/jobs/instances
//       ?jobType=RunNotebook  → 202 + a Location header pointing at the job
//       instance; the instance id is parsed from it.
//   - Poll instance: GET  /v1/workspaces/{ws}/items/{id}/jobs/instances/{jobId}
//       → { status: NotStarted | InProgress | Completed | Failed | Cancelled }.
//
// Result retrieval is NOT here: the run-job API returns status only, so the
// helper notebook writes its lineage to OneLake and the caller reads it back via
// readOneLakeFile (oneLake.ts). See notebook-lineage Phase 2 design.
//
// fetch + sleep are injected (RuntimeDeps) so the whole create→run→wait flow is
// unit-testable with a fake fetch and a no-op sleep, no real tenant involved.

import { readOneLakeFile, type OneLakeDeps } from "./oneLake";

const API_ROOT = "https://api.fabric.microsoft.com/v1";

export interface RuntimeDeps {
  fetchImpl: typeof fetch;
  sleep: (ms: number) => Promise<void>;
}
export const realRuntimeDeps: RuntimeDeps = {
  fetchImpl: (...args) => fetch(...args),
  sleep: (ms) => new Promise((r) => setTimeout(r, ms)),
};

async function apiFetch(
  deps: RuntimeDeps,
  url: string,
  token: string,
  init?: RequestInit
): Promise<Response> {
  const res = await deps.fetchImpl(url, {
    ...init,
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
      ...(init?.headers ?? {}),
    },
  });
  // 202 Accepted is a success for the long-running create/run calls.
  if (!res.ok && res.status !== 202) {
    let detail = "";
    try {
      const body = await res.json();
      detail = body?.message ? `: ${body.message}` : "";
    } catch {
      // not JSON
    }
    if (res.status === 401 || res.status === 403) {
      throw new Error(
        `Fabric write/execute call failed (${res.status})${detail}. The token needs Item.ReadWrite.All + Item.Execute.All scopes and admin consent.`
      );
    }
    throw new Error(`Fabric request to ${url} failed (${res.status})${detail}`);
  }
  return res;
}

interface OperationStatus {
  status?: string; // Succeeded | Failed | Running | NotStarted
  error?: { message?: string };
}

// Poll a long-running-operation Location URL until it settles.
async function pollOperation(
  deps: RuntimeDeps,
  operationUrl: string,
  token: string,
  maxAttempts: number,
  intervalMs: number
): Promise<void> {
  for (let i = 0; i < maxAttempts; i++) {
    const res = await apiFetch(deps, operationUrl, token);
    const body = (await res.json()) as OperationStatus;
    if (body.status === "Succeeded") return;
    if (body.status === "Failed") {
      throw new Error(`Fabric operation failed${body.error?.message ? `: ${body.error.message}` : ""}.`);
    }
    await deps.sleep(intervalMs);
  }
  throw new Error("Timed out waiting for the Fabric create-notebook operation.");
}

/**
 * Create a notebook in the target workspace from a base64 `.ipynb` payload.
 * Returns the new item id. Handles both the synchronous (201) and long-running
 * (202 + operation Location) create responses.
 */
export async function createHelperNotebook(
  deps: RuntimeDeps,
  workspaceId: string,
  token: string,
  displayName: string,
  ipynbBase64: string,
  opts: { maxAttempts?: number; intervalMs?: number } = {}
): Promise<string> {
  const res = await apiFetch(deps, `${API_ROOT}/workspaces/${workspaceId}/notebooks`, token, {
    method: "POST",
    body: JSON.stringify({
      displayName,
      definition: {
        format: "ipynb",
        parts: [
          { path: "notebook-content.ipynb", payload: ipynbBase64, payloadType: "InlineBase64" },
        ],
      },
    }),
  });

  if (res.status === 201) {
    const body = (await res.json()) as { id?: string };
    if (!body.id) throw new Error("Fabric create-notebook returned no item id.");
    return body.id;
  }

  // 202: follow the operation to completion, then fetch its result for the id.
  const operationUrl = res.headers.get("Location");
  if (!operationUrl) throw new Error("Fabric create-notebook returned no operation Location.");
  await pollOperation(deps, operationUrl, token, opts.maxAttempts ?? 30, opts.intervalMs ?? 2000);
  const resultRes = await apiFetch(deps, `${operationUrl}/result`, token);
  const result = (await resultRes.json()) as { id?: string };
  if (!result.id) throw new Error("Fabric create-notebook operation returned no item id.");
  return result.id;
}

/**
 * Start an on-demand RunNotebook job. Returns the job instance id, parsed from
 * the response's Location header (falls back to a body id for tenants that
 * return one).
 */
export async function startNotebookRun(
  deps: RuntimeDeps,
  workspaceId: string,
  token: string,
  itemId: string
): Promise<string> {
  const res = await apiFetch(
    deps,
    `${API_ROOT}/workspaces/${workspaceId}/items/${itemId}/jobs/instances?jobType=RunNotebook`,
    token,
    { method: "POST", body: JSON.stringify({ executionData: {} }) }
  );
  const location = res.headers.get("Location");
  const fromHeader = location?.match(/instances\/([^/?]+)/)?.[1];
  if (fromHeader) return fromHeader;
  try {
    const body = (await res.json()) as { id?: string };
    if (body.id) return body.id;
  } catch {
    // no body
  }
  throw new Error("Fabric run-notebook returned no job instance id.");
}

interface JobInstance {
  status?: string; // NotStarted | InProgress | Completed | Failed | Cancelled | Deduped
  failureReason?: { message?: string };
}

/**
 * Poll a notebook run to completion. Resolves when Completed; throws on
 * Failed/Cancelled/Deduped or timeout.
 */
export async function waitForNotebookRun(
  deps: RuntimeDeps,
  workspaceId: string,
  token: string,
  itemId: string,
  jobInstanceId: string,
  opts: { maxAttempts?: number; intervalMs?: number } = {}
): Promise<void> {
  const maxAttempts = opts.maxAttempts ?? 60;
  const intervalMs = opts.intervalMs ?? 3000;
  for (let i = 0; i < maxAttempts; i++) {
    const res = await apiFetch(
      deps,
      `${API_ROOT}/workspaces/${workspaceId}/items/${itemId}/jobs/instances/${jobInstanceId}`,
      token
    );
    const body = (await res.json()) as JobInstance;
    if (body.status === "Completed") return;
    if (body.status === "Failed" || body.status === "Cancelled" || body.status === "Deduped") {
      throw new Error(
        `Notebook run ${body.status}${body.failureReason?.message ? `: ${body.failureReason.message}` : ""}.`
      );
    }
    await deps.sleep(intervalMs);
  }
  throw new Error("Timed out waiting for the notebook run to complete.");
}

// ── Helper-notebook generation ──────────────────────────────────────────────
// The generated notebook runs in Fabric and captures the REAL tables each
// target notebook reads/writes by:
//   1. Monkeypatching DataFrameReader/DataFrameWriter methods + spark.sql to
//      log every table/path argument at call time (so dynamically-built names
//      are captured as their resolved values).
//   2. Running each target with the `%run` magic — which shares this session
//      (unlike mssparkutils.notebook.run), so the patches intercept its calls.
//      One begin/%run/end cell-triplet per target attributes the captured IO to
//      the right notebook.
//   3. Writing {"notebooks":[{id,name,reads,writes}]} to OneLake via
//      mssparkutils.fs.put, which the caller reads back (run jobs don't return
//      output over REST).
//
// *** ASSUMPTION: the exact %run path semantics and mssparkutils.fs.put
// signature vary by Fabric runtime version and have NOT been validated against
// a live tenant — treat this template as needing a first-real-run check, same
// caveat convention as fabricScanner.ts. ***

export interface HelperTarget {
  id: string;
  name: string;
  // Path/name passed to `%run` (a workspace notebook name or path).
  runPath: string;
}

const PATCH_SRC = `import json, re, traceback
_cap = {"reads": [], "writes": []}
_results = []
_cur = None

from pyspark.sql import DataFrameReader, DataFrameWriter
def _wrap(cls, meth, bucket):
    orig = getattr(cls, meth)
    def w(self, *a, **k):
        for arg in a:
            if isinstance(arg, str):
                _cap[bucket].append(arg)
        return orig(self, *a, **k)
    setattr(cls, meth, w)
for _m in ["load", "table", "parquet", "csv", "json"]:
    _wrap(DataFrameReader, _m, "reads")
for _m in ["saveAsTable", "save", "insertInto"]:
    _wrap(DataFrameWriter, _m, "writes")

_orig_sql = spark.sql
def _sql(q, *a, **k):
    if isinstance(q, str):
        for t in re.findall(r"(?i)\\\\b(?:from|join)\\\\s+([A-Za-z0-9_.\\\`\\"]+)", q):
            _cap["reads"].append(t)
        for t in re.findall(r"(?i)\\\\b(?:insert\\\\s+into|insert\\\\s+overwrite(?:\\\\s+table)?|create\\\\s+(?:or\\\\s+replace\\\\s+)?table(?:\\\\s+if\\\\s+not\\\\s+exists)?|merge\\\\s+into)\\\\s+([A-Za-z0-9_.\\\`\\"]+)", q):
            _cap["writes"].append(t)
    return _orig_sql(q, *a, **k)
spark.sql = _sql

def __begin(nid, name):
    global _cur
    _cap["reads"].clear(); _cap["writes"].clear()
    _cur = {"id": nid, "name": name}

def __end():
    if _cur is not None:
        _cur["reads"] = sorted(set(_cap["reads"]))
        _cur["writes"] = sorted(set(_cap["writes"]))
        _results.append(_cur)

def __write(path):
    payload = json.dumps({"notebooks": _results})
    mssparkutils.fs.put(path, payload, True)
`;

function toBase64(s: string): string {
  return typeof btoa === "function" ? btoa(s) : Buffer.from(s, "utf-8").toString("base64");
}

function codeCell(source: string) {
  return { cell_type: "code", metadata: {}, execution_count: null, outputs: [], source };
}

/**
 * Generate the base64 `.ipynb` payload for the lineage-capture helper notebook.
 * Emits: a patch cell, then a (begin / %run / end) triplet per target, then a
 * final cell that writes the captured lineage JSON to `outputAbfssPath`.
 */
export function buildLineageHelperIpynb(targets: HelperTarget[], outputAbfssPath: string): string {
  const cells: ReturnType<typeof codeCell>[] = [codeCell(PATCH_SRC)];
  for (const t of targets) {
    cells.push(codeCell(`__begin(${JSON.stringify(t.id)}, ${JSON.stringify(t.name)})`));
    cells.push(codeCell(`%run ${t.runPath}`));
    cells.push(codeCell("__end()"));
  }
  cells.push(codeCell(`__write(${JSON.stringify(outputAbfssPath)})`));
  const doc = {
    nbformat: 4,
    nbformat_minor: 5,
    metadata: { language_info: { name: "python" } },
    cells,
  };
  return toBase64(JSON.stringify(doc));
}

// ── Captured-lineage parsing ────────────────────────────────────────────────
export interface RuntimeNotebookIo {
  id: string;
  name: string;
  reads: string[];
  writes: string[];
}

/** Parse the JSON the helper notebook wrote back from OneLake. Forgiving. */
export function parseCapturedLineage(text: string): RuntimeNotebookIo[] {
  const data = JSON.parse(text) as { notebooks?: unknown };
  if (!Array.isArray(data.notebooks)) return [];
  return data.notebooks.map((n) => {
    const nb = n as Partial<RuntimeNotebookIo>;
    return {
      id: String(nb.id ?? ""),
      name: String(nb.name ?? ""),
      reads: Array.isArray(nb.reads) ? nb.reads.map(String) : [],
      writes: Array.isArray(nb.writes) ? nb.writes.map(String) : [],
    };
  });
}

// ── End-to-end orchestration ────────────────────────────────────────────────
export interface RuntimeExtractionArgs {
  deps: RuntimeDeps;
  oneLakeDeps: OneLakeDeps;
  // Where the helper notebook is created + run.
  runWorkspaceId: string;
  // Where the helper writes its result (the workspace holding the output
  // Lakehouse). Defaults to runWorkspaceId when the two match.
  outputWorkspaceId: string;
  fabricWriteToken: string;
  oneLakeToken: string;
  targets: HelperTarget[];
  // Full OneLake abfss URL the helper writes its result to.
  outputAbfssPath: string;
  // Workspace-relative path (e.g. "<lakehouseId>/Files/lineage/result.json")
  // used to read the result back via OneLake DFS from outputWorkspaceId.
  resultReadPath: string;
  helperName?: string;
  // Optional progress callback for the UI.
  onPhase?: (phase: "creating" | "running" | "reading") => void;
}

/**
 * Create → run → wait → read-back the lineage-capture helper notebook, returning
 * each target notebook's resolved reads/writes. MUTATES the run workspace
 * (creates + runs a notebook) and writes a file into the output Lakehouse —
 * callers must gate this behind explicit user intent and chosen workspaces.
 */
export async function runRuntimeLineageExtraction(
  args: RuntimeExtractionArgs
): Promise<RuntimeNotebookIo[]> {
  const ipynb = buildLineageHelperIpynb(args.targets, args.outputAbfssPath);
  args.onPhase?.("creating");
  const itemId = await createHelperNotebook(
    args.deps,
    args.runWorkspaceId,
    args.fabricWriteToken,
    args.helperName ?? "Lineage Studio — lineage capture (temporary)",
    ipynb
  );
  args.onPhase?.("running");
  const jobId = await startNotebookRun(args.deps, args.runWorkspaceId, args.fabricWriteToken, itemId);
  await waitForNotebookRun(args.deps, args.runWorkspaceId, args.fabricWriteToken, itemId, jobId);
  args.onPhase?.("reading");
  const text = await readOneLakeFile(
    args.oneLakeDeps,
    args.outputWorkspaceId,
    args.resultReadPath,
    args.oneLakeToken
  );
  return parseCapturedLineage(text);
}
