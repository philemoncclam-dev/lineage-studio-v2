// Parse a pasted/uploaded list of column definitions and match them to existing
// attributes in the model. Input columns: Column, Table, Definition (in that
// order for a headerless paste; header names are auto-detected when present).
// Matching is by table name + column name (case-insensitive); the definition is
// written to each matched attribute's `description` metadata.
import type { Model, LineageNode } from "../types";
import { parseCSVLine, guessColumn } from "./schemaImport";

export interface DefRow {
  column: string;
  table: string;
  definition: string;
}

export interface DefMatch {
  attrId: string;
  column: string;
  table: string;
  definition: string;
  path: string; // readable "Layer / Object / Table" location
}

export interface DefParse {
  rows: DefRow[];
  hasHeader: boolean;
}

const COLUMN_PATTERNS = [/^column$/i, /column/i, /field/i, /attribute/i, /^name$/i];
const TABLE_PATTERNS = [/^table$/i, /table/i, /entity/i];
const DEF_PATTERNS = [/defin/i, /descrip/i, /meaning/i, /comment/i, /^business/i];

const HEADER_HINT = /column|table|field|attribute|defin|descrip|meaning/i;

// Split a single line by tab (when tabs are present) or RFC-4180 CSV.
function splitLine(line: string, tab: boolean): string[] {
  return tab ? line.split("\t").map((c) => c.trim()) : parseCSVLine(line);
}

// Parse free text (CSV or TSV) into definition rows. A header row is detected
// when the first line's cells look like field names rather than data.
export function parseDefinitions(text: string): DefParse {
  const lines = text.split(/\r?\n/).filter((l) => l.trim().length > 0);
  if (lines.length === 0) return { rows: [], hasHeader: false };

  const tab = lines[0].includes("\t");
  const cells = lines.map((l) => splitLine(l, tab));

  // Treat row 0 as a header when it has no obvious definition-ish data and at
  // least one cell reads like a field name.
  const hasHeader = cells[0].some((c) => HEADER_HINT.test(c));

  let cIdx = 0;
  let tIdx = 1;
  let dIdx = 2;
  let dataRows = cells;
  if (hasHeader) {
    const header = cells[0];
    cIdx = guessColumn(header, COLUMN_PATTERNS);
    tIdx = guessColumn(header, TABLE_PATTERNS);
    dIdx = guessColumn(header, DEF_PATTERNS);
    if (cIdx < 0) cIdx = 0;
    if (tIdx < 0) tIdx = 1;
    if (dIdx < 0) dIdx = 2;
    dataRows = cells.slice(1);
  }

  const rows: DefRow[] = [];
  for (const row of dataRows) {
    const column = (row[cIdx] ?? "").trim();
    const table = (row[tIdx] ?? "").trim();
    const definition = (row[dIdx] ?? "").trim();
    if (!column || !definition) continue;
    rows.push({ column, table, definition });
  }
  return { rows, hasHeader };
}

// Read definition rows from an uploaded file. .xlsx/.xls go through SheetNJS;
// everything else is treated as CSV/TSV text.
export async function parseDefinitionsFile(file: File): Promise<DefParse> {
  if (/\.xlsx?$/i.test(file.name)) {
    const XLSX = await import("xlsx");
    const buffer = await file.arrayBuffer();
    const wb = XLSX.read(buffer, { type: "array" });
    const ws = wb.Sheets[wb.SheetNames[0]];
    if (!ws) return { rows: [], hasHeader: false };
    // sheet_to_json with header:1 gives raw row arrays, which we re-join into a
    // TSV string and reuse the text parser (so header detection is shared).
    const matrix = XLSX.utils.sheet_to_json<string[]>(ws, {
      header: 1,
      defval: "",
      raw: false,
    });
    const text = matrix.map((r) => r.map((c) => String(c ?? "")).join("\t")).join("\n");
    return parseDefinitions(text);
  }
  const text = await file.text();
  return parseDefinitions(text);
}

// The nearest Group (table) ancestor name for an attribute, or null.
function tableOf(node: LineageNode, byId: Map<string, LineageNode>): string | null {
  let cur = node.parentId ? byId.get(node.parentId) : undefined;
  while (cur) {
    if (cur.type === "Group") return cur.name;
    cur = cur.parentId ? byId.get(cur.parentId) : undefined;
  }
  return null;
}

function pathOf(node: LineageNode, byId: Map<string, LineageNode>): string {
  const parts: string[] = [];
  let cur = node.parentId ? byId.get(node.parentId) : undefined;
  while (cur) {
    parts.unshift(cur.name);
    cur = cur.parentId ? byId.get(cur.parentId) : undefined;
  }
  return parts.join(" / ");
}

export interface MatchResult {
  matched: DefMatch[];
  unmatched: DefRow[];
}

// Match parsed rows against the model's attributes. A row matches every
// attribute whose name equals the row's column (case-insensitive) and whose
// table ancestor equals the row's table. When a row omits the table, it matches
// on column name alone (useful for small models with unique column names).
export function matchDefinitions(model: Model, rows: DefRow[]): MatchResult {
  const byId = new Map(model.nodes.map((n) => [n.id, n]));
  const attrs = model.nodes.filter((n) => n.type === "Attribute");

  const matched: DefMatch[] = [];
  const unmatched: DefRow[] = [];

  for (const row of rows) {
    const col = row.column.toLowerCase();
    const tbl = row.table.toLowerCase();
    const hits = attrs.filter((a) => {
      if (a.name.toLowerCase() !== col) return false;
      if (!tbl) return true;
      return (tableOf(a, byId) ?? "").toLowerCase() === tbl;
    });
    if (hits.length === 0) {
      unmatched.push(row);
      continue;
    }
    for (const a of hits) {
      matched.push({
        attrId: a.id,
        column: row.column,
        table: row.table,
        definition: row.definition,
        path: pathOf(a, byId),
      });
    }
  }
  return { matched, unmatched };
}
