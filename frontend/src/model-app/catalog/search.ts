// Cross-model catalog search + light impact analysis. Pure functions over the
// list of accessible models (each carrying its nodes) so a single fetch backs
// both search and the "also appears in" lookup.
import type { CatalogModelData, CatalogMatch, LineageNode } from "../types";
import { readMeta } from "../editor/attributeMeta";

// Substring match over a node's name, description, and transformation logic.
function matchesQuery(node: LineageNode, q: string): boolean {
  if (node.name?.toLowerCase().includes(q)) return true;
  const desc = readMeta(node.properties ?? {}, "description").toLowerCase();
  if (desc.includes(q)) return true;
  if (node.transformation_logic?.toLowerCase().includes(q)) return true;
  return false;
}

export function searchCatalog(models: CatalogModelData[], query: string): CatalogMatch[] {
  const q = query.trim().toLowerCase();
  if (!q) return [];
  const out: CatalogMatch[] = [];
  for (const m of models) {
    for (const node of m.nodes) {
      if (matchesQuery(node, q)) {
        out.push({ modelId: m.id, modelName: m.name, node });
      }
    }
  }
  return out;
}

// "Also appears in": other models holding a node that looks like the same
// thing. Prefers an exact external-id match (populated once a node came from a
// connector sync — see enterprise-plan.md §2); otherwise falls back to a
// case-insensitive name match. Excludes the node's own model.
export function findRelated(
  models: CatalogModelData[],
  node: LineageNode,
  ownModelId: string
): CatalogMatch[] {
  const extId = node.externalId;
  const name = node.name?.toLowerCase() ?? "";
  const out: CatalogMatch[] = [];
  for (const m of models) {
    if (m.id === ownModelId) continue;
    for (const other of m.nodes) {
      const sameExternal = extId && other.externalId === extId;
      const sameName = !extId && other.name?.toLowerCase() === name && name !== "";
      if (sameExternal || sameName) {
        out.push({ modelId: m.id, modelName: m.name, node: other });
      }
    }
  }
  return out;
}
