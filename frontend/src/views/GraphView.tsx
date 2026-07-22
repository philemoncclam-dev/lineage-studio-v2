import { useEffect, useRef, useState } from 'react'
import type { GNode, Level } from '../data'
import { useModel } from '../model'
import { useSelection } from '../selection/useSelection'
import { canvasFont, DOMAIN_TOKEN, getCanvasTokens, invalidateCanvasTokens } from '../tokens/canvasTokens'
import DefinitionsImport from './DefinitionsImport'
import './graph.css'

interface Crumb { label: string; key: string }
interface Sim extends GNode { x: number; y: number; vx: number; vy: number }

const matchNode = (n: GNode, q: string) => {
  const s = q.trim().toLowerCase()
  if (!s) return false
  return n.label.toLowerCase().includes(s) || (n.sub || '').toLowerCase().includes(s)
}

export default function GraphView({ onOpenLineage }: { onOpenLineage: (tableId: string, colKey?: string) => void }) {
  const model = useModel()
  const LEVELS = model.levels
  const [path, setPath] = useState<Crumb[]>([{ label: 'Estate', key: 'estate' }])
  const [query, setQuery] = useState('')

  useEffect(() => { setPath([{ label: 'Estate', key: 'estate' }]); setQuery('') }, [model])

  const key = path[path.length - 1].key
  const level = LEVELS[key] ?? { level: 'Estate', type: 'graph' as const }

  const drill = (k: string) => {
    const d = LEVELS[k]
    setPath((p) => [...p, { label: d.crumb || d.level, key: k }])
    setQuery('')
  }
  const goto = (i: number) => { setPath((p) => p.slice(0, i + 1)); setQuery('') }

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setPath((p) => (p.length > 1 ? p.slice(0, -1) : p)) }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  const onQueryKey = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Escape') {
      if (query) { e.stopPropagation(); setQuery(''); (e.target as HTMLInputElement).blur() }
      return
    }
    if (e.key === 'Enter') {
      const matches = (level.nodes || []).filter((n) => matchNode(n, query))
      if (matches.length === 1 && matches[0].drill) drill(matches[0].drill)
    }
  }

  return (
    <div className="gv-root">
      <div className="crumbs">
        {path.map((c, i) => (
          <span key={c.key}>
            <button className={i === path.length - 1 ? 'cur' : ''} onClick={() => goto(i)}>{c.label}</button>
            {i < path.length - 1 && <span className="sep">›</span>}
          </span>
        ))}
      </div>
      <div className="gv-stage">
        {level.type === 'graph' ? (
          <>
            <GraphCanvas levelKey={key} level={level} onDrill={drill} query={query} />
            <div className="gq">
              <svg viewBox="0 0 24 24"><circle cx="11" cy="11" r="7" /><path d="M20 20l-3.5-3.5" /></svg>
              <input
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                onKeyDown={onQueryKey}
                placeholder={`Query ${level.level.toLowerCase()}…`}
                spellCheck={false}
              />
              {query && <button className="gq-clear" onClick={() => setQuery('')} aria-label="Clear query">×</button>}
            </div>
          </>
        ) : (
          <TableDetail levelKey={key} onOpenLineage={onOpenLineage} />
        )}
      </div>
    </div>
  )
}

function GraphCanvas({ levelKey, level, onDrill, query }: { levelKey: string; level: Level; onDrill: (k: string) => void; query: string }) {
  const wrapRef = useRef<HTMLDivElement>(null)
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const [card, setCard] = useState<{ n: Sim; x: number; y: number } | null>(null)
  const queryRef = useRef(query)
  queryRef.current = query

  useEffect(() => {
    const wrap = wrapRef.current!, cv = canvasRef.current!, ctx = cv.getContext('2d')!
    // Snapshot read hoisted outside the draw function (THEME-03) — a plain
    // object, never a per-frame DOM read. Refreshed only when data-theme
    // actually changes, via the observer wired below; every frame just
    // dereferences tokensRef.current.
    const tokensRef = { current: getCanvasTokens() }
    const nodes: Sim[] = (level.nodes || []).map((n) => ({ ...n, x: (Math.random() - 0.5) * 260, y: (Math.random() - 0.5) * 260, vx: 0, vy: 0 }))
    const byId: Record<string, Sim> = Object.fromEntries(nodes.map((n) => [n.id, n]))
    const links = level.links || []
    const adj: Record<string, Set<string>> = {}
    nodes.forEach((n) => (adj[n.id] = new Set()))
    links.forEach(([a, b]) => { adj[a]?.add(b); adj[b]?.add(a) })

    let W = 0, H = 0, DPR = 1, alpha = 1, hover: Sim | null = null, drag: Sim | null = null, raf = 0
    let zoom = 1
    const resize = () => { DPR = devicePixelRatio || 1; W = wrap.clientWidth; H = wrap.clientHeight; cv.width = W * DPR; cv.height = H * DPR; cv.style.width = W + 'px'; cv.style.height = H + 'px'; ctx.setTransform(DPR, 0, 0, DPR, 0, 0) }
    const screen = (n: Sim) => ({ x: W / 2 + n.x * zoom, y: H / 2 + n.y * zoom })

    const draw = () => {
      const t = tokensRef.current
      ctx.clearRect(0, 0, W, H)
      const q = queryRef.current.trim()
      // matched: nodes the live query keeps lit (null when no query)
      const matched = q ? new Set(nodes.filter((n) => matchNode(n, q)).map((n) => n.id)) : null
      const hi = hover ? new Set([hover.id, ...adj[hover.id]]) : null
      links.forEach(([ai, bi]) => {
        const a = screen(byId[ai]), b = screen(byId[bi])
        const on = hi ? hi.has(ai) && hi.has(bi) : matched ? matched.has(ai) || matched.has(bi) : false
        const dimmed = (hi || matched) && !on
        const mx = (a.x + b.x) / 2, my = (a.y + b.y) / 2
        ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.quadraticCurveTo(mx, my, b.x, b.y)
        ctx.strokeStyle = on ? t.accent : t.borderStrong; ctx.globalAlpha = dimmed ? 0.07 : on ? 0.95 : 0.5; ctx.lineWidth = on ? 2 : 1; ctx.stroke()
      })
      ctx.globalAlpha = 1
      nodes.forEach((n) => {
        const p = screen(n), R = n.r * zoom
        const dim = hi ? !hi.has(n.id) : matched ? !matched.has(n.id) : false
        const nodeColor = t[DOMAIN_TOKEN[n.c]]
        ctx.globalAlpha = dim ? 0.22 : 1
        if (hover === n || (matched && matched.has(n.id))) { ctx.beginPath(); ctx.arc(p.x, p.y, R + 7, 0, 7); ctx.fillStyle = nodeColor; ctx.globalAlpha = 0.16; ctx.fill(); ctx.globalAlpha = dim ? 0.22 : 1 }
        ctx.beginPath(); ctx.arc(p.x, p.y, R, 0, 7); ctx.fillStyle = nodeColor; ctx.fill(); ctx.lineWidth = 2.2; ctx.strokeStyle = t.surface1; ctx.stroke()
        if (!dim) {
          ctx.fillStyle = t.textPrimary; ctx.font = canvasFont(600, 'base', 'sans', zoom); ctx.textAlign = 'center'; ctx.textBaseline = 'top'
          ctx.fillText(n.label, p.x, p.y + R + 5)
          if (n.drill && n.sub) { ctx.globalAlpha = 0.55; ctx.font = canvasFont(400, 'micro', 'mono', zoom); ctx.fillStyle = t.textTertiary; ctx.fillText(n.sub, p.x, p.y + R + 19); ctx.globalAlpha = 1 }
        }
        ctx.globalAlpha = 1
      })
    }
    const step = () => {
      if (alpha > 0.02) {
        for (let i = 0; i < nodes.length; i++) for (let j = i + 1; j < nodes.length; j++) {
          const a = nodes[i], b = nodes[j]; let dx = a.x - b.x, dy = a.y - b.y; const d2 = dx * dx + dy * dy || 0.01; const rep = 3200 / d2, d = Math.sqrt(d2); dx /= d; dy /= d
          a.vx += dx * rep; a.vy += dy * rep; b.vx -= dx * rep; b.vy -= dy * rep
        }
        links.forEach(([ai, bi]) => { const a = byId[ai], b = byId[bi]; if (!a || !b) return; let dx = b.x - a.x, dy = b.y - a.y; const d = Math.sqrt(dx * dx + dy * dy) || 0.01, k = 0.02 * (d - 130); dx /= d; dy /= d; a.vx += dx * k; a.vy += dy * k; b.vx -= dx * k; b.vy -= dy * k })
        nodes.forEach((n) => { n.vx += -n.x * 0.003; n.vy += -n.y * 0.003; if (n !== drag) { n.x += n.vx * alpha; n.y += n.vy * alpha } n.vx *= 0.85; n.vy *= 0.85 })
        alpha *= 0.99
      }
      draw()
      raf = requestAnimationFrame(step)
    }
    const pick = (mx: number, my: number) => {
      for (let i = nodes.length - 1; i >= 0; i--) { const p = screen(nodes[i]), R = nodes[i].r * zoom + 5; if ((mx - p.x) ** 2 + (my - p.y) ** 2 <= R * R) return nodes[i] }
      return null
    }
    const onMove = (e: MouseEvent) => {
      const mx = e.offsetX, my = e.offsetY
      if (drag) { drag.x = (mx - W / 2) / zoom; drag.y = (my - H / 2) / zoom; drag.vx = drag.vy = 0; alpha = Math.max(alpha, 0.3); return }
      const n = pick(mx, my); hover = n; cv.style.cursor = n ? (n.drill ? 'pointer' : 'grab') : 'default'
      if (n) { const p = screen(n); setCard({ n, x: Math.min(p.x + 18, W - 195), y: p.y + 12 }) } else setCard(null)
    }
    const onDown = (e: MouseEvent) => { const n = pick(e.offsetX, e.offsetY); if (n && !n.drill) { drag = n; cv.style.cursor = 'grabbing' } }
    const onUp = () => { drag = null }
    const onClick = (e: MouseEvent) => { const n = pick(e.offsetX, e.offsetY); if (n?.drill) onDrill(n.drill) }
    const onWheel = (e: WheelEvent) => { e.preventDefault(); zoom = Math.min(2.4, Math.max(0.5, zoom * (e.deltaY < 0 ? 1.1 : 0.9))) }
    // The draw loop above never reads styles itself — it only dereferences
    // tokensRef.current. This observer is the sole place that re-reads the
    // snapshot, and only once per real data-theme change, never per frame:
    // invalidateCanvasTokens() forces a fresh read regardless of whether the
    // bootstrap-level observer in main.tsx has already cleared the cache.
    const onThemeChange = () => {
      invalidateCanvasTokens()
      tokensRef.current = getCanvasTokens()
    }
    const themeObserver = new MutationObserver(onThemeChange)
    themeObserver.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] })

    resize()
    cv.addEventListener('mousemove', onMove); cv.addEventListener('mousedown', onDown); window.addEventListener('mouseup', onUp)
    cv.addEventListener('click', onClick); cv.addEventListener('wheel', onWheel, { passive: false }); window.addEventListener('resize', resize)
    cv.style.opacity = '0'; requestAnimationFrame(() => (cv.style.opacity = '1'))
    step()
    return () => {
      cancelAnimationFrame(raf)
      cv.removeEventListener('mousemove', onMove); cv.removeEventListener('mousedown', onDown); window.removeEventListener('mouseup', onUp)
      cv.removeEventListener('click', onClick); cv.removeEventListener('wheel', onWheel); window.removeEventListener('resize', resize)
      themeObserver.disconnect()
    }
  }, [levelKey, level, onDrill])

  return (
    <div className="gv-canvas-wrap" ref={wrapRef}>
      <canvas ref={canvasRef} className="gv-canvas" />
      {card && (
        <div className="card on" style={{ left: card.x, top: card.y }}>
          <div className="ct" style={{ color: `var(--${card.n.c})` }}>{card.n.sub?.split(' ')[0] === 'notebook' ? 'notebook' : ''}</div>
          <h3>{card.n.label}</h3>
          <p>{card.n.sub}</p>
          {card.n.drill && <div className="go">Click to drill in →</div>}
        </div>
      )}
    </div>
  )
}

function TableDetail({ levelKey, onOpenLineage }: { levelKey: string; onOpenLineage: (tableId: string, colKey?: string) => void }) {
  const model = useModel()
  const { select, clear } = useSelection()
  const tableId = model.levelTable[levelKey]
  const table = tableId ? model.tables.find((t) => t.id === tableId) : undefined
  const level = model.levels[levelKey]
  const ctx = tableId ? model.context[tableId] : undefined
  const [importing, setImporting] = useState(false)

  // Definitions are pushed onto Purview entities by GUID. In the live model a
  // table's id *is* its Purview GUID (model.adapt keeps it); in the sample
  // model it is a name, so there is nothing to write to and no button.
  const purviewGuid =
    model.source === 'live' && tableId && /^[0-9a-f-]{36}$/i.test(tableId) ? tableId : null

  const Mini = ({ rows }: { rows: [string, string, string][] }) => (
    <>
      {rows.map(([name, layer, via]) => (
        <div className="tcard mini" key={name}>
          <i style={{ background: `var(--${layer})` }} />
          <div className="tn">{name}</div><div className="ts">{layer}</div>
          <div className="via">via {via}</div>
        </div>
      ))}
    </>
  )

  if (!table || !tableId) {
    return (
      <div className="td-wrap on">
        <div className="td-panel">
          <div className="td-head">
            <div className="td-name">{level.crumb || level.level}</div>
            <div className="td-meta">No column metadata available for this table yet.</div>
          </div>
          <div className="td-empty">Column-level detail appears here once this table has been ingested.</div>
        </div>
      </div>
    )
  }

  return (
    <div
      className="td-wrap on"
      onClick={(e) => {
        // Empty-canvas click clears selection (D-11) — only when the click
        // lands on the wrap's own background, not a node/column/button.
        if (e.target === e.currentTarget) clear()
      }}
    >
      {ctx && (
        <div className="td-side">
          <div className="td-sidehead">Upstream</div>
          <Mini rows={ctx.up} />
        </div>
      )}
      <div className="td-panel">
        <div className="td-head" onClick={() => select(tableId)} title={`Select ${table.name}`}>
          <i className="td-dot" style={{ background: `var(--${table.c})` }} />
          <div>
            <div className="td-name">{table.name}</div>
            <div className="td-meta">{table.layer} · {table.columns.length} columns</div>
          </div>
        </div>
        <div className="td-cols">
          {table.columns.map((col) => (
            <button className="td-col" key={col.key} onClick={() => onOpenLineage(tableId, col.key)} title={`Trace ${col.name} lineage`}>
              <span className="name">{col.name}</span>
              {col.pk && <span className="pk">PK</span>}
              <span className="type">{col.type}</span>
            </button>
          ))}
        </div>
        <div className="td-foot">
          <button className="openbtn" onClick={() => onOpenLineage(tableId)}>View column-level lineage →</button>
          {purviewGuid && (
            <button className="linkbtn" onClick={() => setImporting(true)}>Import definitions…</button>
          )}
        </div>
        {importing && purviewGuid && (
          <DefinitionsImport
            tableGuid={purviewGuid}
            tableName={table.name}
            onClose={() => setImporting(false)}
          />
        )}
      </div>
      {ctx && (
        <div className="td-side">
          <div className="td-sidehead">Downstream</div>
          <Mini rows={ctx.down} />
        </div>
      )}
    </div>
  )
}
