import { describe, expect, it } from 'vitest'
import { CARD_WIDTH, layoutModel } from '../layout'
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

describe('aligning a traced chain', () => {
  /**
   * Three layers, medallion-shaped. Bronze holds a decoy card ABOVE the traced
   * one, so the chain's row starts lower in bronze than in landing — the
   * staircase this pass exists to flatten.
   */
  const chain = (): LineageModel => {
    const col = (name: string) => ({ id: `c:${name}`, name, children: [] })
    const obj = (id: string, rows: string[]) => ({
      id,
      name: id,
      children: rows.map((r) => ({ ...col(r), id: `${id}.${r}` })),
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

  const cyOf = (layout: ReturnType<typeof layoutModel>, id: string) => layout.anchors.get(id)!.cy

  it('leaves an untraced layout exactly as it was', () => {
    // The pass must not touch a model the user is working in — it only has an
    // unambiguous answer once a trace has pruned everything else away.
    const model = chain()
    const before = layoutModel(model, new Set())
    const after = layoutModel(model, new Set(), false)
    expect(after.cards.map((c) => c.y)).toEqual(before.cards.map((c) => c.y))
  })

  it('puts every row of the chain on one line', () => {
    const layout = layoutModel(chain(), new Set(), true)
    const ys = ['raw.order_id', 'bronze.order_id', 'silver.order_id'].map((id) => cyOf(layout, id))
    expect(new Set(ys).size).toBe(1)
  })

  it('was a staircase before, which is the point', () => {
    const plain = layoutModel(chain(), new Set())
    expect(cyOf(plain, 'raw.order_id')).not.toBe(cyOf(plain, 'bronze.order_id'))
  })

  it('never stacks two cards of one layer on top of each other', () => {
    // Alignment yields to overlap: two cards in the same place is not a layout,
    // however straight it would have made the line.
    const layout = layoutModel(chain(), new Set(), true)
    const bronze = layout.cards.filter((c) => c.layerId === 'L2').sort((a, b) => a.y - b.y)
    expect(bronze[0].y + bronze[0].height).toBeLessThanOrEqual(bronze[1].y)
  })

  it('grows the world to fit whatever it pushed down', () => {
    const layout = layoutModel(chain(), new Set(), true)
    const lowest = Math.max(...layout.cards.map((c) => c.y + c.height))
    expect(layout.height).toBeGreaterThan(lowest)
  })

  it('lowers the upstream when the downstream row sits further down its card', () => {
    // The ordinary case: bronze carries two traced columns and the one the
    // chain follows is the second. Bronze cannot rise above its column top, so
    // landing descends to meet it — the only direction this pass ever moves.
    const model: LineageModel = {
      ...emptyModel('m'),
      layers: [
        {
          id: 'L1',
          name: 'Landing',
          objects: [{ id: 'raw', name: 'raw', children: [{ id: 'raw.order_id', name: 'order_id', children: [] }] }],
        },
        {
          id: 'L2',
          name: 'Bronze',
          objects: [
            {
              id: 'bronze',
              name: 'bronze',
              children: [
                { id: 'bronze.customer_id', name: 'customer_id', children: [] },
                { id: 'bronze.order_id', name: 'order_id', children: [] },
              ],
            },
          ],
        },
      ],
      transitions: [{ id: 't1', source: 'raw.order_id', target: 'bronze.order_id' }],
    }
    const layout = layoutModel(model, new Set(), true)
    expect(layout.anchors.get('raw.order_id')!.cy).toBe(layout.anchors.get('bronze.order_id')!.cy)
    expect(layout.cards.find((c) => c.id === 'raw')!.y).toBeGreaterThan(
      layout.cards.find((c) => c.id === 'bronze')!.y,
    )
  })
})
