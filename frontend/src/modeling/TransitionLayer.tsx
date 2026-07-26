// Transitions, drawn as one Canvas 2D layer under the DOM cards.
//
// Why canvas and not SVG/DOM: a real lineage model has far more transitions
// than entities, and every one is a curve. At a few thousand edges an SVG
// <path> per transition costs more in layout/style recalc than the whole rest
// of the viewer; a single canvas draws them in one pass with no DOM cost.
//
// The canvas is viewport-sized, not world-sized — a world-sized canvas would
// blow past the browser's maximum canvas dimensions on a large model. It is
// absolutely positioned at the current scroll offset (so it stays parked over
// the visible region while remaining a child of the scrolling world, and thus
// beneath the cards) and draws with an inverse translate.

import { useEffect, useRef } from 'react'
import type { EntityId } from '../model/types'
import type { Layout } from '../model/layout'
import { curveFor, type TransitionLike } from './edgeGeometry'

interface Props {
  layout: Layout
  transitions: TransitionLike[]
  parentOf: (id: EntityId) => EntityId | null
  /** Current scroll offset of the world container. */
  offset: { x: number; y: number }
  width: number
  height: number
  /** Entities on the current trace — their edges draw highlighted. */
  highlighted: ReadonlySet<EntityId>
  /** Transitions the user has picked, by transition id. */
  selected: ReadonlySet<EntityId>
}

const EDGE = 'rgba(60, 70, 90, 0.34)'
const EDGE_TRACED = 'rgba(22, 143, 92, 0.85)'
const EDGE_SELECTED = 'rgba(31, 111, 235, 0.95)'

export default function TransitionLayer({
  layout,
  transitions,
  parentOf,
  offset,
  width,
  height,
  highlighted,
  selected,
}: Props) {
  const ref = useRef<HTMLCanvasElement | null>(null)

  useEffect(() => {
    const canvas = ref.current
    if (!canvas || width === 0 || height === 0) return
    const ctx = canvas.getContext('2d')
    if (!ctx) return

    const dpr = window.devicePixelRatio || 1
    canvas.width = Math.floor(width * dpr)
    canvas.height = Math.floor(height * dpr)

    ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
    ctx.clearRect(0, 0, width, height)
    // World -> viewport. Everything below is in world coordinates.
    ctx.translate(-offset.x, -offset.y)

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

    const draw = (list: TransitionLike[], stroke: string, lineWidth: number) => {
      if (list.length === 0) return
      ctx.strokeStyle = stroke
      ctx.lineWidth = lineWidth
      ctx.beginPath()
      for (const t of list) {
        const c = curveFor(layout, parentOf, t)
        if (!c) continue

        // Cheap viewport cull — skip curves whose bounding box is off-screen.
        const minX = Math.min(c.x0, c.x1)
        const maxX = Math.max(c.x0, c.x1)
        const minY = Math.min(c.y0, c.y1)
        const maxY = Math.max(c.y0, c.y1)
        if (
          maxX < offset.x ||
          minX > offset.x + width ||
          maxY < offset.y ||
          minY > offset.y + height
        ) {
          continue
        }

        ctx.moveTo(c.x0, c.y0)
        ctx.bezierCurveTo(c.cx0, c.y0, c.cx1, c.y1, c.x1, c.y1)
      }
      ctx.stroke()
    }

    draw(plain, EDGE, 1)
    draw(traced, EDGE_TRACED, 1.8)
    draw(picked, EDGE_SELECTED, 2.4)
  }, [layout, transitions, parentOf, offset, width, height, highlighted, selected])

  return (
    <canvas
      ref={ref}
      className="mv-edges"
      style={{ left: offset.x, top: offset.y, width, height }}
      aria-hidden="true"
    />
  )
}
