// The Auto-Mapper panel. All matching logic lives in model/automap.ts; this
// file only collects the config, renders the review list, and commits.
//
// It is a DOCKED panel, not a modal. Two of its three steps refer to things on
// the canvas — picking a scope entity, and reading the objects a suggestion
// group names — so covering the model would defeat it. Picking works by the
// panel staying put and the viewer handing back whatever gets clicked next.

import { useEffect, useMemo, useState } from 'react'
import { buildIndex, pathOf } from '../model/index'
import {
  applySuggestions,
  defaultConfig,
  generateSuggestions,
  groupSuggestions,
  type AutoMapConfig,
  type Algorithm,
  type Criterion,
  type Suggestion,
} from '../model/automap'
import type { EntityId, LineageModel } from '../model/types'

export type PickSlot = 'source' | 'target'

interface Props {
  model: LineageModel
  /** Scope roots, owned by the viewer so it can fill them from a canvas click. */
  scope: { source: EntityId | null; target: EntityId | null }
  onScope: (next: { source: EntityId | null; target: EntityId | null }) => void
  /** Non-null while the viewer is waiting for the user to click an entity. */
  picking: PickSlot | null
  onPick: (slot: PickSlot | null) => void
  onApply: (next: LineageModel) => void
  onClose: () => void
}

const ALGORITHMS: { value: Algorithm; label: string; hint: string }[] = [
  { value: 'fast', label: 'Fast', hint: 'Case-insensitive exact match. Best for large models.' },
  { value: 'exhaustive1', label: 'Exhaustive 1', hint: 'Case-sensitive. Fewer, better matches.' },
  { value: 'exhaustive2', label: 'Exhaustive 2', hint: 'Case-insensitive. Better on long strings.' },
]

const CRITERIA: { value: Criterion; label: string }[] = [
  { value: 'name', label: 'Name' },
  { value: 'path', label: 'Path' },
  { value: 'property', label: 'Property value' },
]

const pairKey = (s: Suggestion) => `${s.source}>${s.target}`

export default function AutoMapper({
  model,
  scope,
  onScope,
  picking,
  onPick,
  onApply,
  onClose,
}: Props) {
  const [config, setConfig] = useState<AutoMapConfig>(defaultConfig)
  /** null means "not generated yet" — which is also what re-enables Generate. */
  const [suggestions, setSuggestions] = useState<Suggestion[] | null>(null)
  const [accepted, setAccepted] = useState<ReadonlySet<string>>(new Set())
  const [expanded, setExpanded] = useState<ReadonlySet<string>>(new Set())
  const [advanced, setAdvanced] = useState(false)

  const index = useMemo(() => buildIndex(model), [model])

  const full: AutoMapConfig = useMemo(
    () => ({ ...config, source: scope.source, target: scope.target }),
    [config, scope],
  )

  // Any change to the configuration invalidates the generated list — otherwise
  // the panel would show suggestions produced under settings that are no longer
  // on screen.
  useEffect(() => {
    setSuggestions(null)
  }, [full])

  const usesProperty = config.criteria.includes('property')
  const canGenerate =
    config.criteria.length > 0 && (!usesProperty || config.property.trim() !== '')

  const set = <K extends keyof AutoMapConfig>(key: K, value: AutoMapConfig[K]) =>
    setConfig((c) => ({ ...c, [key]: value }))

  const toggleCriterion = (c: Criterion) =>
    setConfig((prev) => ({
      ...prev,
      criteria: prev.criteria.includes(c)
        ? prev.criteria.filter((x) => x !== c)
        : [...prev.criteria, c],
    }))

  const generate = () => {
    const found = generateSuggestions(model, full)
    setSuggestions(found)
    // Everything starts accepted, as the documented default — reviewing means
    // rejecting the wrong ones, not opting in to each of hundreds.
    setAccepted(new Set(found.map(pairKey)))
    setExpanded(new Set())
  }

  const groups = useMemo(
    () => (suggestions ? groupSuggestions(model, suggestions) : []),
    [model, suggestions],
  )

  const acceptedList = useMemo(
    () => (suggestions ?? []).filter((s) => accepted.has(pairKey(s))),
    [suggestions, accepted],
  )

  const toggleOne = (s: Suggestion) =>
    setAccepted((prev) => {
      const next = new Set(prev)
      const key = pairKey(s)
      if (next.has(key)) next.delete(key)
      else next.add(key)
      return next
    })

  const toggleGroup = (keys: string[], on: boolean) =>
    setAccepted((prev) => {
      const next = new Set(prev)
      for (const k of keys) {
        if (on) next.add(k)
        else next.delete(k)
      }
      return next
    })

  const done = () => {
    onApply(applySuggestions(model, acceptedList, full))
    onClose()
  }

  const label = (id: EntityId | null): string => {
    if (!id) return 'Auto'
    const entry = index.entries.get(id)
    if (!entry) return 'Auto'
    if (entry.kind === 'layer') return `${entry.name} (layer)`
    return pathOf(index, id) || entry.name
  }

  return (
    <aside className="am-panel" aria-label="Auto-Mapper">
      <header className="am-head">
        <h2 className="am-title">Auto-Mapper</h2>
        <button className="am-x" onClick={onClose} aria-label="Close the Auto-Mapper">
          ×
        </button>
      </header>

      <div className="am-body">
        {/* --- Step 1: scope ------------------------------------------------ */}
        <section className="am-section">
          <h3 className="am-step">
            <span className="am-step-n">1</span> Sources &amp; targets
          </h3>
          <p className="am-note">
            Auto looks only at the part of the model that is already connected. Pick a layer,
            object, group or attribute to narrow it.
          </p>
          {(['source', 'target'] as PickSlot[]).map((slot) => (
            <div className="am-scope" key={slot} data-picking={picking === slot || undefined}>
              <span className="am-scope-label">{slot === 'source' ? 'Source' : 'Target'}</span>
              <span className="am-scope-value" title={label(scope[slot])}>
                {label(scope[slot])}
              </span>
              <button
                className="am-mini"
                data-on={picking === slot || undefined}
                onClick={() => onPick(picking === slot ? null : slot)}
              >
                {picking === slot ? 'Cancel' : 'Pick in model'}
              </button>
              <button
                className="am-mini"
                disabled={scope[slot] === null}
                onClick={() => onScope({ ...scope, [slot]: null })}
              >
                Auto
              </button>
            </div>
          ))}
          {picking && (
            <p className="am-picking" role="status">
              Click a layer, object, group or attribute in the model to use as the{' '}
              {picking}. Esc cancels.
            </p>
          )}
          <button
            className="am-mini am-swap"
            onClick={() => onScope({ source: scope.target, target: scope.source })}
            disabled={scope.source === null && scope.target === null}
          >
            ⇄ Reverse direction
          </button>
        </section>

        {/* --- Step 2: criteria --------------------------------------------- */}
        <section className="am-section">
          <h3 className="am-step">
            <span className="am-step-n">2</span> Mapping criteria
          </h3>

          <div className="am-field">
            <span className="am-field-label">Compare by</span>
            <div className="am-checks">
              {CRITERIA.map((c) => (
                <label key={c.value} className="am-check">
                  <input
                    type="checkbox"
                    checked={config.criteria.includes(c.value)}
                    onChange={() => toggleCriterion(c.value)}
                  />
                  {c.label}
                </label>
              ))}
            </div>
            {config.criteria.length > 1 && (
              <p className="am-note">Several criteria are averaged; a criterion that disagrees lowers the score.</p>
            )}
          </div>

          {usesProperty && (
            <div className="am-field">
              <span className="am-field-label">Property name</span>
              <input
                className="am-input"
                value={config.property}
                placeholder="e.g. Object Type"
                onChange={(e) => set('property', e.target.value)}
              />
            </div>
          )}

          <div className="am-field">
            <span className="am-field-label">
              Acceptable confidence
              <span className="am-value">{config.confidence}%</span>
            </span>
            <input
              type="range"
              min={40}
              max={100}
              step={1}
              value={config.confidence}
              onChange={(e) => set('confidence', Number(e.target.value))}
            />
            <p className="am-note">
              100% requires the compared values to be identical. Lowering it yields more
              suggestions.
            </p>
          </div>

          <div className="am-field">
            <span className="am-field-label">Algorithm</span>
            <select
              className="am-input"
              value={config.algorithm}
              onChange={(e) => set('algorithm', e.target.value as Algorithm)}
            >
              {ALGORITHMS.map((a) => (
                <option key={a.value} value={a.value}>
                  {a.label}
                </option>
              ))}
            </select>
            <p className="am-note">{ALGORITHMS.find((a) => a.value === config.algorithm)?.hint}</p>
          </div>

          <button className="am-disclosure" onClick={() => setAdvanced((v) => !v)} aria-expanded={advanced}>
            {advanced ? '▾' : '▸'} Advanced
          </button>

          {advanced && (
            <div className="am-advanced">
              <label className="am-check">
                <input
                  type="checkbox"
                  checked={config.dateAware}
                  onChange={(e) => set('dateAware', e.target.checked)}
                />
                Search for date and time matches
              </label>
              <label className="am-check">
                <input
                  type="checkbox"
                  checked={config.includeGroups}
                  onChange={(e) => set('includeGroups', e.target.checked)}
                />
                Include attribute groups
              </label>
              <label className="am-check">
                <input
                  type="checkbox"
                  checked={config.allowOneToMany}
                  onChange={(e) => set('allowOneToMany', e.target.checked)}
                />
                Allow one-to-many
              </label>
            </div>
          )}
        </section>

        {/* --- Step 3/4: generate and review -------------------------------- */}
        <section className="am-section">
          <h3 className="am-step">
            <span className="am-step-n">3</span> Suggested mappings
          </h3>
          <button
            className="am-generate"
            onClick={generate}
            disabled={!canGenerate || suggestions !== null}
          >
            {suggestions === null
              ? 'Generate mappings'
              : suggestions.length === 0
                ? 'No new possible mappings'
                : `${suggestions.length} found — change a setting to re-run`}
          </button>
          {!canGenerate && (
            <p className="am-note">
              {config.criteria.length === 0
                ? 'Choose at least one thing to compare.'
                : 'Name the property to compare.'}
            </p>
          )}

          {suggestions !== null && suggestions.length === 0 && (
            <p className="am-note">
              Nothing above {config.confidence}%. Widen the scope, lower the threshold, or try a
              different algorithm.
            </p>
          )}

          {groups.map((g) => {
            const keys = g.suggestions.map(pairKey)
            const on = keys.filter((k) => accepted.has(k)).length
            const isOpen = expanded.has(g.key)
            return (
              <div className="am-group" key={g.key}>
                <div className="am-group-head">
                  <button
                    className="am-twisty"
                    aria-expanded={isOpen}
                    onClick={() =>
                      setExpanded((prev) => {
                        const next = new Set(prev)
                        if (next.has(g.key)) next.delete(g.key)
                        else next.add(g.key)
                        return next
                      })
                    }
                  >
                    {isOpen ? '▾' : '▸'}
                  </button>
                  <span className="am-group-label" title={`${g.sourceLabel} → ${g.targetLabel}`}>
                    {g.sourceLabel} <span className="am-arrow">→</span> {g.targetLabel}
                  </span>
                  <span className="am-badge">{g.suggestions.length}</span>
                  <input
                    type="checkbox"
                    checked={on === keys.length}
                    ref={(el) => {
                      // Partly-accepted groups read as indeterminate rather than
                      // as "off", so a half-reviewed group is not mistaken for a
                      // rejected one.
                      if (el) el.indeterminate = on > 0 && on < keys.length
                    }}
                    onChange={(e) => toggleGroup(keys, e.target.checked)}
                    aria-label={`Accept all ${g.suggestions.length} mappings`}
                  />
                </div>
                {isOpen && (
                  <div className="am-rows">
                    {g.suggestions.map((s) => (
                      <label className="am-row" key={pairKey(s)}>
                        <span className="am-row-name" title={pathOf(index, s.source)}>
                          {index.entries.get(s.source)?.name}
                        </span>
                        <span className="am-arrow">→</span>
                        <span className="am-row-name" title={pathOf(index, s.target)}>
                          {index.entries.get(s.target)?.name}
                        </span>
                        <span className="am-conf" data-strong={s.confidence >= 95 || undefined}>
                          {s.confidence}%
                        </span>
                        <input
                          type="checkbox"
                          checked={accepted.has(pairKey(s))}
                          onChange={() => toggleOne(s)}
                        />
                      </label>
                    ))}
                  </div>
                )}
              </div>
            )
          })}
        </section>
      </div>

      <footer className="am-foot">
        <span className="am-foot-count">
          {suggestions === null
            ? 'Not generated'
            : `${acceptedList.length} of ${suggestions.length} accepted`}
        </span>
        <button className="am-mini" onClick={onClose}>
          Cancel
        </button>
        <button className="am-done" onClick={done} disabled={acceptedList.length === 0}>
          Done
        </button>
      </footer>
    </aside>
  )
}
