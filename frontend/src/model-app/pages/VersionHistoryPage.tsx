// History of a model's saves — list past versions, preview one read-only, and
// restore it. Cloud-only (see enterprise-plan.md): local/signed-out models
// have no server-side snapshot trigger, so this page isn't reachable for them
// (EditorPage only shows the "History" rail button when role !== "local").
import { useEffect, useMemo, useState } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { api } from "../api";
import type { Model, ModelRole, ModelVersion, ModelVersionSummary } from "../types";
import { Button, Select } from "../ui";
import Canvas from "../canvas/Canvas";
import { SelectionContext } from "../editor/selection";
import { diffModels } from "../editor/diffModels";

const noop = () => {};

// The live model, represented as a pseudo-version so it always sorts first
// and can be selected/previewed the same way as a stored snapshot.
const CURRENT = "current";

export default function VersionHistoryPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();

  const [model, setModel] = useState<Model | null>(null);
  const [role, setRole] = useState<ModelRole>("local");
  const [versions, setVersions] = useState<ModelVersionSummary[] | null>(null);
  const [selectedId, setSelectedId] = useState<string>(CURRENT);
  const [preview, setPreview] = useState<ModelVersion | null>(null);
  // Optional "compare against" baseline: null = no diff, else CURRENT or a
  // version id. The canvas always shows the selected version; the diff is
  // computed relative to this baseline.
  const [compareId, setCompareId] = useState<string | null>(null);
  const [compareData, setCompareData] = useState<ModelVersion | null>(null);
  const [loading, setLoading] = useState(true);
  const [restoring, setRestoring] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      if (!id) return;
      setLoading(true);
      setError(null);
      try {
        const [{ model: m, role: r }, v] = await Promise.all([
          api.openModel(id),
          api.listVersions(id),
        ]);
        if (cancelled) return;
        setModel(m);
        setRole(r);
        setVersions(v);
      } catch (e) {
        if (!cancelled) setError(String(e));
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    load();
    return () => {
      cancelled = true;
    };
  }, [id]);

  // Fetch full node/edge data for whichever version is selected (current
  // model's data is already in hand; past versions are fetched on demand).
  useEffect(() => {
    let cancelled = false;
    if (selectedId === CURRENT) {
      setPreview(null);
      return;
    }
    api
      .getVersion(selectedId)
      .then((v) => {
        if (!cancelled) setPreview(v);
      })
      .catch((e) => !cancelled && setError(String(e)));
    return () => {
      cancelled = true;
    };
  }, [selectedId]);

  // Fetch the compare baseline's full data (CURRENT uses the live model).
  useEffect(() => {
    let cancelled = false;
    if (!compareId || compareId === CURRENT) {
      setCompareData(null);
      return;
    }
    api
      .getVersion(compareId)
      .then((v) => !cancelled && setCompareData(v))
      .catch((e) => !cancelled && setError(String(e)));
    return () => {
      cancelled = true;
    };
  }, [compareId]);

  const toModelShape = (v: ModelVersion): Model => ({
    id: model?.id ?? v.id,
    name: v.name,
    nodes: v.nodes,
    edges: v.edges,
    tags: v.tags,
    description: v.description,
    createdAt: v.createdAt,
    updatedAt: v.createdAt,
  });

  const previewModel: Model | null = useMemo(() => {
    if (selectedId === CURRENT) return model;
    if (!preview) return null;
    return toModelShape(preview);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedId, preview, model]);

  // Baseline model for the diff (the "compare against" side).
  const compareModel: Model | null = useMemo(() => {
    if (!compareId) return null;
    if (compareId === CURRENT) return model;
    return compareData ? toModelShape(compareData) : null;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [compareId, compareData, model]);

  const diff = useMemo(
    () => (compareModel && previewModel ? diffModels(compareModel, previewModel) : null),
    [compareModel, previewModel]
  );

  // When diffing, dim every attribute that didn't change so the added/changed
  // ones stand out on the read-only canvas (reuses Canvas's filter dimming).
  const dimmed = useMemo(() => {
    if (!diff || !previewModel) return null;
    const out = new Set<string>();
    for (const n of previewModel.nodes) {
      if (n.type === "Attribute" && !diff.highlightAttrIds.has(n.id)) out.add(n.id);
    }
    return out;
  }, [diff, previewModel]);

  const canRestore = role === "owner" || role === "editor";

  async function restore() {
    if (!id || selectedId === CURRENT) return;
    setRestoring(true);
    setError(null);
    try {
      const restored = await api.restoreVersion(id, selectedId);
      setModel(restored);
      setSelectedId(CURRENT);
      // Re-fetch the list so the pre-restore state (now snapshotted by the
      // server-side trigger) shows up.
      setVersions(await api.listVersions(id));
    } catch (e) {
      setError(String(e));
    } finally {
      setRestoring(false);
    }
  }

  if (loading) return <div className="home"><p className="empty">Loading…</p></div>;
  if (error && !model)
    return (
      <div className="home">
        <div className="error">{error}</div>
        <Button variant="secondary" onClick={() => navigate("/")}>Back home</Button>
      </div>
    );
  if (!model || !id) return null;

  const fmt = (s: string) => new Date(s).toLocaleString();
  const versionLabel = (vid: string) => {
    if (vid === CURRENT) return "Current";
    const v = (versions ?? []).find((x) => x.id === vid);
    return v ? fmt(v.createdAt) : "…";
  };

  return (
    <div className="editor-shell">
      <div className="side-panel" style={{ width: 320 }}>
        <div className="tree-header">
          <span>Version history</span>
        </div>
        <div className="details-body" style={{ padding: "8px" }}>
          <ul className="overview-people">
            <li
              className={`overview-row-clickable${selectedId === CURRENT ? " selected" : ""}`}
              onClick={() => setSelectedId(CURRENT)}
            >
              <span className="overview-role">Current</span>
              <span>
                {fmt(model.updatedAt)} · {model.nodes.length} nodes · {model.edges.length} edges
              </span>
            </li>
            {(versions ?? []).length === 0 && (
              <li className="empty">No past versions yet — edit and save to start building history</li>
            )}
            {(versions ?? []).map((v) => (
              <li
                key={v.id}
                className={`overview-row-clickable${selectedId === v.id ? " selected" : ""}`}
                onClick={() => setSelectedId(v.id)}
              >
                <span className="overview-role">{fmt(v.createdAt)}</span>
                <span>
                  {v.createdBy ?? "unknown"} · {v.nodeCount} nodes · {v.edgeCount} edges
                </span>
              </li>
            ))}
          </ul>

          {diff && (
            <div className="version-diff">
              <div className="filter-section-label">
                Changes vs {versionLabel(compareId!)}
              </div>
              {diff.counts.added + diff.counts.removed + diff.counts.changed + diff.counts.edges === 0 ? (
                <p className="filter-empty">No differences</p>
              ) : (
                <ul className="version-diff-stats">
                  <li><span className="diff-dot diff-added" /> {diff.counts.added} added</li>
                  <li><span className="diff-dot diff-removed" /> {diff.counts.removed} removed</li>
                  <li><span className="diff-dot diff-changed" /> {diff.counts.changed} changed</li>
                  <li><span className="diff-dot diff-edge" /> {diff.counts.edges} edge change{diff.counts.edges === 1 ? "" : "s"}</li>
                </ul>
              )}
              {diff.removed.length > 0 && (
                <>
                  <div className="filter-section-label">Removed</div>
                  <ul className="validation-list">
                    {diff.removed.map((n) => (
                      <li key={n.id} className="diff-removed-item">{n.name || n.type}</li>
                    ))}
                  </ul>
                </>
              )}
            </div>
          )}
        </div>
      </div>

      <div className="editor-main">
        <header className="canvas-topbar">
          <span className="editor-name" style={{ display: "flex", alignItems: "center" }}>
            {model.name}
          </span>
          <span className="editor-meta">
            {selectedId === CURRENT ? "Current" : "Read-only preview"}
          </span>
          <label className="editor-meta" style={{ display: "flex", alignItems: "center", gap: 6 }}>
            Compare with
            <Select
              value={compareId ?? ""}
              onChange={(e) => setCompareId(e.target.value || null)}
            >
              <option value="">— none —</option>
              {selectedId !== CURRENT && <option value={CURRENT}>Current</option>}
              {(versions ?? [])
                .filter((v) => v.id !== selectedId)
                .map((v) => (
                  <option key={v.id} value={v.id}>
                    {fmt(v.createdAt)}
                  </option>
                ))}
            </Select>
          </label>
          <Button variant="secondary" onClick={() => navigate(`/models/${id}`)}>
            Back to editor
          </Button>
          {canRestore && (
            <Button
              variant="primary"
              disabled={selectedId === CURRENT || restoring}
              onClick={restore}
            >
              {restoring ? "Restoring…" : "Restore this version"}
            </Button>
          )}
        </header>

        {error && <div className="error">{error}</div>}

        <div className="editor-canvas">
          {previewModel ? (
            <SelectionContext.Provider
              value={{ selectedId: null, selectedIds: new Set(), onSelect: noop }}
            >
              <Canvas
                model={previewModel}
                selectedId={null}
                selectedIds={new Set()}
                onSelect={noop}
                onConnectAttrs={noop}
                onOpenMenu={noop}
                onDeleteEdges={noop}
                onReorderLayer={noop}
                onRenameLayer={noop}
                onRenameNode={noop}
                filteredOut={dimmed ?? undefined}
                filterActive={!!dimmed}
                filterMode="dim"
              />
            </SelectionContext.Provider>
          ) : (
            <p style={{ padding: "2rem" }}>Loading…</p>
          )}
        </div>
      </div>
    </div>
  );
}
