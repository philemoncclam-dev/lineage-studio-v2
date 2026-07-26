import { describe, expect, it } from 'vitest'
import { CARD_WIDTH, layoutModel } from '../layout'
import { sampleModel } from '../sample'

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
    const last = layout.layers[layout.layers.length - 1]
    expect(last.bandLeft + last.bandWidth).toBeCloseTo(layout.width, 5)
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
