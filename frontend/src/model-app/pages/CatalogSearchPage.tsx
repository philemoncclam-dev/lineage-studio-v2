// Cross-model catalog search: find attributes/objects by name, description, or
// transformation logic across every model you can access, and see where else a
// node with the same name/external id appears ("also appears in").
import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { api } from "../api";
import type { CatalogModelData, CatalogMatch } from "../types";
import { searchCatalog, findRelated } from "../catalog/search";
import { BarsSpinner, Button, Input } from "../ui";

export default function CatalogSearchPage() {
  const navigate = useNavigate();
  const [models, setModels] = useState<CatalogModelData[]>([]);
  const [query, setQuery] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selected, setSelected] = useState<CatalogMatch | null>(null);

  useEffect(() => {
    let cancelled = false;
    api
      .catalogModels()
      .then((m) => !cancelled && setModels(m))
      .catch((e) => !cancelled && setError(String(e)))
      .finally(() => !cancelled && setLoading(false));
    return () => {
      cancelled = true;
    };
  }, []);

  const results = useMemo(() => searchCatalog(models, query), [models, query]);
  const related = useMemo(
    () => (selected ? findRelated(models, selected.node, selected.modelId) : []),
    [selected, models]
  );

  const nodeCount = models.reduce((s, m) => s + m.nodes.length, 0);
  const open = (m: CatalogMatch) =>
    navigate(`/models/${m.modelId}?focus=${m.node.id}`);

  return (
    <div className="home">
      <header className="home-header">
        <div className="brand">
          <span className="brand-mark">L</span>
          <h1>Catalog search</h1>
        </div>
        <p className="subtitle">
          Search attributes, objects, and logic across {models.length} model
          {models.length === 1 ? "" : "s"} · {nodeCount} nodes.
        </p>
      </header>

      <div className="create-row">
        <Input
          value={query}
          autoFocus
          placeholder="Search node names, descriptions, transformation logic…"
          onChange={(e) => {
            setQuery(e.target.value);
            setSelected(null);
          }}
        />
        <Button variant="secondary" onClick={() => navigate("/")}>
          Home
        </Button>
      </div>

      {error && <div className="error">{error}</div>}
      {loading ? (
        <p className="empty"><span className="loading-row"><BarsSpinner size={16} />Loading…</span></p>
      ) : (
        <>
          <div className="section-label">
            {query.trim()
              ? `${results.length} match${results.length === 1 ? "" : "es"}`
              : "Type to search"}
          </div>
          <ul className="catalog-results">
            {results.map((m) => (
              <li
                key={`${m.modelId}-${m.node.id}`}
                className={`catalog-result${
                  selected?.node.id === m.node.id && selected?.modelId === m.modelId
                    ? " is-selected"
                    : ""
                }`}
              >
                <button className="catalog-result-main" onClick={() => setSelected(m)}>
                  <span className="catalog-node-name">{m.node.name || "(unnamed)"}</span>
                  <span className="catalog-node-meta">
                    {m.node.type} · in <strong>{m.modelName}</strong>
                  </span>
                </button>
                <button className="model-delete" onClick={() => open(m)}>
                  Open
                </button>
              </li>
            ))}
          </ul>

          {selected && (
            <>
              <div className="section-label">
                Also appears in ({related.length})
              </div>
              {related.length === 0 ? (
                <p className="empty">
                  No other model has a node named “{selected.node.name}”
                </p>
              ) : (
                <ul className="catalog-results">
                  {related.map((m) => (
                    <li key={`${m.modelId}-${m.node.id}`} className="catalog-result">
                      <button className="catalog-result-main" onClick={() => open(m)}>
                        <span className="catalog-node-name">{m.node.name}</span>
                        <span className="catalog-node-meta">
                          {m.node.type} · in <strong>{m.modelName}</strong>
                        </span>
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </>
          )}
        </>
      )}
    </div>
  );
}
