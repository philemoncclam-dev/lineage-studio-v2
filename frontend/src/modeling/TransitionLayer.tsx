// Transitions, drawn as one Canvas 2D layer under the DOM cards.
//
// Why canvas and not SVG/DOM: a real lineage model has far more transitions
// than entities, and every one is a curve. At a few thousand edges an SVG
// <path> per transition costs more in layout/style recalc than the whole rest
// of the viewer; a single canvas draws them in one pass with no DOM cost.
//
// The canvas is WORLD-sized and scrolls with the cards, rather than being a
// viewport-sized canvas re-parked at the scroll offset. The viewport-following
// version had to be positioned from React scroll state, which lags the
// browser's native scrolling by a frame — so edges visibly detached from their
// rows while scrolling. Living in world coordinates removes the synchronisation
// problem entirely: the browser scrolls the canvas exactly as it scrolls the
// cards.
//
// The cost is memory, which is bounded below: past MAX_CANVAS_PIXELS the
// backing store drops to 1x rather than devicePixelRatio, trading crispness for
// a canvas the browser will actually allocate.

import { useEffect, useRef } from 'react'
import type { EntityId } from '../model/types'
import type { Layout } from '../model/layout'
import { curveFor, type TransitionLike } from './edgeGeometry'

interface Props {
  layout: Layout
  transitions: TransitionLike[]
  parentOf: (id: EntityId) => EntityId | null
  /** Entities on the current trace — their edges draw highlighted. */
  highlighted: ReadonlySet<EntityId>
  /** Transitions the user has picked, by transition id. */
  selected: ReadonlySet<EntityId>
}

/** ~24 megapixels of backing store, well inside every browser's canvas limit. */
const MAX_CANVAS_PIXELS = 24_000_000

const EDGE = 'rgba(60, 70, 90, 0.34)'
const EDGE_TRACED = 'rgba(22, 143, 92, 0.85)'
const EDGE_SELECTED = 'rgba(31, 111, 235, 0.95)'

export default function TransitionLayer({
  layout,
  transitions,
  parentOf,
  highlighted,
  selected,
}: Props) {
  const ref = useRef<HTMLCanvasElement | null>(null)
  const width = layout.width
  const height = layout.height

  useEffect(() => {
    const canvas = ref.current
    if (!canvas || width === 0 || height === 0) return
    const ctx = canvas.getContext('2d')
    if (!ctx) return

    const wanted = window.devicePixelRatio || 1
    const dpr = width * height * wanted * wanted > MAX_CANVAS_PIXELS ? 1 : wanted
    canvas.width = Math.floor(width * dpr)
    canvas.height = Math.floor(height * dpr)

    ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
    ctx.clearRect(0, 0, width, height)

    // Painter's order: plain, then traced, then selected. Later passes must sit
    // on top, otherwise a picked line can be buried by the bundle around it.
    const plain: TransitionLike[] = []
    const traced: TransitionLike[] = []
    const picked: TransitionLike[] = []
    for (const t of transitions) {
      if (selected.has(t.id)) picked.push(t)
      else if (highlighted.has(t.source) || highlighted.has(t.target)) traced.push(t)
      else plain.push(t)
    }

    /**
     * An arrowhead at the target end, filled in the line's own colour.
     *
     * Drawn from the curve's incoming tangent rather than from the straight
     * source→target vector: a right-to-left edge arrives from the LEFT after
     * looping around, so the straight vector would point the head backwards on
     * exactly the edges whose direction most needs stating.
     */
    const arrowHead = (c: ReturnType<typeof curveFor>, size: number) => {
      if (!c) return
      // Tangent at t=1 of a cubic is 3*(P3 - P2); P2 is (cx1, y1) here, so the
      // incoming direction is (x1 - cx1, 0) — horizontal, sign giving the side.
      const dir = c.x1 - c.cx1 >= 0 ? 1 : -1
      const tipX = c.x1
      const tipY = c.y1
      ctx.beginPath()
      ctx.moveTo(tipX, tipY)
      ctx.lineTo(tipX - dir * size, tipY - size * 0.5)
      ctx.lineTo(tipX - dir * size, tipY + size * 0.5)
      ctx.closePath()
      ctx.fill()
    }

    const draw = (list: TransitionLike[], stroke: string, lineWidth: number, head: number) => {
      if (list.length === 0) return
      ctx.strokeStyle = stroke
      ctx.fillStyle = stroke
      ctx.lineWidth = lineWidth
      ctx.beginPath()
      const curves: (ReturnType<typeof curveFor>)[] = []
      for (const t of list) {
        const c = curveFor(layout, parentOf, t)
        if (!c) continue
        curves.push(c)
        ctx.moveTo(c.x0, c.y0)
        ctx.bezierCurveTo(c.cx0, c.y0, c.cx1, c.y1, c.x1, c.y1)
      }
      ctx.stroke()
      // Heads in a second pass: they are filled, the lines are stroked, and
      // batching each keeps this one path + one fill per style rather than per
      // edge.
      for (const c of curves) arrowHead(c, head)
    }

    draw(plain, EDGE, 1, 6)
    draw(traced, EDGE_TRACED, 1.8, 7.5)
    draw(picked, EDGE_SELECTED, 2.4, 8.5)
  }, [layout, transitions, parentOf, width, height, highlighted, selected])

  return (
    <canvas
      ref={ref}
      className="mv-edges"
      style={{ left: 0, top: 0, width, height }}
      aria-hidden="true"
    />
  )
}
