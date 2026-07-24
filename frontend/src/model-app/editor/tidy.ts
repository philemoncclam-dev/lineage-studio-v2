// Auto-layout ("Tidy"): reorder siblings so lineage edges cross less. The
// canvas renders everything from model.nodes array order (layout.ts walks
// children in array order), so tidying is a pure reorder of that array — no
// coordinates involved, fully undoable like any other edit.
//
// Classic barycenter (median-average) heuristic for layered graphs: sweep the
// layer columns left→right then right→left; in each column, sort attributes by
// the average row position of the attributes they connect to on the already-
// placed side, then sort groups/objects by the average of their attributes.
// Unconnected siblings keep their current relative position.
import type { LineageNode, Model } from "../types";

interface Ctx {
  childrenOf: (parentId: string | null) => LineageNode[];
  order: Map<string, LineageNode[]>; // parentId -> (reordered) children
  layerOf: Map<string, number>; // node id -> layer column index
  rowOf: Map<string, number>; // attribute id -> row index within its column
  neighbors: Map<string, string[]>; // attr id -> connected attr ids
}

const byType = (nodes: LineageNode[], type: LineageNode["type"]) =>
  nodes.filter((n) => n.type === type);

// Attributes of a group in render order (nested attributes follow their parent,
// mirroring layout.ts's flattenAttrs).
function attrsInRenderOrder(ctx: Ctx, parentId: string): LineageNode[] {
  const out: LineageNode[] = [];
  for (const a of byType(ctx.order.get(parentId) ?? ctx.childrenOf(parentId), "Attribute")) {
    out.push(a);
    out.push(...attrsInRenderOrder(ctx, a.id));
  }
  return out;
}

// Containers of a layer in render order: bandless groups first, then objects
// (mirrors layout.ts).
function containersOf(ctx: Ctx, layerId: string): LineageNode[] {
  const kids = ctx.order.get(layerId) ?? ctx.childrenOf(layerId);
  return [...byType(kids, "Group"), ...byType(kids, "Object")];
}

function groupsOfContainer(ctx: Ctx, container: LineageNode): LineageNode[] {
  if (container.type === "Group") return [container];
  return byType(ctx.order.get(container.id) ?? ctx.childrenOf(container.id), "Group");
}

// Recompute row indexes for every attribute in one layer column.
function assignRows(ctx: Ctx, layerId: string): void {
  let row = 0;
  for (const container of containersOf(ctx, layerId)) {
    for (const group of groupsOfContainer(ctx, container)) {
      for (const a of attrsInRenderOrder(ctx, group.id)) ctx.rowOf.set(a.id, row++);
    }
  }
}

// Mean row of an attribute's neighbors on the given side of its column;
// undefined when it has none there.
function barycenter(ctx: Ctx, attrId: string, side: "left" | "right"): number | undefined {
  const col = ctx.layerOf.get(attrId);
  if (col === undefined) return undefined;
  let sum = 0;
  let n = 0;
  for (const other of ctx.neighbors.get(attrId) ?? []) {
    const oc = ctx.layerOf.get(other);
    const row = ctx.rowOf.get(other);
    if (oc === undefined || row === undefined) continue;
    if (side === "left" ? oc < col : oc > col) {
      sum += row;
      n++;
    }
  }
  return n === 0 ? undefined : sum / n;
}

// Stable sort of siblings by a score, where unscored items keep their current
// relative position (score = current index).
function sortBy<T>(items: T[], score: (item: T, index: number) => number): T[] {
  return items
    .map((item, i) => ({ item, key: score(item, i) }))
    .sort((a, b) => a.key - b.key)
    .map((x) => x.item);
}

function sweepLayer(ctx: Ctx, layerId: string, side: "left" | "right"): void {
  // Sort each group's top-level attributes (nested ones travel with their parent).
  const sortAttrs = (parentId: string): void => {
    const kids = ctx.order.get(parentId) ?? ctx.childrenOf(parentId);
    const attrs = byType(kids, "Attribute");
    const rest = kids.filter((n) => n.type !== "Attribute");
    const sorted = sortBy(attrs, (a, i) => {
      // Score a parent attribute by itself + its nested subtree.
      const subtree = [a, ...attrsInRenderOrder(ctx, a.id)];
      const scores = subtree
        .map((s) => barycenter(ctx, s.id, side))
        .filter((x): x is number => x !== undefined);
      if (scores.length === 0) return ctx.rowOf.get(a.id) ?? i;
      return scores.reduce((s, x) => s + x, 0) / scores.length;
    });
    ctx.order.set(parentId, [...rest, ...sorted]);
    for (const a of attrs) sortAttrs(a.id);
  };

  // Mean barycenter across a set of attributes (fallback: mean current row).
  const setScore = (attrs: LineageNode[], fallback: number): number => {
    const scores = attrs
      .map((a) => barycenter(ctx, a.id, side))
      .filter((x): x is number => x !== undefined);
    if (scores.length === 0) {
      const rows = attrs
        .map((a) => ctx.rowOf.get(a.id))
        .filter((x): x is number => x !== undefined);
      return rows.length ? rows.reduce((s, x) => s + x, 0) / rows.length : fallback;
    }
    return scores.reduce((s, x) => s + x, 0) / scores.length;
  };

  const kids = ctx.order.get(layerId) ?? ctx.childrenOf(layerId);
  for (const g of byType(kids, "Group")) sortAttrs(g.id);
  for (const o of byType(kids, "Object")) {
    const oKids = ctx.order.get(o.id) ?? ctx.childrenOf(o.id);
    const groups = byType(oKids, "Group");
    for (const g of groups) sortAttrs(g.id);
    // Order tables within the object.
    const sortedGroups = sortBy(groups, (g, i) => setScore(attrsInRenderOrder(ctx, g.id), i));
    const oRest = oKids.filter((n) => n.type !== "Group");
    ctx.order.set(o.id, [...oRest, ...sortedGroups]);
  }

  // Order containers within the layer (groups stay before objects, as rendered).
  const groups = byType(kids, "Group");
  const objects = byType(kids, "Object");
  const rest = kids.filter((n) => n.type !== "Group" && n.type !== "Object");
  const contScore = (c: LineageNode, i: number) =>
    setScore(
      groupsOfContainer(ctx, c).flatMap((g) => attrsInRenderOrder(ctx, g.id)),
      i
    );
  ctx.order.set(layerId, [
    ...rest,
    ...sortBy(groups, contScore),
    ...sortBy(objects, contScore),
  ]);

  assignRows(ctx, layerId);
}

/**
 * Returns a reordered copy of model.nodes that minimizes edge crossings.
 * Layers keep their column order; only the vertical order of containers,
 * tables, and attributes changes.
 */
export function tidyNodes(model: Model): LineageNode[] {
  const childrenByParent = new Map<string | null, LineageNode[]>();
  for (const n of model.nodes) {
    const arr = childrenByParent.get(n.parentId);
    if (arr) arr.push(n);
    else childrenByParent.set(n.parentId, [n]);
  }
  const ctx: Ctx = {
    childrenOf: (p) => childrenByParent.get(p) ?? [],
    order: new Map(),
    layerOf: new Map(),
    rowOf: new Map(),
    neighbors: new Map(),
  };

  // Column index for every node (via its ancestor layer).
  const layers = byType(model.nodes, "Layer");
  const parentOf = new Map(model.nodes.map((n) => [n.id, n.parentId]));
  const layerIndex = new Map(layers.map((l, i) => [l.id, i]));
  for (const n of model.nodes) {
    let cur: string | null | undefined = n.id;
    while (cur) {
      const li = layerIndex.get(cur);
      if (li !== undefined) {
        ctx.layerOf.set(n.id, li);
        break;
      }
      cur = parentOf.get(cur) ?? null;
    }
  }

  const link = (a: string, b: string) => {
    const arr = ctx.neighbors.get(a);
    if (arr) arr.push(b);
    else ctx.neighbors.set(a, [b]);
  };
  for (const e of model.edges) {
    link(e.sourceNodeId, e.targetNodeId);
    link(e.targetNodeId, e.sourceNodeId);
  }

  for (const l of layers) assignRows(ctx, l.id);

  // Left→right, then right→left — one round is the standard heuristic sweet spot.
  for (let i = 1; i < layers.length; i++) sweepLayer(ctx, layers[i].id, "left");
  for (let i = layers.length - 2; i >= 0; i--) sweepLayer(ctx, layers[i].id, "right");

  // Emit the new array: DFS in the tidied order; anything unreachable from a
  // layer (defensive) keeps its original position at the end.
  const out: LineageNode[] = [];
  const seen = new Set<string>();
  const emit = (n: LineageNode): void => {
    if (seen.has(n.id)) return;
    seen.add(n.id);
    out.push(n);
    for (const c of ctx.order.get(n.id) ?? ctx.childrenOf(n.id)) emit(c);
  };
  for (const l of layers) emit(l);
  for (const n of model.nodes) if (!seen.has(n.id)) out.push(n);
  return out;
}
