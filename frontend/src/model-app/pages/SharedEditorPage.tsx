// Public *editable* view of a shared model, opened via /share/:token/edit. Like
// SharedModelPage but with real editing wired up: it reuses useModelEditor with a
// persistence adapter that reads/writes the public `shared_models` row (no
// account needed — the unguessable token is the credential, same trust model as
// the read-only share). Edits autosave back to the share so collaborators always
// open the latest state.
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useParams, Link } from "react-router-dom";
import { Icon } from "../ui/Icon";
import Canvas from "../canvas/Canvas";
import ContextMenu from "../canvas/ContextMenu";
import type { MenuTarget } from "../canvas/menu";
import Inspector from "../editor/Inspector";
import EdgeInspector from "../editor/EdgeInspector";
import { SelectionContext } from "../editor/selection";
import { useModelEditor, type ModelPersistence } from "../editor/useModelEditor";
import { fetchShare, updateShare } from "../share";
import type { Model } from "../types";

const AUTOSAVE_MS = 1200;

export default function SharedEditorPage() {
  const { token } = useParams<{ token: string }>();

  // Persistence bound to the shared_models row. load() maps the snapshot to a
  // Model and grants the "editor" role only when the share opted into editing —
  // otherwise the role is "viewer" and useModelEditor blocks every mutation, and
  // we bounce the visitor to the read-only page below.
  const persistence = useMemo<ModelPersistence>(
    () => ({
      load: async () => {
        const s = await fetchShare(token!);
        const model: Model = {
          id: token!,
          name: s.name,
          nodes: s.nodes,
          edges: s.edges,
          tags: s.tags,
          createdAt: s.createdAt,
          updatedAt: s.updatedAt,
        };
        return { model, role: s.editable ? "editor" : "viewer" };
      },
      save: async (m) => {
        await updateShare(token!, m);
        return { ...m, updatedAt: new Date().toISOString() };
      },
    }),
    [token]
  );

  const ed = useModelEditor(token!, persistence);

  const [menu, setMenu] = useState<{ x: number; y: number; target: MenuTarget } | null>(null);
  const [selectedEdgeIds, setSelectedEdgeIds] = useState<string[]>([]);
  const [savedAt, setSavedAt] = useState<number | null>(null);

  const selectedSet = useMemo(() => new Set(ed.selectedIds), [ed.selectedIds]);
  const selectedNode = ed.model?.nodes.find((n) => n.id === ed.selectedId) ?? null;
  const selectedEdge =
    selectedEdgeIds.length === 1
      ? ed.model?.edges.find((e) => e.id === selectedEdgeIds[0]) ?? null
      : null;

  // Menu actions apply to the whole selection when the right-clicked node is
  // part of it (mirrors EditorPage.targetsForMenu).
  const targetsForMenu = useCallback(
    (nodeId: string) => (ed.selectedIds.includes(nodeId) ? ed.selectedIds : [nodeId]),
    [ed.selectedIds]
  );

  const handleEdgeSelection = useCallback((ids: string[]) => setSelectedEdgeIds(ids), []);

  // Debounced autosave: whenever the model is dirty and idle for AUTOSAVE_MS,
  // push it to the share. A manual Save button is also offered for immediacy.
  // `ed.save` is held in a ref so the effect only re-arms on dirty/saving flips,
  // not on every render (the hook returns a fresh object each time).
  const saveRef = useRef(ed.save);
  saveRef.current = ed.save;
  useEffect(() => {
    if (!ed.dirty || ed.saving) return;
    const t = setTimeout(() => {
      saveRef.current().then(() => setSavedAt(Date.now()));
    }, AUTOSAVE_MS);
    return () => clearTimeout(t);
  }, [ed.dirty, ed.saving]);

  if (ed.error) {
    return (
      <div className="share-view-error">
        <h1>Can’t open this link</h1>
        <p>{ed.error}</p>
      </div>
    );
  }
  if (!ed.model) return <p style={{ padding: "2rem" }}>Loading…</p>;

  // The share exists but isn't editable — send the visitor to the read-only view
  // rather than presenting an editor whose every action would silently no-op.
  if (ed.role === "viewer") {
    return (
      <div className="share-view-error">
        <h1>This link is view-only</h1>
        <p>The owner hasn't enabled editing for this shared model</p>
        <p>
          <Link to={`/share/${token}`}>Open the read-only view <Icon name="arrowRight" /></Link>
        </p>
      </div>
    );
  }

  const saveLabel = ed.saving
    ? "Saving…"
    : ed.dirty
      ? "Save"
      : savedAt
        ? "Saved"
        : "Up to date";

  return (
    <SelectionContext.Provider
      value={{ selectedId: ed.selectedId, selectedIds: selectedSet, onSelect: ed.select }}
    >
      <div className="share-view">
        <header className="share-view-bar">
          <div className="brand">
            <span className="brand-mark">L</span>
            <input
              className="editor-name"
              value={ed.model.name}
              onChange={(e) => ed.setName(e.target.value)}
              aria-label="Model name"
            />
          </div>
          <span className="share-view-badge share-view-badge--edit"><Icon name="edit" /> Shared — editing</span>
          <span className="editor-meta">
            {ed.model.nodes.length} nodes · {ed.model.edges.length} edges
          </span>
          <div className="share-edit-actions">
            <button className="ui-iconbtn" disabled={!ed.canUndo} onClick={ed.undo} title="Undo">
              <Icon name="undo" />
            </button>
            <button className="ui-iconbtn" disabled={!ed.canRedo} onClick={ed.redo} title="Redo">
              <Icon name="redo" />
            </button>
            <button
              className="ui-btn ui-btn--primary"
              disabled={!ed.dirty || ed.saving}
              onClick={() => ed.save().then(() => setSavedAt(Date.now()))}
            >
              {saveLabel}
            </button>
          </div>
        </header>

        <div className="share-view-body">
          <div className="editor-canvas">
            <Canvas
              model={ed.model}
              selectedId={ed.selectedId}
              selectedIds={selectedSet}
              onSelect={ed.select}
              onConnectAttrs={ed.addEdge}
              onOpenMenu={(x, y, target) => setMenu({ x, y, target })}
              onDeleteEdges={ed.deleteEdges}
              onEdgeSelection={handleEdgeSelection}
              onReorderLayer={ed.reorderLayer}
              onRenameLayer={(id, name) => ed.updateNode(id, { name })}
              onRenameNode={(id, name) => ed.updateNode(id, { name })}
              onReorderNode={ed.reorderNode}
              onAddLayer={() => ed.addNode("Layer", null)}
            />
          </div>
          {/* Details panel is contextual: it only takes screen space while a
              node or edge is selected, so the canvas gets the full width the
              rest of the time. */}
          {(selectedNode || selectedEdge) && (
            <aside className="share-edit-panel">
              <div className="details-panel">
                <div className="tree-header">
                  <span>Details</span>
                  <button
                    className="modal-close"
                    title="Close"
                    onClick={() => {
                      ed.setSelectedId(null);
                      setSelectedEdgeIds([]);
                    }}
                  >
                    ×
                  </button>
                </div>
                <div className="details-body">
                  {!selectedNode && selectedEdge ? (
                    <EdgeInspector
                      edge={selectedEdge}
                      model={ed.model}
                      onChange={(patch) => ed.updateEdge(selectedEdge.id, patch)}
                      onDelete={() => {
                        ed.deleteEdge(selectedEdge.id);
                        setSelectedEdgeIds([]);
                      }}
                    />
                  ) : (
                    <Inspector
                      node={selectedNode}
                      model={ed.model}
                      onChange={(patch) => selectedNode && ed.updateNode(selectedNode.id, patch)}
                      onDelete={() => selectedNode && ed.deleteNode(selectedNode.id)}
                    />
                  )}
                </div>
              </div>
            </aside>
          )}
        </div>
      </div>

      {menu && (
        <ContextMenu
          x={menu.x}
          y={menu.y}
          target={menu.target}
          model={ed.model}
          onAdd={(type, parentId) => ed.addNode(type, parentId)}
          onDelete={(nodeId) => ed.deleteNodes(targetsForMenu(nodeId))}
          onMove={(nodeId, dir) => ed.moveNode(nodeId, dir)}
          onCopy={(nodeId) => ed.copyNodes(targetsForMenu(nodeId))}
          onCut={(nodeId) => ed.cutNodes(targetsForMenu(nodeId))}
          onPaste={(targetId) => ed.pasteInto(targetId)}
          onDuplicate={(nodeId) => ed.duplicateNodes(targetsForMenu(nodeId))}
          clipboardType={ed.clipboardType}
          onClose={() => setMenu(null)}
        />
      )}
    </SelectionContext.Provider>
  );
}
