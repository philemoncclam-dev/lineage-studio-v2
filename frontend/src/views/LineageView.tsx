import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { COL_EDGES, NOTEBOOKS, OPS, TABLES, XFORM } from '../data'

const TableIcon = () => (
  <svg viewBox="0 0 24 24"><rect x="3.5" y="4.5" width="17" height="15" rx="2.5" /><path d="M3.5 10h17M9.5 10v9.5" /></svg>
)
const Caret = () => <svg viewBox="0 0 24 24"><path d="M9 6l6 6-6 6" /></svg>

interface EdgePath { d: string; from?: string; to?: string; kind?: string }

// walk upstream + downstream from a column
function trace(id: string): Set<string> {
  const set = new Set<string>()
  const go = (c: string, dir: number) => {
    set.add(c)
    for (const [s, t] of COL_EDGES) {
      if (dir >= 0 && s === c && !set.has(t)) go(t, 1)
      if (dir <= 0 && t === c && !set.has(s)) go(s, -1)
    }
  }
  go(id, 0)
  return set
}

export default function LineageView({ focusTable }: { focusTable?: string }) {
  const canvasRef = useRef<HTMLDivElement>(null)
  const [open, setOpen] = useState<Set<string>>(() => new Set(TABLES.map((t) => t.id)))
  const [selected, setSelected] = useState<string | null>('clean.customer_name')
  const [hover, setHover] = useState<string | null>(null)
  const [paths, setPaths] = useState<EdgePath[]>([])
  const [tick, setTick] = useState(0)

  const active = hover ?? selected
  const traced = useMemo(() => (active ? trace(active) : null), [active])

  // measure DOM and compute edge geometry
  useLayoutEffect(() => {
    const root = canvasRef.current
    if (!root) return
    const box = root.getBoundingClientRect()
    const anchor = (el: Element | null, side: 'l' | 'r') => {
      if (!el) return null
      const r = el.getBoundingClientRect()
      return { x: (side === 'r' ? r.right : r.left) - box.left, y: r.top - box.top + r.height / 2 }
    }
    const curve = (a: { x: number; y: number }, b: { x: number; y: number }) => {
      const dx = Math.max(40, Math.abs(b.x - a.x) * 0.5)
      return `M${a.x},${a.y} C${a.x + dx},${a.y} ${b.x - dx},${b.y} ${b.x},${b.y}`
    }
    const colEl = (k: string) => root.querySelector(`[data-col="${k}"]`)
    const nodeOf = (k: string) => colEl(k)?.closest('.ls-node') ?? null
    const next: EdgePath[] = []
    for (const [s, t] of COL_EDGES) {
      const sOpen = nodeOf(s)?.classList.contains('open')
      const tOpen = nodeOf(t)?.classList.contains('open')
      const a = anchor(sOpen ? colEl(s) : nodeOf(s), 'r')
      const b = anchor(tOpen ? colEl(t) : nodeOf(t), 'l')
      if (a && b) next.push({ d: curve(a, b), from: s, to: t })
    }
    for (const [s, t, kind] of OPS) {
      const a = anchor(root.querySelector(`#ls-${s}`), 'r')
      const b = anchor(root.querySelector(`#ls-${t}`), 'l')
      if (a && b) next.push({ d: curve(a, b), kind })
    }
    setPaths(next)
  }, [open, tick])

  useEffect(() => {
    const onResize = () => setTick((t) => t + 1)
    window.addEventListener('resize', onResize)
    return () => window.removeEventListener('resize', onResize)
  }, [])

  const toggle = useCallback((id: string) => {
    setOpen((prev) => {
      const n = new Set(prev)
      n.has(id) ? n.delete(id) : n.add(id)
      return n
    })
  }, [])

  return (
    <div className="ls-body">
      <div className="ls-stage">
        <div className="ls-canvas" ref={canvasRef}>
          <svg className="ls-edges">
            {paths.map((p, i) => {
              const isCol = !!p.from
              const on = isCol && traced?.has(p.from!) && traced?.has(p.to!)
              const cls = ['edge', p.kind ?? '', on ? 'hot' : '', traced && !on ? 'dim' : ''].join(' ')
              return <path key={i} d={p.d} className={cls} />
            })}
          </svg>

          {NOTEBOOKS.map((nb) => (
            <div className="ls-node" id={`ls-${nb.id}`} key={nb.id} style={{ left: nb.x, top: nb.y }}>
              <div className="head">
                <span className="ico notebook"><svg viewBox="0 0 24 24"><rect x="4.5" y="3.5" width="15" height="17" rx="2.5" /><path d="M9.2 8.5l-2 2 2 2M14.8 8.5l2 2-2 2" /></svg></span>
                <div><div className="title">{nb.name}</div><div className="sub">notebook · PySpark</div></div>
                <span className="badge">3 cells</span>
              </div>
            </div>
          ))}

          {TABLES.map((t) => {
            const isOpen = open.has(t.id)
            return (
              <div className={`ls-node ${isOpen ? 'open' : ''} ${t.id === focusTable ? 'focus' : ''}`}
                id={`ls-${t.id}`} key={t.id} style={{ left: t.x, top: t.y }}>
                <div className="head" onClick={() => toggle(t.id)}>
                  <span className="ico table"><TableIcon /></span>
                  <div><div className="title">{t.name}</div><div className="sub">{t.layer}</div></div>
                  <span className="caret"><Caret /></span>
                </div>
                <div className="cols">
                  {t.columns.map((c) => (
                    <div className={`col ${traced?.has(c.key) && c.key !== active ? 'hot' : ''} ${c.key === selected ? 'sel' : ''}`}
                      key={c.key} data-col={c.key}
                      onMouseEnter={() => setHover(c.key)} onMouseLeave={() => setHover(null)}
                      onClick={(e) => { e.stopPropagation(); setSelected(c.key) }}>
                      <span className="name">{c.name}</span>
                      {c.pk && <span className="pk">PK</span>}
                      <span className="type">{c.type}</span>
                    </div>
                  ))}
                </div>
              </div>
            )
          })}
        </div>
      </div>

      <Inspector colKey={selected} onSelect={setSelected} />
    </div>
  )
}

function Inspector({ colKey, onSelect }: { colKey: string | null; onSelect: (k: string) => void }) {
  if (!colKey) return <aside className="ls-inspector" />
  const table = TABLES.find((t) => t.columns.some((c) => c.key === colKey))!
  const col = table.columns.find((c) => c.key === colKey)!
  const ups = COL_EDGES.filter(([, t]) => t === colKey).map(([s]) => s)
  const downs = COL_EDGES.filter(([s]) => s === colKey).map(([, t]) => t)
  const xf = XFORM[colKey]
  const info = (k: string) => {
    const tb = TABLES.find((t) => t.columns.some((c) => c.key === k))!
    return { name: tb.columns.find((c) => c.key === k)!.name, tbl: `${tb.layer}.${tb.name}` }
  }
  const Row = ({ k }: { k: string }) => {
    const i = info(k)
    return (
      <div className="flow-item" onClick={() => onSelect(k)}>
        <svg className="dir" viewBox="0 0 24 24"><path d="M9 6l6 6-6 6" /></svg>
        <div><div className="fcol">{i.name}</div><div className="ftbl">{i.tbl}</div></div>
      </div>
    )
  }
  return (
    <aside className="ls-inspector">
      <div className="insp-head">
        <div className="insp-crumb">{table.layer}.{table.name}</div>
        <div className="insp-title">
          <span className="ico table"><TableIcon /></span>
          <div><h2>{col.name}</h2><div className="ttype">{col.type}{col.pk ? ' · primary key' : ''}</div></div>
        </div>
        <span className="pill type-string">column</span>{col.pk && <span className="pill verified">verified</span>}
      </div>
      {xf && (
        <div className="sec"><div className="sec-t">Transformation</div>
          <div className="xform"><code>{xf[0]}</code><p>{xf[1]}</p></div></div>
      )}
      <div className="sec"><div className="sec-t">Inputs <span className="n">{ups.length}</span></div>
        <div className="flow">{ups.length ? ups.map((k) => <Row key={k} k={k} />) : <div className="empty">Source column — no upstream.</div>}</div></div>
      <div className="sec"><div className="sec-t">Outputs <span className="n">{downs.length}</span></div>
        <div className="flow">{downs.length ? downs.map((k) => <Row key={k} k={k} />) : <div className="empty">Terminal column — no downstream.</div>}</div></div>
    </aside>
  )
}
