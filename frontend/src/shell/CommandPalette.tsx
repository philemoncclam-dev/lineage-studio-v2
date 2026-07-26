// cmdk Command.Dialog command palette (D-17, NAV-01, NAV-03). Searches the live
// Fabric catalog — every discoverable asset (workspaces, notebooks, lakehouses,
// tables, and other items) via /fabric/catalog — and jumps to the Explore view
// drilled onto the picked object (auto-expanding its ancestors and selecting
// it, through the target search-params the explore route understands).
//
// shouldFilter={false}: we rank/group/cap results ourselves so cmdk never
// re-sorts them. cmdk + the Radix Dialog own keyboard nav, focus-trap, and
// focus-restore-on-close — no hand-rolled key handling here.
import { useEffect, useMemo, useRef, useState } from 'react'
import { Command } from 'cmdk'
import { useNavigate } from '@tanstack/react-router'
import { type FabricCatalogEntry, type FabricCatalogKind } from '../api'
import { loadCatalog } from './catalogCache'

export interface CommandPaletteProps {
  open: boolean
  onOpenChange: (open: boolean) => void
}

const GROUP_ORDER: FabricCatalogKind[] = ['workspace', 'notebook', 'lakehouse', 'table', 'item']
const GROUP_LABEL: Record<FabricCatalogKind, string> = {
  workspace: 'Workspaces',
  notebook: 'Notebooks',
  lakehouse: 'Lakehouses',
  table: 'Tables',
  item: 'Other items',
}
const MAX_PER_GROUP = 8

// The catalog itself is cached in ./catalogCache — shared with the Fabric
// overview dashboard so re-opening the palette never re-crawls the tenant.

// Rank: case-insensitive substring match, earlier match wins, then shorter name.
function rank(entries: FabricCatalogEntry[], query: string): FabricCatalogEntry[] {
  const q = query.trim().toLowerCase()
  if (!q) return []
  const scored: { e: FabricCatalogEntry; at: number }[] = []
  for (const e of entries) {
    const at = e.name.toLowerCase().indexOf(q)
    const wat = at < 0 ? e.workspace_name.toLowerCase().indexOf(q) : -2
    if (at < 0 && wat < 0) continue
    scored.push({ e, at: at < 0 ? 1000 + wat : at })
  }
  scored.sort((a, b) => a.at - b.at || a.e.name.length - b.e.name.length)
  return scored.map((s) => s.e)
}

function hl(text: string, query: string) {
  const q = query.trim().toLowerCase()
  const at = q ? text.toLowerCase().indexOf(q) : -1
  if (at < 0) return text
  return (
    <>
      {text.slice(0, at)}
      <mark>{text.slice(at, at + q.length)}</mark>
      {text.slice(at + q.length)}
    </>
  )
}

// A catalog entry → the explore route's target search-params.
function targetSearch(e: FabricCatalogEntry): Record<string, string> {
  const s: Record<string, string> = {
    ws: e.workspace_id,
    wsName: e.workspace_name,
    kind: e.kind,
    id: e.id,
    name: e.name,
  }
  if (e.item_type) s.itemType = e.item_type
  if (e.lakehouse_id) s.lh = e.lakehouse_id
  if (e.lakehouse_name) s.lhName = e.lakehouse_name
  return s
}

function subtitle(e: FabricCatalogEntry): string {
  if (e.kind === 'table') return `${e.lakehouse_name ?? 'lakehouse'} · ${e.workspace_name}`
  if (e.kind === 'workspace') return 'Workspace'
  return e.workspace_name
}

export default function CommandPalette({ open, onOpenChange }: CommandPaletteProps) {
  const navigate = useNavigate()
  const [query, setQuery] = useState('')
  const [entries, setEntries] = useState<FabricCatalogEntry[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const loadingRef = useRef(false)

  // Fresh query each time the palette opens — its own effect so a late catalog
  // load (which changes `entries`) never wipes what the user just typed.
  useEffect(() => {
    if (open) setQuery('')
  }, [open])

  useEffect(() => {
    if (!open || entries || loadingRef.current) return
    loadingRef.current = true
    setError(null)
    loadCatalog()
      .then(setEntries)
      .catch((e: unknown) => setError(e instanceof Error ? e.message : String(e)))
      .finally(() => {
        loadingRef.current = false
      })
  }, [open, entries])

  const results = useMemo(() => rank(entries ?? [], query), [entries, query])

  const pick = (e: FabricCatalogEntry) => {
    void navigate({ to: '/fabric/explore', search: targetSearch(e) as never })
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
        placeholder="Search workspaces, notebooks, lakehouses, tables…"
        value={query}
        onValueChange={setQuery}
        spellCheck={false}
      />
      {query.trim() !== '' && (
        <Command.List className="sp-results">
          {error ? (
            <div className="sp-empty">Couldn’t load the catalog: {error}</div>
          ) : !entries ? (
            <div className="sp-empty">Loading catalog…</div>
          ) : (
            <>
              <Command.Empty className="sp-empty">No matches for &quot;{query}&quot;.</Command.Empty>
              {GROUP_ORDER.map((kind) => {
                const group = results.filter((r) => r.kind === kind).slice(0, MAX_PER_GROUP)
                if (group.length === 0) return null
                return (
                  <Command.Group key={kind} heading={GROUP_LABEL[kind]}>
                    {group.map((r) => {
                      const value = `${r.kind}:${r.workspace_id}:${r.lakehouse_id ?? ''}:${r.id}`
                      return (
                        <Command.Item key={value} value={value} className="sp-row" onSelect={() => pick(r)}>
                          <span className="sp-id">{hl(r.name, query)}</span>
                          <span className="sp-ctx">{subtitle(r)}</span>
                        </Command.Item>
                      )
                    })}
                  </Command.Group>
                )
              })}
            </>
          )}
        </Command.List>
      )}
    </Command.Dialog>
  )
}
