// OpenGrok-style global search palette: tables, columns, notebooks, and
// grep-style matches over NOTEBOOK_CODE. Centered modal, keyboard-driven.
import { useEffect, useMemo, useRef, useState } from 'react'
import { TABLES, NOTEBOOKS, LEVELS, NOTEBOOK_CODE } from '../data'
import './search.css'

export interface SearchResult {
  kind: 'table' | 'column' | 'notebook' | 'code'
  tableId?: string
  colKey?: string
  notebookId?: string
  label: string
  context?: string
  line?: number
}

interface Props {
  open: boolean
  onClose: () => void
  onResult: (r: SearchResult) => void
}

const GROUP_ORDER: SearchResult['kind'][] = ['table', 'column', 'notebook', 'code']
const GROUP_LABEL: Record<SearchResult['kind'], string> = {
  table: 'Tables', column: 'Columns', notebook: 'Notebooks', code: 'Code',
}
const MAX_PER_GROUP = 8

// All notebooks known by name (LEVELS notebook nodes + DAG notebooks), deduped.
function notebookIndex(): { id: string; name: string }[] {
  const seen = new Map<string, string>()
  for (const nb of NOTEBOOKS) seen.set(nb.name, nb.id)
  for (const lvl of Object.values(LEVELS)) {
    for (const n of lvl.nodes ?? []) {
      if (n.sub?.includes('notebook') && !seen.has(n.label)) {
        // code is keyed by name-like id when not the DAG notebook
        seen.set(n.label, n.label in NOTEBOOK_CODE ? n.label : n.id)
      }
    }
  }
  return [...seen.entries()].map(([name, id]) => ({ id, name }))
}

function search(query: string): SearchResult[] {
  const q = query.trim().toLowerCase()
  if (!q) return []
  const out: SearchResult[] = []

  for (const t of TABLES) {
    if (t.name.toLowerCase().includes(q)) {
      out.push({ kind: 'table', tableId: t.id, label: t.name, context: t.layer })
    }
  }
  for (const t of TABLES) {
    for (const c of t.columns) {
      if (c.name.toLowerCase().includes(q)) {
        out.push({ kind: 'column', tableId: t.id, colKey: c.key, label: c.name, context: `${t.name} · ${c.type}` })
      }
    }
  }
  for (const nb of notebookIndex()) {
    if (nb.name.toLowerCase().includes(q)) {
      out.push({ kind: 'notebook', notebookId: nb.id, label: nb.name, context: 'notebook' })
    }
  }
  const nbName = new Map(notebookIndex().map(n => [n.id, n.name]))
  for (const [id, code] of Object.entries(NOTEBOOK_CODE)) {
    const lines = code.split('\n')
    let hits = 0
    for (let i = 0; i < lines.length && hits < MAX_PER_GROUP; i++) {
      if (lines[i].toLowerCase().includes(q)) {
        out.push({
          kind: 'code', notebookId: id, line: i + 1,
          label: nbName.get(id) ?? id, context: lines[i].trim(),
        })
        hits++
      }
    }
  }
  return out
}

// Highlight every case-insensitive occurrence of q in text with <mark>.
function hl(text: string, q: string) {
  const query = q.trim().toLowerCase()
  if (!query) return text
  const parts: (string | React.JSX.Element)[] = []
  const lower = text.toLowerCase()
  let pos = 0
  let idx = lower.indexOf(query, pos)
  let k = 0
  while (idx !== -1) {
    if (idx > pos) parts.push(text.slice(pos, idx))
    parts.push(<mark key={k++}>{text.slice(idx, idx + query.length)}</mark>)
    pos = idx + query.length
    idx = lower.indexOf(query, pos)
  }
  if (pos < text.length) parts.push(text.slice(pos))
  return <>{parts}</>
}

export default function SearchPalette({ open, onClose, onResult }: Props) {
  const [query, setQuery] = useState('')
  const [sel, setSel] = useState(0)
  const inputRef = useRef<HTMLInputElement>(null)
  const listRef = useRef<HTMLDivElement>(null)

  const results = useMemo(() => {
    const all = search(query)
    // stable group order, capped per group
    const grouped: SearchResult[] = []
    for (const kind of GROUP_ORDER) {
      grouped.push(...all.filter(r => r.kind === kind).slice(0, MAX_PER_GROUP))
    }
    return grouped
  }, [query])

  useEffect(() => {
    if (open) {
      setQuery('')
      setSel(0)
      // focus after mount/paint
      requestAnimationFrame(() => inputRef.current?.focus())
    }
  }, [open])

  useEffect(() => { setSel(0) }, [query])

  useEffect(() => {
    const el = listRef.current?.querySelector('[data-selected="true"]')
    el?.scrollIntoView({ block: 'nearest' })
  }, [sel, results])

  if (!open) return null

  const pick = (r: SearchResult) => { onResult(r); onClose() }

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Escape') { e.preventDefault(); onClose() }
    else if (e.key === 'ArrowDown') { e.preventDefault(); setSel(s => Math.min(s + 1, results.length - 1)) }
    else if (e.key === 'ArrowUp') { e.preventDefault(); setSel(s => Math.max(s - 1, 0)) }
    else if (e.key === 'Enter' && results[sel]) { e.preventDefault(); pick(results[sel]) }
  }

  let flat = -1
  return (
    <div className="sp-overlay" onMouseDown={onClose}>
      <div className="sp-palette" role="dialog" aria-label="Search" onMouseDown={e => e.stopPropagation()}>
        <input
          ref={inputRef}
          className="sp-input"
          placeholder="Search tables, columns, notebooks, code…"
          value={query}
          onChange={e => setQuery(e.target.value)}
          onKeyDown={onKeyDown}
          spellCheck={false}
        />
        {query.trim() !== '' && (
          <div className="sp-results" ref={listRef}>
            {results.length === 0 && <div className="sp-empty">No matches</div>}
            {GROUP_ORDER.map(kind => {
              const group = results.filter(r => r.kind === kind)
              if (group.length === 0) return null
              return (
                <div key={kind} className="sp-group">
                  <div className="sp-group-label">{GROUP_LABEL[kind]}</div>
                  {group.map(r => {
                    flat++
                    const i = flat
                    return (
                      <div
                        key={`${r.kind}:${r.tableId ?? ''}:${r.colKey ?? ''}:${r.notebookId ?? ''}:${r.line ?? ''}`}
                        className="sp-row"
                        data-selected={i === sel}
                        onMouseEnter={() => setSel(i)}
                        onClick={() => pick(r)}
                      >
                        {r.kind === 'code' ? (
                          <>
                            <span className="sp-id">{r.label}</span>
                            <span className="sp-line">:{r.line}</span>
                            <span className="sp-code">{hl(r.context ?? '', query)}</span>
                          </>
                        ) : (
                          <>
                            <span className="sp-id">{hl(r.label, query)}</span>
                            {r.context && <span className="sp-ctx">{r.context}</span>}
                          </>
                        )}
                      </div>
                    )
                  })}
                </div>
              )
            })}
          </div>
        )}
      </div>
    </div>
  )
}
