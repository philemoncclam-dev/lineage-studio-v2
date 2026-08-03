// The line between two cards in one band. Both of these were real bugs seen on
// screen before they were tests: an arrowhead with no line attached to it, and
// a line clipped off at the canvas edge.
import { describe, expect, it } from 'vitest'
import { sameBandArc } from '../SequenceCanvas'

const CARD = 208
/** Column gutters: Medallion packs tighter than Zig-Zag. */
const GX = 76
const ZIG_GX = 150

/** Every x coordinate the path visits. */
const xs = (d: string) =>
  [...d.matchAll(/[MC]?(-?[\d.]+) (-?[\d.]+)/g)].map((m) => Number(m[1]))

describe('sameBandArc', () => {
  it('stays inside the gutter, so it is not drawn under the next column', () => {
    // The bug: reach was capped at Zig-Zag's gutter and used in Medallion too,
    // so the arc bulged past the tighter columns and behind the cards there.
    // Only the sliver that escaped was visible.
    const far = sameBandArc({ x: 0, sy: 0, ty: 4000, gutter: GX, last: false })
    expect(far.reach).toBeLessThanOrEqual(GX)
    expect(Math.max(...xs(far.d))).toBeLessThanOrEqual(CARD + GX)
  })

  it('gives a wider view a wider arc', () => {
    const tight = sameBandArc({ x: 0, sy: 0, ty: 400, gutter: GX, last: false })
    const roomy = sameBandArc({ x: 0, sy: 0, ty: 400, gutter: ZIG_GX, last: false })
    expect(roomy.reach).toBeGreaterThan(tight.reach)
  })

  it('reaches further for a taller hop, so two arcs do not trace one line', () => {
    const near = sameBandArc({ x: 0, sy: 0, ty: 40, gutter: ZIG_GX, last: false })
    const far = sameBandArc({ x: 0, sy: 0, ty: 300, gutter: ZIG_GX, last: false })
    expect(far.reach).toBeGreaterThan(near.reach)
  })

  it('arcs LEFT in the last column, where the canvas edge would clip it', () => {
    const last = sameBandArc({ x: 500, sy: 0, ty: 200, gutter: GX, last: true })
    // Leaves the card's left edge and never goes right of it.
    expect(last.side).toBe(500)
    expect(Math.max(...xs(last.d))).toBeLessThanOrEqual(500)
  })

  it('arcs RIGHT anywhere else', () => {
    const mid = sameBandArc({ x: 500, sy: 0, ty: 200, gutter: GX, last: false })
    expect(mid.side).toBe(500 + CARD)
    expect(Math.min(...xs(mid.d))).toBeGreaterThanOrEqual(500 + CARD)
  })

  it('starts and ends on the same side, which is what keeps it off the cards', () => {
    const a = sameBandArc({ x: 0, sy: 10, ty: 300, gutter: GX, last: false })
    const points = xs(a.d)
    expect(points[0]).toBe(points[points.length - 1])
  })
})
