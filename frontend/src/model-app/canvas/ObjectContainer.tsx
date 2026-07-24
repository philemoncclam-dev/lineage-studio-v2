import { memo, useState } from "react";
import { Handle, Position, type NodeProps } from "reactflow";
import { Icon } from "../ui/Icon";
import { TypeGlyph } from "../ui/TypeGlyph";
import type { ObjectContainerData } from "./layout";
import { useSelection } from "../editor/selection";
import { useCollapse } from "./collapse";
import { useMenu } from "./menu";
import { useRename } from "./rename";
import { useReorder } from "./reorder";
import { usePick } from "./pick";
import { useContested } from "./contested";
import { useSettings } from "../settings";

// One container = an optional Object band header + one or more table sections,
// rendered as a single node so the object reads (and selects) as one unit.
function ObjectContainerImpl({ data }: NodeProps<ObjectContainerData>) {
  const { selectedIds, onSelect } = useSelection();
  const { toggle } = useCollapse();
  const { openMenu } = useMenu();
  const { onRename } = useRename();
  const reorder = useReorder();
  const pick = usePick();
  const contested = useContested();
  const { settings } = useSettings();

  // Advisory-only marker: a colored ring/pill using the contesting
  // collaborator's presence color, so the user sees *which* object a peer is
  // also editing (the banner in EditorPage says *who*). Never blocks
  // anything — purely visual.
  const contestedStyle = (id: string): React.CSSProperties | undefined => {
    const entry = contested[id];
    if (!entry) return undefined;
    return { ["--contested-color" as string]: entry.collaborators[0].color };
  };
  const contestedClass = (id: string) => (contested[id] ? " is-contested" : "");

  // Row drag-reorder state, scoped to this container: the dragged attribute
  // (with its table, so drags don't cross tables) and the current insert
  // position. Cross-container drags never match `dragAttr` and are ignored.
  const [dragAttr, setDragAttr] = useState<{ id: string; groupId: string } | null>(null);
  const [dropAttr, setDropAttr] = useState<{ id: string; pos: "before" | "after" } | null>(null);
  const clearRowDrag = () => {
    setDragAttr(null);
    setDropAttr(null);
  };

  // In pick mode a click reports the id to the mapper instead of selecting it.
  // The red outline marks the chosen source/target.
  const pickClass = (id: string) =>
    pick.sourceId === id
      ? " is-pick-source"
      : pick.targetId === id
        ? " is-pick-target"
        : "";
  const selectOrPick = (id: string) => {
    if (pick.active) pick.onPick(id);
    else onSelect(id);
  };

  // Inline rename: which id is being edited (if any) and its draft text.
  const [editingId, setEditingId] = useState<string | null>(null);
  const [draft, setDraft] = useState("");

  function startEdit(id: string, current: string) {
    setEditingId(id);
    setDraft(current);
  }
  function commitEdit() {
    if (editingId && draft.trim()) onRename(editingId, draft.trim());
    setEditingId(null);
  }
  // A name that can be double-clicked to rename, swapping in an input while
  // editing. Mirrors the layer-header rename affordance.
  function nameField(id: string, name: string, className: string) {
    if (editingId === id) {
      return (
        <input
          className="inline-name-input"
          autoFocus
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onBlur={commitEdit}
          onClick={(e) => e.stopPropagation()}
          onDoubleClick={(e) => e.stopPropagation()}
          onKeyDown={(e) => {
            e.stopPropagation();
            if (e.key === "Enter") commitEdit();
            if (e.key === "Escape") setEditingId(null);
          }}
        />
      );
    }
    return (
      <span
        className={className}
        title="Double-click to rename"
        onDoubleClick={(e) => {
          e.stopPropagation();
          startEdit(id, name);
        }}
      >
        {name}
      </span>
    );
  }

  const band = data.band;
  const bandCollapsed = band?.collapsed ?? false;

  return (
    <div
      className={`object-container${data.selected ? " is-selected" : ""}${
        band ? pickClass(band.objectId) : ""
      }`}
      role="group"
      aria-label={band ? `${band.name} object` : undefined}
    >
      {band && (
        <div
          className={`ocontainer-band${contestedClass(band.objectId)}${
            pick.active ? pickClass(band.objectId) : ""
          }`}
          style={contestedStyle(band.objectId)}
          id={`focus-node-${band.objectId}`}
          role="group"
          aria-label={`${band.name}, object, ${band.tableCount} ${band.tableCount === 1 ? "table" : "tables"}`}
          aria-selected={selectedIds.has(band.objectId)}
          tabIndex={-1}
          onClick={(e) => {
            e.stopPropagation();
            selectOrPick(band.objectId);
          }}
          onContextMenu={(e) => {
            e.preventDefault();
            e.stopPropagation();
            onSelect(band.objectId);
            openMenu(e.clientX, e.clientY, { kind: "node", id: band.objectId, type: "Object" });
          }}
        >
          <button
            className="collapse-btn"
            title={bandCollapsed ? "Expand object" : "Collapse object"}
            onClick={(e) => {
              e.stopPropagation();
              toggle(band.objectId);
            }}
          >
            <Icon name={bandCollapsed ? "chevronRight" : "chevronDown"} />
          </button>
          {settings.showTypeIcons && (
            <span className="type-glyph" style={{ color: "var(--t-object)" }}>
              <TypeGlyph type="Object" />
            </span>
          )}
          {nameField(band.objectId, band.name, "ocontainer-band-name")}
          <span className="ocontainer-band-count">
            {band.tableCount} {band.tableCount === 1 ? "table" : "tables"}
          </span>
          {/* When the object is collapsed its attribute rows are gone, so edges
              re-route here (see layout.ts attrAnchor). Non-connectable: purely
              a landing point for existing lineage curves. */}
          {bandCollapsed && (
            <>
              <Handle id={`${band.objectId}-target-l`} type="target" position={Position.Left} className="attr-handle" isConnectable={false} />
              <Handle id={`${band.objectId}-source-l`} type="source" position={Position.Left} className="attr-handle" isConnectable={false} />
              <Handle id={`${band.objectId}-target-r`} type="target" position={Position.Right} className="attr-handle" isConnectable={false} />
              <Handle id={`${band.objectId}-source-r`} type="source" position={Position.Right} className="attr-handle" isConnectable={false} />
            </>
          )}
        </div>
      )}

      {!bandCollapsed &&
        data.tables.map((t) => (
          <div
            className={`otable${t.selected ? " is-selected" : ""}${pickClass(t.groupId)}`}
            key={t.groupId}
          >
            <div
              className={`otable-header${contestedClass(t.groupId)}${
                pick.active ? pickClass(t.groupId) : ""
              }`}
              style={contestedStyle(t.groupId)}
              id={`focus-node-${t.groupId}`}
              role="group"
              aria-label={`${t.label}, table, ${t.attrCount} attribute${t.attrCount === 1 ? "" : "s"}`}
              aria-selected={selectedIds.has(t.groupId)}
              tabIndex={-1}
              onClick={(e) => {
                e.stopPropagation();
                selectOrPick(t.groupId);
              }}
              onContextMenu={(e) => {
                e.preventDefault();
                e.stopPropagation();
                onSelect(t.groupId);
                openMenu(e.clientX, e.clientY, { kind: "node", id: t.groupId, type: "Group" });
              }}
            >
              <button
                className="collapse-btn"
                title={t.collapsed ? "Expand columns" : "Collapse columns"}
                onClick={(e) => {
                  e.stopPropagation();
                  toggle(t.groupId);
                }}
              >
                <Icon name={t.collapsed ? "chevronRight" : "chevronDown"} />
              </button>
              {settings.showTypeIcons && (
                <span className="type-glyph" style={{ color: "var(--t-group)" }}>
                  <TypeGlyph type="Group" />
                </span>
              )}
              {nameField(t.groupId, t.label, "otable-title")}
              <span className="otable-count" title={`${t.attrCount} attributes`}>
                {t.attrCount}
              </span>
              {/* Collapsed group: attribute rows are hidden, so their edges
                  re-route to this header (see layout.ts attrAnchor). */}
              {t.collapsed && (
                <>
                  <Handle id={`${t.groupId}-target-l`} type="target" position={Position.Left} className="attr-handle" isConnectable={false} />
                  <Handle id={`${t.groupId}-source-l`} type="source" position={Position.Left} className="attr-handle" isConnectable={false} />
                  <Handle id={`${t.groupId}-target-r`} type="target" position={Position.Right} className="attr-handle" isConnectable={false} />
                  <Handle id={`${t.groupId}-source-r`} type="source" position={Position.Right} className="attr-handle" isConnectable={false} />
                </>
              )}
            </div>

            {!t.collapsed && (
              <div className="otable-attrs" role="listbox" aria-label={`${t.label} attributes`}>
                {t.attributes.map((a) => (
                  <div
                    className={`attr-row${selectedIds.has(a.id) ? " attr-selected" : ""}${a.dimmed ? " attr-row--dimmed" : ""}${a.matched ? " attr-row--matched" : ""}${
                      dragAttr?.id === a.id ? " attr-row--dragging" : ""
                    }${
                      dropAttr?.id === a.id
                        ? ` attr-row--drop-${dropAttr.pos}`
                        : ""
                    }${pick.active ? pickClass(a.id) : ""}${contestedClass(a.id)}`}
                    key={a.id}
                    id={`attr-row-${a.id}`}
                    title={a.logic || a.name}
                    role="option"
                    aria-label={
                      a.logic ? `${a.name}, attribute, ${a.logic}` : `${a.name}, attribute`
                    }
                    aria-selected={selectedIds.has(a.id)}
                    tabIndex={-1}
                    style={{
                      ...(a.depth ? { paddingLeft: 12 + a.depth * 14 } : undefined),
                      ...contestedStyle(a.id),
                    }}
                    draggable={reorder.active && !pick.active && editingId !== a.id}
                    onDragStart={(e) => {
                      e.stopPropagation();
                      setDragAttr({ id: a.id, groupId: t.groupId });
                      e.dataTransfer.effectAllowed = "move";
                      e.dataTransfer.setData("text/attr-id", a.id);
                    }}
                    onDragOver={(e) => {
                      // Only rows of the same table are meaningful targets.
                      if (!dragAttr || dragAttr.groupId !== t.groupId || dragAttr.id === a.id)
                        return;
                      e.preventDefault();
                      e.dataTransfer.dropEffect = "move";
                      const r = e.currentTarget.getBoundingClientRect();
                      const pos = e.clientY < r.top + r.height / 2 ? "before" : "after";
                      if (dropAttr?.id !== a.id || dropAttr.pos !== pos)
                        setDropAttr({ id: a.id, pos });
                    }}
                    onDrop={(e) => {
                      e.preventDefault();
                      e.stopPropagation();
                      const dragged = e.dataTransfer.getData("text/attr-id") || dragAttr?.id;
                      if (dragged && dragged !== a.id && dropAttr?.id === a.id)
                        reorder.onReorder(dragged, a.id, dropAttr.pos);
                      clearRowDrag();
                    }}
                    onDragEnd={clearRowDrag}
                    onClick={(e) => {
                      e.stopPropagation();
                      if (pick.active) pick.onPick(a.id);
                      else onSelect(a.id, e.shiftKey);
                    }}
                    onContextMenu={(e) => {
                      e.preventDefault();
                      e.stopPropagation();
                      // Keep an existing multi-selection if this row is part of
                      // it (so "Copy" copies all selected attributes); otherwise
                      // select just this one.
                      if (!selectedIds.has(a.id)) onSelect(a.id);
                      openMenu(e.clientX, e.clientY, { kind: "node", id: a.id, type: "Attribute" });
                    }}
                  >
                    {/* Handles on both sides so an edge can leave/enter whichever
                        side faces its partner; the layout picks the side. */}
                    <Handle id={`${a.id}-target-l`} type="target" position={Position.Left} className="attr-handle" />
                    <Handle id={`${a.id}-source-l`} type="source" position={Position.Left} className="attr-handle" />
                    {settings.showTypeIcons && (
                      <span className="type-glyph" style={{ color: "var(--t-attr)" }}>
                        <TypeGlyph type="Attribute" />
                      </span>
                    )}
                    {nameField(a.id, a.name, "attr-name")}
                    {a.tags.length > 0 && (
                      <span className="attr-tags">
                        {a.tags.map((t) => (
                          <span
                            key={t.name}
                            className="attr-tag-chip"
                            style={{ ["--chip-color" as string]: t.color }}
                            title={t.name}
                          >
                            {t.name}
                          </span>
                        ))}
                      </span>
                    )}
                    <Handle id={`${a.id}-target-r`} type="target" position={Position.Right} className="attr-handle" />
                    <Handle id={`${a.id}-source-r`} type="source" position={Position.Right} className="attr-handle" />
                  </div>
                ))}
                {t.attributes.length === 0 && (
                  <div className="attr-row attr-empty">no attributes</div>
                )}
              </div>
            )}
          </div>
        ))}
    </div>
  );
}

// Re-render only when the container's content signature changes. Every layout
// pass builds a fresh `data` object, so an identity compare would always miss;
// selection/pick/menu state arrives via contexts, which bypass memo anyway.
export default memo(
  ObjectContainerImpl,
  (prev, next) => prev.data.sig === next.data.sig
);
