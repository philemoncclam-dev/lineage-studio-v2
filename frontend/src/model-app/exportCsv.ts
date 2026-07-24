import type { Model } from "./types";

const CSV_HEADERS = [
  "SourceLayer",
  "SourceObject",
  "SourceTable",
  "SourceAttribute",
  "TargetLayer",
  "TargetObject",
  "TargetTable",
  "TargetAttribute",
  "edge_kind",
  "edge_note",
];

function quoteField(value: string): string {
  // RFC-4180: quote fields containing commas, double-quotes, or newlines
  if (value.includes(",") || value.includes('"') || value.includes("\n")) {
    return `"${value.replace(/"/g, '""')}"`;
  }
  return value;
}

interface Ancestors {
  layer: string;
  object: string;
  table: string;
  attribute: string;
}

function resolveAncestors(
  nodeId: string,
  byId: Map<string, { id: string; name: string; type: string; parentId: string | null }>
): Ancestors {
  const node = byId.get(nodeId);
  if (!node) return { layer: "", object: "", table: "", attribute: "" };

  // Walk up the parent chain collecting names by type
  const chain: { name: string; type: string }[] = [];
  let current: { id: string; name: string; type: string; parentId: string | null } | undefined = node;
  while (current) {
    chain.unshift({ name: current.name, type: current.type });
    current = current.parentId ? byId.get(current.parentId) : undefined;
  }

  const get = (type: string) => chain.find((c) => c.type === type)?.name ?? "";

  return {
    layer: get("Layer"),
    object: get("Object"),
    table: get("Group"),
    attribute: get("Attribute"),
  };
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

export function exportModelCsv(model: Model): void {
  const byId = new Map(model.nodes.map((n) => [n.id, n]));

  const lines: string[] = [CSV_HEADERS.join(",")];

  for (const edge of model.edges) {
    const src = resolveAncestors(edge.sourceNodeId, byId);
    const tgt = resolveAncestors(edge.targetNodeId, byId);

    const row = [
      src.layer,
      src.object,
      src.table,
      src.attribute,
      tgt.layer,
      tgt.object,
      tgt.table,
      tgt.attribute,
      edge.kind ?? "",
      edge.note ?? "",
    ].map(quoteField);

    lines.push(row.join(","));
  }

  const csv = lines.join("\r\n");
  const blob = new Blob([csv], { type: "text/csv" });
  downloadBlob(blob, `${model.name}.lineage.csv`);
}
