// Client-side Excel export to the Solidatus import format. Port of the former
// backend export.py, using SheetJS in the browser. SheetJS is heavy, so it is
// dynamically imported only when an export actually runs.
import type { Model, LineageNode } from "./types";
import { META_COLUMNS, readMeta } from "./editor/attributeMeta";

const HEADERS = [
  "Type",
  "Name",
  "Parent",
  "ID",
  "Source",
  "Target",
  "Properties",
  "transformation_logic",
  ...META_COLUMNS.map((c) => c.column),
];

const MULTI_DELIM = "; ";
// Order rows so parents precede children (Layer > Object > Group > Attribute).
const TYPE_ORDER: Record<string, number> = {
  Layer: 0,
  Object: 1,
  Group: 2,
  Attribute: 3,
};

// node id -> qualified path (ancestor names joined by "/")
function buildPaths(model: Model): Map<string, string> {
  const byId = new Map(model.nodes.map((n) => [n.id, n]));
  const cache = new Map<string, string>();
  const path = (id: string): string => {
    const cached = cache.get(id);
    if (cached) return cached;
    const node = byId.get(id)!;
    const result =
      node.parentId && byId.has(node.parentId)
        ? `${path(node.parentId)}/${node.name}`
        : node.name;
    cache.set(id, result);
    return result;
  };
  model.nodes.forEach((n) => path(n.id));
  return cache;
}

function buildRows(model: Model): (string | number)[][] {
  const paths = buildPaths(model);
  const byId = new Map(model.nodes.map((n) => [n.id, n]));

  const incoming = new Map<string, string[]>();
  const outgoing = new Map<string, string[]>();
  model.nodes.forEach((n) => {
    incoming.set(n.id, []);
    outgoing.set(n.id, []);
  });
  for (const e of model.edges) {
    if (byId.has(e.sourceNodeId) && byId.has(e.targetNodeId)) {
      outgoing.get(e.sourceNodeId)!.push(paths.get(e.targetNodeId)!);
      incoming.get(e.targetNodeId)!.push(paths.get(e.sourceNodeId)!);
    }
  }

  // Hierarchy order: depth-first by parent, types in canonical order then name.
  const children = new Map<string | null, LineageNode[]>();
  for (const n of model.nodes) {
    const arr = children.get(n.parentId) ?? [];
    arr.push(n);
    children.set(n.parentId, arr);
  }
  for (const arr of children.values()) {
    arr.sort((a, b) => {
      const ta = TYPE_ORDER[a.type] ?? 9;
      const tb = TYPE_ORDER[b.type] ?? 9;
      return ta !== tb ? ta - tb : a.name.localeCompare(b.name);
    });
  }

  const ordered: LineageNode[] = [];
  const walk = (parentId: string | null) => {
    for (const node of children.get(parentId) ?? []) {
      ordered.push(node);
      walk(node.id);
    }
  };
  walk(null);

  const rows: (string | number)[][] = [HEADERS];
  for (const node of ordered) {
    const parentPath =
      node.parentId && byId.has(node.parentId) ? paths.get(node.parentId)! : "";
    const props = node.properties as Record<string, unknown>;
    rows.push([
      node.type,
      node.name,
      parentPath,
      paths.get(node.id)!,
      incoming.get(node.id)!.join(MULTI_DELIM),
      outgoing.get(node.id)!.join(MULTI_DELIM),
      Object.keys(node.properties).length ? JSON.stringify(node.properties) : "",
      node.transformation_logic,
      // Readable metadata columns (attributes only).
      ...META_COLUMNS.map((c) => (node.type === "Attribute" ? readMeta(props, c.key) : "")),
    ]);
  }
  return rows;
}

const EDGE_HEADERS = ["Source", "Target", "Kind", "Note", "Verified"];

function buildEdgeRows(model: Model): (string | number)[][] {
  const paths = buildPaths(model);
  const byId = new Map(model.nodes.map((n) => [n.id, n]));
  const rows: (string | number)[][] = [EDGE_HEADERS];
  for (const e of model.edges) {
    if (!byId.has(e.sourceNodeId) || !byId.has(e.targetNodeId)) continue;
    rows.push([
      paths.get(e.sourceNodeId)!,
      paths.get(e.targetNodeId)!,
      e.kind ?? "",
      e.note ?? "",
      e.verified ? "true" : "",
    ]);
  }
  return rows;
}

const MODEL_HEADERS = ["Key", "Value"];

function buildModelRows(model: Model): (string | number)[][] {
  return [
    MODEL_HEADERS,
    ["Name", model.name],
    ["Description", model.description ?? ""],
    ["Labels", JSON.stringify(model.labels ?? [])],
    ["Tags", JSON.stringify(model.tags ?? [])],
  ];
}

export async function downloadModelXlsx(model: Model): Promise<void> {
  const XLSX = await import("xlsx");
  const ws = XLSX.utils.aoa_to_sheet(buildRows(model));
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, "Lineage");
  const edgesWs = XLSX.utils.aoa_to_sheet(buildEdgeRows(model));
  XLSX.utils.book_append_sheet(wb, edgesWs, "Edges");
  const modelWs = XLSX.utils.aoa_to_sheet(buildModelRows(model));
  XLSX.utils.book_append_sheet(wb, modelWs, "Model");
  const safe = (model.name.replace(/[^A-Za-z0-9._-]+/g, "_").replace(/^_+|_+$/g, "")) || "model";
  XLSX.writeFile(wb, `${safe}.xlsx`);
}
