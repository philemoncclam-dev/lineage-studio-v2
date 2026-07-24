import type { Model } from "../types";

// Pure keyboard focus-navigation over the canvas's visible node list.
//
// The canvas renders a strict hierarchy (Layer > Object > Group > Attribute),
// but keyboard users move through a flattened, order-preserving list of
// "focusable" ids: every Layer, Object, Group (table) and Attribute that is
// currently visible (i.e. not hidden behind a collapsed ancestor). Arrow keys
// move within that flattened list:
//   - Down/Up: next/previous focusable in document order (naturally goes
//     table -> its own attributes -> next table, matching visual reading order).
//   - Right: step INTO the current node's first child (if any and not collapsed).
//   - Left: step OUT to the current node's parent (if any).
// This mirrors a standard tree-view keyboard pattern (arrow keys) while
// staying a pure function of (model, collapsed, currentId) -> nextId, so it's
// trivial to unit test without any DOM/React involved.

export type ArrowDirection = "up" | "down" | "left" | "right";

/** Build the flattened, order-preserving list of focusable node ids. */
export function visibleFocusOrder(model: Model, collapsed: Set<string>): string[] {
  const childrenByParent = new Map<string | null, string[]>();
  for (const n of model.nodes) {
    const arr = childrenByParent.get(n.parentId);
    if (arr) arr.push(n.id);
    else childrenByParent.set(n.parentId, [n.id]);
  }
  const byId = new Map(model.nodes.map((n) => [n.id, n]));

  const out: string[] = [];
  const visit = (parentId: string | null) => {
    for (const id of childrenByParent.get(parentId) ?? []) {
      out.push(id);
      // Layers are never "collapsed" in the traversal sense here (that state
      // lives elsewhere in the UI); Object/Group collapse hides descendants.
      if (collapsed.has(id)) continue;
      visit(id);
    }
  };
  visit(null);
  // Layers themselves are also included in the walk above since they're
  // top-level nodes with parentId === null; keep the natural document order.
  return out.filter((id) => byId.has(id));
}

/**
 * Given the current focused id (or null, meaning nothing focused yet) and an
 * arrow direction, return the id that should receive focus next. Returns null
 * if there is nowhere to go (e.g. Up from the first item, or Left from a
 * top-level Layer).
 */
export function nextFocusTarget(
  model: Model,
  collapsed: Set<string>,
  currentId: string | null,
  direction: ArrowDirection
): string | null {
  const order = visibleFocusOrder(model, collapsed);
  if (order.length === 0) return null;

  if (currentId === null) {
    // Nothing focused yet: any arrow key enters at the first focusable node.
    return order[0];
  }

  const idx = order.indexOf(currentId);
  if (idx === -1) return order[0];

  const byId = new Map(model.nodes.map((n) => [n.id, n]));
  const current = byId.get(currentId);

  switch (direction) {
    case "down":
      return idx + 1 < order.length ? order[idx + 1] : currentId;
    case "up":
      return idx - 1 >= 0 ? order[idx - 1] : currentId;
    case "right": {
      // Step into the first visible child, if the node has one and isn't
      // itself collapsed (a collapsed node has no visible children to enter).
      if (!current || collapsed.has(current.id)) return currentId;
      const child = model.nodes.find((n) => n.parentId === current.id);
      return child ? child.id : currentId;
    }
    case "left": {
      if (!current || current.parentId === null) return currentId;
      return current.parentId;
    }
    default:
      return currentId;
  }
}
