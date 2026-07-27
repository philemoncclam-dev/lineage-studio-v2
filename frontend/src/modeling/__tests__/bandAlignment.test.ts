// Guards the geometry the layer band depends on, across model edits.
//
// The reported symptom was "objects fall between two layers after adding a
// layer". The layout maths was in fact correct — the drift was a rendering
// synchronisation bug — but these assertions pin the invariant so a future
// layout change cannot introduce the real version of that bug unnoticed.

import { describe, expect, it } from 'vitest'
import { addLayer, addObject } from '../../model/edit'
import { CARD_WIDTH, LAYER_ADD_WIDTH, LAYER_GAP, layoutModel } from '../../model/layout'
import { sampleModel } from '../../model/sample'
import type { LineageModel } from '../../model/types'

function assertAligned(model: LineageModel) {
  const layout = layoutModel(model, new Set())

  for (const card of layout.cards) {
    const layer = layout.layers.find((l) => l.id === card.layerId)!

    // The card sits strictly inside its own column...
    expect(card.x).toBeGreaterThanOrEqual(layer.x)
    expect(card.x + card.width).toBeLessThanOrEqual(layer.x + layer.width)

    // ...shares its centre with the layer name...
    expect(card.x + card.width / 2).toBeCloseTo(layer.centerX, 5)

    // ...and never straddles a band boundary.
    expect(card.x).toBeGreaterThan(layer.bandLeft)
    expect(card.x + card.width).toBeLessThan(layer.bandLeft + layer.bandWidth)
  }

  // Columns never overlap, and the band tiles the canvas with no gaps.
  for (let i = 1; i < layout.layers.length; i += 1) {
    const previous = layout.layers[i - 1]
    const current = layout.layers[i]
    expect(previous.x + previous.width).toBeLessThan(current.x)
    expect(previous.bandLeft + previous.bandWidth).toBeCloseTo(current.bandLeft, 5)
  }
  expect(layout.layers[0].bandLeft).toBe(0)
  // The band is CLOSED on the right: it ends half a gutter past the last
  // column, not at the canvas edge, and leaves room for the add-layer slot.
  const last = layout.layers.at(-1)!
  expect(last.bandLeft + last.bandWidth).toBeCloseTo(layout.bandEnd, 5)
  expect(layout.bandEnd).toBeCloseTo(last.x + last.width + LAYER_GAP / 2, 5)
  expect(layout.width).toBeGreaterThanOrEqual(layout.bandEnd + LAYER_ADD_WIDTH)
}

describe('band alignment survives edits', () => {
  it('holds for the untouched sample', () => {
    assertAligned(sampleModel())
  })

  it('holds after appending a layer', () => {
    assertAligned(addLayer(sampleModel()).model)
  })

  it('holds after inserting a layer before the first one', () => {
    const model = sampleModel()
    assertAligned(addLayer(model, { relativeTo: model.layers[0].id, side: 'before' }).model)
  })

  it('holds after inserting a layer in the middle', () => {
    const model = sampleModel()
    assertAligned(addLayer(model, { relativeTo: model.layers[1].id, side: 'after' }).model)
  })

  it('holds after adding several layers', () => {
    let model = sampleModel()
    for (let i = 0; i < 5; i += 1) model = addLayer(model).model
    assertAligned(model)
  })

  it('keeps an object under its own layer after new layers appear around it', () => {
    const original = sampleModel()
    const firstLayer = original.layers[0]
    const firstCard = layoutModel(original, new Set()).cards.find(
      (c) => c.layerId === firstLayer.id,
    )!

    const widened = addLayer(original, { relativeTo: firstLayer.id, side: 'after' }).model
    const after = layoutModel(widened, new Set())
    const movedCard = after.cards.find((c) => c.layerId === firstLayer.id)!
    const movedLayer = after.layers.find((l) => l.id === firstLayer.id)!

    // Inserting AFTER the first layer must not move the first layer's object.
    expect(movedCard.x).toBe(firstCard.x)
    expect(movedCard.x + CARD_WIDTH / 2).toBeCloseTo(movedLayer.centerX, 5)
  })

  it('holds for a layer holding several objects', () => {
    let model = sampleModel()
    const layerId = model.layers[2].id
    for (let i = 0; i < 3; i += 1) model = addObject(model, layerId).model
    assertAligned(model)

    const layout = layoutModel(model, new Set())
    const cards = layout.cards.filter((c) => c.layerId === layerId)
    expect(cards).toHaveLength(4)
    // Stacked vertically, all sharing one x.
    expect(new Set(cards.map((c) => c.x)).size).toBe(1)
  })
})
