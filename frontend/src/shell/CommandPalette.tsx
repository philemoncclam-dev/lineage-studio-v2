// cmdk Command.Dialog command palette (D-17, NAV-01, NAV-03) — real
// implementation replacing the 02-04 stub. AppShell owns the open state
// (rail-bottom search trigger + the global Cmd+K keydown listener) and mounts
// this unconditionally; this file only fills Command.Input/Command.List.
//
// shouldFilter={false} (set on the stub already) + driving Command.List
// directly from src/shell/search.ts's ported GROUP_ORDER/MAX_PER_GROUP
// ranking means cmdk never re-sorts/re-filters results the app already
// ranked, grouped, and capped (RESEARCH.md Pattern 4 / Pitfall 6).
//
// No manual key-event listener or Arrow/Enter/Escape handling lives in this
// file — cmdk + the Radix Dialog it wraps own keyboard nav, focus-trap, and
// focus-restore-on-close (NAV-03, "Don't Hand-Roll").
import { useEffect, useMemo, useState } from 'react'
import { Command } from 'cmdk'
import { useNavigate } from '@tanstack/react-router'
import { useModel, type AppModel } from '../model'
import { useSelection } from '../selection/useSelection'
import { GROUP_LABEL, GROUP_ORDER, hl, search, type SearchResult } from './search'

export interface CommandPaletteProps {
  open: boolean
  onOpenChange: (open: boolean) => void
}

// Best-effort table for a notebook/code result: the table the notebook
// writes to, per the model's object-level ops ([source, target, kind]).
// Notebooks with no resolvable write target (not covered by `ops`, e.g. the
// non-DAG sample notebooks) fall back to a selection-only update below.
function firstWrittenTable(model: AppModel, notebookId: string): string | undefined {
  const op = model.ops.find(([src, , kind]) => src === notebookId && kind === 'writes')
  return op?.[1]
}

export default function CommandPalette({ open, onOpenChange }: CommandPaletteProps) {
  const model = useModel()
  const navigate = useNavigate()
  const { select } = useSelection()
  const [query, setQuery] = useState('')

  // Fresh state each time the palette opens (carried forward from
  // SearchPalette.tsx's reset-on-open effect); cmdk/Radix Dialog own
  // focus-on-open, so no manual `.focus()` call is needed here.
  useEffect(() => {
    if (open) setQuery('')
  }, [open])

  const results = useMemo(() => search(model, query), [model, query])

  // The retired Lineage-mode DAG was the old jump target; picks now land in
  // the graph with the result selected (?sel/?col).
  const pick = (r: SearchResult) => {
    if ((r.kind === 'table' || r.kind === 'column') && r.tableId) {
      const tableId = r.tableId
      void navigate({
        to: '/graph',
        search: (prev: Record<string, unknown>) => ({ ...prev, sel: tableId, col: r.colKey }),
      })
    } else if ((r.kind === 'notebook' || r.kind === 'code') && r.notebookId) {
      const tableId = firstWrittenTable(model, r.notebookId)
      if (tableId) {
        void navigate({
          to: '/graph',
          search: (prev: Record<string, unknown>) => ({ ...prev, sel: tableId, col: undefined }),
        })
      } else {
        select(r.notebookId)
      }
    }
    onOpenChange(false)
  }

  return (
    <Command.Dialog
      open={open}
      onOpenChange={onOpenChange}
      label="Search"
      shouldFilter={false}
      overlayClassName="palette-overlay"
      contentClassName="palette-content"
      className="palette"
    >
      <Command.Input
        className="sp-input"
        placeholder="Search tables, columns, notebooks, code…"
        value={query}
        onValueChange={setQuery}
        spellCheck={false}
      />
      {query.trim() !== '' && (
        <Command.List className="sp-results">
          <Command.Empty className="sp-empty">No matches for &quot;{query}&quot;.</Command.Empty>
          {GROUP_ORDER.map((kind) => {
            const group = results.filter((r) => r.kind === kind)
            if (group.length === 0) return null
            return (
              <Command.Group key={kind} heading={GROUP_LABEL[kind]}>
                {group.map((r) => {
                  const value = `${r.kind}:${r.tableId ?? ''}:${r.colKey ?? ''}:${r.notebookId ?? ''}:${r.line ?? ''}`
                  return (
                    <Command.Item key={value} value={value} className="sp-row" onSelect={() => pick(r)}>
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
                    </Command.Item>
                  )
                })}
              </Command.Group>
            )
          })}
        </Command.List>
      )}
    </Command.Dialog>
  )
}
