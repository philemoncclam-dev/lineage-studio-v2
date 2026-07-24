import type { Model } from "../types";

export interface TraceResult {
  tracedNodeIds: Set<string>;
  tracedEdgeIds: Set<string>;
}

/**
 * Trace the lineage path of a single attribute: everything it flows FROM
 * (upstream) and everything it flows INTO (downstream). The two traversals are
 * strictly directional — upstream only ever steps target→source, downstream
 * only ever steps source→target — so unrelated sibling chains that merely share
 * a common ancestor or descendant are NOT pulled in. (A naive bidirectional BFS
 * would light up the entire connected component, which in a medallion model is
 * effectively every edge.)
 */
export function traceLineage(model: Model, selectedAttrId: string): TraceResult {
  const tracedNodeIds = new Set<string>([selectedAttrId]);
  const tracedEdgeIds = new Set<string>();

  // Adjacency: for each node, the edges leaving it (downstream) and entering it
  // (upstream), each paired with the neighbour on the other end.
  const outgoing = new Map<string, Array<{ edgeId: string; to: string }>>();
  const incoming = new Map<string, Array<{ edgeId: string; from: string }>>();

  for (const e of model.edges) {
    if (!outgoing.has(e.sourceNodeId)) outgoing.set(e.sourceNodeId, []);
    outgoing.get(e.sourceNodeId)!.push({ edgeId: e.id, to: e.targetNodeId });

    if (!incoming.has(e.targetNodeId)) incoming.set(e.targetNodeId, []);
    incoming.get(e.targetNodeId)!.push({ edgeId: e.id, from: e.sourceNodeId });
  }

  // Walk downstream: follow only outgoing edges.
  const walkDownstream = (id: string) => {
    for (const { edgeId, to } of outgoing.get(id) ?? []) {
      tracedEdgeIds.add(edgeId);
      if (!tracedNodeIds.has(to)) {
        tracedNodeIds.add(to);
        walkDownstream(to);
      }
    }
  };

  // Walk upstream: follow only incoming edges.
  const walkUpstream = (id: string) => {
    for (const { edgeId, from } of incoming.get(id) ?? []) {
      tracedEdgeIds.add(edgeId);
      if (!tracedNodeIds.has(from)) {
        tracedNodeIds.add(from);
        walkUpstream(from);
      }
    }
  };

  walkDownstream(selectedAttrId);
  walkUpstream(selectedAttrId);

  return { tracedNodeIds, tracedEdgeIds };
}
