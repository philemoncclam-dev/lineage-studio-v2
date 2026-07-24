// The Alt "Add" submenu — the keyboard equivalent of right-clicking to add a
// node. Lists the valid add actions for the current selection, each with a
// key-tip so the two-level Alt flow (Alt → open → letter) can drive it. The
// container carries data-keytip-menu so KeyTips scopes its second-level tips
// here (see keytips.tsx).
import { useEffect } from "react";
import type { Model, NodeType } from "../types";
import { addTargets } from "./addTargets";

interface Props {
  model: Model;
  selectedId: string | null;
  onAdd: (type: NodeType, parentId: string | null) => void;
  onClose: () => void;
}

export default function AddMenu({ model, selectedId, onAdd, onClose }: Props) {
  const targets = addTargets(model, selectedId);

  useEffect(() => {
    const onDown = (e: MouseEvent) => {
      if (!(e.target as HTMLElement).closest(".add-menu")) onClose();
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [onClose]);

  return (
    <div className="add-menu" data-keytip-menu>
      <div className="add-menu-title">Add to canvas</div>
      {targets.map((t) => (
        <button
          key={t.type}
          className="add-menu-item"
          data-keytip={t.key}
          onClick={() => {
            onAdd(t.type, t.parentId);
            onClose();
          }}
        >
          <span className="add-menu-key">{t.key}</span>
          Add {t.label}
        </button>
      ))}
    </div>
  );
}
