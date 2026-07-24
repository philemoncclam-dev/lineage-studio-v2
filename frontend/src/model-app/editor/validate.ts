// Model validation — surfaces likely problems without mutating anything. Pure
// so it can drive both the rail badge count and the Validation panel list.
import type { Model, LineageNode } from "../types";
import { readMeta } from "./attributeMeta";

export type IssueKind = "unmapped" | "typeMismatch" | "orphan" | "cycle";

export interface ValidationIssue {
  kind: IssueKind;
  nodeId: string; // node to select/scroll to when the issue is clicked
  message: string;
}

export interface ValidationResult {
  issues: ValidationIssue[];
  byKind: Record<IssueKind, ValidationIssue[]>;
  // Attributes the user marked as intentionally unmapped (excluded from issues).
  acknowledged: ValidationIssue[];
}

// Property flag set when a user confirms it's OK for an attribute to have no
// lineage (see ValidationPanel's "Mark OK"). Round-trips as model data.
export const UNMAPPED_OK = "unmappedOk";

export const ISSUE_LABELS: Record<IssueKind, string> = {
  unmapped: "Unmapped attributes",
  typeMismatch: "Type mismatches",
  orphan: "Orphaned nodes",
  cycle: "Circular dependencies",
};

// Tarjan's strongly-connected-components: any component with more than one node
// (or a self-loop) contains a cycle. Runs over the attribute lineage graph.
function cyclicNodeIds(adj: Map<string, string[]>): Set<string> {
  let idx = 0;
  const index = new Map<string, number>();
  const low = new Map<string, number>();
  const onStack = new Set<string>();
  const stack: string[] = [];
  const cyclic = new Set<string>();

  const strongConnect = (v: string) => {
    index.set(v, idx);
    low.set(v, idx);
    idx++;
    stack.push(v);
    onStack.add(v);

    for (const w of adj.get(v) ?? []) {
      if (!index.has(w)) {
        strongConnect(w);
        low.set(v, Math.min(low.get(v)!, low.get(w)!));
      } else if (onStack.has(w)) {
        low.set(v, Math.min(low.get(v)!, index.get(w)!));
      }
    }

    if (low.get(v) === index.get(v)) {
      const comp: string[] = [];
      let w: string;
      do {
        w = stack.pop()!;
        onStack.delete(w);
        comp.push(w);
      } while (w !== v);
      // A component larger than one node is a cycle; a single node is only
      // cyclic if it links to itself.
      if (comp.length > 1 || (adj.get(v) ?? []).includes(v)) {
        comp.forEach((n) => cyclic.add(n));
      }
    }
  };

  for (const v of adj.keys()) if (!index.has(v)) strongConnect(v);
  return cyclic;
}

export function validateModel(model: Model): ValidationResult {
  const byId = new Map<string, LineageNode>(model.nodes.map((n) => [n.id, n]));
  const attrs = model.nodes.filter((n) => n.type === "Attribute");
  const touched = new Set<string>(); // attribute ids that any edge references
  const adj = new Map<string, string[]>();

  for (const e of model.edges) {
    touched.add(e.sourceNodeId);
    touched.add(e.targetNodeId);
    const arr = adj.get(e.sourceNodeId);
    if (arr) arr.push(e.targetNodeId);
    else adj.set(e.sourceNodeId, [e.targetNodeId]);
  }

  const issues: ValidationIssue[] = [];
  const acknowledged: ValidationIssue[] = [];

  // 1. Unmapped: an attribute no edge touches (no lineage at all). Attributes
  // the user has marked OK are moved aside rather than flagged.
  for (const a of attrs) {
    if (!touched.has(a.id)) {
      const item: ValidationIssue = {
        kind: "unmapped",
        nodeId: a.id,
        message: a.name || "(unnamed attribute)",
      };
      if (a.properties?.[UNMAPPED_OK] === true) acknowledged.push(item);
      else issues.push(item);
    }
  }

  // 2. Type mismatch across a mapping edge (both ends carry an explicit,
  // differing data type).
  for (const e of model.edges) {
    const s = byId.get(e.sourceNodeId);
    const t = byId.get(e.targetNodeId);
    if (!s || !t) continue;
    const st = readMeta(s.properties, "dataType");
    const tt = readMeta(t.properties, "dataType");
    if (st && tt && st !== tt) {
      issues.push({
        kind: "typeMismatch",
        nodeId: t.id,
        message: `${s.name} (${st}) → ${t.name} (${tt})`,
      });
    }
  }

  // 3. Orphan: a node whose parent id doesn't resolve to an existing node.
  for (const n of model.nodes) {
    if (n.parentId && !byId.has(n.parentId)) {
      issues.push({
        kind: "orphan",
        nodeId: n.id,
        message: `${n.name || n.type} references a missing parent`,
      });
    }
  }

  // 4. Circular dependency in the attribute lineage graph.
  for (const id of cyclicNodeIds(adj)) {
    const n = byId.get(id);
    issues.push({
      kind: "cycle",
      nodeId: id,
      message: n?.name || "(node in cycle)",
    });
  }

  const byKind: Record<IssueKind, ValidationIssue[]> = {
    unmapped: [],
    typeMismatch: [],
    orphan: [],
    cycle: [],
  };
  for (const it of issues) byKind[it.kind].push(it);

  return { issues, byKind, acknowledged };
}
