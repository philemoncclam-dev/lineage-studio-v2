import type { LineageNode } from "../types";

/**
 * Move `id` to sit directly before/after `targetId` among its siblings.
 * Render order follows array order within `nodes`, so this splices the node's
 * array slot. Both nodes must share the same parent and type (matching the
 * moveNode up/down semantics); anything else is a no-op.
 *
 * Mutates `nodes` in place and returns whether a move happened — callers
 * invoke it inside `mutate`, which already works on a fresh clone.
 */
export function reorderNodes(
  nodes: LineageNode[],
  id: string,
  targetId: string,
  pos: "before" | "after"
): boolean {
  if (id === targetId) return false;
  const node = nodes.find((n) => n.id === id);
  const target = nodes.find((n) => n.id === targetId);
  if (!node || !target) return false;
  if (node.parentId !== target.parentId || node.type !== target.type) return false;
  nodes.splice(nodes.indexOf(node), 1);
  const to = nodes.indexOf(target);
  nodes.splice(pos === "before" ? to : to + 1, 0, node);
  return true;
}
