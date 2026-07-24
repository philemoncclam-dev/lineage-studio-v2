// Structural diff between two model snapshots (used by version history's
// compare view). Nodes and edges are matched by id — ids are stable across a
// model's version history, since a restore rewrites the stored data verbatim.
import type { Model, LineageNode, LineageEdge } from "../types";

export interface ModelDiff {
  added: LineageNode[];
  removed: LineageNode[];
  changed: { before: LineageNode; after: LineageNode }[];
  edgesAdded: LineageEdge[];
  edgesRemoved: LineageEdge[];
  // Attribute ids that are added or changed in `after` — drives canvas
  // highlighting (dim everything else).
  highlightAttrIds: Set<string>;
  counts: { added: number; removed: number; changed: number; edges: number };
}

// Fields whose change counts as a "changed" node (position x/y is deliberately
// ignored — a moved card isn't a semantic edit).
function nodeSignature(n: LineageNode): string {
  return JSON.stringify({
    type: n.type,
    name: n.name,
    parentId: n.parentId,
    logic: n.transformation_logic,
    props: n.properties ?? {},
  });
}

export function diffModels(base: Model, target: Model): ModelDiff {
  const baseById = new Map(base.nodes.map((n) => [n.id, n]));
  const targetById = new Map(target.nodes.map((n) => [n.id, n]));

  const added: LineageNode[] = [];
  const changed: { before: LineageNode; after: LineageNode }[] = [];
  const highlightAttrIds = new Set<string>();

  for (const n of target.nodes) {
    const prev = baseById.get(n.id);
    if (!prev) {
      added.push(n);
      if (n.type === "Attribute") highlightAttrIds.add(n.id);
    } else if (nodeSignature(prev) !== nodeSignature(n)) {
      changed.push({ before: prev, after: n });
      if (n.type === "Attribute") highlightAttrIds.add(n.id);
    }
  }

  const removed = base.nodes.filter((n) => !targetById.has(n.id));

  const baseEdgeIds = new Set(base.edges.map((e) => e.id));
  const targetEdgeIds = new Set(target.edges.map((e) => e.id));
  const edgesAdded = target.edges.filter((e) => !baseEdgeIds.has(e.id));
  const edgesRemoved = base.edges.filter((e) => !targetEdgeIds.has(e.id));

  return {
    added,
    removed,
    changed,
    edgesAdded,
    edgesRemoved,
    highlightAttrIds,
    counts: {
      added: added.length,
      removed: removed.length,
      changed: changed.length,
      edges: edgesAdded.length + edgesRemoved.length,
    },
  };
}
