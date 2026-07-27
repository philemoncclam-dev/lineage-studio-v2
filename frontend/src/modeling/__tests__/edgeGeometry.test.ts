import { describe, expect, it } from 'vitest'
import { curveFor, distanceToCurve, hitTestTransitions } from '../edgeGeometry'
import { layoutModel } from '../../model/layout'
import { buildIndex } from '../../model/index'
import { sampleModel } from '../../model/sample'
import type { Layout } from '../../model/layout'
import type { LineageModel } from '../../model/types'

function setup(collapsed: string[] = []) {
  const model: LineageModel = sampleModel()
  const index = buildIndex(model)
  const layout: Layout = layoutModel(model, new Set(collapsed))
  const parentOf = (id: string) => index.entries.get(id)?.parentId ?? null
  return { model, layout, parentOf }
}

describe('curveFor', () => {
  it('leaves the source on its right edge and enters the target on its left', () => {
    const { model, layout, parentOf } = setup()
    const c = curveFor(layout, parentOf, model.transitions[0])
    expect(c).not.toBeNull()
    const source = layout.anchors.get(model.transitions[0].source)
    const target = layout.anchors.get(model.transitions[0].target)
    expect(c!.x0).toBe(source!.right)
    expect(c!.x1).toBe(target!.left)
    // Forwards: the incoming tangent (x1 - cx1) points RIGHT, so does the head.
    expect(c!.x1 - c!.cx1).toBeGreaterThan(0)
  })

  it('mirrors a right-to-left edge so its arrowhead points left', () => {
    const { model, layout, parentOf } = setup()
    // The same transition reversed: its target now sits left of its source.
    const forward = model.transitions[0]
    const c = curveFor(layout, parentOf, {
      id: 'reversed',
      source: forward.target,
      target: forward.source,
    })
    expect(c).not.toBeNull()
    const source = layout.anchors.get(forward.target)
    const target = layout.anchors.get(forward.source)
    expect(c!.x0).toBe(source!.left)
    expect(c!.x1).toBe(target!.right)
    // Backwards: the incoming tangent points LEFT, and so does the head.
    expect(c!.x1 - c!.cx1).toBeLessThan(0)
  })

  it('returns null when an endpoint resolves to nothing', () => {
    const { model, layout, parentOf } = setup()
    const bogus = { id: 'x', source: 'nope', target: 'also-nope' }
    expect(curveFor(layout, parentOf, bogus)).toBeNull()
    void model
  })
})

describe('distanceToCurve', () => {
  it('is zero at the endpoints', () => {
    const { model, layout, parentOf } = setup()
    const c = curveFor(layout, parentOf, model.transitions[0])!
    expect(distanceToCurve(c, c.x0, c.y0)).toBeLessThan(0.5)
    expect(distanceToCurve(c, c.x1, c.y1)).toBeLessThan(0.5)
  })

  it('grows with distance away from the curve', () => {
    const { model, layout, parentOf } = setup()
    const c = curveFor(layout, parentOf, model.transitions[0])!
    const near = distanceToCurve(c, c.x0, c.y0 + 5)
    const far = distanceToCurve(c, c.x0, c.y0 + 200)
    expect(near).toBeLessThan(far)
  })
})

describe('hitTestTransitions', () => {
  it('picks the transition under the point', () => {
    const { model, layout, parentOf } = setup()
    const t = model.transitions[0]
    const c = curveFor(layout, parentOf, t)!
    // A point right on the source end of the curve.
    expect(hitTestTransitions(layout, parentOf, model.transitions, c.x0, c.y0)).toBe(t.id)
  })

  it('returns null in empty space', () => {
    const { model, layout, parentOf } = setup()
    expect(hitTestTransitions(layout, parentOf, model.transitions, -5000, -5000)).toBeNull()
  })

  it('respects the tolerance', () => {
    const { model, layout, parentOf } = setup()
    const t = model.transitions[0]
    const c = curveFor(layout, parentOf, t)!
    // 40px off the curve: outside a 6px tolerance, inside a 60px one.
    expect(
      hitTestTransitions(layout, parentOf, model.transitions, c.x0, c.y0 + 40, 6),
    ).not.toBe(t.id)
    expect(
      hitTestTransitions(layout, parentOf, model.transitions, c.x0, c.y0 + 40, 60),
    ).not.toBeNull()
  })

  it('draws no curve for a transition into a collapsed layer', () => {
    const { model } = setup()
    const middle = model.layers[1].id
    const { layout, parentOf } = setup([middle])

    // Every sample transition has an endpoint in the middle layer, so none of
    // them should resolve once it is collapsed.
    const drawn = model.transitions.filter((t) => curveFor(layout, parentOf, t) !== null)
    expect(drawn).toHaveLength(0)
    expect(hitTestTransitions(layout, parentOf, model.transitions, 100, 100, 10_000)).toBeNull()
  })

  it('ignores transitions whose endpoints are inside a collapsed object', () => {
    const { model } = setup()
    // Collapse every object, so attribute anchors vanish and edges resolve to
    // the object headers instead of their original rows.
    const allObjects = model.layers.flatMap((l) => l.objects.map((o) => o.id))
    const { layout, parentOf } = setup(allObjects)
    const c = curveFor(layout, parentOf, model.transitions[0])
    expect(c).not.toBeNull()
    // It resolved to an object header anchor, not the (now hidden) attribute.
    expect(layout.anchors.has(model.transitions[0].source)).toBe(false)
  })
})
