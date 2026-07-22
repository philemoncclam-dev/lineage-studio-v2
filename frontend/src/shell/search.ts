// OpenGrok-style ranked/grouped search over tables, columns, notebooks, and
// grep-style matches over notebook code — ported verbatim (Pitfall 6: keep
// the app's own exact-substring ranking, not cmdk's fuzzy filter) from
// src/views/SearchPalette.tsx as part of the D-17 cmdk rebuild (NAV-01).
// A `.ts` (not `.tsx`) module by design (02-06-PLAN.md files_modified), so
// `hl()` builds React nodes via `createElement`, never JSX syntax or an HTML
// string — see the threat register (T-02-06): notebook code content must
// never be able to inject markup into the palette.
import { createElement, type ReactNode } from 'react'
import type { AppModel } from '../model'
import { nid } from '../model/ids'

export interface SearchResult {
  kind: 'table' | 'column' | 'notebook' | 'code'
  tableId?: string
  colKey?: string
  notebookId?: string
  label: string
  context?: string
  line?: number
}

export const GROUP_ORDER: SearchResult['kind'][] = ['table', 'column', 'notebook', 'code']
export const GROUP_LABEL: Record<SearchResult['kind'], string> = {
  table: 'Tables', column: 'Columns', notebook: 'Notebooks', code: 'Code',
}
export const MAX_PER_GROUP = 8

// All notebooks known by NODE ID (LEVELS notebook nodes + DAG notebooks),
// deduped by id (not display name) so two same-named notebooks from
// different workspaces are both indexed (WR-04). Graph-only notebook nodes
// carry the RAW graph id (e.g. 'notebook.clean_orders'); resolve them through
// the same nid() used everywhere else in AppModel (model.notebooks,
// model.notebookCode, model.ops) so the returned id is always resolvable —
// never a raw id the rest of the model can't look up.
function notebookIndex(m: AppModel): { id: string; name: string }[] {
  const seen = new Map<string, string>() // id -> name
  for (const nb of m.notebooks) seen.set(nb.id, nb.name)
  for (const lvl of Object.values(m.levels)) {
    for (const n of lvl.nodes ?? []) {
      if (!n.sub?.includes('notebook')) continue
      const id = nid(n.id)
      if (!seen.has(id)) seen.set(id, n.label)
    }
  }
  return [...seen.entries()].map(([id, name]) => ({ id, name }))
}

function rawSearch(m: AppModel, query: string): SearchResult[] {
  const q = query.trim().toLowerCase()
  if (!q) return []
  const out: SearchResult[] = []

  for (const t of m.tables) {
    if (t.name.toLowerCase().includes(q)) {
      out.push({ kind: 'table', tableId: t.id, label: t.name, context: t.layer })
    }
  }
  for (const t of m.tables) {
    for (const c of t.columns) {
      if (c.name.toLowerCase().includes(q)) {
        out.push({ kind: 'column', tableId: t.id, colKey: c.key, label: c.name, context: `${t.name} · ${c.type}` })
      }
    }
  }
  for (const nb of notebookIndex(m)) {
    if (nb.name.toLowerCase().includes(q)) {
      out.push({ kind: 'notebook', notebookId: nb.id, label: nb.name, context: 'notebook' })
    }
  }
  const nbName = new Map(notebookIndex(m).map((n) => [n.id, n.name]))
  for (const [id, code] of Object.entries(m.notebookCode)) {
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

// search(): rawSearch() + the grouped/capped assembly ported verbatim from
// SearchPalette.tsx's `results` memo — stable GROUP_ORDER, each group capped
// at MAX_PER_GROUP. Feeds cmdk's Command.List with shouldFilter={false}
// (RESEARCH.md Pattern 4 / Pitfall 6) — cmdk never re-sorts/re-filters this.
export function search(m: AppModel, query: string): SearchResult[] {
  const all = rawSearch(m, query)
  const grouped: SearchResult[] = []
  for (const kind of GROUP_ORDER) {
    grouped.push(...all.filter((r) => r.kind === kind).slice(0, MAX_PER_GROUP))
  }
  return grouped
}

// Highlight every case-insensitive occurrence of q in text with <mark>.
// Returns React nodes (text segments + createElement('mark', ...) elements)
// — never an HTML string / dangerouslySetInnerHTML (T-02-06).
export function hl(text: string, q: string): ReactNode {
  const query = q.trim().toLowerCase()
  if (!query) return text
  const parts: ReactNode[] = []
  const lower = text.toLowerCase()
  let pos = 0
  let idx = lower.indexOf(query, pos)
  let k = 0
  while (idx !== -1) {
    if (idx > pos) parts.push(text.slice(pos, idx))
    parts.push(createElement('mark', { key: k++ }, text.slice(idx, idx + query.length)))
    pos = idx + query.length
    idx = lower.indexOf(query, pos)
  }
  if (pos < text.length) parts.push(text.slice(pos))
  return parts
}
