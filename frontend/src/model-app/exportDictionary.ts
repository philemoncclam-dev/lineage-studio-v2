// Business-facing data dictionary export: every attribute with its metadata,
// tags, upstream provenance, and transformation logic — the document data
// teams are perpetually asked to produce. Markdown (readable/pasteable) and
// CSV (spreadsheet) flavors share one row builder so they can't drift.
import type { LineageNode, Model } from "./types";
import { readMeta, META_DROPDOWNS, META_DESCRIPTION } from "./editor/attributeMeta";
import { readTags } from "./editor/tags";

export interface DictionaryRow {
  layer: string;
  container: string; // Object name (or "" for a bandless table)
  table: string; // Group name
  attribute: string;
  dataType: string;
  nullable: string;
  key: string;
  classification: string;
  description: string;
  tags: string[];
  sources: string[]; // upstream attribute paths ("Layer › Table › attr"), with edge kind/note if present
  logic: string;
}

// Walk attributes in canvas render order: layers left→right, containers top to
// bottom, nested attributes after their parent.
export function dictionaryRows(model: Model): DictionaryRow[] {
  const childrenByParent = new Map<string | null, LineageNode[]>();
  for (const n of model.nodes) {
    const arr = childrenByParent.get(n.parentId);
    if (arr) arr.push(n);
    else childrenByParent.set(n.parentId, [n]);
  }
  const childrenOf = (p: string | null) => childrenByParent.get(p) ?? [];
  const byId = new Map(model.nodes.map((n) => [n.id, n]));

  // Short path for an attribute used in the "sources" column.
  const pathOf = (attrId: string): string => {
    const parts: string[] = [];
    let cur = byId.get(attrId);
    while (cur) {
      if (cur.type !== "Attribute" || parts.length === 0) parts.unshift(cur.name);
      cur = cur.parentId ? byId.get(cur.parentId) : undefined;
    }
    return parts.join(" › ");
  };

  // Upstream source node ids per target, alongside the edge's kind/note (if
  // any) so the dictionary can surface "aggregate — <note>" style provenance.
  const upstream = new Map<string, string[]>();
  const edgeInfo = new Map<string, { kind?: string; note?: string }>();
  for (const e of model.edges) {
    const arr = upstream.get(e.targetNodeId);
    if (arr) arr.push(e.sourceNodeId);
    else upstream.set(e.targetNodeId, [e.sourceNodeId]);
    edgeInfo.set(`${e.sourceNodeId} ${e.targetNodeId}`, { kind: e.kind, note: e.note });
  }

  const rows: DictionaryRow[] = [];
  const walkAttrs = (parentId: string, layer: string, container: string, table: string) => {
    for (const a of childrenOf(parentId).filter((n) => n.type === "Attribute")) {
      const props = a.properties as Record<string, unknown>;
      rows.push({
        layer,
        container,
        table,
        attribute: a.name,
        dataType: readMeta(props, "dataType"),
        nullable: readMeta(props, "nullable"),
        key: readMeta(props, "key"),
        classification: readMeta(props, "classification"),
        description: readMeta(props, META_DESCRIPTION.key),
        tags: readTags(props),
        sources: (upstream.get(a.id) ?? []).map((srcId) => {
          const info = edgeInfo.get(`${srcId} ${a.id}`);
          const provenance = [info?.kind, info?.note].filter(Boolean).join(" — ");
          return provenance ? `${pathOf(srcId)} (${provenance})` : pathOf(srcId);
        }),
        logic: a.transformation_logic,
      });
      walkAttrs(a.id, layer, container, table);
    }
  };

  for (const layer of model.nodes.filter((n) => n.type === "Layer")) {
    for (const g of childrenOf(layer.id).filter((n) => n.type === "Group")) {
      walkAttrs(g.id, layer.name, "", g.name);
    }
    for (const o of childrenOf(layer.id).filter((n) => n.type === "Object")) {
      for (const g of childrenOf(o.id).filter((n) => n.type === "Group")) {
        walkAttrs(g.id, layer.name, o.name, g.name);
      }
    }
  }
  return rows;
}

function downloadBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

export function dictionaryMarkdown(model: Model): string {
  const rows = dictionaryRows(model);
  const lines: string[] = [
    `# ${model.name} — data dictionary`,
    "",
    ...(model.description ? [model.description, ""] : []),
    `Generated ${new Date().toISOString().slice(0, 10)} · ${rows.length} attributes`,
  ];
  const esc = (s: string) => s.replace(/\|/g, "\\|").replace(/\n/g, " ");

  let currentTable = "";
  for (const r of rows) {
    const tableKey = `${r.layer}|${r.container}|${r.table}`;
    if (tableKey !== currentTable) {
      currentTable = tableKey;
      const where = r.container ? `${r.container} › ${r.table}` : r.table;
      lines.push("", `## ${r.layer} › ${where}`, "");
      lines.push("| Attribute | Type | Nullable | Key | Classification | Tags | Sources | Description | Logic |");
      lines.push("| --- | --- | --- | --- | --- | --- | --- | --- | --- |");
    }
    lines.push(
      `| ${[
        esc(r.attribute),
        r.dataType,
        r.nullable,
        r.key,
        r.classification,
        r.tags.join(", "),
        esc(r.sources.join("; ")),
        esc(r.description),
        esc(r.logic),
      ].join(" | ")} |`
    );
  }
  return lines.join("\n") + "\n";
}

export function dictionaryCsv(model: Model): string {
  const q = (s: string) => `"${s.replace(/"/g, '""')}"`;
  const header = [
    "Layer", "Object", "Table", "Attribute",
    META_DROPDOWNS.map((d) => d.column).join(","),
    "Tags", "Sources", META_DESCRIPTION.column, "TransformationLogic",
  ].join(",");
  const lines = dictionaryRows(model).map((r) =>
    [
      r.layer, r.container, r.table, r.attribute,
      r.dataType, r.nullable, r.key, r.classification,
      r.tags.join("; "), r.sources.join("; "), r.description, r.logic,
    ]
      .map(q)
      .join(",")
  );
  return [header, ...lines].join("\n") + "\n";
}

export function exportDictionaryMarkdown(model: Model): void {
  downloadBlob(
    new Blob([dictionaryMarkdown(model)], { type: "text/markdown" }),
    `${model.name}.dictionary.md`
  );
}

export function exportDictionaryCsv(model: Model): void {
  downloadBlob(
    new Blob([dictionaryCsv(model)], { type: "text/csv" }),
    `${model.name}.dictionary.csv`
  );
}
