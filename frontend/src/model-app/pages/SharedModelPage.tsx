// Public read-only view of a shared model, opened via /share/:token. No account
// needed — it fetches the snapshot by token and renders the canvas without any
// editing affordances.
import { useEffect, useMemo, useState } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { Icon } from "../ui/Icon";
import { Button } from "../ui";
import Canvas from "../canvas/Canvas";
import { SelectionContext } from "../editor/selection";
import { lineageNarrative } from "../editor/lineageNarrative";
import { fetchShare, errorText, type SharedModel } from "../share";
import type { LineageNode, Model } from "../types";

const noop = () => {};

export default function SharedModelPage() {
  const { token } = useParams<{ token: string }>();
  const navigate = useNavigate();
  const [shared, setShared] = useState<SharedModel | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);

  useEffect(() => {
    if (!token) return;
    fetchShare(token)
      .then(setShared)
      .catch((e) => setError(errorText(e)));
  }, [token]);

  // Adapt the snapshot to the Model shape the Canvas expects (id is unused by
  // the read-only render path).
  const model: Model | null = useMemo(
    () =>
      shared
        ? {
            id: token ?? "shared",
            name: shared.name,
            nodes: shared.nodes,
            edges: shared.edges,
            tags: shared.tags,
            createdAt: shared.createdAt,
            updatedAt: shared.updatedAt,
          }
        : null,
    [shared, token]
  );

  // NB: every hook must run on every render — keep them above the early
  // returns below, or the loading→loaded transition changes the hook count and
  // React throws "rendered more hooks than during the previous render" (which
  // previously blanked shared links to a white page).
  const selectedSet = useMemo(
    () => new Set(selectedId ? [selectedId] : []),
    [selectedId]
  );

  if (error) {
    return (
      <div className="share-view-error">
        <h1>Can’t open this link</h1>
        <p>{error}</p>
      </div>
    );
  }
  if (!model) return <p style={{ padding: "2rem" }}>Loading…</p>;

  const selectedNode = model.nodes.find((n) => n.id === selectedId) ?? null;

  return (
    <SelectionContext.Provider
      value={{ selectedId, selectedIds: selectedSet, onSelect: setSelectedId }}
    >
      <div className="share-view">
        <header className="share-view-bar">
          <div className="brand">
            <span className="brand-mark">L</span>
            <span className="share-view-name">{model.name}</span>
          </div>
          <span className="share-view-badge">Read-only shared view</span>
          <span className="editor-meta">
            {model.nodes.length} nodes · {model.edges.length} edges
          </span>
          {shared?.editable && (
            <Button
              variant="secondary"
              className="share-view-edit-btn"
              onClick={() => navigate(`/share/${token}/edit`)}
            >
              <Icon name="edit" /> Edit
            </Button>
          )}
          <Button variant="secondary" onClick={() => navigate(`/share/${token}/overview`)}>
            <Icon name="info" /> Overview
          </Button>
        </header>

        <div className="share-view-body">
          <div className="editor-canvas">
            <Canvas
              model={model}
              selectedId={selectedId}
              selectedIds={selectedSet}
              onSelect={setSelectedId}
              onConnectAttrs={noop}
              onOpenMenu={noop}
              onDeleteEdges={noop}
              onReorderLayer={noop}
              onRenameLayer={noop}
              onRenameNode={noop}
            />
          </div>
          {selectedNode && (
            <ReadOnlyDetails node={selectedNode} model={model} onClose={() => setSelectedId(null)} />
          )}
        </div>
      </div>
    </SelectionContext.Provider>
  );
}

function ReadOnlyDetails({
  node,
  model,
  onClose,
}: {
  node: LineageNode;
  model: Model;
  onClose: () => void;
}) {
  const [lineageOpen, setLineageOpen] = useState(false);
  const [copied, setCopied] = useState(false);
  const narrative = useMemo(
    () => (node.type === "Attribute" ? lineageNarrative(model, node.id) : null),
    [model, node.id, node.type]
  );
  const props = Object.entries(node.properties ?? {});

  const copyNarrative = () => {
    if (!narrative) return;
    navigator.clipboard?.writeText(narrative.text).then(
      () => { setCopied(true); setTimeout(() => setCopied(false), 1500); },
      () => {}
    );
  };

  return (
    <aside className="share-details">
      <div className="share-details-head">
        <span className="share-details-type">{node.type}</span>
        <button className="modal-close" onClick={onClose} title="Close">
          ×
        </button>
      </div>
      <h2 className="share-details-name">{node.name}</h2>
      {node.transformation_logic && (
        <div className="share-details-field">
          <div className="share-details-label">Transformation logic</div>
          <pre className="share-details-code">{node.transformation_logic}</pre>
        </div>
      )}
      {props.length > 0 && (
        <div className="share-details-field">
          <div className="share-details-label">Properties</div>
          <dl className="share-details-props">
            {props.map(([k, v]) => (
              <div key={k} className="share-details-prop">
                <dt>{k}</dt>
                <dd>{String(v)}</dd>
              </div>
            ))}
          </dl>
        </div>
      )}
      {narrative && (
        <div className="lineage-explain">
          <button className="lineage-explain-toggle" onClick={() => setLineageOpen((o) => !o)}>
            <span><Icon name={lineageOpen ? "chevronDown" : "chevronRight"} /> Explain lineage</span>
            <span className="lineage-explain-count">{narrative.transformations} ƒ</span>
          </button>
          {lineageOpen && (
            <>
              <pre className="lineage-explain-text">{narrative.text}</pre>
              <button className="lineage-explain-copy" onClick={copyNarrative}>
                {copied ? <>Copied <Icon name="checkmark" /></> : "Copy"}
              </button>
            </>
          )}
        </div>
      )}
    </aside>
  );
}
