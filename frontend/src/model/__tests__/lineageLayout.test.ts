import { describe, expect, it } from 'vitest'
import { layoutLineage } from '../lineageLayout'
import { sampleGraph } from './fixtures'

describe('layoutLineage', () => {
  const g = sampleGraph()
  const ops: [string, string, 'reads' | 'writes'][] = [
    ['raw_orders', 'nb_clean_orders', 'reads'],
    ['customers', 'nb_clean_orders', 'reads'],
    ['nb_clean_orders', 'orders_clean', 'writes'],
  ]
  const { tables, notebooks } = layoutLineage(g, ops)

  it('places depth-0 (bronze) tables at x=40, stacked with a 36px gutter', () => {
    const raw = tables.find((t) => t.id === 'raw_orders')!
    const customers = tables.find((t) => t.id === 'customers')!
    expect(raw.x).toBe(40)
    expect(raw.y).toBe(70)
    expect(customers.x).toBe(40)
    // stacked below raw_orders: prior y (70) + raw_orders height (47 + 29*2) + 36px gutter
    expect(customers.y).toBe(70 + (47 + 29 * 2) + 36)
  })

  it('places the notebook (depth 1) and its write target (depth 2) via x = 40 + depth*274', () => {
    const nb = notebooks.find((n) => n.id === 'nb_clean_orders')!
    const clean = tables.find((t) => t.id === 'orders_clean')!
    expect(nb.x).toBe(40 + 1 * 274)
    expect(nb.y).toBe(70)
    expect(clean.x).toBe(40 + 2 * 274)
    expect(clean.y).toBe(70)
  })

  it('assigns layer/colour from the parent lakehouse and preserves column metadata', () => {
    const raw = tables.find((t) => t.id === 'raw_orders')!
    const clean = tables.find((t) => t.id === 'orders_clean')!
    expect(raw.layer).toBe('bronze')
    expect(raw.c).toBe('bronze')
    expect(raw.columns).toEqual([
      { key: 'raw_orders.order_id', name: 'order_id', type: 'long' },
      { key: 'raw_orders.customer', name: 'customer', type: 'string' },
    ])
    expect(clean.layer).toBe('silver')
    expect(clean.c).toBe('silver')
  })
})
