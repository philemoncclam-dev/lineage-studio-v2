// Forgiving, universal "Model" importer. Accepts almost any reasonable file and
// extracts as much as it can, collecting warnings instead of hard-failing.
//
// Supported inputs:
//   - JSON: a full Model; {nodes, edges} with aliased/loosely-cased keys; a bare
//     array of node-ish objects; or a nested tree ({children: [...]}).
//   - XLSX: the app's own "Lineage" sheet (+ optional v2 "Edges" / "Model"
//     sheets), or any arbitrary spreadsheet via fuzzy header matching.
//   - CSV/TSV: the app's lineage CSV, schema CSVs, or any headered CSV via the
//     same fuzzy matching. Delimiter is sniffed among , ; tab | (BOM/CRLF ok).
//
// Output is an ImportResult carrying the extracted Model fields plus a list of
// human-readable warnings, which the dialog surfaces before applying.
import type { Model, LineageNode, LineageEdge, NodeType, EdgeKind, TagDef } from "../types";
import { META_COLUMNS } from "./attributeMeta";

export interface ImportResult {
  name: string;
  description?: string;
  labels?: string[];
  tags?: TagDef[];
  nodes: LineageNode[];
  edges: LineageEdge[];
  warnings: string[];
}

const newId = () =>
  (crypto.randomUUID?.() ?? Math.random().toString(36).slice(2)).replace(/-/g, "");

const VALID_TYPES = new Set<NodeType>(["Layer", "Group", "Object", "Attribute"]);
const VALID_KINDS = new Set<EdgeKind>(["copy", "aggregate", "derive", "filter"]);
const MULTI_DELIM = /\s*;\s*/;
// Depth → inferred type when a node's type is missing. Beyond this, everything
// deeper is an Attribute.
const DEPTH_TYPES: NodeType[] = ["Layer", "Object", "Attribute", "Attribute", "Attribute"];

// ── small helpers ───────────────────────────────────────────────────────────

const strip = (s: string) => s.replace(/^﻿/, "");
const norm = (s: string) => s.toLowerCase().replace(/[\s_-]+/g, "");

function asString(v: unknown): string {
  if (v == null) return "";
  if (typeof v === "string") return v;
  if (typeof v === "number" || typeof v === "boolean") return String(v);
  return "";
}

function coerceType(v: unknown, depth = 0): NodeType | null {
  const s = norm(asString(v));
  if (!s) return null;
  if (s === "layer") return "Layer";
  if (s === "object" || s === "entity" || s === "table" || s === "model") return "Object";
  if (s === "group") return "Group";
  if (s === "attribute" || s === "attr" || s === "column" || s === "field") return "Attribute";
  return DEPTH_TYPES[Math.min(depth, DEPTH_TYPES.length - 1)];
}

function coerceKind(v: unknown): EdgeKind | undefined {
  const s = norm(asString(v));
  if (VALID_KINDS.has(s as EdgeKind)) return s as EdgeKind;
  return undefined;
}

function truthy(v: unknown): boolean {
  const s = norm(asString(v));
  return s === "true" || s === "yes" || s === "1" || s === "y";
}

// Read the first present key (case/alias-insensitive) from an object.
function pick(obj: Record<string, unknown>, keys: string[]): unknown {
  const lookup = new Map<string, unknown>();
  for (const [k, val] of Object.entries(obj)) lookup.set(norm(k), val);
  for (const k of keys) {
    const hit = lookup.get(norm(k));
    if (hit !== undefined && hit !== null && hit !== "") return hit;
  }
  return undefined;
}

const mkNode = (over: Partial<LineageNode> & { type: NodeType; name: string }): LineageNode => ({
  id: over.id ?? newId(),
  type: over.type,
  name: over.name,
  parentId: over.parentId ?? null,
  properties: over.properties ?? {},
  transformation_logic: over.transformation_logic ?? "",
  x: 0,
  y: 0,
});

// ── format detection ────────────────────────────────────────────────────────

export type DetectedFormat = "json" | "xlsx" | "csv";

// XLSX/ZIP files start with "PK\x03\x04". We sniff both the extension and the
// magic bytes so a mislabelled file still lands in the right parser.
function isZip(bytes: Uint8Array): boolean {
  return bytes[0] === 0x50 && bytes[1] === 0x4b && (bytes[2] === 0x03 || bytes[2] === 0x05);
}

async function detectFormat(file: File): Promise<DetectedFormat> {
  const buf = new Uint8Array(await file.slice(0, 8).arrayBuffer());
  if (isZip(buf)) return "xlsx";
  const ext = file.name.toLowerCase();
  if (ext.endsWith(".xlsx") || ext.endsWith(".xls")) return "xlsx";
  if (ext.endsWith(".json")) return "json";
  if (ext.endsWith(".csv") || ext.endsWith(".tsv")) return "csv";
  // Content sniff: leading { or [ → JSON.
  const head = strip(new TextDecoder().decode(buf)).trimStart();
  if (head.startsWith("{") || head.startsWith("[")) return "json";
  return "csv";
}

// ── delimited (CSV/TSV) parsing ─────────────────────────────────────────────

const DELIMS: Record<string, string> = { comma: ",", semicolon: ";", tab: "\t", pipe: "|" };

// Sniff the delimiter by counting candidates in the first non-empty line.
function sniffDelimiter(firstLine: string): string {
  let best = ",";
  let bestCount = 0;
  for (const d of Object.values(DELIMS)) {
    const count = firstLine.split(d).length - 1;
    if (count > bestCount) {
      bestCount = count;
      best = d;
    }
  }
  return best;
}

// RFC-4180-ish parser generalised to any single-char delimiter. Handles quoted
// fields, escaped "" quotes, and embedded newlines inside quotes.
export function parseDelimited(text: string, delim: string): string[][] {
  const rows: string[][] = [];
  let field = "";
  let row: string[] = [];
  let inQuotes = false;
  const t = strip(text);
  for (let i = 0; i < t.length; i++) {
    const ch = t[i];
    if (inQuotes) {
      if (ch === '"') {
        if (t[i + 1] === '"') {
          field += '"';
          i++;
        } else inQuotes = false;
      } else field += ch;
    } else if (ch === '"') {
      inQuotes = true;
    } else if (ch === delim) {
      row.push(field);
      field = "";
    } else if (ch === "\n" || ch === "\r") {
      if (ch === "\r" && t[i + 1] === "\n") i++;
      row.push(field);
      field = "";
      rows.push(row);
      row = [];
    } else field += ch;
  }
  row.push(field);
  rows.push(row);
  // Drop wholly-empty trailing rows.
  return rows.filter((r) => r.some((c) => c.trim() !== "")).map((r) => r.map((c) => c.trim()));
}

// ── fuzzy header matching ───────────────────────────────────────────────────

// Role → header synonyms (normalised). Used for arbitrary spreadsheets/CSVs.
const HEADER_ROLES: Record<string, string[]> = {
  type: ["type", "nodetype", "kind"],
  name: ["name", "nodename", "label"],
  parent: ["parent", "parentid", "parentname", "parentpath"],
  id: ["id", "path", "qualifiedname", "fqn"],
  source: ["source", "from", "src", "sourcepath", "upstream"],
  target: ["target", "to", "tgt", "targetpath", "downstream"],
  properties: ["properties", "props", "meta", "metadata"],
  transformation: ["transformationlogic", "transformation", "logic", "expression", "sql"],
  attribute: ["attribute", "column", "field", "columnname", "attributename"],
  object: ["table", "object", "entity", "dataset", "tablename"],
  layer: ["layer", "sourcesystem", "system", "schema", "database", "zone"],
  ordinal: ["ordinal", "position", "order", "index", "seq"],
  datatype: ["datatype", "type", "sqltype"],
  description: ["description", "definition", "comment", "meaning", "businessdefinition"],
  edgekind: ["edgekind", "kind", "transformationtype"],
  edgenote: ["edgenote", "note", "edgecomment"],
};

// Find the column index whose header best matches one of a role's synonyms.
function matchHeader(headers: string[], role: string): number {
  const syns = HEADER_ROLES[role] ?? [role];
  const normed = headers.map(norm);
  // Prefer exact synonym match, then substring.
  for (const syn of syns) {
    const exact = normed.indexOf(syn);
    if (exact >= 0) return exact;
  }
  for (const syn of syns) {
    const sub = normed.findIndex((h) => h.includes(syn) || syn.includes(h));
    if (sub >= 0 && normed[sub]) return sub;
  }
  return -1;
}

// ── JSON extraction ─────────────────────────────────────────────────────────

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

// A node-ish record already has a name and (usually) a type or children.
function looksLikeNode(v: unknown): boolean {
  if (!isRecord(v)) return false;
  return (
    pick(v, ["name", "label"]) !== undefined ||
    pick(v, ["id"]) !== undefined ||
    "children" in v
  );
}

function extractJson(raw: unknown, warnings: string[]): Omit<ImportResult, "warnings"> {
  const nodes: LineageNode[] = [];
  const edges: LineageEdge[] = [];
  let name = "";
  let description: string | undefined;
  let labels: string[] | undefined;
  let tags: TagDef[] | undefined;

  const root = isRecord(raw) ? raw : null;

  if (root) {
    name = asString(pick(root, ["name", "modelName", "title"]));
    const desc = pick(root, ["description", "about", "summary"]);
    if (desc) description = asString(desc);
    const lbl = pick(root, ["labels", "tagsList"]);
    if (Array.isArray(lbl)) labels = lbl.map(asString).filter(Boolean);
    const tg = pick(root, ["tags"]);
    if (Array.isArray(tg)) {
      tags = tg
        .filter(isRecord)
        .map((t) => ({ name: asString(pick(t, ["name"])), color: asString(pick(t, ["color"])) }))
        .filter((t) => t.name && t.color);
    }
  }

  // Case A: explicit nodes array (+ optional edges).
  const nodeArr = root ? pick(root, ["nodes", "elements"]) : Array.isArray(raw) ? raw : undefined;
  const edgeArr = root ? pick(root, ["edges", "links", "relationships", "lineage"]) : undefined;

  // Case B: a nested tree (root has children, or the array items have children).
  const treeRoot =
    root && "children" in root && !nodeArr ? root : undefined;
  const arrayHasChildren =
    Array.isArray(nodeArr) && nodeArr.some((n) => isRecord(n) && "children" in n);

  if (treeRoot || (arrayHasChildren && Array.isArray(nodeArr))) {
    // Walk the tree, inferring types by depth.
    const walk = (node: unknown, parentId: string | null, depth: number) => {
      if (!isRecord(node)) return;
      const nm = asString(pick(node, ["name", "label", "id"]));
      if (!nm && !("children" in node)) return;
      const type = coerceType(pick(node, ["type", "kind"]), depth) ?? DEPTH_TYPES[Math.min(depth, DEPTH_TYPES.length - 1)];
      const props = pick(node, ["properties", "props", "meta"]);
      const n = mkNode({
        id: asString(pick(node, ["id"])) || undefined,
        type,
        name: nm || `node ${nodes.length + 1}`,
        parentId,
        properties: isRecord(props) ? props : {},
        transformation_logic: asString(pick(node, ["transformation_logic", "logic", "transformation"])),
      });
      nodes.push(n);
      const kids = pick(node, ["children", "columns", "fields", "attributes"]);
      if (Array.isArray(kids)) for (const k of kids) walk(k, n.id, depth + 1);
    };
    const roots = treeRoot
      ? (Array.isArray(pick(treeRoot, ["children"])) ? (pick(treeRoot, ["children"]) as unknown[]) : [treeRoot])
      : (nodeArr as unknown[]);
    for (const r of roots) walk(r, null, 0);
    return { name: name || "Imported model", description, labels, tags, nodes, edges };
  }

  // Case A continued: flat node list.
  if (Array.isArray(nodeArr)) {
    // Map any provided id (or generated) so edge endpoints resolve.
    const idMap = new Map<string, string>();
    let skipped = 0;
    for (const raw of nodeArr) {
      if (!looksLikeNode(raw)) {
        skipped++;
        continue;
      }
      const rec = raw as Record<string, unknown>;
      const providedId = asString(pick(rec, ["id"]));
      const explicit = pick(rec, ["type", "kind"]);
      const hasExplicitType =
        explicit !== undefined && explicit !== null && asString(explicit) !== "";
      const type = (hasExplicitType ? coerceType(explicit) : null) ?? "Attribute";
      const nm = asString(pick(rec, ["name", "label"])) || providedId || `node ${nodes.length + 1}`;
      const props = pick(rec, ["properties", "props", "meta"]);
      const n = mkNode({
        id: providedId || undefined,
        type,
        name: nm,
        properties: isRecord(props) ? props : {},
        transformation_logic: asString(pick(rec, ["transformation_logic", "logic", "transformation"])),
      });
      if (providedId) idMap.set(providedId, n.id);
      idMap.set(n.id, n.id);
      // Stash the raw parent ref (and whether the type was explicit) for a
      // second pass once every node exists.
      (n as unknown as { _parentRef?: string })._parentRef = asString(
        pick(rec, ["parentId", "parent_id", "parent"])
      );
      (n as unknown as { _untyped?: boolean })._untyped = !hasExplicitType;
      nodes.push(n);
    }
    // Resolve parents (by id, else by name).
    const byName = new Map(nodes.map((n) => [n.name, n.id]));
    for (const n of nodes) {
      const ref = (n as unknown as { _parentRef?: string })._parentRef;
      delete (n as unknown as { _parentRef?: string })._parentRef;
      if (!ref) continue;
      n.parentId = idMap.get(ref) ?? byName.get(ref) ?? null;
    }
    // Nodes with no explicit type defaulted to Attribute above; now that the
    // hierarchy is known, re-infer those from their actual depth
    // (Layer > Object > Attribute).
    const nodeById = new Map(nodes.map((n) => [n.id, n]));
    const depthOf = (n: LineageNode, seen = new Set<string>()): number => {
      if (!n.parentId || seen.has(n.id)) return 0;
      seen.add(n.id);
      const p = nodeById.get(n.parentId);
      return p ? depthOf(p, seen) + 1 : 0;
    };
    for (const n of nodes) {
      const untyped = (n as unknown as { _untyped?: boolean })._untyped;
      delete (n as unknown as { _untyped?: boolean })._untyped;
      if (untyped) n.type = DEPTH_TYPES[Math.min(depthOf(n), DEPTH_TYPES.length - 1)];
    }
    if (skipped) warnings.push(`Skipped ${skipped} unrecognised node entr${skipped === 1 ? "y" : "ies"}.`);

    // Edges.
    if (Array.isArray(edgeArr)) {
      let eskip = 0;
      for (const e of edgeArr) {
        if (!isRecord(e)) {
          eskip++;
          continue;
        }
        const srcRef = asString(pick(e, ["sourceNodeId", "source", "from", "src"]));
        const tgtRef = asString(pick(e, ["targetNodeId", "target", "to", "tgt"]));
        const src = idMap.get(srcRef) ?? byName.get(srcRef);
        const tgt = idMap.get(tgtRef) ?? byName.get(tgtRef);
        if (!src || !tgt) {
          eskip++;
          continue;
        }
        edges.push({
          id: newId(),
          sourceNodeId: src,
          targetNodeId: tgt,
          kind: coerceKind(pick(e, ["kind", "type", "transformation"])),
          note: asString(pick(e, ["note", "comment"])) || undefined,
          verified: pick(e, ["verified"]) !== undefined ? truthy(pick(e, ["verified"])) : undefined,
        });
      }
      if (eskip) warnings.push(`Skipped ${eskip} unresolved edge${eskip === 1 ? "" : "s"}.`);
    }
    return { name: name || "Imported model", description, labels, tags, nodes, edges };
  }

  warnings.push("No recognisable nodes found in the JSON; imported an empty model.");
  return { name: name || "Imported model", description, labels, tags, nodes, edges };
}

// ── path-based lineage (shared by the app's XLSX & CSV formats) ─────────────

// Build nodes+edges from rows carrying Type/Name/Parent/ID/Source/Target paths.
// `getVal(row, role)` returns a cell string for a given logical role.
interface LineageRow {
  type: string;
  name: string;
  parent: string;
  id: string;
  source: string;
  target: string;
  properties: string;
  transformation: string;
  meta: Record<string, string>;
}

function buildFromLineageRows(rows: LineageRow[], warnings: string[]) {
  const nodes: LineageNode[] = [];
  const pathToId = new Map<string, string>();
  let skipped = 0;

  for (const r of rows) {
    const type = coerceType(r.type);
    if (!type || !VALID_TYPES.has(type)) {
      if (r.name || r.type) skipped++;
      continue;
    }
    const qualifiedPath = r.id || (r.parent ? `${r.parent}/${r.name}` : r.name);
    let properties: Record<string, unknown> = {};
    if (r.properties) {
      try {
        const p = JSON.parse(r.properties);
        if (isRecord(p)) properties = p;
      } catch {
        warnings.push(`Ignored malformed Properties JSON for "${r.name}".`);
      }
    }
    for (const c of META_COLUMNS) {
      const v = (r.meta[c.column] ?? "").trim();
      if (v) properties[c.key] = v;
    }
    const nodeId = newId();
    pathToId.set(qualifiedPath, nodeId);
    nodes.push(
      mkNode({ id: nodeId, type, name: r.name, properties, transformation_logic: r.transformation })
    );
  }
  if (skipped) warnings.push(`Skipped ${skipped} row(s) without a recognisable type.`);

  // Resolve parents.
  let idx = 0;
  for (const r of rows) {
    const type = coerceType(r.type);
    if (!type || !VALID_TYPES.has(type)) continue;
    if (r.parent) {
      const pid = pathToId.get(r.parent);
      if (pid) nodes[idx].parentId = pid;
    }
    idx++;
  }

  // Edges from Target (outgoing) columns.
  const edges: LineageEdge[] = [];
  const seen = new Set<string>();
  idx = 0;
  for (const r of rows) {
    const type = coerceType(r.type);
    if (!type || !VALID_TYPES.has(type)) continue;
    const qualifiedPath = r.id || (r.parent ? `${r.parent}/${r.name}` : r.name);
    const src = pathToId.get(qualifiedPath);
    idx++;
    if (!src) continue;
    for (const tp of r.target.split(MULTI_DELIM).map((p) => p.trim()).filter(Boolean)) {
      const tgt = pathToId.get(tp);
      if (!tgt) continue;
      const key = `${src}:${tgt}`;
      if (seen.has(key)) continue;
      seen.add(key);
      edges.push({ id: newId(), sourceNodeId: src, targetNodeId: tgt });
    }
  }
  return { nodes, edges, pathToId };
}

// Build a schema-style hierarchy (Layer → Group(table) → Attribute(column))
// from rows that only carry table/column pairs.
function buildFromTableColumn(
  rows: string[][],
  headers: string[],
  warnings: string[]
): { nodes: LineageNode[]; edges: LineageEdge[] } {
  const objIdx = matchHeader(headers, "object");
  const attrIdx = matchHeader(headers, "attribute");
  const layerIdx = matchHeader(headers, "layer");
  const dtIdx = matchHeader(headers, "datatype");
  const descIdx = matchHeader(headers, "description");
  if (attrIdx < 0) {
    warnings.push("Could not find a column/attribute column; imported an empty model.");
    return { nodes: [], edges: [] };
  }

  const nodes: LineageNode[] = [];
  const layerNodes = new Map<string, LineageNode>();
  const tableNodes = new Map<string, LineageNode>(); // key: layer|table
  const attrSeen = new Set<string>();
  const defaultLayer = "Imported";

  const ensureLayer = (nm: string) => {
    let l = layerNodes.get(nm);
    if (!l) {
      l = mkNode({ type: "Layer", name: nm });
      layerNodes.set(nm, l);
      nodes.push(l);
    }
    return l;
  };
  const ensureTable = (layer: LineageNode, tbl: string) => {
    const key = `${layer.name}|${tbl}`;
    let g = tableNodes.get(key);
    if (!g) {
      g = mkNode({ type: "Group", name: tbl, parentId: layer.id });
      tableNodes.set(key, g);
      nodes.push(g);
    }
    return g;
  };

  for (const row of rows) {
    const col = (row[attrIdx] ?? "").trim();
    if (!col) continue;
    const layerName = (layerIdx >= 0 ? row[layerIdx] : "")?.trim() || defaultLayer;
    const tableName = (objIdx >= 0 ? row[objIdx] : "")?.trim() || "table";
    const layer = ensureLayer(layerName);
    const group = ensureTable(layer, tableName);
    const aKey = `${group.id}|${col.toLowerCase()}`;
    if (attrSeen.has(aKey)) continue;
    attrSeen.add(aKey);
    const props: Record<string, unknown> = {};
    if (dtIdx >= 0 && row[dtIdx]?.trim()) props.dataType = row[dtIdx].trim();
    if (descIdx >= 0 && row[descIdx]?.trim()) props.description = row[descIdx].trim();
    nodes.push(mkNode({ type: "Attribute", name: col, parentId: group.id, properties: props }));
  }
  if (nodes.length === 0)
    warnings.push("No table/column rows found; imported an empty model.");
  return { nodes, edges: [] };
}

// Turn arbitrary delimited rows into a Model, choosing the best strategy.
function extractRows(rows: string[][], warnings: string[]): Omit<ImportResult, "warnings"> {
  if (rows.length === 0) {
    warnings.push("File had no rows; imported an empty model.");
    return { name: "Imported model", nodes: [], edges: [] };
  }
  const headers = rows[0];
  const data = rows.slice(1);
  const typeIdx = matchHeader(headers, "type");
  const nameIdx = matchHeader(headers, "name");

  // App-format lineage table: has Type + Name columns.
  if (typeIdx >= 0 && nameIdx >= 0) {
    const parentIdx = matchHeader(headers, "parent");
    const idIdx = matchHeader(headers, "id");
    const srcIdx = matchHeader(headers, "source");
    const tgtIdx = matchHeader(headers, "target");
    const propIdx = matchHeader(headers, "properties");
    const trIdx = matchHeader(headers, "transformation");
    const metaIdx = new Map<string, number>();
    for (const c of META_COLUMNS) {
      const i = headers.findIndex((h) => norm(h) === norm(c.column));
      if (i >= 0) metaIdx.set(c.column, i);
    }
    const lineageRows: LineageRow[] = data.map((row) => {
      const meta: Record<string, string> = {};
      for (const [col, i] of metaIdx) meta[col] = row[i] ?? "";
      return {
        type: row[typeIdx] ?? "",
        name: row[nameIdx] ?? "",
        parent: parentIdx >= 0 ? (row[parentIdx] ?? "") : "",
        id: idIdx >= 0 ? (row[idIdx] ?? "") : "",
        source: srcIdx >= 0 ? (row[srcIdx] ?? "") : "",
        target: tgtIdx >= 0 ? (row[tgtIdx] ?? "") : "",
        properties: propIdx >= 0 ? (row[propIdx] ?? "") : "",
        transformation: trIdx >= 0 ? (row[trIdx] ?? "") : "",
        meta,
      };
    });
    const { nodes, edges } = buildFromLineageRows(lineageRows, warnings);
    return { name: "Imported model", nodes, edges };
  }

  // Otherwise treat as a schema-style table/column sheet.
  const { nodes, edges } = buildFromTableColumn(data, headers, warnings);
  return { name: "Imported model", nodes, edges };
}

// ── XLSX extraction ─────────────────────────────────────────────────────────

async function extractXlsx(file: File, warnings: string[]): Promise<Omit<ImportResult, "warnings">> {
  const XLSX = await import("xlsx");
  const buffer = await file.arrayBuffer();
  const wb = XLSX.read(buffer, { type: "array" });
  if (wb.SheetNames.length === 0) {
    warnings.push("Workbook has no sheets.");
    return { name: "Imported model", nodes: [], edges: [] };
  }
  const toRows = (name: string): string[][] => {
    const ws = wb.Sheets[name];
    if (!ws) return [];
    return XLSX.utils.sheet_to_json<string[]>(ws, { header: 1, defval: "", raw: false })
      .map((r) => (Array.isArray(r) ? r.map((c) => String(c ?? "").trim()) : []))
      .filter((r) => r.some((c) => c !== ""));
  };

  const findSheet = (want: string) => wb.SheetNames.find((n) => norm(n) === norm(want));
  const lineageName = findSheet("Lineage");
  let base: Omit<ImportResult, "warnings">;

  if (lineageName) {
    base = extractRows(toRows(lineageName), warnings);
  } else {
    // Use the first sheet that yields any rows.
    const first = wb.SheetNames.map(toRows).find((r) => r.length > 1) ?? [];
    base = extractRows(first, warnings);
  }

  // Optional v2 "Model" sheet: Key|Value rows.
  const modelName = findSheet("Model");
  if (modelName) {
    const mrows = toRows(modelName);
    const kv = new Map<string, string>();
    for (const r of mrows.slice(1)) if (r[0]) kv.set(norm(r[0]), r[1] ?? "");
    if (kv.get("name")) base.name = kv.get("name")!;
    if (kv.get("description")) base.description = kv.get("description");
    for (const [k, key] of [["labels", "labels"], ["tags", "tags"]] as const) {
      const raw = kv.get(k);
      if (!raw) continue;
      try {
        const parsed = JSON.parse(raw);
        if (key === "labels" && Array.isArray(parsed)) base.labels = parsed.map(asString).filter(Boolean);
        if (key === "tags" && Array.isArray(parsed))
          base.tags = parsed.filter(isRecord).map((t) => ({ name: asString(t.name), color: asString(t.color) })).filter((t) => t.name && t.color);
      } catch {
        warnings.push(`Ignored malformed ${k} JSON in the Model sheet.`);
      }
    }
  }

  // Optional v2 "Edges" sheet: Source|Target|Kind|Note|Verified (path-based).
  const edgesName = findSheet("Edges");
  if (edgesName) {
    const erows = toRows(edgesName);
    if (erows.length > 1) {
      // Build a path→id map from the imported nodes (qualified by ancestor names).
      const byId = new Map(base.nodes.map((n) => [n.id, n]));
      const pathOf = (n: LineageNode): string => {
        const parts = [n.name];
        let cur = n.parentId ? byId.get(n.parentId) : undefined;
        while (cur) {
          parts.unshift(cur.name);
          cur = cur.parentId ? byId.get(cur.parentId) : undefined;
        }
        return parts.join("/");
      };
      const pathToId = new Map(base.nodes.map((n) => [pathOf(n), n.id]));
      const eh = erows[0];
      const si = matchHeader(eh, "source");
      const ti = matchHeader(eh, "target");
      const ki = matchHeader(eh, "edgekind");
      const ni = matchHeader(eh, "edgenote");
      const vi = eh.findIndex((h) => norm(h) === "verified");
      let added = 0;
      const seen = new Set(base.edges.map((e) => `${e.sourceNodeId}:${e.targetNodeId}`));
      for (const r of erows.slice(1)) {
        const src = pathToId.get((r[si] ?? "").trim());
        const tgt = pathToId.get((r[ti] ?? "").trim());
        if (!src || !tgt) continue;
        const key = `${src}:${tgt}`;
        if (seen.has(key)) continue;
        seen.add(key);
        base.edges.push({
          id: newId(),
          sourceNodeId: src,
          targetNodeId: tgt,
          kind: ki >= 0 ? coerceKind(r[ki]) : undefined,
          note: ni >= 0 && r[ni]?.trim() ? r[ni].trim() : undefined,
          verified: vi >= 0 ? truthy(r[vi]) : undefined,
        });
        added++;
      }
      if (added) warnings.push(`Added ${added} edge(s) from the Edges sheet.`);
    }
  }

  return base;
}

// ── CSV extraction ──────────────────────────────────────────────────────────

function extractCsv(text: string, warnings: string[]): Omit<ImportResult, "warnings"> {
  const clean = strip(text);
  const firstLine = clean.split(/\r?\n/).find((l) => l.trim() !== "") ?? "";
  const delim = sniffDelimiter(firstLine);
  const named = Object.entries(DELIMS).find(([, v]) => v === delim)?.[0] ?? "comma";
  if (named !== "comma") warnings.push(`Detected ${named}-delimited data.`);
  const rows = parseDelimited(clean, delim);
  return extractRows(rows, warnings);
}

// ── public entry point ──────────────────────────────────────────────────────

// Parse any reasonable file into an ImportResult. Never throws for recoverable
// issues — those become warnings. Only genuinely unreadable input throws.
export async function importAny(file: File): Promise<ImportResult> {
  const warnings: string[] = [];
  const fmt = await detectFormat(file);
  let base: Omit<ImportResult, "warnings">;

  if (fmt === "json") {
    const text = strip(await file.text());
    let parsed: unknown;
    try {
      parsed = JSON.parse(text);
    } catch {
      throw new Error("File looked like JSON but could not be parsed.");
    }
    base = extractJson(parsed, warnings);
  } else if (fmt === "xlsx") {
    try {
      base = await extractXlsx(file, warnings);
    } catch {
      throw new Error("Could not read the spreadsheet file.");
    }
  } else {
    base = extractCsv(await file.text(), warnings);
  }

  // Derive a name from the filename when the content didn't supply one.
  if (!base.name || base.name === "Imported model") {
    const fromFile = file.name
      .replace(/\.(lineage\.)?(json|xlsx|xls|csv|tsv)$/i, "")
      .replace(/[_-]+/g, " ")
      .trim();
    if (fromFile) base.name = fromFile;
  }
  if (!base.name) base.name = "Imported model";

  if (base.nodes.length === 0 && warnings.length === 0)
    warnings.push("No nodes were found in this file.");

  return { warnings, ...base };
}

// Convenience: produce a fully-formed Model (fresh id/timestamps) from a file.
// This is what the dialog applies once the user confirms.
export function resultToModel(res: ImportResult): Model {
  const now = new Date().toISOString();
  return {
    id: newId(),
    name: res.name,
    createdAt: now,
    updatedAt: now,
    nodes: res.nodes,
    edges: res.edges,
    tags: res.tags,
    description: res.description,
    labels: res.labels,
  };
}

// Counts for the preview summary.
export function summarize(res: ImportResult) {
  const by = (t: NodeType) => res.nodes.filter((n) => n.type === t).length;
  return {
    layers: by("Layer"),
    objects: by("Object") + by("Group"),
    attributes: by("Attribute"),
    edges: res.edges.length,
  };
}
