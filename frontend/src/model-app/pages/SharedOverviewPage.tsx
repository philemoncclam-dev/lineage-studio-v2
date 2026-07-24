// Public read-only overview for a shared model, opened via /share/:token/overview.
// Mirrors ModelOverviewPage but works off the public snapshot (no account): it
// shows the model's name, description and size. Collaborators/comments are
// owner-only features and are intentionally omitted here.
import { useEffect, useState } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { fetchShare, errorText, type SharedModel } from "../share";
import { Button } from "../ui";

export default function SharedOverviewPage() {
  const { token } = useParams<{ token: string }>();
  const navigate = useNavigate();
  const [shared, setShared] = useState<SharedModel | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!token) return;
    fetchShare(token)
      .then(setShared)
      .catch((e) => setError(errorText(e)));
  }, [token]);

  if (error) {
    return (
      <div className="share-view-error">
        <h1>Can’t open this link</h1>
        <p>{error}</p>
      </div>
    );
  }
  if (!shared) return <p style={{ padding: "2rem" }}>Loading…</p>;

  const fmt = (s: string) => (s ? new Date(s).toLocaleString() : "—");

  return (
    <div className="home overview">
      <header className="home-header">
        <div className="brand">
          <span className="brand-mark">L</span>
          <h1>{shared.name}</h1>
        </div>
        <p className="subtitle">Model overview · shared (read-only)</p>
      </header>

      <div className="create-row">
        <Button variant="primary" onClick={() => navigate(`/share/${token}`)}>
          Open model
        </Button>
      </div>

      {/* ── Snapshot ── */}
      <div className="section-label">Snapshot</div>
      <div className="overview-panel">
        <div className="overview-stat">
          <span className="overview-stat-label">Last updated</span>
          <span className="overview-stat-value">{fmt(shared.updatedAt)}</span>
        </div>
        <div className="overview-stat">
          <span className="overview-stat-label">Created</span>
          <span className="overview-stat-value">{fmt(shared.createdAt)}</span>
        </div>
        <div className="overview-stat">
          <span className="overview-stat-label">Size</span>
          <span className="overview-stat-value">
            {shared.nodes.length} nodes · {shared.edges.length} edges
          </span>
        </div>
      </div>

      {/* ── About ── */}
      <div className="section-label">About this model</div>
      <div className="overview-panel">
        <p className={shared.description ? "" : "empty"}>
          {shared.description || "No description provided"}
        </p>
      </div>
    </div>
  );
}
