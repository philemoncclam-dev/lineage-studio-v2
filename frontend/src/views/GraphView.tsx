import { useEffect, useRef, useState } from 'react'
import { LEVELS, type GNode } from '../data'

interface Crumb { label: string; key: string }
interface Sim extends GNode { x: number; y: number; vx: number; vy: number }

const cssVar = (k: string) => getComputedStyle(document.documentElement).getPropertyValue('--' + k).trim()

export default function GraphView({ onOpenLineage }: { onOpenLineage: (tableId: string) => void }) {
  const [path, setPath] = useState<Crumb[]>([{ label: 'Estate', key: 'estate' }])
  const key = path[path.length - 1].key
  const level = LEVELS[key]

  const drill = (k: string) => {
    const d = LEVELS[k]
    setPath((p) => [...p, { label: d.crumb || d.level, key: k }])
  }
  const goto = (i: number) => setPath((p) => p.slice(0, i + 1))

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setPath((p) => (p.length > 1 ? p.slice(0, -1) : p)) }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  return (
    <div className="gv-root">
      <div className="crumbs">
        {path.map((c, i) => (
          <span key={c.key}>
            <button className={i === path.length - 1 ? 'cur' : ''} onClick={() => goto(i)}>{c.label}</button>
            {i < path.length - 1 && <span className="sep">›</span>}
          </span>
        ))}
        <span className="lvl">{level.level}</span>
      </div>
      <div className="gv-stage">
        {level.type === 'graph'
          ? <GraphCanvas levelKey={key} onDrill={drill} />
          : <LineageHandoff onOpen={() => onOpenLineage('clean')} />}
      </div>
    </div>
  )
}

function GraphCanvas({ levelKey, onDrill }: { levelKey: string; onDrill: (k: string) => void }) {
  const wrapRef = useRef<HTMLDivElement>(null)
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const [card, setCard] = useState<{ n: Sim; x: number; y: number } | null>(null)

  useEffect(() => {
    const wrap = wrapRef.current!, cv = canvasRef.current!, ctx = cv.getContext('2d')!
    const level = LEVELS[levelKey]
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
      ctx.clearRect(0, 0, W, H)
      const hi = hover ? new Set([hover.id, ...adj[hover.id]]) : null
      links.forEach(([ai, bi]) => {
        const a = screen(byId[ai]), b = screen(byId[bi]); const on = hi && hi.has(ai) && hi.has(bi)
        const mx = (a.x + b.x) / 2, my = (a.y + b.y) / 2
        ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.quadraticCurveTo(mx, my, b.x, b.y)
        ctx.strokeStyle = on ? cssVar('accent') : cssVar('border-strong'); ctx.globalAlpha = hi ? (on ? 0.95 : 0.07) : 0.5; ctx.lineWidth = on ? 2 : 1; ctx.stroke()
      })
      ctx.globalAlpha = 1
      nodes.forEach((n) => {
        const p = screen(n), R = n.r * zoom, dim = hi && !hi.has(n.id)
        ctx.globalAlpha = dim ? 0.22 : 1
        if (hover === n) { ctx.beginPath(); ctx.arc(p.x, p.y, R + 7, 0, 7); ctx.fillStyle = cssVar(n.c); ctx.globalAlpha = 0.16; ctx.fill(); ctx.globalAlpha = 1 }
        ctx.beginPath(); ctx.arc(p.x, p.y, R, 0, 7); ctx.fillStyle = cssVar(n.c); ctx.fill(); ctx.lineWidth = 2.2; ctx.strokeStyle = cssVar('surface'); ctx.stroke()
        if (!dim) {
          ctx.fillStyle = cssVar('text'); ctx.font = `520 ${Math.max(11, 12 * zoom)}px ${cssVar('sans')}`; ctx.textAlign = 'center'; ctx.textBaseline = 'top'
          ctx.fillText(n.label, p.x, p.y + R + 5)
          if (n.drill && n.sub) { ctx.globalAlpha = 0.55; ctx.font = `500 ${Math.max(9, 9.5 * zoom)}px ${cssVar('mono')}`; ctx.fillStyle = cssVar('text-3'); ctx.fillText(n.sub, p.x, p.y + R + 19); ctx.globalAlpha = 1 }
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

    resize()
    cv.addEventListener('mousemove', onMove); cv.addEventListener('mousedown', onDown); window.addEventListener('mouseup', onUp)
    cv.addEventListener('click', onClick); cv.addEventListener('wheel', onWheel, { passive: false }); window.addEventListener('resize', resize)
    cv.style.opacity = '0'; requestAnimationFrame(() => (cv.style.opacity = '1'))
    step()
    return () => {
      cancelAnimationFrame(raf)
      cv.removeEventListener('mousemove', onMove); cv.removeEventListener('mousedown', onDown); window.removeEventListener('mouseup', onUp)
      cv.removeEventListener('click', onClick); cv.removeEventListener('wheel', onWheel); window.removeEventListener('resize', resize)
    }
  }, [levelKey, onDrill])

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

function LineageHandoff({ onOpen }: { onOpen: () => void }) {
  const T = (name: string, layer: string, via: string | null, color: string, focus = false) => (
    <div className={`tcard ${focus ? 'focus' : ''}`}>
      <i style={{ background: `var(--${color})` }} />
      <div className="tn">{name}</div><div className="ts">{layer}</div>
      {via && <div className="via">via {via}</div>}
    </div>
  )
  const Chev = () => <div className="lchev"><svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round"><path d="M9 6l6 6-6 6" /></svg></div>
  return (
    <div className="lineage on">
      <div className="lcol"><div className="lh">Upstream</div>
        {T('raw_orders', 'bronze', 'clean_orders', 'bronze')}
        {T('raw_customers', 'bronze', 'clean_orders', 'bronze')}</div>
      <Chev />
      <div className="lcol"><div className="lh">Focus</div>
        {T('orders_clean', 'silver · 4 columns', null, 'silver', true)}
        <button className="openbtn" onClick={onOpen}>View column-level lineage →</button></div>
      <Chev />
      <div className="lcol"><div className="lh">Downstream</div>
        {T('orders_report', 'gold', 'daily_revenue', 'gold')}
        {T('revenue_daily', 'gold', 'daily_revenue', 'gold')}
        {T('customer_360', 'gold', 'build_customer_360', 'gold')}</div>
    </div>
  )
}
