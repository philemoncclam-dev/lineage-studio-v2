import { forwardRef, useState } from "react";
import { Icon } from "../ui/Icon";
import { TypeGlyph } from "../ui/TypeGlyph";
import { usePick } from "./pick";
import { useSettings } from "../settings";

// One entry per layer, in model order, with its column width from the layout
// (hidden layers keep a thin sliver so headers stay aligned with the canvas).
export interface HeaderLayer {
  id: string;
  name: string;
  w: number;
  hidden: boolean;
}

interface Props {
  layers: HeaderLayer[];
  collapsed: Set<string>;
  onToggle: (id: string) => void;
  contentWidth: number;
  onReorder: (draggedId: string, targetIndex: number) => void;
  onRename: (id: string, name: string) => void;
  onToggleHidden: (id: string) => void;
  onCollapseAll: () => void;
  onExpandAll: () => void;
}

const LayerHeaders = forwardRef<HTMLDivElement, Props>(function LayerHeaders(
  {
    layers,
    collapsed,
    onToggle,
    contentWidth,
    onReorder,
    onRename,
    onToggleHidden,
    onCollapseAll,
    onExpandAll,
  },
  ref
) {
  const [dragId, setDragId] = useState<string | null>(null);
  const [dropIndex, setDropIndex] = useState<number | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [draft, setDraft] = useState("");
  // "Pick from canvas" (the mapper's gesture): while active, a click on a
  // layer tab picks the whole layer as a source/target endpoint.
  const pick = usePick();
  const { settings } = useSettings();

  function commitEdit() {
    if (editingId && draft.trim()) onRename(editingId, draft.trim());
    setEditingId(null);
  }

  return (
    <div className="layer-headers-wrap">
      <div className="layer-headers" ref={ref}>
        <div className="layer-headers-row" style={{ width: contentWidth }}>
        {layers.map((l, index) => {
          if (l.hidden) {
            // Sliver stub for a hidden layer — click to show it again. Still a
            // valid drop target so layer reordering works across it.
            return (
              <button
                key={l.id}
                className={
                  "layer-header-stub" + (dropIndex === index ? " drop-target" : "")
                }
                style={{ flex: `0 0 ${l.w}px`, width: l.w }}
                title={`Show layer "${l.name}"`}
                onClick={() => onToggleHidden(l.id)}
                onDragOver={(e) => {
                  e.preventDefault();
                  e.dataTransfer.dropEffect = "move";
                  if (dropIndex !== index) setDropIndex(index);
                }}
                onDrop={(e) => {
                  e.preventDefault();
                  const dragged = e.dataTransfer.getData("text/layer-id") || dragId;
                  if (dragged && dragged !== l.id) onReorder(dragged, index);
                  setDragId(null);
                  setDropIndex(null);
                }}
              >
                <span className="layer-header-stub-name">{l.name}</span>
              </button>
            );
          }
          const isCollapsed = collapsed.has(l.id);
          return (
            <div
              key={l.id}
              className={
                "layer-header-tab" +
                (dragId === l.id ? " dragging" : "") +
                (dropIndex === index ? " drop-target" : "") +
                (pick.active ? " is-pickable" : "") +
                (pick.sourceId === l.id ? " is-pick-source" : "") +
                (pick.targetId === l.id ? " is-pick-target" : "")
              }
              style={{ flex: `0 0 ${l.w}px`, width: l.w }}
              title={pick.active ? `Use layer "${l.name}"` : l.name}
              onClick={() => {
                if (pick.active) pick.onPick(l.id);
              }}
              draggable={editingId !== l.id && !pick.active}
              onDragStart={(e) => {
                setDragId(l.id);
                e.dataTransfer.effectAllowed = "move";
                // Carry the id on the drag itself so the drop doesn't depend on
                // React state having flushed between dragstart and drop.
                e.dataTransfer.setData("text/layer-id", l.id);
              }}
              onDragOver={(e) => {
                e.preventDefault();
                e.dataTransfer.dropEffect = "move";
                if (dropIndex !== index) setDropIndex(index);
              }}
              onDrop={(e) => {
                e.preventDefault();
                const dragged = e.dataTransfer.getData("text/layer-id") || dragId;
                if (dragged && dragged !== l.id) onReorder(dragged, index);
                setDragId(null);
                setDropIndex(null);
              }}
              onDragEnd={() => {
                setDragId(null);
                setDropIndex(null);
              }}
            >
              <span className="layer-drag-handle" title="Drag to reorder">
                ⠿
              </span>
              <button
                className="collapse-btn"
                title={isCollapsed ? "Expand layer" : "Collapse layer"}
                onClick={(e) => {
                  e.stopPropagation();
                  onToggle(l.id);
                }}
              >
                <Icon name={isCollapsed ? "chevronRight" : "chevronDown"} />
              </button>
              {settings.showTypeIcons && (
                <span className="type-glyph" style={{ color: "var(--t-layer)" }}>
                  <TypeGlyph type="Layer" />
                </span>
              )}
              {editingId === l.id ? (
                <input
                  className="layer-header-name-input"
                  autoFocus
                  value={draft}
                  onChange={(e) => setDraft(e.target.value)}
                  onBlur={commitEdit}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") commitEdit();
                    if (e.key === "Escape") setEditingId(null);
                  }}
                  onClick={(e) => e.stopPropagation()}
                />
              ) : (
                <span
                  className="layer-header-name"
                  title="Double-click to rename"
                  onDoubleClick={() => {
                    setEditingId(l.id);
                    setDraft(l.name);
                  }}
                >
                  {l.name}
                </span>
              )}
              <button
                className="layer-hide-btn"
                title={`Hide layer "${l.name}"`}
                onClick={(e) => {
                  e.stopPropagation();
                  onToggleHidden(l.id);
                }}
              >
                ⊘
              </button>
            </div>
          );
        })}
        </div>
      </div>
      <div className="layer-headers-tools">
        <button title="Collapse all objects and tables" onClick={onCollapseAll}>
          ⊟
        </button>
        <button title="Expand all objects and tables" onClick={onExpandAll}>
          ⊞
        </button>
      </div>
    </div>
  );
});

export default LayerHeaders;
