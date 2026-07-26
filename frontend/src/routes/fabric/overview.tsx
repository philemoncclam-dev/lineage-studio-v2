// /fabric/overview — the live tenant dashboard. Answers "how much is there?"
// at a glance: data assets (tables + stores + BI items), notebooks, pipelines,
// filterable down to a selection of Fabric workspaces.
//
// Everything on this page comes from a single read-only endpoint, /fabric/catalog
// (see backend/app/fabric/router.py) — one flat index of every discoverable
// asset. Counting happens client-side in ./-assetTypes so changing what counts
// as a "data asset" never needs a backend round-trip, and so the workspace
// filter is instant (re-filtering an array, not re-crawling the tenant).
//
// "Live": the catalog is re-fetched on an interval and on demand via Sync. The
// fetch is shared with the command palette through shell/catalogCache, so the
// tenant is crawled once no matter how many consumers are mounted.
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { createFileRoute, useNavigate } from '@tanstack/react-router'
import { BarsSpinner } from '../../shell/BarsSpinner'
import { fetchFabricStatus, type FabricCatalogEntry } from '../../api'
import { loadCatalog } from '../../shell/catalogCache'
import {
  countByWorkspace,
  countEntries,
  EMPTY_COUNTS,
  type Counts,
  type WorkspaceRow,
} from './-assetTypes'
import { downloadOverviewXlsx, scopeLabel } from './-exportOverview'
import '../../views/fabricOverview.css'

export const Route = createFileRoute('/fabric/overview')({
  component: OverviewRoute,
})

/** How often the dashboard re-crawls while it's on screen. */
const REFRESH_MS = 60_000

// --- small presentational helpers ----------------------------------------

const nf = new Intl.NumberFormat()

function relativeTime(at: number | null, now: number): string {
  if (at == null) return 'never'
  const secs = Math.max(0, Math.round((now - at) / 1000))
  if (secs < 10) return 'just now'
  if (secs < 60) return `${secs}s ago`
  const mins = Math.round(secs / 60)
  if (mins < 60) return `${mins} min ago`
  return `${Math.round(mins / 60)}h ago`
}

type TileTone = 'accent' | 'notebook' | 'pipeline' | 'neutral'

function Tile({
  label,
  value,
  caption,
  tone,
}: {
  label: string
  value: number
  caption: string
  tone: TileTone
}) {
  return (
    <div className="fo-tile" data-tone={tone}>
      <p className="fo-tile-label">{label}</p>
      <p className="fo-tile-value">{nf.format(value)}</p>
      <p className="fo-tile-caption">{caption}</p>
    </div>
  )
}

/** Composition donut. A conic-gradient ring — no chart library for three slices. */
function Donut({ counts }: { counts: Counts }) {
  const slices = [
    { key: 'table', label: 'Lakehouse tables', value: counts.table, color: 'var(--color-accent)' },
    { key: 'store', label: 'Lakehouses & warehouses', value: counts.store, color: 'var(--color-edge-reads)' },
    { key: 'bi', label: 'Reports & semantic models', value: counts.bi, color: 'var(--color-domain-gold)' },
  ]
  const total = counts.data
  let at = 0
  const stops: string[] = []
  for (const s of slices) {
    const share = total > 0 ? (s.value / total) * 100 : 0
    stops.push(`${s.color} ${at}% ${at + share}%`)
    at += share
  }
  if (total === 0) stops.push('var(--color-surface-3) 0% 100%')

  return (
    <div className="fo-donut-wrap">
      <div className="fo-donut" style={{ background: `conic-gradient(${stops.join(',')})` }}>
        <div className="fo-donut-hole">
          <span className="fo-donut-value">{nf.format(total)}</span>
          <span className="fo-donut-label">data assets</span>
        </div>
      </div>
      <ul className="fo-legend">
        {slices.map((s) => (
          <li key={s.key}>
            <span className="fo-swatch" style={{ background: s.color }} />
            <span className="fo-legend-label">{s.label}</span>
            <span className="fo-legend-value">{nf.format(s.value)}</span>
          </li>
        ))}
      </ul>
    </div>
  )
}

/** Per-workspace share of the total, as a stacked mini bar. */
function ShareBar({ row }: { row: WorkspaceRow }) {
  const parts = [
    { v: row.data, c: 'var(--color-accent)' },
    { v: row.notebook, c: 'var(--color-domain-notebook)' },
    { v: row.pipeline, c: 'var(--color-edge-writes)' },
    { v: row.other, c: 'var(--color-surface-3)' },
  ].filter((p) => p.v > 0)
  const total = row.total || 1
  return (
    <div className="fo-sharebar" aria-hidden>
      {parts.map((p, i) => (
        <span key={i} style={{ background: p.c, width: `${(p.v / total) * 100}%` }} />
      ))}
    </div>
  )
}

// --- the page -------------------------------------------------------------

function OverviewRoute() {
  const navigate = useNavigate()

  const [configured, setConfigured] = useState<boolean | null>(null)
  const [entries, setEntries] = useState<FabricCatalogEntry[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [syncing, setSyncing] = useState(false)
  const [exporting, setExporting] = useState(false)
  const [syncedAt, setSyncedAt] = useState<number | null>(null)
  const [now, setNow] = useState(() => Date.now())
  const [live, setLive] = useState(true)
  // Empty set means "all workspaces" — the unfiltered default.
  const [selected, setSelected] = useState<Set<string>>(new Set())

  const alive = useRef(true)
  useEffect(() => {
    alive.current = true
    return () => {
      alive.current = false
    }
  }, [])

  const sync = useCallback((force: boolean) => {
    setSyncing(true)
    loadCatalog(force)
      .then((data) => {
        if (!alive.current) return
        setEntries(data)
        setError(null)
        setSyncedAt(Date.now())
      })
      .catch((e: unknown) => {
        if (!alive.current) return
        setError(e instanceof Error ? e.message : String(e))
      })
      .finally(() => {
        if (alive.current) setSyncing(false)
      })
  }, [])

  // Gate on /fabric/status so an unconfigured tenant shows a connect prompt
  // rather than a failed crawl (the explorer does the same).
  useEffect(() => {
    fetchFabricStatus()
      .then((s) => {
        if (!alive.current) return
        setConfigured(s.configured)
        if (s.configured) sync(false)
      })
      .catch((e: unknown) => {
        if (!alive.current) return
        setConfigured(false)
        setError(e instanceof Error ? e.message : String(e))
      })
  }, [sync])

  // Live refresh + a ticking clock for the "last synced" line.
  useEffect(() => {
    if (!live || !configured) return
    const t = window.setInterval(() => sync(true), REFRESH_MS)
    return () => window.clearInterval(t)
  }, [live, configured, sync])
  useEffect(() => {
    const t = window.setInterval(() => setNow(Date.now()), 15_000)
    return () => window.clearInterval(t)
  }, [])

  const allRows = useMemo(() => countByWorkspace(entries ?? []), [entries])

  // The filter applies to every number on the page, so it is applied once here
  // and everything downstream reads the filtered array.
  const filtered = useMemo(() => {
    if (!entries) return []
    if (selected.size === 0) return entries
    return entries.filter((e) => selected.has(e.workspace_id))
  }, [entries, selected])

  const counts = useMemo(() => (entries ? countEntries(filtered) : EMPTY_COUNTS), [entries, filtered])
  const rows = useMemo(() => countByWorkspace(filtered), [filtered])

  // Names (not ids) of the filtered-to workspaces — what the export and the
  // button label both need to say.
  const scope = useMemo(
    () => allRows.filter((w) => selected.has(w.id)).map((w) => w.name),
    [allRows, selected],
  )

  const exportXlsx = () => {
    setExporting(true)
    downloadOverviewXlsx({ counts, rows, scope, syncedAt })
      .catch((e: unknown) => setError(e instanceof Error ? e.message : String(e)))
      .finally(() => {
        if (alive.current) setExporting(false)
      })
  }

  const toggleWorkspace = (id: string) =>
    setSelected((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })

  const openWorkspace = (row: WorkspaceRow) =>
    navigate({
      to: '/fabric/explore',
      search: { ws: row.id, wsName: row.name, kind: 'workspace', id: row.id, name: row.name },
    })

  if (configured === null) {
    return (
      <div className="fo-page fo-page--center">
        <BarsSpinner />
      </div>
    )
  }

  if (!configured) {
    return (
      <div className="fo-page fo-page--center">
        <div className="fo-empty">
          <h2>Not connected to Fabric</h2>
          <p>
            Set the Fabric credentials on the backend to read your tenant. Until then there is
            nothing to count — this page never shows placeholder numbers.
          </p>
        </div>
      </div>
    )
  }

  const loading = entries === null && !error

  return (
    <div className="fo-page">
      <div className="fo-inner">
        <header className="fo-head">
          <div>
            <h1 className="fo-title">Workspace overview</h1>
            <p className="fo-sub">
              <span className={`fo-dot${live ? ' fo-dot--live' : ''}`} />
              {allRows.length === 0
                ? 'No workspaces visible'
                : `${nf.format(allRows.length)} workspace${allRows.length === 1 ? '' : 's'} visible`}
              {' · '}
              {syncing ? 'syncing…' : `last sync ${relativeTime(syncedAt, now)}`}
            </p>
          </div>
          <div className="fo-actions">
            <label className="fo-live">
              <input type="checkbox" checked={live} onChange={(e) => setLive(e.target.checked)} />
              Live
            </label>
            {/* The label states the scope so nobody exports a filtered sheet
                thinking it covers the whole tenant. */}
            <button
              className="fo-sync"
              onClick={exportXlsx}
              disabled={exporting || entries === null}
              title={`Export ${scopeLabel(scope).toLowerCase()} to .xlsx`}
            >
              <svg viewBox="0 0 24 24">
                <path d="M12 3v11" />
                <path d="M8 10.5l4 4 4-4" />
                <path d="M4 17v2.5h16V17" />
              </svg>
              <span className="fo-btn-label">
                {exporting
                  ? 'Exporting…'
                  : scope.length === 0
                    ? 'Export all'
                    : scope.length === 1
                      ? `Export ${scope[0]}`
                      : `Export ${scope.length} workspaces`}
              </span>
            </button>
            <button className="fo-sync" onClick={() => sync(true)} disabled={syncing}>
              <svg viewBox="0 0 24 24" className={syncing ? 'spin' : undefined}>
                <path d="M20 12a8 8 0 1 1-2.3-5.6" />
                <path d="M20 4v4h-4" />
              </svg>
              Sync
            </button>
          </div>
        </header>

        {error && (
          <div className="fo-error" role="alert">
            Couldn’t read the catalog: {error}
          </div>
        )}

        {/* Workspace filter. Chips rather than a select: the tenant is small
            enough to show whole, and multi-select is the common case. */}
        {allRows.length > 0 && (
          <div className="fo-filter" role="group" aria-label="Filter by workspace">
            <button
              className={`fo-chip${selected.size === 0 ? ' fo-chip--on' : ''}`}
              onClick={() => setSelected(new Set())}
            >
              All workspaces
            </button>
            {allRows.map((w) => (
              <button
                key={w.id}
                className={`fo-chip${selected.has(w.id) ? ' fo-chip--on' : ''}`}
                onClick={() => toggleWorkspace(w.id)}
                aria-pressed={selected.has(w.id)}
              >
                {w.name}
                <span className="fo-chip-count">{nf.format(w.total)}</span>
              </button>
            ))}
          </div>
        )}

        {loading ? (
          <div className="fo-page--center">
            <BarsSpinner />
          </div>
        ) : (
          <>
            <div className="fo-tiles">
              <Tile
                label="Data assets"
                value={counts.data}
                caption={`${nf.format(counts.table)} tables · ${nf.format(counts.bi)} reports & models`}
                tone="accent"
              />
              <Tile
                label="Notebooks"
                value={counts.notebook}
                caption="Spark notebooks, runnable in the sandbox"
                tone="notebook"
              />
              <Tile
                label="Pipelines"
                value={counts.pipeline}
                caption="Data pipelines and dataflows"
                tone="pipeline"
              />
              <Tile
                label="Other items"
                value={counts.other}
                caption="Environments, ML models, everything else"
                tone="neutral"
              />
            </div>

            <div className="fo-grid">
              <section className="fo-card fo-card--donut">
                <h2 className="fo-card-title">Data asset composition</h2>
                <Donut counts={counts} />
              </section>

              <section className="fo-card fo-card--table">
                <div className="fo-card-head">
                  <h2 className="fo-card-title">By workspace</h2>
                  <span className="fo-card-note">
                    {selected.size === 0 ? 'All workspaces' : `${selected.size} selected`}
                  </span>
                </div>
                <div className="fo-table-scroll">
                  <table className="fo-table">
                    <thead>
                      <tr>
                        <th>Workspace</th>
                        <th className="num">Data assets</th>
                        <th className="num">Notebooks</th>
                        <th className="num">Pipelines</th>
                        <th className="num">Total</th>
                        <th>Mix</th>
                      </tr>
                    </thead>
                    <tbody>
                      {rows.length === 0 && (
                        <tr>
                          <td colSpan={6} className="fo-table-empty">
                            Nothing to show for this selection.
                          </td>
                        </tr>
                      )}
                      {rows.map((row) => (
                        <tr key={row.id} onClick={() => openWorkspace(row)} tabIndex={0}
                            onKeyDown={(e) => {
                              if (e.key === 'Enter' || e.key === ' ') {
                                e.preventDefault()
                                openWorkspace(row)
                              }
                            }}>
                          <td className="fo-ws">{row.name}</td>
                          <td className="num">{nf.format(row.data)}</td>
                          <td className="num">{nf.format(row.notebook)}</td>
                          <td className="num">{nf.format(row.pipeline)}</td>
                          <td className="num fo-strong">{nf.format(row.total)}</td>
                          <td>
                            <ShareBar row={row} />
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </section>
            </div>
          </>
        )}
      </div>
    </div>
  )
}
