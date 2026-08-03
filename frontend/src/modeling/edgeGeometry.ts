// Transition curve geometry, shared by the renderer and the hit-tester.
//
// Both need the exact same curve: if the drawing code and the picking code each
// computed their own control points, clicking a line would select a line drawn
// somewhere slightly else. One function, two consumers.

import { LAYER_GAP, resolveAnchor, type Layout } from '../model/layout'
import type { EntityId } from '../model/types'

export interface Curve {
  x0: number
  y0: number
  /** First control point x; both control points share their endpoint's y. */
  cx0: number
  cx1: number
  x1: number
  y1: number
}

export interface TransitionLike {
  id: EntityId
  source: EntityId
  target: EntityId
}

/**
 * True when this endpoint is not itself on screen and the edge has had to land
 * on an ancestor instead — i.e. the row it belongs to is inside a collapsed
 * card.
 *
 * Worth distinguishing because the edge then says something weaker than it
 * appears to: the line touches a card, but its real endpoint is one of the rows
 * folded inside, and which one is not visible. Two edges into the same collapsed
 * object are drawn identically whether they land on the same row or different
 * ones.
 *
 * `resolveAnchor` already walks the chain; this only asks whether the walk had
 * to take a step, so the two can never disagree about what is anchored.
 */
export function isRolledUp(layout: Layout, id: EntityId): boolean {
  return !layout.anchors.has(id)
}

/** Null when either endpoint resolves to nothing (e.g. inside a collapsed layer). */
export function curveFor(
  layout: Layout,
  parentOf: (id: EntityId) => EntityId | null,
  t: TransitionLike,
): Curve | null {
  const from = resolveAnchor(layout, parentOf, t.source)
  const to = resolveAnchor(layout, parentOf, t.target)
  if (!from || !to) return null

  // Which side each end uses follows the direction of travel: a left-to-right
  // edge leaves the source's right and enters the target's left, and a
  // right-to-left one MIRRORS that — out of the source's left, into the
  // target's right.
  //
  // The earlier version pinned every edge to right→left sides, so a backwards
  // edge looped around and still arrived pointing rightwards: the arrowhead was
  // correct for the curve but stated the wrong direction of flow. Mirroring
  // makes a backwards edge look backwards, which is the whole point of drawing
  // the head.
  //
  // Backwards is decided on CENTRES, not on whether the boxes overlap: two
  // near-neighbours with a slight overlap should still take the short mirrored
  // path rather than the long way around.
  // Both ends in the SAME column — two cards stacked in one layer, or two rows
  // of one card. There is no horizontal distance to travel, so the usual
  // right-edge-to-left-edge curve has nowhere to go but straight back across
  // the column, behind every card between the two rows.
  //
  // So leave and arrive on the same side, bulging into the gutter beside the
  // column: a C in empty space instead of a line through the furniture. The
  // arrowhead still reads correctly — it is built from the incoming tangent,
  // which now points back INTO the card's right edge.
  //
  // The bulge grows with the vertical distance, so a long hop stands clear of a
  // short one instead of the two overlapping, and is capped inside the gutter
  // so it never reaches the next column's cards.
  if (Math.abs(from.left - to.left) < 1 && Math.abs(from.right - to.right) < 1) {
    const reach = Math.min(LAYER_GAP * 0.8, Math.max(28, Math.abs(to.cy - from.cy) * 0.4))
    return {
      x0: from.right,
      y0: from.cy,
      cx0: from.right + reach,
      cx1: to.right + reach,
      x1: to.right,
      y1: to.cy,
    }
  }

  const backwards = (to.left + to.right) / 2 < (from.left + from.right) / 2
  const x0 = backwards ? from.left : from.right
  const y0 = from.cy
  const x1 = backwards ? to.right : to.left
  const y1 = to.cy
  const dx = Math.max(40, Math.abs(x1 - x0) * 0.45) * (backwards ? -1 : 1)
  return { x0, y0, cx0: x0 + dx, cx1: x1 - dx, x1, y1 }
}

function cubicAt(p0: number, p1: number, p2: number, p3: number, t: number): number {
  const mt = 1 - t
  return mt * mt * mt * p0 + 3 * mt * mt * t * p1 + 3 * mt * t * t * p2 + t * t * t * p3
}

/**
 * Approximate distance from a point to the curve.
 *
 * Sampled rather than solved: the exact closest-point-on-cubic is a quintic
 * root find, and for a click tolerance of a few pixels a 24-segment polyline is
 * indistinguishable and far cheaper.
 */
export function distanceToCurve(c: Curve, px: number, py: number, samples = 24): number {
  let best = Infinity
  let prevX = c.x0
  let prevY = c.y0
  for (let i = 1; i <= samples; i += 1) {
    const t = i / samples
    const x = cubicAt(c.x0, c.cx0, c.cx1, c.x1, t)
    const y = cubicAt(c.y0, c.y0, c.y1, c.y1, t)
    best = Math.min(best, distanceToSegment(px, py, prevX, prevY, x, y))
    prevX = x
    prevY = y
  }
  return best
}

function distanceToSegment(
  px: number,
  py: number,
  ax: number,
  ay: number,
  bx: number,
  by: number,
): number {
  const dx = bx - ax
  const dy = by - ay
  const lenSq = dx * dx + dy * dy
  if (lenSq === 0) return Math.hypot(px - ax, py - ay)
  const t = Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / lenSq))
  return Math.hypot(px - (ax + t * dx), py - (ay + t * dy))
}

/** The transition nearest a world-space point, or null if none is within `tolerance`. */
export function hitTestTransitions(
  layout: Layout,
  parentOf: (id: EntityId) => EntityId | null,
  transitions: TransitionLike[],
  px: number,
  py: number,
  tolerance = 6,
): EntityId | null {
  let bestId: EntityId | null = null
  let bestDistance = tolerance

  for (const t of transitions) {
    const c = curveFor(layout, parentOf, t)
    if (!c) continue

    // Bounding-box reject before the expensive sampling. The box is padded by
    // the tolerance so a near-miss on a flat curve isn't discarded early.
    const minX = Math.min(c.x0, c.x1, c.cx0, c.cx1) - tolerance
    const maxX = Math.max(c.x0, c.x1, c.cx0, c.cx1) + tolerance
    const minY = Math.min(c.y0, c.y1) - tolerance
    const maxY = Math.max(c.y0, c.y1) + tolerance
    if (px < minX || px > maxX || py < minY || py > maxY) continue

    const d = distanceToCurve(c, px, py)
    if (d < bestDistance) {
      bestDistance = d
      bestId = t.id
    }
  }
  return bestId
}
