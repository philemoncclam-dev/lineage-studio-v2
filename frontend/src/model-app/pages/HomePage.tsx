import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { api } from "../api";
import type { Model, ModelSummary, NodeType } from "../types";
import { BarsSpinner, Button, Input } from "../ui";
import ImportModel from "../editor/ImportModel";
import { relativeTime } from "../connectors/connections";
import { tagColor } from "../editor/tags";
import { TypeGlyph } from "../ui/TypeGlyph";

// The node-type accents mirror the editor canvas (--t-* tokens) so a model's
// makeup reads the same on its card as it does once opened.
const TYPE_META: { type: NodeType; label: string; color: string }[] = [
  { type: "Layer", label: "layers", color: "var(--t-layer)" },
  { type: "Object", label: "objects", color: "var(--t-object)" },
  { type: "Group", label: "tables", color: "var(--t-group)" },
  { type: "Attribute", label: "attributes", color: "var(--t-attr)" },
];

export default function HomePage() {
  const [models, setModels] = useState<ModelSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [newName, setNewName] = useState("");
  const [showImport, setShowImport] = useState(false);
  const navigate = useNavigate();

  async function refresh() {
    setLoading(true);
    setError(null);
    try {
      setModels(await api.listModels());
    } catch (e) {
      setError(String(e));
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    refresh();
  }, []);

  async function handleCreate() {
    const name = newName.trim();
    if (!name) return;
    try {
      const model = await api.createModel(name);
      navigate(`/models/${model.id}`);
    } catch (e) {
      setError(String(e));
    }
  }

  async function handleCreateSample() {
    try {
      const model = await api.createSampleModel();
      navigate(`/models/${model.id}`);
    } catch (e) {
      setError(String(e));
    }
  }

  async function handleDelete(id: string, name: string) {
    if (!confirm(`Delete model "${name}"? This cannot be undone.`)) return;
    try {
      await api.deleteModel(id);
      refresh();
    } catch (e) {
      setError(String(e));
    }
  }

  async function handleImportNew(model: Model) {
    const saved = await api.importModel(model);
    await refresh();
    navigate(`/models/${saved.id}`);
  }

  return (
    <div className="home2">
      {/* Full-bleed glass header — the same chrome as the editor's top bar, so
          opening a model reads as zooming in rather than switching apps. */}
      <header className="home2-bar">
        <div className="brand">
          <span className="brand-mark">L</span>
          <div>
            <h1>Lineage Studio</h1>
            <p className="subtitle">Build and edit lineage models</p>
          </div>
        </div>
      </header>

      <div className="home2-content">
        <div className="home2-actions">
          <Input
            value={newName}
            placeholder="Name a new model, e.g. CustomerData"
            onChange={(e) => setNewName(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && handleCreate()}
          />
          <Button variant="primary" keyTip="C" onClick={handleCreate} disabled={!newName.trim()}>
            Create model
          </Button>
          <Button variant="secondary" keyTip="B" onClick={handleCreateSample}>
            Sample
          </Button>
          <Button variant="secondary" keyTip="N" onClick={() => setShowImport(true)}>
            Import
          </Button>
          <Button variant="secondary" keyTip="S" onClick={() => navigate("/catalog")}>
            Search catalog
          </Button>
        </div>

        {error && <div className="error">{error}</div>}

        <div className="section-label">Your models</div>

        {loading ? (
          <p className="empty"><span className="loading-row"><BarsSpinner size={16} />Loading…</span></p>
        ) : models.length === 0 ? (
          <div className="home2-emptystate">
            <span className="brand-mark home2-empty-mark">L</span>
            <h2>Start your first model</h2>
            <p>Create from scratch, open a sample, or import from dbt</p>
            <div className="home2-empty-actions">
              <Button variant="primary" onClick={handleCreateSample}>
                Open a sample
              </Button>
              <Button variant="secondary" onClick={() => setShowImport(true)}>
                Import from dbt
              </Button>
            </div>
          </div>
        ) : (
          <ul className="model-grid">
            {models.map((m) => (
              <li key={m.id} className="model-card2">
                <button className="model-card2-open" onClick={() => navigate(`/models/${m.id}`)}>
                  <div className="model-card2-head">
                    <span className="model-name">{m.name}</span>
                    {m.role && m.role !== "owner" && m.role !== "local" && (
                      <span className="model-role-badge">{m.role}</span>
                    )}
                  </div>
                  {m.description ? (
                    <p className="model-desc">{m.description}</p>
                  ) : (
                    <p className="model-desc is-empty">No description</p>
                  )}
                  {m.labels && m.labels.length > 0 && (
                    <div className="model-tags">
                      {m.labels.map((t) => (
                        <span key={t} className="model-tag-chip is-sm" style={{ background: tagColor(t) }}>
                          {t}
                        </span>
                      ))}
                    </div>
                  )}
                  <div className="model-typebar">
                    {TYPE_META.filter((t) => (m.typeCounts?.[t.type] ?? 0) > 0).map((t) => (
                      <span key={t.type} className="model-type" title={t.label}>
                        <span className="type-glyph" style={{ color: t.color }}>
                          <TypeGlyph type={t.type} />
                        </span>
                        {m.typeCounts?.[t.type]}
                      </span>
                    ))}
                    {m.nodeCount === 0 && <span className="model-type is-empty">empty</span>}
                  </div>
                  <div className="model-card2-meta">
                    {m.edgeCount} edge{m.edgeCount === 1 ? "" : "s"} · {relativeTime(m.updatedAt)}
                  </div>
                </button>
                <div className="model-card2-actions">
                  <button
                    className="card-action"
                    onClick={() => navigate(`/models/${m.id}/overview`)}
                    title="Model overview"
                  >
                    Overview
                  </button>
                  <button
                    className="card-action card-action-del"
                    onClick={() => handleDelete(m.id, m.name)}
                    title="Delete model"
                  >
                    Delete
                  </button>
                </div>
              </li>
            ))}
          </ul>
        )}
      </div>

      {showImport && (
        <ImportModel onImportNew={handleImportNew} onClose={() => setShowImport(false)} />
      )}
    </div>
  );
}
