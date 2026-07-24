import { useMemo } from "react";
import { Icon } from "../ui/Icon";
import type { Model } from "../types";

interface Props {
  model: Model;
  query: string;
  setQuery: (q: string) => void;
  selectedId: string | null;
  onSelect: (id: string) => void;
}

// Search flyout: live attribute filter (drives the canvas dimming via the shared
// query) plus a clickable list of matches with their full path.
export default function SearchPanel({ model, query, setQuery, selectedId, onSelect }: Props) {
  const byId = useMemo(() => new Map(model.nodes.map((n) => [n.id, n])), [model.nodes]);

  const matches = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return [];
    const path = (id: string): string => {
      const parts: string[] = [];
      let cur = byId.get(id);
      while (cur && cur.parentId) {
        cur = byId.get(cur.parentId);
        if (cur) parts.unshift(cur.name);
      }
      return parts.join(" / ");
    };
    return model.nodes
      .filter((n) => n.type === "Attribute" && n.name.toLowerCase().includes(q))
      .map((n) => ({ id: n.id, name: n.name, path: path(n.id) }));
  }, [model.nodes, byId, query]);

  return (
    <div className="search-panel">
      <div className="search-panel-input">
        <span className="search-panel-icon"><Icon name="search" /></span>
        <input
          autoFocus
          type="search"
          placeholder="Search attributes…"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
      </div>

      {query.trim() && (
        <div className="search-panel-count">
          {matches.length} {matches.length === 1 ? "match" : "matches"}
        </div>
      )}

      <div className="search-panel-results">
        {matches.map((m) => (
          <button
            key={m.id}
            className={`search-result${selectedId === m.id ? " is-selected" : ""}`}
            onClick={() => onSelect(m.id)}
            title={`${m.path} / ${m.name}`}
          >
            <span className="type-dot type-attr" />
            <span className="search-result-name">{m.name}</span>
            {m.path && <span className="search-result-path">{m.path}</span>}
          </button>
        ))}
        {query.trim() && matches.length === 0 && (
          <p className="search-panel-empty">No attributes match “{query}”</p>
        )}
      </div>
    </div>
  );
}
