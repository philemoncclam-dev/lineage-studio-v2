import type { Model, LineageNode, EdgeKind } from "../types";

// How each edge kind reads in a sentence, e.g. "derived from".
const KIND_VERB: Record<EdgeKind, string> = {
  copy: "copied from",
  aggregate: "aggregated from",
  derive: "derived from",
  filter: "filtered from",
};

// One node on an attribute's lineage path. `depth` is the signed distance from
// the focus attribute: negative = upstream (a source), positive = downstream (a
// target), 0 = the focus itself.
export interface LineageStep {
  id: string;
  name: string;
  path: string; // ancestor trail, e.g. "Landing (_LH_L) ▸ landing_source_dataset"
  logic: string; // the node's transformation_logic (trimmed; "" if none)
  depth: number;
  // Kind of the edge connecting this step to the *next* step toward the
  // focus (i.e. the edge this node's value flows across). Undefined if that
  // edge has no kind set, or for the focus step itself.
  edgeKind?: EdgeKind;
}

export interface LineageNarrative {
  focus: LineageStep;
  upstream: LineageStep[]; // ordered origin → nearest source (ascending depth)
  downstream: LineageStep[]; // ordered nearest target → terminal (ascending depth)
  transformations: number; // count of steps that carry transformation_logic
  text: string; // rendered plain-English narration
}

// The ancestor trail (Layer ▸ Object ▸ Table) above a node, top-down. Mirrors
// the path shown in the search panel.
function pathOf(byId: Map<string, LineageNode>, id: string): string {
  const parts: string[] = [];
  let parentId = byId.get(id)?.parentId ?? null;
  while (parentId) {
    const n = byId.get(parentId);
    if (!n) break;
    parts.unshift(n.name);
    parentId = n.parentId;
  }
  return parts.join(" ▸ ");
}

const push = (m: Map<string, string[]>, key: string, val: string) => {
  const arr = m.get(key);
  if (arr) arr.push(val);
  else m.set(key, [val]);
};

// Build a deterministic narration of an attribute's lineage straight from the
// graph — no model/LLM involved. Returns null if the id isn't a known node.
export function lineageNarrative(model: Model, attrId: string): LineageNarrative | null {
  const byId = new Map(model.nodes.map((n) => [n.id, n]));
  const focusNode = byId.get(attrId);
  if (!focusNode) return null;

  // Directional adjacency: sources feeding a node, and targets it feeds.
  const incoming = new Map<string, string[]>();
  const outgoing = new Map<string, string[]>();
  // Edge kind keyed by "sourceId targetId", so a step can look up the kind of
  // the edge that carried it from its neighbor toward the focus.
  const kindOf = new Map<string, EdgeKind | undefined>();
  for (const e of model.edges) {
    push(outgoing, e.sourceNodeId, e.targetNodeId);
    push(incoming, e.targetNodeId, e.sourceNodeId);
    kindOf.set(`${e.sourceNodeId} ${e.targetNodeId}`, e.kind);
  }

  const toStep = (id: string, depth: number, edgeKind?: EdgeKind): LineageStep => {
    const n = byId.get(id)!;
    return { id, name: n.name, path: pathOf(byId, id), logic: n.transformation_logic.trim(), depth, edgeKind };
  };

  // BFS outward from the focus following one direction only, recording the
  // shortest depth at which each node is reached (so sibling chains that share a
  // distant ancestor aren't double-counted).
  const walk = (adj: Map<string, string[]>, sign: 1 | -1): LineageStep[] => {
    const seen = new Set<string>([attrId]);
    const steps: LineageStep[] = [];
    let frontier = [attrId];
    let depth = 0;
    while (frontier.length) {
      depth++;
      const next: string[] = [];
      for (const id of frontier) {
        for (const nb of adj.get(id) ?? []) {
          if (seen.has(nb)) continue;
          seen.add(nb);
          next.push(nb);
          // The edge kind for this hop: upstream (sign -1) edges run
          // nb -> id; downstream (sign 1) edges run id -> nb.
          const kind = sign === -1 ? kindOf.get(`${nb} ${id}`) : kindOf.get(`${id} ${nb}`);
          steps.push(toStep(nb, sign * depth, kind));
        }
      }
      frontier = next;
    }
    return steps;
  };

  const focus = toStep(attrId, 0);
  // Upstream nearest-first from the walk; reorder origin → nearest for reading.
  const upstream = walk(incoming, -1).sort((a, b) => a.depth - b.depth);
  const downstream = walk(outgoing, 1); // already nearest → terminal

  const transformations = [...upstream, focus, ...downstream].filter((s) => s.logic).length;

  return { focus, upstream, downstream, transformations, text: render(focus, upstream, downstream) };
}

// Parse the ancestor path "Layer ▸ Object ▸ Group" into labelled parts.
// The path always stores ancestors top-down; the last segment is the table
// (Group), and the first is the Layer.
function locationLine(s: LineageStep): string {
  const parts = s.path.split(" ▸ ").map((p) => p.trim()).filter(Boolean);
  if (parts.length >= 2) {
    return `   Layer: ${parts[0]}  -  Table: ${parts[parts.length - 1]}`;
  }
  if (parts.length === 1) return `   Layer: ${parts[0]}`;
  return "";
}

function render(focus: LineageStep, upstream: LineageStep[], downstream: LineageStep[]): string {
  const lines: string[] = [];
  lines.push(`"${focus.name}" column lineage`);

  if (upstream.length === 0 && downstream.length === 0) {
    lines.push("");
    lines.push("No lineage connections are recorded for this attribute.");
    return lines.join("\n");
  }

  lines.push("");

  // Full chain: upstream (origin → nearest) then focus then downstream
  const chain: { step: LineageStep; isFocus: boolean }[] = [
    ...upstream.map((s) => ({ step: s, isFocus: false })),
    { step: focus, isFocus: true },
    ...downstream.map((s) => ({ step: s, isFocus: false })),
  ];

  chain.forEach((entry, i) => {
    const { step: s, isFocus } = entry;
    const marker = isFocus ? "  <- you are here" : "";
    lines.push(`- ${s.name}${marker}`);
    const loc = locationLine(s);
    if (loc) lines.push(loc);
    if (s.logic) lines.push(`   Transformation: ${s.logic}`);
    if (i < chain.length - 1) {
      // Downstream steps carry the edge kind of the hop *into* them (i.e.
      // from this step to the next); upstream steps (and the focus) don't
      // describe the next hop, so fall back to the generic connector.
      const next = chain[i + 1].step;
      const verb = !isFocus && s.depth < 0 ? undefined : next.edgeKind && KIND_VERB[next.edgeKind];
      lines.push(verb ? `   | ${verb}` : "   |");
    }
  });

  const total = chain.length;
  const txCount = chain.filter((e) => e.step.logic).length;
  lines.push("");
  lines.push(`${total} step${total === 1 ? "" : "s"} - ${txCount} transformation${txCount === 1 ? "" : "s"}`);

  return lines.join("\n");
}
