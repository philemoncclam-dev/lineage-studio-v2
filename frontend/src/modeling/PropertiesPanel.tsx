// The Properties panel — the read side of the property bag.
//
// Everything in the bag was write-only before this: the sandbox importer wrote
// `Source`, `Step`, `Workspace`, `Access`, `Data type` and `Transform`, the
// Auto-Mapper wrote `Confidence`, `Mapped by` and `Algorithm`, and the only way
// to see any of it was the two or three keys the card badges happen to decorate
// (see `Badges` in ModelViewer). This panel shows all of it, for whatever is
// selected, and lets it be edited.
//
// A docked panel rather than a modal, for the same reason Views is one: you
// read a property against the thing on the canvas that carries it, and a modal
// covers exactly that. It shares the Views panel's skin (`.vw-*`) deliberately
// — two docks in the same slot that looked different would read as two
// different kinds of surface.
//
// TRANSITIONS ARE SUBJECTS TOO. Properties are keyed by id and a Transition has
// an id, so a selected line has a bag like anything else — and the Auto-Mapper's
// confidence has always lived there with no way to read it. Picking a line and
// opening this panel is now how you ask "where did this edge come from".
import { useEffect, useMemo, useState } from 'react'
import { ancestorsOf, type ModelIndex } from '../model/index'
import {
  commonProperties,
  isReservedKey,
  propertyKeyCounts,
  removeProperty,
  renameProperty,
  setProperty,
  valuesForKey,
} from '../model/properties'
import { tagsOf } from '../model/tags'
import type { EntityId, LineageModel } from '../model/types'

const KIND_LABEL: Record<string, string> = {
  layer: 'Layer',
  object: 'Object',
  attribute: 'Attribute',
}

export function PropertiesPanel({
  model,
  index,
  entityIds,
  transitionIds,
  onChange,
  onEditTags,
  onSelect,
  onClose,
}: {
  model: LineageModel
  index: ModelIndex
  /** Selected entities. Takes precedence over `transitionIds` when both are set. */
  entityIds: EntityId[]
  /** Selected transitions, by transition id. */
  transitionIds: EntityId[]
  onChange: (next: LineageModel) => void
  /** Hands the selection to the tag editor — `Tags` is not a plain text field. */
  onEditTags: (ids: EntityId[]) => void
  /** Jumps to a transition's endpoint, so a line's ends are reachable from here. */
  onSelect: (id: EntityId) => void
  onClose: () => void
}) {
  // Entities win when both are selected: ctrl-clicking can leave a line and a
  // row picked at once, and the row is the thing under the cursor.
  const onEntities = entityIds.length > 0
  const ids = onEntities ? entityIds : transitionIds
  const signature = ids.join(',')

  // Values are drafted locally and committed on blur or Enter. Every commit is
  // an undo step (useUndoable snapshots and does not coalesce), so writing
  // straight through onChange would put one history entry per KEYSTROKE and
  // make ⌃Z useless for anything else.
  const [drafts, setDrafts] = useState<Record<string, string>>({})
  const [renaming, setRenaming] = useState<string | null>(null)
  const [newKey, setNewKey] = useState('')
  const [newValue, setNewValue] = useState('')
  useEffect(() => {
    setDrafts({})
    setRenaming(null)
    setNewKey('')
    setNewValue('')
  }, [signature])

  const rows = useMemo(() => commonProperties(model, ids), [model, ids])
  const keyCounts = useMemo(() => propertyKeyCounts(model), [model])
  const suggestedKeys = useMemo(
    () =>
      [...keyCounts.entries()]
        .filter(([k]) => !rows.some((r) => r.key === k))
        .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
        .map(([k]) => k),
    [keyCounts, rows],
  )

  const commit = (key: string, value: string) => {
    setDrafts((d) => {
      const next = { ...d }
      delete next[key]
      return next
    })
    const row = rows.find((r) => r.key === key)
    // A mixed row left untouched must not be flattened: its displayed value is
    // '' precisely because the subjects disagree, and committing that would
    // clear the key on every one of them.
    if (row?.mixed && value === '') return
    onChange(setProperty(model, ids, key, value))
  }

  const addNew = () => {
    const key = newKey.trim()
    if (!key || isReservedKey(key) || !newValue.trim()) return
    onChange(setProperty(model, ids, key, newValue))
    setNewKey('')
    setNewValue('')
  }

  return (
    <aside className="vw-panel pr-panel" aria-label="Properties">
      <header className="vw-head">
        <h2 className="vw-title">Properties</h2>
        {rows.length > 0 && <span className="vw-badge">{rows.length}</span>}
        <button className="tg-x" onClick={onClose} aria-label="Close properties">
          ×
        </button>
      </header>

      {ids.length === 0 ? (
        <div className="vw-body">
          <p className="tg-empty">
            Select an entity or a transition on the canvas to see what it carries.
          </p>
        </div>
      ) : (
        <div className="vw-body">
          <Subject
            model={model}
            index={index}
            ids={ids}
            onEntities={onEntities}
            onSelect={onSelect}
          />

          {onEntities && (
            <div className="vw-field">
              <span className="tg-label">Tags</span>
              <TagsRow model={model} ids={ids} onEdit={() => onEditTags(ids)} />
            </div>
          )}

          <div className="vw-field">
            <span className="tg-label">Values</span>
            {rows.length === 0 ? (
              <p className="tg-empty">
                Nothing recorded here yet. Add one below.
              </p>
            ) : (
              <ul className="pr-list">
                {rows.map((row) => (
                  <li className="pr-row" key={row.key}>
                    {renaming === row.key ? (
                      <input
                        className="tg-field pr-key-edit"
                        autoFocus
                        defaultValue={row.key}
                        aria-label={`Rename ${row.key}`}
                        onBlur={(e) => {
                          onChange(renameProperty(model, ids, row.key, e.currentTarget.value))
                          setRenaming(null)
                        }}
                        onKeyDown={(e) => {
                          e.stopPropagation()
                          if (e.key === 'Enter') e.currentTarget.blur()
                          if (e.key === 'Escape') setRenaming(null)
                        }}
                      />
                    ) : (
                      <button
                        className="pr-key"
                        title={`${row.key} — click to rename on ${
                          ids.length === 1 ? 'this entity' : `these ${ids.length}`
                        }`}
                        onClick={() => setRenaming(row.key)}
                      >
                        {row.key}
                      </button>
                    )}
                    <input
                      className="tg-field pr-value"
                      value={drafts[row.key] ?? row.value}
                      placeholder={row.mixed ? `Mixed — ${row.present}/${ids.length}` : ''}
                      data-mixed={row.mixed || undefined}
                      aria-label={`${row.key} value`}
                      onChange={(e) =>
                        setDrafts((d) => ({ ...d, [row.key]: e.target.value }))
                      }
                      onBlur={(e) => commit(row.key, e.target.value)}
                      onKeyDown={(e) => {
                        e.stopPropagation()
                        if (e.key === 'Enter') e.currentTarget.blur()
                        if (e.key === 'Escape') {
                          setDrafts((d) => {
                            const next = { ...d }
                            delete next[row.key]
                            return next
                          })
                          e.currentTarget.blur()
                        }
                      }}
                      list={`pr-vals-${cssId(row.key)}`}
                    />
                    <datalist id={`pr-vals-${cssId(row.key)}`}>
                      {valuesForKey(model, row.key).map((v) => (
                        <option key={v} value={v} />
                      ))}
                    </datalist>
                    <button
                      className="tg-act"
                      aria-label={`Remove ${row.key}`}
                      title={`Remove ${row.key}`}
                      onClick={() => onChange(removeProperty(model, ids, row.key))}
                    >
                      ×
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>

          <div className="vw-field">
            <span className="tg-label">Add a property</span>
            <div className="pr-add">
              <input
                className="tg-field"
                list="pr-keys"
                value={newKey}
                placeholder="Key"
                aria-label="New property key"
                onChange={(e) => setNewKey(e.target.value)}
                onKeyDown={(e) => e.stopPropagation()}
              />
              <input
                className="tg-field"
                value={newValue}
                placeholder="Value"
                aria-label="New property value"
                onChange={(e) => setNewValue(e.target.value)}
                onKeyDown={(e) => {
                  e.stopPropagation()
                  if (e.key === 'Enter') addNew()
                }}
              />
            </div>
            <datalist id="pr-keys">
              {suggestedKeys.map((k) => (
                <option key={k} value={k} />
              ))}
            </datalist>
            {isReservedKey(newKey) ? (
              <span className="tg-hint">
                <strong>{newKey.trim()}</strong> has its own editor above.
              </span>
            ) : (
              <button
                className="imp-btn"
                disabled={!newKey.trim() || !newValue.trim()}
                onClick={addNew}
              >
                Add to {ids.length === 1 ? 'this' : `all ${ids.length}`}
              </button>
            )}
          </div>
        </div>
      )}

      <footer className="vw-foot">
        <span className="vw-result">{describeSelection(ids.length, onEntities)}</span>
      </footer>
    </aside>
  )
}

function describeSelection(count: number, onEntities: boolean): string {
  if (count === 0) return 'Nothing selected'
  if (onEntities) return count === 1 ? '1 entity' : `${count} entities`
  return count === 1 ? '1 transition' : `${count} transitions`
}

/** datalist ids must be valid selectors; property keys can hold spaces. */
function cssId(key: string): string {
  return key.replace(/[^a-zA-Z0-9]/g, '-')
}

/**
 * What is being described — the panel's whole orientation.
 *
 * Without it a bag of key/values is unattributed: with two rows selected the
 * values are a merge, and the header is the only thing saying so.
 */
function Subject({
  model,
  index,
  ids,
  onEntities,
  onSelect,
}: {
  model: LineageModel
  index: ModelIndex
  ids: EntityId[]
  onEntities: boolean
  onSelect: (id: EntityId) => void
}) {
  if (ids.length > 1) {
    return (
      <div className="pr-subject">
        <span className="pr-subject-name">
          {ids.length} {onEntities ? 'entities' : 'transitions'}
        </span>
        <span className="pr-subject-meta">
          Edits below apply to all of them.
        </span>
      </div>
    )
  }

  const id = ids[0]

  if (!onEntities) {
    const t = model.transitions.find((x) => x.id === id)
    const from = t ? index.entries.get(t.source) : undefined
    const to = t ? index.entries.get(t.target) : undefined
    return (
      <div className="pr-subject">
        <span className="pr-subject-name">Transition</span>
        <span className="pr-subject-meta">
          {/* Both ends are buttons: the commonest thing to want after reading a
              line's provenance is to go and look at the row it lands on. */}
          <button className="pr-link" onClick={() => t && onSelect(t.source)}>
            {from?.name ?? 'unknown'}
          </button>
          {' → '}
          <button className="pr-link" onClick={() => t && onSelect(t.target)}>
            {to?.name ?? 'unknown'}
          </button>
        </span>
      </div>
    )
  }

  const entry = index.entries.get(id)
  if (!entry) return null
  const trail = ancestorsOf(index, id).reverse()

  return (
    <div className="pr-subject">
      <span className="pr-subject-name" title={entry.name}>
        {entry.name}
      </span>
      <span className="pr-subject-meta">
        <span className="pr-kind">{KIND_LABEL[entry.kind] ?? entry.kind}</span>
        {trail.length > 0 && (
          <>
            {' · '}
            {trail.map((a, i) => (
              <span key={a.id}>
                {i > 0 && ' / '}
                <button className="pr-link" onClick={() => onSelect(a.id)}>
                  {a.name}
                </button>
              </span>
            ))}
          </>
        )}
      </span>
    </div>
  )
}

/** Tags read here, but are edited in their own dialog — see RESERVED_KEYS. */
function TagsRow({
  model,
  ids,
  onEdit,
}: {
  model: LineageModel
  ids: EntityId[]
  onEdit: () => void
}) {
  // For a multi-selection the union is shown: "what is on these" is the useful
  // reading, and the editor itself already warns that saving REPLACES.
  const tags = useMemo(() => {
    const seen = new Set<string>()
    for (const id of ids) for (const t of tagsOf(model, id)) seen.add(t)
    return [...seen]
  }, [model, ids])

  return (
    <div className="pr-tags">
      {tags.length === 0 ? (
        <span className="tg-empty">None</span>
      ) : (
        tags.map((t) => (
          <span className="tg-chip" key={t} data-kind={t.toLowerCase()}>
            {t}
          </span>
        ))
      )}
      <button className="tg-act" onClick={onEdit}>
        Edit…
      </button>
    </div>
  )
}

export default PropertiesPanel
