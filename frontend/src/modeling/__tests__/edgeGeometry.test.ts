import { describe, expect, it } from 'vitest'
import { curveFor, distanceToCurve, hitTestTransitions, isRolledUp } from '../edgeGeometry'
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

// --- edges into folded cards -----------------------------------------------
// When an object is collapsed its rows lose their anchors, so an edge into one
// resolves up to the card and lands on the header. The line is still true, but
// it makes a WEAKER claim than it looks like it does — it reaches the object,
// and which row inside is no longer on screen. The renderer colours those
// differently, and this is the predicate it colours by.

describe('isRolledUp', () => {
  /** A transition whose endpoints are both attributes, and the object above one. */
  function attributeEdge() {
    const { model, layout } = setup()
    const index = buildIndex(model)
    const edge = model.transitions.find(
      (t) => index.entries.get(t.target)?.kind === 'attribute',
    )!
    return { edge, owner: index.entries.get(edge.target)!.parentId as string, layout }
  }

  it('is false for every endpoint while nothing is collapsed', () => {
    const { model, layout } = setup()
    for (const t of model.transitions) {
      expect(isRolledUp(layout, t.source)).toBe(false)
      expect(isRolledUp(layout, t.target)).toBe(false)
    }
  })

  it('is true for a row whose object is collapsed', () => {
    const { edge, owner } = attributeEdge()
    const folded = setup([owner]).layout
    expect(isRolledUp(folded, edge.target)).toBe(true)
    // The card itself is still anchored — it is on screen, just shut.
    expect(isRolledUp(folded, owner)).toBe(false)
  })

  it('still yields a drawable curve, landing on the card', () => {
    const { edge, owner } = attributeEdge()
    const { layout, parentOf } = setup([owner])
    const c = curveFor(layout, parentOf, edge)
    expect(c).not.toBeNull()
    // The endpoint is the object's own anchor, not the row's.
    expect(c!.y1).toBe(layout.anchors.get(owner)!.cy)
  })
})

describe('an edge inside one column', () => {
  // Two cards stacked in a single layer, and a transition between them. There
  // is no horizontal distance to cover, so the ordinary right-edge-to-left-edge
  // curve had nowhere to go but straight back through the column.
  const oneColumn = (): LineageModel => ({
    ...sampleModel(),
    layers: [
      {
        id: 'L1',
        name: 'Only',
        objects: [
          { id: 'a', name: 'a', children: [{ id: 'a.x', name: 'x', children: [] }] },
          { id: 'b', name: 'b', children: [{ id: 'b.x', name: 'x', children: [] }] },
        ],
      },
    ],
    transitions: [{ id: 't', source: 'a.x', target: 'b.x' }],
  })

  const curve = () => {
    const model = oneColumn()
    const index = buildIndex(model)
    const layout = layoutModel(model, new Set())
    return {
      layout,
      c: curveFor(layout, (id) => index.entries.get(id)?.parentId ?? null, model.transitions[0])!,
    }
  }

  it('leaves and arrives on the same side, so it never crosses the cards', () => {
    const { layout, c } = curve()
    const a = layout.anchors.get('a.x')!
    const b = layout.anchors.get('b.x')!
    expect(c.x0).toBe(a.right)
    expect(c.x1).toBe(b.right)
  })

  it('bulges into the gutter beside the column, not back across it', () => {
    const { layout, c } = curve()
    const right = layout.anchors.get('a.x')!.right
    // Both control points sit clear to the RIGHT of the cards — the C shape.
    // Before this, cx1 landed left of the column and the line went behind
    // every card between the two rows.
    expect(c.cx0).toBeGreaterThan(right)
    expect(c.cx1).toBeGreaterThan(right)
  })

  it('still points its arrowhead into the target', () => {
    const { c } = curve()
    // The head is built from the incoming tangent, which now runs leftwards
    // back into the card's right edge.
    expect(c.x1 - c.cx1).toBeLessThan(0)
  })

  it('reaches further for a longer hop, so two of them do not overlap', () => {
    const model = oneColumn()
    model.layers[0].objects.splice(1, 0, {
      id: 'mid',
      name: 'mid',
      children: [{ id: 'mid.x', name: 'x', children: [] }],
    })
    const index = buildIndex(model)
    const layout = layoutModel(model, new Set())
    const parentOf = (id: string) => index.entries.get(id)?.parentId ?? null
    const near = curveFor(layout, parentOf, { id: 'n', source: 'a.x', target: 'mid.x' })!
    const far = curveFor(layout, parentOf, { id: 'f', source: 'a.x', target: 'b.x' })!
    expect(far.cx0).toBeGreaterThan(near.cx0)
  })
})
