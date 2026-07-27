// The Model Viewer's tag surfaces: the per-entity editor and the tag manager.
//
// Why these do not reuse `ModelDialogs.TagDialog`: that component is skinned
// entirely in `.mb-*` classes, which live in modelBrowser.css — a stylesheet
// only ModelBrowser imports. The viewer imported the component but not the
// stylesheet, so tagging from the canvas rendered as unstyled markup in the
// corner of the screen. That is the exact failure ModelDialogs' own header
// warns about. The fix is a viewer-owned component on the viewer's own skin,
// not a cross-import of the browser's stylesheet, which would drag the whole
// browser look into the canvas.
import { useEffect, useMemo, useRef, useState } from 'react'
import { normalizeTags } from '../model/store'
import {
  addTagTo,
  allTags,
  deleteTag,
  entitiesWithTag,
  renameTag,
  setTags,
  tagCounts,
  tagsOf,
} from '../model/tags'
import type { Attribute, EntityId, LineageModel } from '../model/types'

/** Centres a panel on the viewer's own backdrop (see .ms-backdrop, modeling.css). */
function Backdrop({ children, onClose }: { children: React.ReactNode; onClose: () => void }) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopPropagation()
        onClose()
      }
    }
    window.addEventListener('keydown', onKey, true)
    return () => window.removeEventListener('keydown', onKey, true)
  }, [onClose])

  return (
    <div className="ms-backdrop" onMouseDown={onClose}>
      <div className="imp-panel tg-panel" onMouseDown={(e) => e.stopPropagation()}>
        {children}
      </div>
    </div>
  )
}

// ===== Per-entity tag editor =====

/**
 * Edits the tags on one entity or on a multi-selection.
 *
 * Multi-select REPLACES rather than merges, and says so — merging would make
 * "clear the tags on these twelve rows" impossible to express, and clearing is
 * the commonest bulk edit.
 */
export function EntityTagDialog({
  model,
  ids,
  onSubmit,
  onClose,
}: {
  model: LineageModel
  ids: EntityId[]
  onSubmit: (tags: string[]) => void
  onClose: () => void
}) {
  const bulk = ids.length > 1
  const [tags, setTagList] = useState<string[]>(() => (bulk ? [] : tagsOf(model, ids[0])))
  const [draft, setDraft] = useState('')
  const inputRef = useRef<HTMLInputElement | null>(null)

  useEffect(() => inputRef.current?.focus(), [])

  const counts = useMemo(() => tagCounts(model), [model])
  const add = (raw: string) => {
    setTagList(normalizeTags([...tags, raw]))
    setDraft('')
  }
  const remove = (tag: string) => setTagList(tags.filter((t) => t !== tag))

  const onKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter' || e.key === ',') {
      e.preventDefault()
      if (draft.trim()) add(draft)
    } else if (e.key === 'Backspace' && !draft && tags.length) {
      remove(tags[tags.length - 1])
    }
  }

  // Suggestions are ranked by how much of the model already uses them, so the
  // vocabulary that actually exists surfaces before one-off labels.
  const unused = allTags(model)
    .filter((s) => !tags.some((t) => t.toLowerCase() === s.toLowerCase()))
    .filter((s) => !draft.trim() || s.toLowerCase().includes(draft.trim().toLowerCase()))
    .sort((a, b) => (counts.get(b) ?? 0) - (counts.get(a) ?? 0))

  const commit = () => onSubmit(draft.trim() ? normalizeTags([...tags, draft]) : tags)

  return (
    <Backdrop onClose={onClose}>
      <header className="imp-head">
        <h2 className="imp-title">Tags</h2>
        <span className="tg-subject">
          {bulk ? `${ids.length} entities` : (nameOf(model, ids[0]) ?? 'Entity')}
        </span>
        <button className="tg-x" onClick={onClose} aria-label="Close">
          ×
        </button>
      </header>

      <div className="tg-body">
        {bulk && (
          <p className="tg-warn">
            These tags <strong>replace</strong> whatever each selected entity carries now.
          </p>
        )}

        <div className="tg-input" onClick={() => inputRef.current?.focus()}>
          {tags.map((tag) => (
            <span className="tg-chip" key={tag} data-kind={tag.toLowerCase()}>
              {tag}
              <button className="tg-chip-x" onClick={() => remove(tag)} aria-label={`Remove ${tag}`}>
                ×
              </button>
            </span>
          ))}
          <input
            ref={inputRef}
            className="tg-entry"
            value={draft}
            placeholder={tags.length ? 'Add another…' : 'Type a tag, then Enter'}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={onKeyDown}
            aria-label="Add a tag"
          />
        </div>

        {unused.length > 0 && (
          <>
            <p className="tg-label">Already in this model</p>
            <div className="tg-suggest">
              {unused.map((tag) => (
                <button className="tg-chip ghost" key={tag} onClick={() => add(tag)}>
                  {tag}
                  <span className="tg-count">{counts.get(tag) ?? 0}</span>
                </button>
              ))}
            </div>
          </>
        )}
      </div>

      <footer className="tg-foot">
        <button className="imp-btn" onClick={onClose}>
          Cancel
        </button>
        <button className="imp-btn primary" onClick={commit}>
          Save
        </button>
      </footer>
    </Backdrop>
  )
}

function nameOf(model: LineageModel, id: EntityId): string | null {
  const findAttr = (list: Attribute[]): string | null => {
    for (const a of list) {
      if (a.id === id) return a.name
      const deeper = findAttr(a.children)
      if (deeper) return deeper
    }
    return null
  }
  for (const layer of model.layers) {
    if (layer.id === id) return layer.name
    for (const obj of layer.objects) {
      if (obj.id === id) return obj.name
      const found = findAttr(obj.children)
      if (found) return found
    }
  }
  return null
}

// ===== Tag manager =====

/**
 * Every tag in the model, with what it costs and what it touches.
 *
 * This is the tag VOCABULARY, not a per-entity editor: rename and delete here
 * apply everywhere the tag appears, which is the whole reason the screen exists
 * — before it, fixing a typo in a tag meant reopening every entity carrying it.
 */
export function TagManager({
  model,
  selection,
  onChange,
  onSelect,
  onClose,
}: {
  model: LineageModel
  selection: ReadonlySet<EntityId>
  onChange: (next: LineageModel) => void
  /** Replaces the canvas selection — how a tag becomes something you can act on. */
  onSelect: (ids: EntityId[]) => void
  onClose: () => void
}) {
  const [query, setQuery] = useState('')
  const [renaming, setRenaming] = useState<string | null>(null)
  const [draft, setDraft] = useState('')
  const [newTag, setNewTag] = useState('')

  const counts = useMemo(() => tagCounts(model), [model])
  const tags = useMemo(() => {
    const q = query.trim().toLowerCase()
    return allTags(model)
      .filter((t) => !q || t.toLowerCase().includes(q))
      .sort((a, b) => (counts.get(b) ?? 0) - (counts.get(a) ?? 0) || a.localeCompare(b))
  }, [model, query, counts])

  const startRename = (tag: string) => {
    setRenaming(tag)
    setDraft(tag)
  }
  const commitRename = () => {
    if (renaming && draft.trim() && draft.trim() !== renaming)
      onChange(renameTag(model, renaming, draft))
    setRenaming(null)
  }

  const applyToSelection = () => {
    if (!newTag.trim() || selection.size === 0) return
    onChange(addTagTo(model, selection, newTag))
    setNewTag('')
  }

  return (
    <Backdrop onClose={onClose}>
      <header className="imp-head">
        <h2 className="imp-title">Tags</h2>
        <span className="tg-subject">
          {allTags(model).length} in this model
        </span>
        <button className="tg-x" onClick={onClose} aria-label="Close">
          ×
        </button>
      </header>

      <div className="tg-body">
        {/* Tagging the current selection lives here as well as on the context
            menu: someone who opened this screen to survey the vocabulary is
            exactly the person who then wants to apply one of them. */}
        <div className="tg-add">
          <input
            className="tg-field"
            value={newTag}
            placeholder={
              selection.size
                ? `Add a tag to ${selection.size} selected…`
                : 'Select entities on the canvas to tag them'
            }
            disabled={selection.size === 0}
            onChange={(e) => setNewTag(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && applyToSelection()}
            aria-label="Add a tag to the selection"
          />
          <button
            className="imp-btn primary"
            disabled={selection.size === 0 || !newTag.trim()}
            onClick={applyToSelection}
          >
            Add
          </button>
        </div>

        <input
          className="tg-field tg-search"
          value={query}
          placeholder="Search tags…"
          onChange={(e) => setQuery(e.target.value)}
          aria-label="Search tags"
        />

        {tags.length === 0 ? (
          <p className="tg-empty">
            {allTags(model).length === 0
              ? 'No tags yet. Select something on the canvas and add one above.'
              : 'No tag matches that search.'}
          </p>
        ) : (
          <ul className="tg-list">
            {tags.map((tag) => (
              <li className="tg-row" key={tag}>
                {renaming === tag ? (
                  <input
                    className="tg-field tg-rename"
                    value={draft}
                    autoFocus
                    onChange={(e) => setDraft(e.target.value)}
                    onBlur={commitRename}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') commitRename()
                      if (e.key === 'Escape') setRenaming(null)
                    }}
                    aria-label={`Rename ${tag}`}
                  />
                ) : (
                  <>
                    <span className="tg-chip" data-kind={tag.toLowerCase()}>
                      {tag}
                    </span>
                    <span className="tg-row-count">
                      {counts.get(tag) ?? 0} {(counts.get(tag) ?? 0) === 1 ? 'entity' : 'entities'}
                    </span>
                    <div className="tg-row-acts">
                      <button
                        className="tg-act"
                        onClick={() => onSelect(entitiesWithTag(model, tag))}
                        title="Select every entity carrying this tag"
                      >
                        Select
                      </button>
                      <button className="tg-act" onClick={() => startRename(tag)}>
                        Rename
                      </button>
                      <button
                        className="tg-act danger"
                        onClick={() => onChange(deleteTag(model, tag))}
                        title="Remove this tag from every entity"
                      >
                        Delete
                      </button>
                    </div>
                  </>
                )}
              </li>
            ))}
          </ul>
        )}
      </div>

      <footer className="tg-foot">
        <span className="tg-foot-note">Rename and Delete apply everywhere the tag is used.</span>
        <button className="imp-btn primary" onClick={onClose}>
          Done
        </button>
      </footer>
    </Backdrop>
  )
}

export { setTags }
