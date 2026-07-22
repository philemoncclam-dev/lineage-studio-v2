import { describe, expect, it } from 'vitest'
import { adapt } from '../adapt'
import { sampleGraph } from './fixtures'

describe('adapt', () => {
  const model = adapt(sampleGraph())

  it('is a live-source AppModel with the layered tables/notebooks lineageLayout produces', () => {
    expect(model.source).toBe('live')
    expect(model.tables.map((t) => t.id)).toEqual(['raw_orders', 'customers', 'orders_clean'])
    expect(model.notebooks).toEqual([{ id: 'nb_clean_orders', name: 'clean_orders', x: 314, y: 70 }])
  })

  it('classifies object-level ops as table<->notebook<->table', () => {
    expect(model.ops).toEqual([
      ['raw_orders', 'nb_clean_orders', 'reads'],
      ['customers', 'nb_clean_orders', 'reads'],
      ['nb_clean_orders', 'orders_clean', 'writes'],
    ])
  })

  it('resolves column-level edges and transforms from the write-edge column map', () => {
    expect(model.colEdges).toEqual([
      ['raw_orders.order_id', 'orders_clean.order_id'],
      ['raw_orders.customer', 'orders_clean.customer_name'],
    ])
    expect(model.xform).toEqual({
      'orders_clean.order_id': ['order_id', 'Passed through from raw_orders · order_id by clean_orders.'],
      'orders_clean.customer_name': ['upper(customer)', 'Computed as upper(customer) in clean_orders.'],
    })
  })

  it('builds upstream/downstream context per table via shared notebooks', () => {
    expect(model.context).toEqual({
      raw_orders: { up: [], down: [['orders_clean', 'silver', 'clean_orders']] },
      customers: { up: [], down: [['orders_clean', 'silver', 'clean_orders']] },
      orders_clean: { up: [['raw_orders', 'bronze', 'clean_orders'], ['customers', 'bronze', 'clean_orders']], down: [] },
    })
  })

  it('carries notebook source through for the code grep', () => {
    expect(model.notebookCode).toEqual({ nb_clean_orders: 'print(1)' })
  })

  it('produces the same knowledge-graph levels/levelTable as buildGraphLevels', () => {
    expect(model.levels.estate.nodes).toEqual([
      { id: 'workspace.ws1', label: 'Analytics', c: 'accent', r: 30, sub: '2 lakehouses · 3 tables', drill: 'ws:workspace.ws1' },
    ])
    expect(model.levelTable).toEqual({
      'tbl:raw_orders': 'raw_orders',
      'tbl:customers': 'customers',
      'tbl:orders_clean': 'orders_clean',
    })
  })

  it('is deep-equal across two calls on the same input (adapt is pure/deterministic)', () => {
    expect(adapt(sampleGraph())).toEqual(model)
  })
})
