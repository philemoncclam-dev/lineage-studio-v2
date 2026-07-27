// In-model search overlay, opened by the rail search button or Cmd+K while the
// Model Viewer is on screen (see shell/searchBridge.ts).

import { useEffect, useMemo, useRef, useState } from 'react'
import type { ModelIndex } from '../model/index'
import { pathOf } from '../model/index'
import { highlightParts, searchModel, type SearchHit } from './searchModel'

interface Props {
  index: ModelIndex
  onPick: (hit: SearchHit) => void
  onClose: () => void
}

export default function ModelSearch({ index, onPick, onClose }: Props) {
  const [query, setQuery] = useState('')
  const [active, setActive] = useState(0)
  const inputRef = useRef<HTMLInputElement | null>(null)
  const listRef = useRef<HTMLDivElement | null>(null)

  const hits = useMemo(() => searchModel(index, query), [index, query])

  useEffect(() => {
    inputRef.current?.focus()
  }, [])

  // Any new query invalidates the highlighted row's position in the list.
  useEffect(() => {
    setActive(0)
  }, [query])

  // Keep the keyboard-selected row in view when arrowing past the fold.
  useEffect(() => {
    listRef.current?.querySelector('[data-active="true"]')?.scrollIntoView({ block: 'nearest' })
  }, [active])

  const onKeyDown = (e: React.KeyboardEvent) => {
    // Stop keys reaching the canvas — Delete and Escape both mean something
    // destructive out there.
    e.stopPropagation()
    if (e.key === 'Escape') {
      onClose()
      return
    }
    if (e.key === 'ArrowDown') {
      e.preventDefault()
      setActive((i) => Math.min(i + 1, hits.length - 1))
      return
    }
    if (e.key === 'ArrowUp') {
      e.preventDefault()
      setActive((i) => Math.max(i - 1, 0))
      return
    }
    if (e.key === 'Enter' && hits[active]) {
      e.preventDefault()
      onPick(hits[active])
    }
  }

  return (
    // Same container as the Fabric command palette (.palette-overlay /
    // .palette-content / .palette / .sp-input in styles/shell.css) so every
    // search surface in the app is one shape. Only the RESULT rows are this
    // view's own — a model hit is name + path + match count, not a catalog row.
    <>
      <div className="palette-overlay" onMouseDown={onClose} />
      <div className="palette-content">
      <div
        className="palette"
        onMouseDown={(e) => e.stopPropagation()}
        role="dialog"
        aria-label="Search the model"
      >
        <input
          ref={inputRef}
          className="sp-input"
          value={query}
          placeholder="Search layers, objects and attributes…"
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={onKeyDown}
          aria-label="Search the model"
        />

        <div className="ms-results" ref={listRef} onKeyDown={onKeyDown}>
          {query && hits.length === 0 && <div className="ms-empty">No matches.</div>}
          {hits.map((hit, i) => (
            <button
              key={`${hit.kind}:${hit.name}`}
              className="ms-hit"
              data-active={i === active}
              onMouseEnter={() => setActive(i)}
              onClick={() => onPick(hit)}
            >
              <span className="ms-kind" data-kind={hit.kind}>
                {hit.kind[0].toUpperCase()}
              </span>
              <span className="ms-name">
                {(() => {
                  const [before, match, after] = highlightParts(hit.name, query)
                  return (
                    <>
                      {before}
                      <mark>{match}</mark>
                      {after}
                    </>
                  )
                })()}
              </span>
              <span className="ms-where">
                {hit.ids.length === 1 ? pathOf(index, hit.ids[0]) : ''}
              </span>
              {hit.ids.length > 1 && <span className="ms-count">{hit.ids.length}</span>}
            </button>
          ))}
        </div>

        <div className="ms-foot">
          {hits.length > 0 && <>↑↓ move · ↵ select all matches · esc close</>}
        </div>
      </div>
      </div>
    </>
  )
}
