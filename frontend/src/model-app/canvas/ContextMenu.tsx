import { useEffect, useRef } from "react";
import type { Model, NodeType } from "../types";
import type { MenuTarget } from "./menu";
import { PASTE_ACCEPTS as ACCEPTS } from "../editor/useModelEditor";

interface Props {
  x: number;
  y: number;
  target: MenuTarget;
  model: Model;
  onAdd: (type: NodeType, parentId: string | null) => void;
  onDelete: (id: string) => void;
  onMove: (id: string, dir: "up" | "down") => void;
  onCopy: (id: string) => void;
  onCut: (id: string) => void;
  onPaste: (targetId: string) => void;
  onDuplicate: (id: string) => void;
  clipboardType: NodeType | null;
  onClose: () => void;
}

interface Item {
  label: string;
  run: () => void;
  danger?: boolean;
}

// Right-click menu whose actions depend on what was clicked. Each entry adds a
// child node or deletes the target, mirroring the Layer > Object > Group >
// Attribute hierarchy (attributes can also nest under attributes).
export default function ContextMenu({
  x,
  y,
  target,
  model,
  onAdd,
  onDelete,
  onMove,
  onCopy,
  onCut,
  onPaste,
  onDuplicate,
  clipboardType,
  onClose,
}: Props) {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const onDoc = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) onClose();
    };
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    document.addEventListener("mousedown", onDoc);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDoc);
      document.removeEventListener("keydown", onKey);
    };
  }, [onClose]);

  const node =
    target.kind === "node" ? model.nodes.find((n) => n.id === target.id) : undefined;

  const items: Item[] = [];
  const add = (label: string, type: NodeType, parentId: string | null) =>
    items.push({ label, run: () => onAdd(type, parentId) });

  // Add "Move up / Move down" for a node that has same-type siblings to swap
  // with (reorder within the same parent).
  const addMove = (n: NonNullable<typeof node>) => {
    const siblings = model.nodes.filter(
      (s) => s.parentId === n.parentId && s.type === n.type
    );
    const pos = siblings.findIndex((s) => s.id === n.id);
    if (pos > 0) items.push({ label: "Move up", run: () => onMove(n.id, "up") });
    if (pos < siblings.length - 1)
      items.push({ label: "Move down", run: () => onMove(n.id, "down") });
  };

  // Copy a node + its subtree; Paste it nested into a target whose type can hold
  // the clipboard's type.
  const addCopy = (id: string) =>
    items.push({ label: "Copy", run: () => onCopy(id) });
  const addCut = (id: string) =>
    items.push({ label: "Cut", run: () => onCut(id) });
  const addDuplicate = (id: string) =>
    items.push({ label: "Duplicate", run: () => onDuplicate(id) });
  const addPaste = (parentType: NodeType, parentId: string) => {
    if (clipboardType && ACCEPTS[parentType].includes(clipboardType)) {
      items.push({ label: `Paste ${clipboardType}`, run: () => onPaste(parentId) });
    }
  };

  if (target.kind === "pane") {
    add("Add Layer", "Layer", null);
  } else if (target.kind === "layerArea") {
    add("Add Object", "Object", target.layerId);
    add("Add Table", "Group", target.layerId);
    addPaste("Layer", target.layerId);
    add("Add Layer", "Layer", null);
  } else if (node) {
    switch (node.type) {
      case "Layer":
        add("Add Object", "Object", node.id);
        add("Add Table", "Group", node.id);
        addDuplicate(node.id);
        addPaste("Layer", node.id);
        items.push({ label: "Delete Layer", run: () => onDelete(node.id), danger: true });
        break;
      case "Object":
        add("Add Table", "Group", node.id);
        addMove(node);
        addCopy(node.id);
        addDuplicate(node.id);
        addPaste("Object", node.id);
        items.push({ label: "Delete Object", run: () => onDelete(node.id), danger: true });
        break;
      case "Group":
        add("Add Attribute", "Attribute", node.id);
        addMove(node);
        addCopy(node.id);
        addDuplicate(node.id);
        addPaste("Group", node.id);
        items.push({ label: "Delete Table", run: () => onDelete(node.id), danger: true });
        break;
      case "Attribute":
        add("Add Nested Attribute", "Attribute", node.id);
        add("Add Attribute Below", "Attribute", node.parentId);
        addMove(node);
        addCopy(node.id);
        addCut(node.id);
        addDuplicate(node.id);
        addPaste("Attribute", node.id);
        items.push({ label: "Delete Attribute", run: () => onDelete(node.id), danger: true });
        break;
    }
  }

  return (
    <div
      ref={ref}
      className="context-menu"
      style={{ left: x, top: y }}
      onContextMenu={(e) => e.preventDefault()}
    >
      {node && <div className="context-menu-head">{node.name || node.type}</div>}
      {items.map((it) => (
        <button
          key={it.label}
          className={`context-menu-item${it.danger ? " is-danger" : ""}`}
          onClick={() => {
            it.run();
            onClose();
          }}
        >
          {it.label}
        </button>
      ))}
    </div>
  );
}
