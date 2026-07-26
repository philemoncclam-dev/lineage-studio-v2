// Transitions, drawn as one Canvas 2D layer under the DOM cards.
//
// Why canvas and not SVG/DOM: a real lineage model has far more transitions
// than entities, and every one is a curve. At a few thousand edges an SVG
// <path> per transition costs more in layout/style recalc than the whole rest
// of the viewer; a single canvas draws them in one pass with no DOM cost.
//
// The canvas is backed at devicePixelRatio so hairlines stay crisp, and it
// applies the same pan/zoom transform as the DOM layer so the two never drift.

import { useEffect, useRef } from 'react'
import type { EntityId } from '../model/types'
import { resolveAnchor, type Layout } from '../model/layout'

export interface Viewport {
  x: number
  y: number
  scale: number
}

interface Props {
  layout: Layout
  transitions: { id: EntityId; source: EntityId; target: EntityId }[]
  parentOf: (id: EntityId) => EntityId | null
  viewport: Viewport
  width: number
  height: number
  /** Entities on the current trace — their edges draw highlighted and on top. */
  highlighted: ReadonlySet<EntityId>
}

const EDGE = 'rgba(60, 70, 90, 0.34)'
const EDGE_HI = 'rgba(22, 143, 92, 0.85)'

export default function TransitionLayer({
  layout,
  transitions,
  parentOf,
  viewport,
  width,
  height,
  highlighted,
}: Props) {
  const ref = useRef<HTMLCanvasElement | null>(null)

  useEffect(() => {
    const canvas = ref.current
    if (!canvas) return
    const ctx = canvas.getContext('2d')
    if (!ctx) return

    const dpr = window.devicePixelRatio || 1
    canvas.width = Math.floor(width * dpr)
    canvas.height = Math.floor(height * dpr)

    ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
    ctx.clearRect(0, 0, width, height)
    ctx.translate(viewport.x, viewport.y)
    ctx.scale(viewport.scale, viewport.scale)

    // Highlighted edges are drawn last so they sit above the bundle rather than
    // being buried by whatever happens to come later in the transition array.
    const plain: typeof transitions = []
    const hot: typeof transitions = []
    for (const t of transitions) {
      ;(highlighted.has(t.source) || highlighted.has(t.target) ? hot : plain).push(t)
    }

    // Below ~0.5 scale individual curves are visually indistinguishable, so
    // thinning them keeps the bundle readable instead of a solid smear.
    const hairline = Math.max(0.6, 1 / viewport.scale)

    const draw = (list: typeof transitions, stroke: string, lineWidth: number) => {
      ctx.strokeStyle = stroke
      ctx.lineWidth = lineWidth
      ctx.beginPath()
      for (const t of list) {
        const from = resolveAnchor(layout, parentOf, t.source)
        const to = resolveAnchor(layout, parentOf, t.target)
        if (!from || !to) continue

        // Always leave the source on its right edge and enter the target on its
        // left, so direction reads consistently even for a right-to-left edge.
        const x0 = from.right
        const y0 = from.cy
        const x1 = to.left
        const y1 = to.cy
        const dx = Math.max(40, Math.abs(x1 - x0) * 0.45)

        ctx.moveTo(x0, y0)
        ctx.bezierCurveTo(x0 + dx, y0, x1 - dx, y1, x1, y1)
      }
      ctx.stroke()
    }

    draw(plain, EDGE, hairline)
    if (hot.length) draw(hot, EDGE_HI, hairline * 1.8)
  }, [layout, transitions, parentOf, viewport, width, height, highlighted])

  return (
    <canvas
      ref={ref}
      className="mv-edges"
      style={{ width, height }}
      aria-hidden="true"
    />
  )
}
