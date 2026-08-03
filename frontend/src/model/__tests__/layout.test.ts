import { describe, expect, it } from 'vitest'
import { CARD_GAP, CARD_WIDTH, layoutModel } from '../layout'
import { sampleModel } from '../sample'
import { emptyModel } from '../store'
import type { LineageModel } from '../types'

describe('layoutModel', () => {
  it('centres each card in its column, leaving an equal gutter either side', () => {
    const layout = layoutModel(sampleModel(), new Set())
    for (const card of layout.cards) {
      const layer = layout.layers.find((l) => l.id === card.layerId)!
      expect(card.width).toBe(CARD_WIDTH)
      const leftGutter = card.x - layer.x
      const rightGutter = layer.x + layer.width - (card.x + card.width)
      expect(Math.abs(leftGutter - rightGutter)).toBeLessThanOrEqual(1)
    }
  })

  it('anchors transitions to the card edges, not the column edges', () => {
    const model = sampleModel()
    const layout = layoutModel(model, new Set())
    const card = layout.cards[0]
    const anchor = layout.anchors.get(card.id)!
    expect(anchor.left).toBe(card.x)
    expect(anchor.right).toBe(card.x + CARD_WIDTH)
  })

  it('gives every layer the same column width', () => {
    const layout = layoutModel(sampleModel(), new Set())
    const widths = new Set(layout.layers.map((l) => l.width))
    expect(widths.size).toBe(1)
  })

  // The bug this guards: segments only as wide as their column left the
  // inter-column gap belonging to no layer, so a name centred in its segment
  // read as off-centre against the column the eye actually perceives.
  it('produces contiguous band segments with no orphaned gap', () => {
    const layout = layoutModel(sampleModel(), new Set())
    expect(layout.layers[0].bandLeft).toBe(0)
    for (let i = 1; i < layout.layers.length; i += 1) {
      const previous = layout.layers[i - 1]
      const current = layout.layers[i]
      expect(previous.bandLeft + previous.bandWidth).toBeCloseTo(current.bandLeft, 5)
    }
    // The band CLOSES half a gutter past the last column rather than running to
    // the canvas edge, and the world is wide enough to hold the add-layer slot
    // beyond that line.
    const last = layout.layers[layout.layers.length - 1]
    expect(last.bandLeft + last.bandWidth).toBeCloseTo(layout.bandEnd, 5)
    expect(layout.bandEnd).toBeLessThan(layout.width)
  })

  it('centres the layer name on the column, which is also the card centre', () => {
    const layout = layoutModel(sampleModel(), new Set())
    for (const layer of layout.layers) {
      expect(layer.centerX).toBeCloseTo(layer.x + layer.width / 2, 5)
      const card = layout.cards.find((c) => c.layerId === layer.id)
      if (card) expect(layer.centerX).toBeCloseTo(card.x + card.width / 2, 0)
    }
  })

  it('drops every anchor in a collapsed layer, so its transitions stop drawing', () => {
    const model = sampleModel()
    const target = model.layers[1]
    const layout = layoutModel(model, new Set([target.id]))

    // Neither the layer, nor its objects, nor its attributes may anchor —
    // otherwise a hidden layer's traffic would pile onto its collapsed strip.
    expect(layout.anchors.has(target.id)).toBe(false)
    for (const obj of target.objects) {
      expect(layout.anchors.has(obj.id)).toBe(false)
      for (const attr of obj.children) expect(layout.anchors.has(attr.id)).toBe(false)
    }
    // Layers still on screen keep theirs.
    expect(layout.anchors.has(model.layers[0].id)).toBe(true)
  })

  it('shrinks a collapsed layer without removing it from the band', () => {
    const model = sampleModel()
    const target = model.layers[1].id
    const layout = layoutModel(model, new Set([target]))
    const collapsedLayer = layout.layers.find((l) => l.id === target)!
    expect(collapsedLayer.collapsed).toBe(true)
    expect(collapsedLayer.width).toBeLessThan(CARD_WIDTH)
    expect(layout.layers).toHaveLength(model.layers.length)
    expect(layout.cards.some((c) => c.layerId === target)).toBe(false)
  })
})

describe('ordering a traced chain', () => {
  /**
   * Three layers, medallion-shaped. Bronze holds a decoy card that comes FIRST
   * in the model, so the chain's card is second in its layer — the staircase
   * this pass exists to remove.
   */
  const chain = (): LineageModel => {
    const obj = (id: string, rows: string[]) => ({
      id,
      name: id,
      children: rows.map((r) => ({ id: `${id}.${r}`, name: r, children: [] })),
    })
    return {
      ...emptyModel('m'),
      layers: [
        { id: 'L1', name: 'Landing', objects: [obj('raw', ['order_id'])] },
        { id: 'L2', name: 'Bronze', objects: [obj('decoy', ['a', 'b', 'c']), obj('bronze', ['order_id'])] },
        { id: 'L3', name: 'Silver', objects: [obj('silver', ['order_id'])] },
      ],
      transitions: [
        { id: 't1', source: 'raw.order_id', target: 'bronze.order_id' },
        { id: 't2', source: 'bronze.order_id', target: 'silver.order_id' },
      ],
    }
  }

  const topOf = (layout: ReturnType<typeof layoutModel>, layerId: string) =>
    Math.min(...layout.cards.filter((c) => c.layerId === layerId).map((c) => c.y))

  it('leaves an untraced layout exactly as it was', () => {
    // The pass only has an unambiguous answer once a trace has pruned the rest
    // away; it must not reorder a model the user is working in.
    const model = chain()
    const before = layoutModel(model, new Set())
    const after = layoutModel(model, new Set(), false)
    expect(after.cards.map((c) => c.id)).toEqual(before.cards.map((c) => c.id))
  })

  it('puts the chain first in every layer', () => {
    const layout = layoutModel(chain(), new Set(), true)
    const first = (layerId: string) =>
      layout.cards.filter((c) => c.layerId === layerId).sort((a, b) => a.y - b.y)[0].id
    expect([first('L1'), first('L2'), first('L3')]).toEqual(['raw', 'bronze', 'silver'])
  })

  it('was NOT first before, which is the point', () => {
    const plain = layoutModel(chain(), new Set())
    const bronzeCards = plain.cards.filter((c) => c.layerId === 'L2').sort((a, b) => a.y - b.y)
    expect(bronzeCards[0].id).toBe('decoy')
  })

  it('starts every layer at the top of the canvas', () => {
    // The whole complaint: no card parked far down with a line running to it.
    // Ordering never introduces a vertical offset, so each column packs tight
    // from the top exactly as an untraced one does.
    const layout = layoutModel(chain(), new Set(), true)
    const tops = ['L1', 'L2', 'L3'].map((id) => topOf(layout, id))
    expect(new Set(tops).size).toBe(1)
    expect(tops[0]).toBe(topOf(layoutModel(chain(), new Set()), 'L1'))
  })

  it('never leaves a gap between cards in a column', () => {
    const layout = layoutModel(chain(), new Set(), true)
    const bronze = layout.cards.filter((c) => c.layerId === 'L2').sort((a, b) => a.y - b.y)
    expect(bronze[1].y).toBe(bronze[0].y + bronze[0].height + CARD_GAP)
  })
})
