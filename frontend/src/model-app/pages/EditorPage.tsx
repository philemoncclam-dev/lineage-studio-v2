import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { useParams, useNavigate, useSearchParams } from "react-router-dom";
import { Icon } from "../ui/Icon";
import Canvas from "../canvas/Canvas";
import ContextMenu from "../canvas/ContextMenu";
import type { MenuTarget } from "../canvas/menu";
import SearchPanel from "../editor/SearchPanel";
import FilterPanel from "../editor/FilterPanel";
import TagsPanel from "../editor/TagsPanel";
import ValidationPanel from "../editor/ValidationPanel";
import { validateModel } from "../editor/validate";
import Inspector from "../editor/Inspector";
import EdgeInspector from "../editor/EdgeInspector";
import ResizeHandle from "../editor/ResizeHandle";
import ImportSchema from "../editor/ImportSchema";
import ImportModel from "../editor/ImportModel";
import ImportDefinitions from "../editor/ImportDefinitions";
import SyncConnector from "../editor/SyncConnector";
import ImportHub from "../editor/ImportHub";
import ExportHub from "../editor/ExportHub";
import SettingsPanel from "../editor/SettingsPanel";
import { useSettings } from "../settings";
import AddMenu from "../editor/AddMenu";
import { getConnection } from "../connectors/connections";
import ShareDialog from "../editor/ShareDialog";
import AttributeMapper from "../editor/AttributeMapper";
import { SelectionContext } from "../editor/selection";
import { applyFilter, EMPTY_FILTER, type ModelFilter } from "../editor/filter";
import { useModelEditor } from "../editor/useModelEditor";
import { useCollaboration } from "../realtime/useCollaboration";
import { screenToScrollSpace } from "../realtime/cursorMapping";
import { describeContestedBanner } from "../realtime/conflictDetection";
import { api } from "../api";
import type { Model } from "../types";
import { Button } from "../ui";
import { ThemeToggle } from "../theme";
import { Tour } from "../tour/Tour";
import { hasSeenTour } from "../tour/tourSeen";

const PANEL_MIN = 200;
const PANEL_MAX = 480;

const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));

type Panel = null | "search" | "details" | "filter" | "tags" | "validation";

// A single vertical rail button (icon glyph + label).
function RailButton({
  icon,
  label,
  active,
  disabled,
  badge,
  keyTip,
  submenu,
  onClick,
  tour,
}: {
  icon: ReactNode;
  label: string;
  active?: boolean;
  disabled?: boolean;
  badge?: number;
  keyTip?: string;
  submenu?: boolean;
  onClick: () => void;
  // Anchor id for the onboarding tour (see src/tour/); omitted on buttons the
  // tour doesn't spotlight.
  tour?: string;
}) {
  return (
    <button
      className={`rail-btn${active ? " is-active" : ""}`}
      onClick={onClick}
      disabled={disabled}
      data-keytip={keyTip}
      data-keytip-submenu={submenu ? "" : undefined}
      data-tour={tour}
      title={label}
    >
      <span className="rail-btn-icon">
        {icon}
        {badge != null && badge > 0 && <span className="rail-btn-badge">{badge}</span>}
      </span>
      <span className="rail-btn-label">{label}</span>
    </button>
  );
}

export default function EditorPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const ed = useModelEditor(id!);
  const collab = useCollaboration({
    modelId: id!,
    model: ed.model,
    role: ed.role,
    onRemoteModel: ed.applyRemoteModel,
  });
  // Peer cursors already arrive in scroll-space content coordinates (see
  // realtime/cursorMapping.ts), which is exactly the coordinate system Canvas
  // renders `.live-cursor` dots in (absolutely positioned inside the sized
  // content wrapper, independent of *this* client's own scroll offset) — so
  // no further conversion is needed on the receiving side, only on the
  // reporting side (raw mouse event -> scroll-space, done in
  // handleCursorMove below via screenToScrollSpace).
  const liveCursors = collab.collaborators
    .filter((c) => c.cursor)
    .map((c) => ({ userId: c.userId, name: c.name, color: c.color, ...c.cursor! }));
  const handleCursorMove = useCallback(
    (
      clientX: number,
      clientY: number,
      rect: { left: number; top: number; scrollLeft: number; scrollTop: number }
    ) => {
      if (!collab.active) return;
      collab.reportCursor(screenToScrollSpace(clientX, clientY, rect));
    },
    [collab]
  );

  // Broadcast "editing focus": whenever the local selection changes, tell
  // peers which object id(s) we currently have selected (see
  // realtime/useCollaboration.ts's reportFocus, debounced there). A no-op
  // when inactive (local model / no collaborators) or for viewers (handled
  // inside reportFocus itself). Selection changes on deselect (empty array)
  // are sent immediately so a peer's conflict marker clears promptly.
  useEffect(() => {
    if (!collab.active) return;
    collab.reportFocus(ed.selectedIds);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [collab.active, ed.selectedIds]);

  // Banner dismissal: dismissing warns-about-this-object-right-now, keyed by
  // the primary selected object id so re-selecting it (or a save clearing the
  // conflict) naturally re-arms the warning for a *new* conflict later.
  const [dismissedContestKey, setDismissedContestKey] = useState<string | null>(null);
  // The model title reads as static text; double-clicking it turns it into an
  // input so the name isn't perpetually in a "rename me" state.
  const [renamingModel, setRenamingModel] = useState(false);
  // Snapshot the name when editing starts so Escape can restore it.
  const nameBeforeRenameRef = useRef("");
  const contestedEntries = Object.values(collab.contested);
  // Name the primary (most-recently-selected) contested object in the
  // banner when possible, falling back to the first contested entry — the
  // banner only ever calls out one object by name to stay short.
  const primaryContested =
    (ed.selectedId ? collab.contested[ed.selectedId] : undefined) ?? contestedEntries[0];
  const contestBannerKey = primaryContested?.objectId ?? null;
  const showConflictBanner =
    !!primaryContested && dismissedContestKey !== contestBannerKey;

  // Deep link from catalog search (/models/:id?focus=<nodeId>): once the model
  // has loaded, select the target node, then clear the param so a later manual
  // selection isn't fought and the URL stays clean.
  const focusId = searchParams.get("focus");
  const focusedRef = useRef(false);
  useEffect(() => {
    if (focusedRef.current || !focusId || !ed.model) return;
    if (ed.model.nodes.some((n) => n.id === focusId)) {
      ed.setSelectedId(focusId);
      focusedRef.current = true;
      setSearchParams({}, { replace: true });
    }
  }, [focusId, ed.model, ed.setSelectedId, setSearchParams]);

  const { settings } = useSettings();
  const [panel, setPanel] = useState<Panel>(null);
  const [panelWidth, setPanelWidth] = useState(248);
  const [modal, setModal] = useState<
    null | "importHub" | "import" | "map" | "importModel" | "importDefs" | "sync" | "share" | "exportHub" | "settings"
  >(null);
  const [searchQuery, setSearchQuery] = useState("");
  const [debouncedQuery, setDebouncedQuery] = useState("");
  const [filter, setFilter] = useState<ModelFilter>(EMPTY_FILTER);
  const [menu, setMenu] = useState<{ x: number; y: number; target: MenuTarget } | null>(
    null
  );
  // Edges selected on the canvas (mirrored out by Canvas). Selecting exactly
  // one shows the edge inspector in the Details panel.
  const [selectedEdgeIds, setSelectedEdgeIds] = useState<string[]>([]);
  const handleEdgeSelection = useCallback((ids: string[]) => {
    setSelectedEdgeIds(ids);
    // Clicking an edge opens its inspector (matches node-inspector tools).
    if (ids.length === 1) setPanel("details");
  }, []);
  const [addMenuOpen, setAddMenuOpen] = useState(false);
  // First-run onboarding tour (see src/tour/): runs once per browser, gated by
  // the "ls.tour.seen" localStorage flag, and can be replayed via the "Take
  // the tour" button below. Never auto-runs under automated tests (no
  // navigator.webdriver / jsdom "test" env), so `npm test` stays deterministic.
  const [tourRun, setTourRun] = useState(false);
  useEffect(() => {
    if (typeof navigator !== "undefined" && navigator.webdriver) return;
    if (import.meta.env.MODE === "test") return;
    if (!hasSeenTour()) setTourRun(true);
  }, []);
  const [syncPreset, setSyncPreset] = useState<string | undefined>(undefined);
  // Bumped after a sync applies so the "last synced" hint re-reads from storage.
  const [connBump, setConnBump] = useState(0);
  const connection = useMemo(
    () => (id ? getConnection(id) : null),
    [id, connBump]
  );

  // "Pick scopes from canvas" flow for the mapper: while `picking`, clicking an
  // object/table on the canvas sets the source (first click) then target
  // (second), after which the mapper reopens with both preset.
  const [picking, setPicking] = useState(false);
  const [pickSource, setPickSource] = useState<string | null>(null);
  const [mapPreset, setMapPreset] = useState<{ src: string | null; tgt: string | null }>({
    src: null,
    tgt: null,
  });

  const startPick = () => {
    setModal(null);
    setPickSource(null);
    setPicking(true);
  };
  const cancelPick = () => {
    setPicking(false);
    setPickSource(null);
  };
  const handlePickNode = (id: string) => {
    if (pickSource === null) {
      setPickSource(id);
      return;
    }
    if (id === pickSource) return; // clicking the source again is a no-op
    setPicking(false);
    setPickSource(null);
    // Attribute → attribute maps the pair directly — no need to route through
    // the mapper for a single edge. Any other pair (table/object/layer on
    // either end) reopens the mapper preset to both, which builds name-match
    // proposals immediately.
    const isAttr = (nid: string) =>
      ed.model?.nodes.find((n) => n.id === nid)?.type === "Attribute";
    if (isAttr(pickSource) && isAttr(id)) {
      ed.addEdge(pickSource, id);
      return;
    }
    setMapPreset({ src: pickSource, tgt: id });
    setModal("map");
  };

  const togglePanel = (p: Exclude<Panel, null>) =>
    setPanel((cur) => (cur === p ? null : p));

  // Keyboard: Delete/Backspace removes the selected node(s); Cmd+Z / Cmd+Shift+Z
  // undo/redo; Cmd+C / Cmd+V / Cmd+D copy / paste / duplicate the selection.
  // (Selected edges are handled inside Canvas.)
  const selectedIds = ed.selectedIds;
  const selectedId = ed.selectedId;
  const deleteNodes = ed.deleteNodes;
  const { undo, redo, copyNodes, pasteInto, duplicateNodes, canPasteInto } = ed;
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const el = document.activeElement as HTMLElement | null;
      const tag = el?.tagName;
      const inField = tag === "INPUT" || tag === "TEXTAREA" || el?.isContentEditable;

      const meta = e.metaKey || e.ctrlKey;
      if (meta && !e.shiftKey && e.key === "z") {
        if (inField) return;
        e.preventDefault();
        undo();
        return;
      }
      if ((meta && e.shiftKey && e.key === "z") || (e.ctrlKey && e.key === "y")) {
        if (inField) return;
        e.preventDefault();
        redo();
        return;
      }
      // Clipboard shortcuts. Never hijack the browser's native copy/paste while
      // the user is typing or has a text selection in a field.
      if (meta && (e.key === "c" || e.key === "C")) {
        if (inField || selectedIds.length === 0) return;
        e.preventDefault();
        copyNodes(selectedIds);
        return;
      }
      if (meta && (e.key === "v" || e.key === "V")) {
        if (inField || !selectedId || !canPasteInto(selectedId)) return;
        e.preventDefault();
        pasteInto(selectedId);
        return;
      }
      if (meta && (e.key === "d" || e.key === "D")) {
        if (inField || selectedIds.length === 0) return;
        e.preventDefault(); // otherwise Cmd/Ctrl+D bookmarks the page
        duplicateNodes(selectedIds);
        return;
      }
      if (e.key !== "Delete" && e.key !== "Backspace") return;
      if (inField) return;
      if (selectedIds.length === 0) return;
      e.preventDefault();
      deleteNodes(selectedIds);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [
    selectedIds,
    selectedId,
    deleteNodes,
    undo,
    redo,
    copyNodes,
    pasteInto,
    duplicateNodes,
    canPasteInto,
  ]);

  // Esc cancels canvas-pick mode.
  useEffect(() => {
    if (!picking) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") cancelPick();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [picking]);

  // Debounce the search query that drives the canvas dimming.
  useEffect(() => {
    const t = setTimeout(() => setDebouncedQuery(searchQuery), 150);
    return () => clearTimeout(t);
  }, [searchQuery]);

  const selectedSet = useMemo(() => new Set(ed.selectedIds), [ed.selectedIds]);
  const filterResult = useMemo(
    () => (ed.model ? applyFilter(ed.model, filter) : null),
    [ed.model, filter]
  );
  const validation = useMemo(
    () => (ed.model ? validateModel(ed.model) : null),
    [ed.model]
  );

  if (ed.error) return <div className="error">{ed.error}</div>;
  if (!ed.model) return <p style={{ padding: "2rem" }}>Loading…</p>;

  const selectedNode = ed.model.nodes.find((n) => n.id === ed.selectedId) ?? null;
  const selectedEdge =
    selectedEdgeIds.length === 1
      ? ed.model.edges.find((e) => e.id === selectedEdgeIds[0]) ?? null
      : null;
  // A right-click action targets the whole selection when the clicked node is
  // part of a multi-selection; otherwise just that node.
  const targetsForMenu = (nodeId: string) =>
    ed.selectedIds.includes(nodeId) && ed.selectedIds.length > 1
      ? ed.selectedIds
      : [nodeId];

  async function handleImportNew(model: Model) {
    const saved = await api.importModel(model);
    navigate(`/models/${saved.id}`);
  }
  async function handleReplace(model: Model) {
    if (!ed.model) return;
    await api.updateModel(ed.model.id, {
      name: model.name,
      nodes: model.nodes,
      edges: model.edges,
    });
    window.location.reload();
  }

  return (
    <SelectionContext.Provider
      value={{ selectedId: ed.selectedId, selectedIds: selectedSet, onSelect: ed.select }}
    >
      <div className="editor-shell">
        {/* ── Left activity rail ─────────────────────────────── */}
        <nav className={`activity-rail${settings.autoHideRail ? " is-autohide" : ""}`}>
          <RailButton icon={<Icon name="home" />} label="Home" keyTip="H" onClick={() => navigate("/")} />
          <RailButton
            icon={<Icon name="info" />}
            label="Overview"
            keyTip="O"
            onClick={() => navigate(`/models/${id}/overview`)}
          />
          {ed.role !== "local" && (
            <RailButton
              icon={<Icon name="history" />}
              label="History"
              keyTip="Y"
              onClick={() => navigate(`/models/${id}/versions`)}
            />
          )}
          <div className="rail-sep" />
          <RailButton
            icon={<Icon name="search" />}
            label="Search"
            keyTip="F"
            active={panel === "search"}
            onClick={() => togglePanel("search")}
          />
          <RailButton
            icon={<Icon name="sidebar" />}
            label="Details"
            keyTip="D"
            active={panel === "details"}
            onClick={() => togglePanel("details")}
          />
          <RailButton
            icon={<Icon name="filter" />}
            label="Filter"
            keyTip="I"
            active={panel === "filter" || (filterResult?.active ?? false)}
            onClick={() => togglePanel("filter")}
          />
          <RailButton
            icon={<Icon name="tag" />}
            label="Tags"
            keyTip="T"
            active={panel === "tags"}
            onClick={() => togglePanel("tags")}
          />
          <RailButton
            icon={<Icon name="check" />}
            label="Validate"
            keyTip="V"
            active={panel === "validation"}
            badge={validation?.issues.length}
            onClick={() => togglePanel("validation")}
          />
          <div className="rail-sep" />
          <RailButton
            icon={<Icon name="plus" />}
            label="Add"
            keyTip="1"
            submenu
            active={addMenuOpen}
            tour="rail-add"
            onClick={() => setAddMenuOpen((o) => !o)}
          />
          <RailButton
            icon={<Icon name="map" />}
            label="Map"
            keyTip="M"
            tour="rail-map"
            onClick={() => {
              setMapPreset({ src: null, tgt: null });
              setModal("map");
            }}
          />
          <RailButton icon={<Icon name="tidy" />} label="Tidy" keyTip="2" onClick={ed.applyTidy} />

          <div className="rail-menu-anchor">
            <RailButton
              icon={<Icon name="import" />}
              label="Import"
              keyTip="N"
              tour="rail-import"
              onClick={() => setModal("importHub")}
            />
          </div>

          <div className="rail-menu-anchor">
            <RailButton
              icon={<Icon name="export" />}
              label="Export"
              keyTip="E"
              tour="rail-export"
              onClick={() => setModal("exportHub")}
            />
          </div>

          <div className="rail-sep" />
          <RailButton icon={<Icon name="undo" />} label="Undo" keyTip="U" disabled={!ed.canUndo} onClick={undo} />
          <RailButton icon={<Icon name="redo" />} label="Redo" keyTip="R" disabled={!ed.canRedo} onClick={redo} />
          <div className="rail-spacer" />
          <RailButton
            icon={<Icon name="settings" />}
            label="Settings"
            keyTip="G"
            onClick={() => setModal("settings")}
          />
        </nav>

        {/* ── Flyout panel (Search / Details / Filter / Tags / Validate) ── */}
        {panel && (
          <>
            <aside className="side-panel" style={{ width: panelWidth }}>
              {panel === "search" && (
                <SearchPanel
                  model={ed.model}
                  query={searchQuery}
                  setQuery={setSearchQuery}
                  selectedId={ed.selectedId}
                  onSelect={ed.setSelectedId}
                />
              )}
              {panel === "filter" && filterResult && (
                <FilterPanel
                  model={ed.model}
                  filter={filter}
                  setFilter={setFilter}
                  matchCount={filterResult.matchCount}
                  attrCount={filterResult.attrCount}
                />
              )}
              {panel === "tags" && (
                <TagsPanel
                  model={ed.model}
                  selected={selectedNode}
                  setTagDef={ed.setTagDef}
                  removeTag={ed.removeTag}
                  renameTag={ed.renameTag}
                  toggleNodeTag={ed.toggleNodeTag}
                />
              )}
              {panel === "validation" && validation && (
                <ValidationPanel
                  result={validation}
                  onSelect={ed.setSelectedId}
                  onAcknowledge={(id) => ed.setUnmappedOk(id, true)}
                  onRestore={(id) => ed.setUnmappedOk(id, false)}
                />
              )}
              {panel === "details" && (
                <div className="details-panel">
                  <div className="tree-header">Details</div>
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
                        onChange={(patch) =>
                          selectedNode && ed.updateNode(selectedNode.id, patch)
                        }
                        onDelete={() => selectedNode && ed.deleteNode(selectedNode.id)}
                      />
                    )}
                  </div>
                </div>
              )}
            </aside>
            <ResizeHandle
              onResize={(dx) =>
                setPanelWidth((w) => clamp(w + dx, PANEL_MIN, PANEL_MAX))
              }
            />
          </>
        )}

        {/* ── Main column: slim header + canvas ──────────────── */}
        <div className="editor-main">
          <header className="canvas-topbar">
            {renamingModel ? (
              <input
                className="editor-name is-editing"
                value={ed.model.name}
                autoFocus
                onFocus={(e) => e.target.select()}
                onChange={(e) => ed.setName(e.target.value)}
                onBlur={() => setRenamingModel(false)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") setRenamingModel(false);
                  else if (e.key === "Escape") {
                    ed.setName(nameBeforeRenameRef.current);
                    setRenamingModel(false);
                  }
                }}
              />
            ) : (
              <span
                className="editor-name"
                title="Double-click to rename"
                onDoubleClick={() => {
                  nameBeforeRenameRef.current = ed.model?.name ?? "";
                  setRenamingModel(true);
                }}
              >
                {ed.model.name}
              </span>
            )}
            <span className="editor-meta">
              {ed.model.nodes.length} nodes · {ed.model.edges.length} edges
            </span>
            {collab.active && collab.collaborators.length > 0 && (
              <div className="collab-avatars" title="Collaborators currently viewing this model">
                {collab.collaborators.map((c) => (
                  <span
                    key={c.userId}
                    className="collab-avatar"
                    style={{ ["--avatar-color" as string]: c.color }}
                    title={c.name}
                  >
                    {c.name.slice(0, 1).toUpperCase()}
                  </span>
                ))}
              </div>
            )}
            <button
              className="ui-iconbtn"
              title="Take the tour"
              aria-label="Take the tour"
              onClick={() => setTourRun(true)}
            >
              ？
            </button>
            <ThemeToggle keyTip="K" />
            <Button variant="secondary" keyTip="A" onClick={() => setModal("share")}>
              Share
            </Button>
            <Button
              variant="primary"
              keyTip="G"
              onClick={async () => {
                await ed.save();
                // Notify peers only after the save round-trip succeeds, so we
                // never broadcast a revision the server doesn't actually have
                // yet (avoids a peer re-fetching and getting stale data).
                collab.broadcastModelChanged();
              }}
              disabled={!ed.dirty || ed.saving}
            >
              {ed.saving ? "Saving…" : ed.dirty ? "Save" : "Saved"}
            </Button>
          </header>

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
              onReorderNode={ed.canEdit ? ed.reorderNode : undefined}
              onAddLayer={() => ed.addNode("Layer", null)}
              searchQuery={debouncedQuery}
              filteredOut={filterResult?.active ? filterResult.filteredOut : undefined}
              filterActive={filterResult?.active ?? false}
              filterMode={filter.mode}
              pickMode={picking}
              pickSourceId={pickSource}
              onPickNode={handlePickNode}
              onCursorMove={collab.active ? handleCursorMove : undefined}
              liveCursors={collab.active ? liveCursors : undefined}
              contested={collab.active ? collab.contested : undefined}
            />
            {picking && (
              <div className="pick-banner">
                <span className="pick-banner-step">
                  {pickSource === null
                    ? "① Click the SOURCE — attribute, table, object, or layer"
                    : "② Now click the TARGET"}
                </span>
                <button className="pick-banner-cancel" onClick={cancelPick}>
                  Cancel (Esc)
                </button>
              </div>
            )}
            {showConflictBanner && primaryContested && (
              <div className="conflict-banner">
                <span className="conflict-banner-icon" aria-hidden="true">
                  <Icon name="warning" />
                </span>
                <span className="conflict-banner-text">
                  {describeContestedBanner(
                    primaryContested,
                    ed.model.nodes.find((n) => n.id === primaryContested.objectId)?.name ??
                      "this object"
                  )}
                </span>
                <button
                  className="conflict-banner-dismiss"
                  onClick={() => setDismissedContestKey(contestBannerKey)}
                >
                  Dismiss
                </button>
              </div>
            )}
          </div>
        </div>
      </div>

      {modal === "importHub" && (
        <ImportHub
          onClose={() => setModal(null)}
          connection={connection}
          onSync={(connectorId) => {
            setSyncPreset(connectorId);
            setModal("sync");
          }}
          onFile={(kind) =>
            setModal(kind === "schema" ? "import" : kind === "model" ? "importModel" : "importDefs")
          }
        />
      )}
      {modal === "import" && (
        <ImportSchema
          model={ed.model}
          onImport={(nodes) => ed.addStructure(nodes)}
          onClose={() => setModal(null)}
        />
      )}
      {modal === "importModel" && (
        <ImportModel
          currentModel={ed.model}
          onImportNew={handleImportNew}
          onReplace={handleReplace}
          onClose={() => setModal(null)}
        />
      )}
      {modal === "importDefs" && (
        <ImportDefinitions
          model={ed.model}
          applyDefinitions={ed.applyDefinitions}
          onClose={() => setModal(null)}
        />
      )}
      {modal === "sync" && (
        <SyncConnector
          model={ed.model}
          initialConnectorId={syncPreset}
          onApply={(nextNodes, nextEdges) => {
            ed.applyConnectorSync(nextNodes, nextEdges);
            setConnBump((n) => n + 1);
          }}
          onClose={() => setModal(null)}
        />
      )}
      {modal === "share" && (
        <ShareDialog model={ed.model} onClose={() => setModal(null)} />
      )}
      {modal === "exportHub" && ed.model && (
        <ExportHub model={ed.model} onClose={() => setModal(null)} />
      )}
      {modal === "settings" && <SettingsPanel onClose={() => setModal(null)} />}
      {modal === "map" && (
        <AttributeMapper
          model={ed.model}
          addEdge={ed.addEdge}
          deleteEdge={ed.deleteEdge}
          updateNode={ed.updateNode}
          onClose={() => setModal(null)}
          onStartPick={startPick}
          initialSrc={mapPreset.src}
          initialTgt={mapPreset.tgt}
        />
      )}

      {addMenuOpen && (
        <AddMenu
          model={ed.model}
          selectedId={ed.selectedId}
          onAdd={(type, parentId) => ed.addNode(type, parentId)}
          onClose={() => setAddMenuOpen(false)}
        />
      )}

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

      <Tour run={tourRun} onDone={() => setTourRun(false)} />
    </SelectionContext.Provider>
  );
}
