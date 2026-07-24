// Phase 1 notebook lineage: STATIC analysis of Fabric notebooks. Given a
// notebook's source code (PySpark + Spark SQL), we extract the tables it reads
// and writes, then synthesize a "Transformations" layer where each notebook is
// an Object carrying its code, wired by edges to the tables it consumes and
// produces. Tables that don't match a known Lakehouse/Warehouse/SemanticModel
// table become "staged" tables (intermediate hops the pipeline materializes).
//
// This module is deliberately pure and network-free so the extraction rules are
// unit-testable in isolation (see __tests__/notebookLineage.test.ts). The
// fabricConnector supplies the notebook code (fetched via getDefinition) and the
// map of already-known table names; everything here is string-in, nodes-out.
//
// Scope note: static parsing catches the common explicit read/write calls. It
// does NOT resolve dynamic/parameterized table names (built from variables or
// config) — those are the Phase 2 (runtime execution) case. Unrecognized code
// simply yields no edges rather than wrong ones.
import type { ConnectorEdge, ConnectorNode, ConnectorParseResult } from "./types";

// Stable external ids for the synthesized nodes (kept in one place so tests and
// the connector agree on them).
export const NOTEBOOK_LAYER_ID = "fabric:layer:Notebook";
export const STAGED_OBJECT_ID = "fabric:notebook:staged";
const stagedGroupId = (matchName: string) => `fabric:staged::${matchName}`;

export interface NotebookInput {
  id: string; // Fabric item id — becomes the notebook Object's externalId
  name: string;
  code: string;
}

export interface NotebookIo {
  reads: string[]; // normalized display names
  writes: string[];
}

// ── Definition decoding ────────────────────────────────────────────────────
interface DefinitionPart {
  path: string;
  payload: string; // base64
}

function decodeBase64(payload: string): string {
  return typeof atob === "function"
    ? atob(payload)
    : Buffer.from(payload, "base64").toString("utf-8");
}

interface IpynbCell {
  cell_type?: string;
  source?: string | string[];
}
interface IpynbDoc {
  cells?: IpynbCell[];
}

/**
 * Turn a getDefinition response's parts into one concatenated code string.
 * Handles both the Jupyter `.ipynb` format (join every code cell's source) and
 * the plain Synapse `.py` source export. Returns "" when nothing decodes.
 */
export function notebookCodeFromParts(parts: DefinitionPart[]): string {
  const ipynb = parts.find((p) => p.path.toLowerCase().endsWith(".ipynb"));
  if (ipynb) {
    try {
      const doc = JSON.parse(decodeBase64(ipynb.payload)) as IpynbDoc;
      return (doc.cells ?? [])
        .filter((c) => c.cell_type === "code")
        .map((c) => (Array.isArray(c.source) ? c.source.join("") : c.source ?? ""))
        .join("\n\n");
    } catch {
      return "";
    }
  }
  const py = parts.find((p) => /\.(py|scala|sql|r)$/i.test(p.path)) ?? parts[0];
  if (!py) return "";
  try {
    return decodeBase64(py.payload);
  } catch {
    return "";
  }
}

// ── Table-name normalization ────────────────────────────────────────────────
// A raw ref can be a path ("Tables/orders", "abfss://…/Tables/dbo/orders"), a
// qualified name ("silver.orders", "lakehouse.dbo.orders") or a bare name. We
// keep a human `display` (last meaningful segment) and a lowercased `matchName`
// used to line up with known table names and to dedupe staged tables.
export interface NormalizedRef {
  display: string;
  matchName: string;
}

export function normalizeTableRef(raw: string): NormalizedRef | null {
  let s = raw.trim().replace(/^["'`]+|["'`]+$/g, "");
  if (!s) return null;
  // Drop a storage/URI scheme prefix if present.
  s = s.replace(/^[a-z0-9]+:\/\/[^/]+\//i, "");
  // Split on path separators, drop empty + Delta bookkeeping segments.
  const pathParts = s.split("/").filter((p) => p && p !== "_delta_log");
  let last = pathParts[pathParts.length - 1] ?? s;
  // Strip a leading "Tables"/"Files" container word if it's the only prefix.
  if (pathParts.length > 1 && /^(Tables|Files)$/i.test(pathParts[0]) && pathParts.length === 2) {
    last = pathParts[1];
  }
  // For a dotted qualified name, the table is the last dotted segment.
  const dotParts = last.split(".").filter(Boolean);
  const display = dotParts[dotParts.length - 1] ?? last;
  if (!display || !/[A-Za-z0-9_]/.test(display)) return null;
  return { display, matchName: display.toLowerCase() };
}

// ── Read/write extraction ───────────────────────────────────────────────────
const STR = `["'\`]([^"'\`]+)["'\`]`;
// Writes are matched first; any table that is written is removed from reads so a
// read-then-overwrite in the same notebook doesn't create a self-cycle.
const WRITE_PATTERNS: RegExp[] = [
  new RegExp(`\\.saveAsTable\\(\\s*${STR}`, "g"),
  new RegExp(`\\.save\\(\\s*${STR}`, "g"),
  new RegExp(`\\.synapsesql\\(\\s*${STR}`, "g"),
  // Spark SQL DDL/DML targets.
  /\b(?:CREATE\s+(?:OR\s+REPLACE\s+)?TABLE(?:\s+IF\s+NOT\s+EXISTS)?|INSERT\s+INTO|INSERT\s+OVERWRITE(?:\s+TABLE)?|MERGE\s+INTO)\s+([A-Za-z0-9_.`"]+)/gi,
];
const READ_PATTERNS: RegExp[] = [
  new RegExp(`\\.(?:table|load|parquet|csv|json)\\(\\s*${STR}`, "g"),
  new RegExp(`spark\\.table\\(\\s*${STR}`, "g"),
  new RegExp(`DeltaTable\\.for(?:Name|Path)\\(\\s*spark\\s*,\\s*${STR}`, "g"),
  // Spark SQL sources.
  /\b(?:FROM|JOIN|USING)\s+([A-Za-z0-9_.`"]+)/gi,
];

function collect(patterns: RegExp[], code: string): NormalizedRef[] {
  const out: NormalizedRef[] = [];
  for (const re of patterns) {
    re.lastIndex = 0;
    let m: RegExpExecArray | null;
    while ((m = re.exec(code)) !== null) {
      const ref = normalizeTableRef(m[1]);
      if (ref) out.push(ref);
    }
  }
  return out;
}

/**
 * Extract the tables a notebook reads and writes. Writes win over reads on a
 * name collision (avoids self-cycles). Returns display names, deduped by
 * matchName, preserving first-seen order.
 */
export function extractNotebookIo(code: string): NotebookIo {
  const writes = collect(WRITE_PATTERNS, code);
  const reads = collect(READ_PATTERNS, code);
  const writeNames = new Set(writes.map((r) => r.matchName));

  const dedupe = (refs: NormalizedRef[], exclude?: Set<string>): string[] => {
    const seen = new Set<string>();
    const out: string[] = [];
    for (const r of refs) {
      if (seen.has(r.matchName) || exclude?.has(r.matchName)) continue;
      seen.add(r.matchName);
      out.push(r.display);
    }
    return out;
  };

  return {
    writes: dedupe(writes),
    reads: dedupe(reads, writeNames),
  };
}

// ── Node/edge synthesis ─────────────────────────────────────────────────────
// A notebook with its input/output tables already resolved — either statically
// (extractNotebookIo) or at runtime (captured while the notebook executed).
export interface NotebookIoItem {
  id: string;
  name: string;
  reads: string[];
  writes: string[];
  // Optional source code to attach as the node's transformationLogic.
  code?: string;
  // Extra metadata merged onto the notebook Object (e.g. { source: "runtime" }).
  metadata?: Record<string, unknown>;
}

/**
 * Build the Transformations layer + staged tables + lineage edges from
 * notebooks whose reads/writes are already known. Shared by the static path
 * (buildNotebookLineage) and the runtime path. `knownTableByName` maps a
 * lowercased table name to an already-synced table Group's externalId, so
 * edges attach to real tables when the name lines up and fall back to a staged
 * table otherwise.
 */
export function buildLineageFromIo(
  items: NotebookIoItem[],
  knownTableByName: Map<string, string>
): ConnectorParseResult {
  const nodes: ConnectorNode[] = [];
  const edges: ConnectorEdge[] = [];
  if (items.length === 0) return { nodes, edges };

  nodes.push({
    externalId: NOTEBOOK_LAYER_ID,
    parentExternalId: null,
    type: "Layer",
    name: "Fabric: Transformations",
  });

  // Staged tables are created lazily under one synthetic Object so they only
  // appear when a notebook actually references an unknown table.
  const stagedGroups = new Map<string, string>(); // matchName -> group externalId
  const ensureStaged = (ref: NormalizedRef): string => {
    const existing = stagedGroups.get(ref.matchName);
    if (existing) return existing;
    if (stagedGroups.size === 0) {
      nodes.push({
        externalId: STAGED_OBJECT_ID,
        parentExternalId: NOTEBOOK_LAYER_ID,
        type: "Object",
        name: "Staged tables",
        metadata: { synthetic: true },
      });
    }
    const gid = stagedGroupId(ref.matchName);
    stagedGroups.set(ref.matchName, gid);
    nodes.push({
      externalId: gid,
      parentExternalId: STAGED_OBJECT_ID,
      type: "Group",
      name: ref.display,
      metadata: { staged: true },
    });
    return gid;
  };

  const resolve = (name: string): string | null => {
    const ref = normalizeTableRef(name);
    if (!ref) return null;
    return knownTableByName.get(ref.matchName) ?? ensureStaged(ref);
  };

  const seenEdges = new Set<string>();
  const addEdge = (source: string, target: string) => {
    if (source === target) return;
    const key = `${source}->${target}`;
    if (seenEdges.has(key)) return;
    seenEdges.add(key);
    edges.push({ sourceExternalId: source, targetExternalId: target });
  };

  for (const nb of items) {
    nodes.push({
      externalId: nb.id,
      parentExternalId: NOTEBOOK_LAYER_ID,
      type: "Object",
      name: nb.name,
      transformationLogic: nb.code || undefined,
      metadata: { itemType: "Notebook", reads: nb.reads, writes: nb.writes, ...nb.metadata },
    });
    for (const r of nb.reads) {
      const gid = resolve(r);
      if (gid) addEdge(gid, nb.id); // source table → notebook
    }
    for (const w of nb.writes) {
      const gid = resolve(w);
      if (gid) addEdge(nb.id, gid); // notebook → produced table
    }
  }

  return { nodes, edges };
}

/**
 * Static-analysis convenience: extract reads/writes from each notebook's code,
 * then synthesize the lineage. Thin wrapper over buildLineageFromIo.
 */
export function buildNotebookLineage(
  notebooks: NotebookInput[],
  knownTableByName: Map<string, string>
): ConnectorParseResult {
  const items: NotebookIoItem[] = notebooks.map((nb) => {
    const io = extractNotebookIo(nb.code);
    return { id: nb.id, name: nb.name, code: nb.code, reads: io.reads, writes: io.writes };
  });
  return buildLineageFromIo(items, knownTableByName);
}
