import { useState } from "react";
import { Icon } from "../ui/Icon";
import type { Model, LineageNode, TagDef } from "../types";
import { allTags, resolveTag, readTags, tagUsage, DEFAULT_TAG_COLOR } from "./tags";

interface Props {
  model: Model;
  selected: LineageNode | null; // the selected attribute (for assignment)
  setTagDef: (name: string, patch: Partial<Omit<TagDef, "name">>) => void;
  removeTag: (name: string) => void;
  renameTag: (oldName: string, newName: string) => void;
  toggleNodeTag: (id: string, name: string) => void;
}

// Tag manager: create tags, set their color + icon, delete them, and assign the
// selected attribute to a tag. Definitions live in the model registry; the same
// presentation is used on the canvas and in the filter.
export default function TagsPanel({ model, selected, setTagDef, removeTag, renameTag, toggleNodeTag }: Props) {
  const [draft, setDraft] = useState("");
  // Inline rename of an existing tag (double-click its name).
  const [editing, setEditing] = useState<string | null>(null);
  const [renameDraft, setRenameDraft] = useState("");

  const startRename = (name: string) => {
    setEditing(name);
    setRenameDraft(name);
  };
  const commitRename = () => {
    if (editing !== null) renameTag(editing, renameDraft);
    setEditing(null);
  };
  const tags = allTags(model);
  const isAttr = selected?.type === "Attribute";
  const assigned = isAttr ? new Set(readTags(selected!.properties as Record<string, unknown>)) : new Set<string>();

  const create = () => {
    const name = draft.trim();
    if (!name) return;
    setTagDef(name, { color: DEFAULT_TAG_COLOR });
    setDraft("");
  };

  return (
    <div className="tags-panel">
      <div className="tree-header">Tags</div>
      <div className="tags-body">
        <div className="tag-create">
          <input
            className="tag-create-input"
            placeholder="New tag name…"
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                create();
              }
            }}
          />
          <button className="tag-create-btn" onClick={create} disabled={!draft.trim()}>
            Add
          </button>
        </div>

        <p className={`tag-assign-hint${isAttr ? "" : " muted"}`}>
          {isAttr ? (
            <>
              Click a tag to add/remove it on <strong>{selected!.name}</strong>
            </>
          ) : (
            <>Select an attribute to assign tags</>
          )}
        </p>

        {tags.length === 0 ? (
          <p className="tag-empty">No tags yet — create one above</p>
        ) : (
          <div className="tag-rows">
            {tags.map((name) => {
              const rt = resolveTag(model, name);
              const on = assigned.has(name);
              return (
                <div className="tag-row" key={name}>
                  {editing === name ? (
                    <input
                      className="tag-rename-input"
                      autoFocus
                      value={renameDraft}
                      onChange={(e) => setRenameDraft(e.target.value)}
                      onBlur={commitRename}
                      onKeyDown={(e) => {
                        if (e.key === "Enter") {
                          e.preventDefault();
                          commitRename();
                        }
                        if (e.key === "Escape") setEditing(null);
                      }}
                    />
                  ) : (
                    <button
                      className={`tag-chip${on ? " is-on" : ""}${isAttr ? "" : " tag-chip-noassign"}`}
                      style={
                        on
                          ? { background: rt.color, borderColor: rt.color, color: "#fff" }
                          : { borderColor: rt.color }
                      }
                      title={
                        isAttr
                          ? (on ? "Remove from attribute" : "Add to attribute") + " · double-click to rename"
                          : "Double-click to rename"
                      }
                      onClick={() => isAttr && toggleNodeTag(selected!.id, name)}
                      onDoubleClick={(e) => {
                        e.stopPropagation();
                        startRename(name);
                      }}
                    >
                      <span className="tag-chip-dot" style={{ background: rt.color }} />
                      {name}
                      {on && <span className="tag-chip-check"><Icon name="checkmark" /></span>}
                    </button>
                  )}

                  <input
                    type="color"
                    className="tag-color"
                    value={rt.color}
                    title="Tag color"
                    onChange={(e) => setTagDef(name, { color: e.target.value })}
                  />
                  <span className="tag-usage" title="attributes with this tag">
                    {tagUsage(model, name)}
                  </span>
                  <button
                    className="tag-del"
                    title="Delete tag"
                    onClick={() => removeTag(name)}
                  >
                    ×
                  </button>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
