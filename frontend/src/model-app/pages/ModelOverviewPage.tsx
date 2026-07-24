import { useEffect, useState } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { api } from "../api";
import { isSignedIn } from "../supabase";
import type { Model, ModelRole, ShareEntry, Comment } from "../types";
import { Button, Input, Textarea } from "../ui";
import { tagColor } from "../editor/tags";

export default function ModelOverviewPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();

  const [model, setModel] = useState<Model | null>(null);
  const [role, setRole] = useState<ModelRole>("local");
  const [shares, setShares] = useState<ShareEntry[] | null>(null);
  const [comments, setComments] = useState<Comment[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [desc, setDesc] = useState("");
  const [savingDesc, setSavingDesc] = useState(false);
  const [descSaved, setDescSaved] = useState(false);

  const [labels, setLabels] = useState<string[]>([]);
  const [newLabel, setNewLabel] = useState("");

  const [newComment, setNewComment] = useState("");
  const [posting, setPosting] = useState(false);

  const local = !isSignedIn();
  const canEdit = role === "owner" || role === "editor" || role === "local";

  useEffect(() => {
    let cancelled = false;
    async function load() {
      if (!id) return;
      setLoading(true);
      setError(null);
      try {
        const { model: m, role: r } = await api.openModel(id);
        if (cancelled) return;
        setModel(m);
        setRole(r);
        setDesc(m.description ?? "");
        setLabels(m.labels ?? []);

        // Comments work in both modes.
        try {
          setComments(await api.listComments(id));
        } catch {
          setComments([]);
        }

        // Shares are cloud-only; degrade gracefully when local/unavailable.
        if (!local) {
          try {
            setShares(await api.listShares(id));
          } catch {
            setShares(null);
          }
        } else {
          setShares(null);
        }
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
  }, [id, local]);

  async function saveDescription() {
    if (!id) return;
    setSavingDesc(true);
    setDescSaved(false);
    setError(null);
    try {
      const updated = await api.updateModel(id, { description: desc });
      setModel(updated);
      setDescSaved(true);
    } catch (e) {
      setError(String(e));
    } finally {
      setSavingDesc(false);
    }
  }

  // Tags persist immediately on add/remove (optimistic, with rollback on error).
  async function persistLabels(next: string[]) {
    if (!id) return;
    const prev = labels;
    setLabels(next);
    setError(null);
    try {
      const updated = await api.updateModel(id, { labels: next });
      setModel(updated);
    } catch (e) {
      setLabels(prev);
      setError(String(e));
    }
  }

  function addLabel() {
    const t = newLabel.trim();
    setNewLabel("");
    if (!t || labels.includes(t)) return;
    persistLabels([...labels, t]);
  }

  function removeLabel(t: string) {
    persistLabels(labels.filter((x) => x !== t));
  }

  async function postComment() {
    const body = newComment.trim();
    if (!body || !id) return;
    setPosting(true);
    setError(null);
    try {
      const c = await api.addComment(id, body);
      setComments((prev) => [...prev, c]);
      setNewComment("");
    } catch (e) {
      setError(String(e));
    } finally {
      setPosting(false);
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
  if (!model) return null;

  const fmt = (s: string) => new Date(s).toLocaleString();

  return (
    <div className="home overview">
      <header className="home-header">
        <div className="brand">
          <span className="brand-mark">L</span>
          <h1>{model.name}</h1>
        </div>
        <p className="subtitle">Model overview</p>
      </header>

      <div className="create-row">
        <Button variant="primary" onClick={() => navigate(`/models/${model.id}`)}>
          Open in editor
        </Button>
        <Button variant="secondary" onClick={() => navigate("/")}>Home</Button>
      </div>

      {error && <div className="error">{error}</div>}

      {/* ── Recent saves ── */}
      <div className="section-label">Recent saves</div>
      <div className="overview-panel">
        <div className="overview-stat">
          <span className="overview-stat-label">Last updated</span>
          <span className="overview-stat-value">{fmt(model.updatedAt)}</span>
        </div>
        <div className="overview-stat">
          <span className="overview-stat-label">Created</span>
          <span className="overview-stat-value">{fmt(model.createdAt)}</span>
        </div>
        <div className="overview-stat">
          <span className="overview-stat-label">Size</span>
          <span className="overview-stat-value">
            {model.nodes.length} nodes · {model.edges.length} edges
          </span>
        </div>
      </div>

      {/* ── About ── */}
      <div className="section-label">About this model</div>
      <div className="overview-panel">
        {canEdit ? (
          <>
            <Textarea
              rows={4}
              value={desc}
              placeholder="Describe what this model is about…"
              onChange={(e) => {
                setDesc(e.target.value);
                setDescSaved(false);
              }}
            />
            <div className="overview-actions">
              <Button
                variant="primary"
                onClick={saveDescription}
                disabled={savingDesc || desc === (model.description ?? "")}
              >
                {savingDesc ? "Saving…" : "Save description"}
              </Button>
              {descSaved && <span className="overview-hint">Saved.</span>}
            </div>
          </>
        ) : (
          <p className={model.description ? "" : "empty"}>
            {model.description || "No description yet"}
          </p>
        )}
      </div>

      {/* ── Tags ── */}
      <div className="section-label">Tags</div>
      <div className="overview-panel">
        <div className="model-tag-chips">
          {labels.map((t) => (
            <span key={t} className="model-tag-chip" style={{ background: tagColor(t) }}>
              {t}
              {canEdit && (
                <button
                  className="model-tag-chip-x"
                  onClick={() => removeLabel(t)}
                  title={`Remove "${t}"`}
                >
                  ×
                </button>
              )}
            </span>
          ))}
          {labels.length === 0 && <span className="empty">No tags yet</span>}
        </div>
        {canEdit && (
          <div className="overview-actions">
            <Input
              value={newLabel}
              placeholder="Add a tag, e.g. finance"
              onChange={(e) => setNewLabel(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && addLabel()}
            />
            <Button variant="secondary" onClick={addLabel} disabled={!newLabel.trim()}>
              Add tag
            </Button>
          </div>
        )}
      </div>

      {/* ── Collaborators ── */}
      <div className="section-label">Who's working on it</div>
      <div className="overview-panel">
        {local ? (
          <p className="empty">
            Local model — collaborators available once you sign in and share
          </p>
        ) : (
          <ul className="overview-people">
            <li>
              <span className="overview-role">Owner</span>
              <span>{role === "owner" ? "You" : "Model owner"}</span>
            </li>
            {(shares ?? []).map((s) => (
              <li key={s.id}>
                <span className="overview-role">{s.role}</span>
                <span>{s.invited_email}</span>
              </li>
            ))}
            {shares !== null && shares.length === 0 && (
              <li className="empty">No collaborators invited yet</li>
            )}
            {shares === null && (
              <li className="empty">Collaborators unavailable</li>
            )}
          </ul>
        )}
      </div>

      {/* ── Comments ── */}
      <div className="section-label">Comments</div>
      <div className="overview-panel">
        {comments.length === 0 ? (
          <p className="empty">No comments yet</p>
        ) : (
          <ul className="overview-comments">
            {comments.map((c) => (
              <li key={c.id}>
                <div className="overview-comment-head">
                  <span className="overview-comment-author">{c.author_email}</span>
                  <span className="overview-comment-date">{fmt(c.created_at)}</span>
                </div>
                <div className="overview-comment-body">{c.body}</div>
              </li>
            ))}
          </ul>
        )}
        <div className="overview-actions">
          <Input
            value={newComment}
            placeholder="Add a comment…"
            onChange={(e) => setNewComment(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && postComment()}
          />
          <Button
            variant="primary"
            onClick={postComment}
            disabled={posting || !newComment.trim()}
          >
            {posting ? "Posting…" : "Comment"}
          </Button>
        </div>
      </div>
    </div>
  );
}
