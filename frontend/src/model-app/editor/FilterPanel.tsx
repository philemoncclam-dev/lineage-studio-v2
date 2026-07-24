import type { Model } from "../types";
import { allTags, resolveTag } from "./tags";
import {
  type ModelFilter,
  type LineageStatus,
  LINEAGE_OPTIONS,
  EMPTY_FILTER,
  isFilterActive,
} from "./filter";

interface Props {
  model: Model;
  filter: ModelFilter;
  setFilter: (f: ModelFilter) => void;
  matchCount: number;
  attrCount: number;
}

// Filter flyout: narrow what the canvas highlights by tag and by lineage status.
// Matching attributes stay bright; everything else dims.
export default function FilterPanel({ model, filter, setFilter, matchCount, attrCount }: Props) {
  const tags = allTags(model);
  const active = isFilterActive(filter);

  const toggleTag = (tag: string) =>
    setFilter({
      ...filter,
      tags: filter.tags.includes(tag)
        ? filter.tags.filter((t) => t !== tag)
        : [...filter.tags, tag],
    });

  return (
    <div className="filter-panel">
      <div className="tree-header">
        Filter
        {active && (
          <button className="filter-clear" onClick={() => setFilter(EMPTY_FILTER)}>
            Clear
          </button>
        )}
      </div>

      <div className="filter-body">
        <div className="filter-section-label">When filtering</div>
        <div className="filter-mode-toggle" role="group" aria-label="Filter mode">
          {(["dim", "hide"] as const).map((m) => (
            <button
              key={m}
              type="button"
              className={`filter-mode-btn${filter.mode === m ? " is-on" : ""}`}
              onClick={() => setFilter({ ...filter, mode: m })}
            >
              {m === "dim" ? "Dim" : "Hide"}
            </button>
          ))}
        </div>

        <div className="filter-section-label">Lineage status</div>
        <div className="filter-lineage">
          {LINEAGE_OPTIONS.map((opt) => (
            <label className="filter-radio" key={opt.value}>
              <input
                type="radio"
                name="lineage"
                checked={filter.lineage === opt.value}
                onChange={() =>
                  setFilter({ ...filter, lineage: opt.value as LineageStatus })
                }
              />
              <span>{opt.label}</span>
            </label>
          ))}
        </div>

        <div className="filter-section-label">
          Tags
          {filter.tags.length > 0 && (
            <span className="filter-section-hint"> · any of {filter.tags.length}</span>
          )}
        </div>
        {tags.length === 0 ? (
          <p className="filter-empty">
            No tags yet — select an attribute and add tags in the Details panel
          </p>
        ) : (
          <div className="filter-tags">
            {tags.map((tag) => {
              const on = filter.tags.includes(tag);
              const rt = resolveTag(model, tag);
              return (
                <button
                  key={tag}
                  className={`tag-chip${on ? " is-on" : ""}`}
                  style={on ? { background: rt.color, borderColor: rt.color, color: "#fff" } : { borderColor: rt.color }}
                  onClick={() => toggleTag(tag)}
                >
                  <span className="tag-chip-dot" style={{ background: rt.color }} />
                  {tag}
                </button>
              );
            })}
          </div>
        )}

        <div className="filter-count">
          {active ? (
            <>
              Showing <strong>{matchCount}</strong> of {attrCount} attributes
            </>
          ) : (
            <>All {attrCount} attributes shown</>
          )}
        </div>
      </div>
    </div>
  );
}
