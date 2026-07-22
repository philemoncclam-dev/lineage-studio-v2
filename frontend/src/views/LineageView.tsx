import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { useModel } from '../model'
import { useSelection } from '../selection/useSelection'

const Caret = () => <svg viewBox="0 0 24 24"><path d="M9 6l6 6-6 6" /></svg>

interface EdgePath { d: string; from?: string; to?: string; kind?: string }

// walk upstream + downstream from a column
function trace(colEdges: [string, string][], id: string): Set<string> {
  const set = new Set<string>()
  const go = (c: string, dir: number) => {
    set.add(c)
    for (const [s, t] of colEdges) {
      if (dir >= 0 && s === c && !set.has(t)) go(t, 1)
      if (dir <= 0 && t === c && !set.has(s)) go(s, -1)
    }
  }
  go(id, 0)
  return set
}

export default function LineageView({ focusTable, focusColumn }: { focusTable?: string; focusColumn?: string }) {
  const { tables: TABLES, notebooks: NOTEBOOKS, colEdges: COL_EDGES, ops: OPS } = useModel()
  const { select, clear } = useSelection()
  const canvasRef = useRef<HTMLDivElement>(null)
  const [open, setOpen] = useState<Set<string>>(() => new Set(TABLES.map((t) => t.id)))
  // Local highlight/trace state, unchanged from before this plan (Phase 3/4
  // own the DAG's hover-trace rebuild — out of scope here). Column clicks
  // additionally write through useSelection().select() below so the shell
  // Inspector (D-10/D-12) picks up the same selection via ?sel/?col.
  const [selected, setSelected] = useState<string | null>(focusColumn ?? null)

  useEffect(() => { if (focusColumn) setSelected(focusColumn) }, [focusColumn])
  useEffect(() => { setOpen(new Set(TABLES.map((t) => t.id))) }, [TABLES])
  const [hover, setHover] = useState<string | null>(null)
  const [paths, setPaths] = useState<EdgePath[]>([])
  const [tick, setTick] = useState(0)

  const active = hover ?? selected
  const traced = useMemo(() => (active ? trace(COL_EDGES, active) : null), [active, COL_EDGES])

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
  }, [open, tick, COL_EDGES, OPS])

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
        <div
          className="ls-canvas"
          ref={canvasRef}
          onClick={(e) => {
            // Empty-canvas click clears selection (D-11) — only fires when
            // the click target is the canvas background itself, never a
            // node/column (those stopPropagation or are distinct targets).
            if (e.target === e.currentTarget) {
              setSelected(null)
              clear()
            }
          }}
        >
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
                <span className="tick notebook" />
                <div><div className="title">{nb.name}</div><div className="sub">notebook · PySpark</div></div>
              </div>
            </div>
          ))}

          {TABLES.map((t) => {
            const isOpen = open.has(t.id)
            return (
              <div className={`ls-node ${isOpen ? 'open' : ''} ${t.id === focusTable ? 'focus' : ''}`}
                id={`ls-${t.id}`} key={t.id} style={{ left: t.x, top: t.y }}>
                <div className="head" onClick={() => toggle(t.id)}>
                  <span className={`tick ${t.layer}`} />
                  <div><div className="title">{t.name}</div><div className="sub">{t.layer}</div></div>
                  <span className="caret"><Caret /></span>
                </div>
                <div className="cols">
                  {t.columns.map((c) => (
                    <div className={`col ${traced?.has(c.key) && c.key !== active ? 'hot' : ''} ${c.key === selected ? 'sel' : ''}`}
                      key={c.key} data-col={c.key}
                      onMouseEnter={() => setHover(c.key)} onMouseLeave={() => setHover(null)}
                      onClick={(e) => { e.stopPropagation(); setSelected(c.key); select(t.id, c.key) }}>
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
    </div>
  )
}
