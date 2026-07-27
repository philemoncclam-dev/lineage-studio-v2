// The Views panel: narrow the canvas to the entities you care about.
//
// A panel rather than a modal, docked to the right of the canvas. Filtering is
// an iterative act — you change a term and read the result — and a modal would
// cover the very thing being filtered, forcing an open/close cycle per edit.
//
// The rule itself lives in model/filter.ts; this file is only its controls.
import { useMemo } from 'react'
import { allTags, tagCounts } from '../model/tags'
import {
  activeFilterCount,
  allPropertyKeys,
  EMPTY_FILTER,
  type AccessValue,
  type EntityKind,
  type ViewFilter,
} from '../model/filter'
import type { LineageModel } from '../model/types'

const KINDS: { key: EntityKind; label: string }[] = [
  { key: 'layer', label: 'Layers' },
  { key: 'object', label: 'Objects' },
  { key: 'attribute', label: 'Attributes' },
]

const ACCESS: AccessValue[] = ['Read', 'Write']

export function ViewsPanel({
  model,
  filter,
  onChange,
  matchCount,
  onClose,
}: {
  model: LineageModel
  filter: ViewFilter
  onChange: (next: ViewFilter) => void
  /** How many entities currently match — the panel's only feedback. */
  matchCount: number
  onClose: () => void
}) {
  const counts = useMemo(() => tagCounts(model), [model])
  const tags = useMemo(
    () => allTags(model).sort((a, b) => (counts.get(b) ?? 0) - (counts.get(a) ?? 0)),
    [model, counts],
  )
  const propertyKeys = useMemo(() => allPropertyKeys(model), [model])
  const active = activeFilterCount(filter)

  const toggle = <T,>(list: T[], value: T): T[] =>
    list.includes(value) ? list.filter((v) => v !== value) : [...list, value]

  return (
    <aside className="vw-panel" aria-label="Views">
      <header className="vw-head">
        <h2 className="vw-title">Views</h2>
        {active > 0 && <span className="vw-badge">{active}</span>}
        <button className="tg-x" onClick={onClose} aria-label="Close views">
          ×
        </button>
      </header>

      <div className="vw-body">
        <label className="vw-field">
          <span className="tg-label">Name contains</span>
          <input
            className="tg-field"
            value={filter.name}
            placeholder="e.g. customer"
            onChange={(e) => onChange({ ...filter, name: e.target.value })}
          />
        </label>

        <div className="vw-field">
          <span className="tg-label">Kind</span>
          <div className="vw-chips">
            {KINDS.map(({ key, label }) => (
              <button
                key={key}
                className="vw-toggle"
                data-on={filter.kinds.includes(key) || undefined}
                aria-pressed={filter.kinds.includes(key)}
                onClick={() => onChange({ ...filter, kinds: toggle(filter.kinds, key) })}
              >
                {label}
              </button>
            ))}
          </div>
        </div>

        <div className="vw-field">
          {/* Access is a property the sandbox observed, not a tag anyone
              assigned, so it gets its own control — see model/filter.ts. */}
          <span className="tg-label">Access</span>
          <div className="vw-chips">
            {ACCESS.map((a) => (
              <button
                key={a}
                className="vw-toggle"
                data-tone={a.toLowerCase()}
                data-on={filter.access.includes(a) || undefined}
                aria-pressed={filter.access.includes(a)}
                onClick={() => onChange({ ...filter, access: toggle(filter.access, a) })}
              >
                {a === 'Read' ? 'R' : 'W'} {a}
              </button>
            ))}
          </div>
        </div>

        <div className="vw-field">
          <span className="tg-label">Tags</span>
          {tags.length === 0 ? (
            <p className="tg-empty">No tags in this model yet.</p>
          ) : (
            <div className="vw-chips">
              {tags.map((tag) => (
                <button
                  key={tag}
                  className="vw-toggle"
                  data-on={filter.tags.includes(tag) || undefined}
                  aria-pressed={filter.tags.includes(tag)}
                  onClick={() => onChange({ ...filter, tags: toggle(filter.tags, tag) })}
                >
                  {tag}
                  <span className="tg-count">{counts.get(tag) ?? 0}</span>
                </button>
              ))}
            </div>
          )}
        </div>

        <div className="vw-field">
          <span className="tg-label">Properties</span>
          {filter.properties.map((p, i) => (
            <div className="vw-prop" key={i}>
              <input
                className="tg-field"
                list="vw-prop-keys"
                value={p.key}
                placeholder="Key"
                aria-label="Property key"
                onChange={(e) => {
                  const next = [...filter.properties]
                  next[i] = { ...p, key: e.target.value }
                  onChange({ ...filter, properties: next })
                }}
              />
              <input
                className="tg-field"
                value={p.value}
                placeholder="Any value"
                aria-label="Property value"
                onChange={(e) => {
                  const next = [...filter.properties]
                  next[i] = { ...p, value: e.target.value }
                  onChange({ ...filter, properties: next })
                }}
              />
              <button
                className="tg-act"
                aria-label="Remove this property filter"
                onClick={() =>
                  onChange({ ...filter, properties: filter.properties.filter((_, j) => j !== i) })
                }
              >
                ×
              </button>
            </div>
          ))}
          <datalist id="vw-prop-keys">
            {propertyKeys.map((k) => (
              <option key={k} value={k} />
            ))}
          </datalist>
          <button
            className="tg-act"
            onClick={() =>
              onChange({ ...filter, properties: [...filter.properties, { key: '', value: '' }] })
            }
          >
            + Property
          </button>
        </div>

        <label className="vw-check">
          <input
            type="checkbox"
            checked={filter.hide}
            onChange={(e) => onChange({ ...filter, hide: e.target.checked })}
          />
          <span>
            Hide non-matching
            <span className="tg-hint">
              Off, they stay in place dimmed — which keeps the shape of the model readable.
            </span>
          </span>
        </label>
      </div>

      <footer className="vw-foot">
        <span className="vw-result">
          {active === 0 ? 'No filter' : `${matchCount} matching`}
        </span>
        <button
          className="imp-btn"
          disabled={active === 0 && !filter.hide}
          onClick={() => onChange(EMPTY_FILTER)}
        >
          Clear
        </button>
      </footer>
    </aside>
  )
}
