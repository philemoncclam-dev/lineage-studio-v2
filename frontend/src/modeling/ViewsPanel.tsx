// The Views panel: narrow the canvas to the entities you care about.
//
// A panel rather than a modal, docked to the right of the canvas. Filtering is
// an iterative act — you change a term and read the result — and a modal would
// cover the very thing being filtered, forcing an open/close cycle per edit.
//
// The rule itself lives in model/filter.ts; this file is only its controls.
import { useMemo, useState } from 'react'
import { allTags, tagCounts } from '../model/tags'
import {
  activeFilterCount,
  allPropertyKeys,
  EMPTY_FILTER,
  type AccessValue,
  type EntityKind,
  type ViewFilter,
} from '../model/filter'
import { activeView, listViews } from '../model/views'
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
  onSaveView,
  onDeleteView,
  onApplyView,
  onClose,
}: {
  model: LineageModel
  filter: ViewFilter
  onChange: (next: ViewFilter) => void
  /** How many entities currently match — the panel's only feedback. */
  matchCount: number
  /** Save the current filter under a name (replacing a view of that name). */
  onSaveView: (name: string) => void
  onDeleteView: (id: string) => void
  /** Apply a saved view, or clear it if it is already the one on screen. */
  onApplyView: (id: string) => void
  onClose: () => void
}) {
  const views = listViews(model)
  const current = activeView(model, filter)
  const [naming, setNaming] = useState(false)
  const [draftName, setDraftName] = useState('')
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
        {/* Saved views first: on reopening the panel the question is almost
            always "put me back in one of my views", not "let me rebuild one". */}
        {views.length > 0 && (
          <div className="vw-field">
            <span className="tg-label">Saved views</span>
            <div className="vw-saved">
              {views.map((v) => (
                <div className="vw-saved-row" key={v.id}>
                  <button
                    className="vw-saved-pick"
                    data-on={current?.id === v.id || undefined}
                    aria-pressed={current?.id === v.id}
                    title={
                      current?.id === v.id ? `Leave ${v.name}` : `Show ${v.name}`
                    }
                    onClick={() => onApplyView(v.id)}
                  >
                    {v.name}
                  </button>
                  <button
                    className="tg-act"
                    aria-label={`Delete view ${v.name}`}
                    onClick={() => onDeleteView(v.id)}
                  >
                    ×
                  </button>
                </div>
              ))}
            </div>
          </div>
        )}

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

        {/* Two named modes rather than one "hide" checkbox: dimming is a real
            mode with its own reason to exist (it keeps the shape of the model
            on screen), and a checkbox only names the other one. */}
        <div className="vw-field">
          <span className="tg-label">Non-matching</span>
          <div className="vw-chips vw-mode">
            <button
              className="vw-toggle"
              data-on={!filter.hide || undefined}
              aria-pressed={!filter.hide}
              onClick={() => onChange({ ...filter, hide: false })}
            >
              Dim
            </button>
            <button
              className="vw-toggle"
              data-on={filter.hide || undefined}
              aria-pressed={filter.hide}
              onClick={() => onChange({ ...filter, hide: true })}
            >
              Hide
            </button>
          </div>
          <span className="tg-hint">
            {filter.hide
              ? 'Non-matching cards, rows and the lines into them are removed.'
              : 'They stay in place, faded — which keeps the shape of the model readable.'}
          </span>
        </div>
      </div>

      <footer className="vw-foot">
        {naming ? (
          // The name is asked for INLINE rather than in a prompt() or a modal:
          // the filter you are naming is the thing a dialog would cover, and
          // the name you pick depends on reading it.
          <form
            className="vw-name"
            onSubmit={(e) => {
              e.preventDefault()
              onSaveView(draftName)
              setNaming(false)
            }}
          >
            <input
              className="tg-field"
              autoFocus
              value={draftName}
              placeholder="View name"
              aria-label="View name"
              onChange={(e) => setDraftName(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Escape') {
                  e.stopPropagation()
                  setNaming(false)
                }
              }}
            />
            <button className="imp-btn imp-btn--primary" type="submit" disabled={!draftName.trim()}>
              Save
            </button>
          </form>
        ) : (
          <>
            <span className="vw-result">
              {active === 0 ? 'No filter' : `${matchCount} matching`}
            </span>
            <button
              className="imp-btn"
              disabled={active === 0}
              title={
                current
                  ? `Update ${current.name}, or save under a new name`
                  : 'Save this filter as a named view'
              }
              onClick={() => {
                setDraftName(current?.name ?? '')
                setNaming(true)
              }}
            >
              {current ? 'Update view' : 'Save view'}
            </button>
            <button
              className="imp-btn"
              disabled={active === 0 && !filter.hide}
              onClick={() => onChange(EMPTY_FILTER)}
            >
              Clear
            </button>
          </>
        )}
      </footer>
    </aside>
  )
}
