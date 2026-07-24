// Reverse of exportXlsx.ts — reads a Solidatus-format .xlsx back into a Model.
// Sheet: "Lineage"; columns: Type, Name, Parent, ID, Source, Target, Properties,
// transformation_logic (see exportXlsx.ts for exact format).
import type { Model, LineageNode, LineageEdge, NodeType } from "../types";
import { META_COLUMNS } from "./attributeMeta";

const MULTI_DELIM = "; ";
const VALID_TYPES = new Set<string>(["Layer", "Object", "Group", "Attribute"]);

const newId = () => crypto.randomUUID().replace(/-/g, "");

export async function importModelFromXlsx(file: File): Promise<Model> {
  const XLSX = await import("xlsx");
  const buffer = await file.arrayBuffer();
  let wb: import("xlsx").WorkBook;
  try {
    wb = XLSX.read(buffer, { type: "array" });
  } catch {
    throw new Error("Could not read Excel file.");
  }

  const sheetName = wb.SheetNames.find((n) => n === "Lineage") ?? wb.SheetNames[0];
  if (!sheetName) throw new Error("Excel file has no sheets.");
  const ws = wb.Sheets[sheetName];
  const rows = XLSX.utils.sheet_to_json<Record<string, string>>(ws, {
    defval: "",
    raw: false,
  });

  if (rows.length === 0) throw new Error("Excel sheet is empty.");

  // path (ID column) -> fresh node id
  const pathToId = new Map<string, string>();
  // path -> node (built in first pass)
  const nodes: LineageNode[] = [];

  // First pass: create all nodes, assign ids, resolve parentId from "Parent" path.
  for (const row of rows) {
    const typeName = (row["Type"] ?? "").trim();
    if (!VALID_TYPES.has(typeName)) continue;

    const name = (row["Name"] ?? "").trim();
    const parentPath = (row["Parent"] ?? "").trim();
    const qualifiedPath = (row["ID"] ?? "").trim() || (parentPath ? `${parentPath}/${name}` : name);
    const propertiesRaw = (row["Properties"] ?? "").trim();
    const transformationLogic = (row["transformation_logic"] ?? "").trim();

    let properties: Record<string, unknown> = {};
    if (propertiesRaw) {
      try {
        properties = JSON.parse(propertiesRaw) as Record<string, unknown>;
      } catch {
        // ignore malformed properties
      }
    }
    // Overlay the readable metadata columns when present (these win over the
    // Properties JSON so a hand-edited Excel sheet round-trips correctly).
    for (const c of META_COLUMNS) {
      const val = (row[c.column] ?? "").trim();
      if (val) properties[c.key] = val;
    }

    const nodeId = newId();
    pathToId.set(qualifiedPath, nodeId);

    const node: LineageNode = {
      id: nodeId,
      type: typeName as NodeType,
      name,
      parentId: null, // resolved in second pass
      properties,
      transformation_logic: transformationLogic,
      x: 0,
      y: 0,
    };
    nodes.push(node);
  }

  // Second pass: resolve parentId using Parent path column.
  let rowIdx = 0;
  for (const row of rows) {
    const typeName = (row["Type"] ?? "").trim();
    if (!VALID_TYPES.has(typeName)) continue;
    const parentPath = (row["Parent"] ?? "").trim();
    if (parentPath) {
      const parentNodeId = pathToId.get(parentPath);
      if (parentNodeId) nodes[rowIdx].parentId = parentNodeId;
    }
    rowIdx++;
  }

  // Third pass: build edges from Source / Target columns.
  // Source = incoming paths (semi-colon delimited), Target = outgoing paths.
  // We use the outgoing (Target) column to avoid double-counting.
  const edges: LineageEdge[] = [];
  const edgeSeen = new Set<string>();

  rowIdx = 0;
  for (const row of rows) {
    const typeName = (row["Type"] ?? "").trim();
    if (!VALID_TYPES.has(typeName)) continue;

    const name = (row["Name"] ?? "").trim();
    const parentPath = (row["Parent"] ?? "").trim();
    const qualifiedPath = (row["ID"] ?? "").trim() || (parentPath ? `${parentPath}/${name}` : name);
    const sourceNodeId = pathToId.get(qualifiedPath);
    if (!sourceNodeId) { rowIdx++; continue; }

    const targetPaths = (row["Target"] ?? "")
      .split(MULTI_DELIM)
      .map((p) => p.trim())
      .filter(Boolean);

    for (const tPath of targetPaths) {
      const targetNodeId = pathToId.get(tPath);
      if (!targetNodeId) continue;
      const key = `${sourceNodeId}:${targetNodeId}`;
      if (!edgeSeen.has(key)) {
        edgeSeen.add(key);
        edges.push({ id: newId(), sourceNodeId, targetNodeId });
      }
    }
    rowIdx++;
  }

  // Derive a model name from the filename (strip extension).
  const rawName = file.name.replace(/\.xlsx$/i, "").replace(/[_-]+/g, " ").trim() || "Imported Model";

  const now = new Date().toISOString();
  return {
    id: newId(),
    name: rawName,
    createdAt: now,
    updatedAt: now,
    nodes,
    edges,
  };
}
