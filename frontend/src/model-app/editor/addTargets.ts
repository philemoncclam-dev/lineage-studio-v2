// Given the current selection, work out which "Add" actions are available and
// which parent each should attach to — mirroring the right-click context menu's
// rules (Layer > Object > Group > Attribute), but resolved for keyboard use so
// the Alt "Add" submenu can offer all four when the model supports them.
import type { Model, NodeType, LineageNode } from "../types";

export interface AddTarget {
  type: NodeType;
  key: string; // key-tip letter
  label: string; // shown in the menu ("Table" for a Group, matching the UI)
  parentId: string | null;
}

export function addTargets(model: Model, selectedId: string | null): AddTarget[] {
  const byId = new Map(model.nodes.map((n) => [n.id, n]));
  const self = selectedId ? byId.get(selectedId) ?? null : null;
  const lastOfType = (t: NodeType): LineageNode | undefined =>
    [...model.nodes].reverse().find((n) => n.type === t);

  // Walk self + ancestors, returning the nearest node of one of `types`.
  const selfOrAncestor = (types: NodeType[]): LineageNode | null => {
    let cur: LineageNode | null | undefined = self;
    while (cur) {
      if (types.includes(cur.type)) return cur;
      cur = cur.parentId ? byId.get(cur.parentId) : null;
    }
    return null;
  };

  const targets: AddTarget[] = [];

  // Layer: always available, top level.
  targets.push({ type: "Layer", key: "L", label: "Layer", parentId: null });

  // Object: needs a Layer parent (selected layer, nearest layer ancestor, or the
  // last layer in the model).
  const layer = selfOrAncestor(["Layer"]) ?? lastOfType("Layer");
  if (layer) targets.push({ type: "Object", key: "O", label: "Object", parentId: layer.id });

  // Group (table): sits under an Object, or directly under a Layer.
  const groupParent = selfOrAncestor(["Object", "Layer"]) ?? lastOfType("Object") ?? layer;
  if (groupParent) targets.push({ type: "Group", key: "G", label: "Table", parentId: groupParent.id });

  // Attribute: under a Group. If an attribute is selected, add a sibling under
  // its parent; otherwise use the nearest/last group.
  let attrParentId: string | null | undefined;
  if (self?.type === "Attribute") attrParentId = self.parentId;
  else attrParentId = (selfOrAncestor(["Group"]) ?? lastOfType("Group"))?.id;
  if (attrParentId)
    targets.push({ type: "Attribute", key: "A", label: "Attribute", parentId: attrParentId });

  return targets;
}
