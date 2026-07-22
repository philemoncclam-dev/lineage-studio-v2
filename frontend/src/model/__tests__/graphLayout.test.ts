import { describe, expect, it } from 'vitest'
import { buildGraphLevels } from '../graphLayout'
import { sampleGraph } from './fixtures'

describe('buildGraphLevels', () => {
  const { levels, levelTable } = buildGraphLevels(sampleGraph())

  it('estate level lists one node per workspace with a "{N} lakehouses · {M} tables" sub and a ws: drill key', () => {
    expect(levels.estate.nodes).toEqual([
      { id: 'workspace.ws1', label: 'Analytics', c: 'accent', r: 30, sub: '2 lakehouses · 3 tables', drill: 'ws:workspace.ws1' },
    ])
    expect(levels.estate.links).toEqual([])
  })

  it('workspace level carries lakehouse/notebook nodes and reads/writes links anchored on the lakehouse', () => {
    const ws = levels['ws:workspace.ws1']
    expect(ws.nodes).toEqual([
      { id: 'lakehouse.bronze', label: 'Bronze', c: 'bronze', r: 20, sub: '2 tables', drill: 'lake:lakehouse.bronze' },
      { id: 'lakehouse.silver', label: 'Silver', c: 'silver', r: 20, sub: '1 tables', drill: 'lake:lakehouse.silver' },
      { id: 'notebook.clean_orders', label: 'clean_orders', c: 'notebook', r: 11, sub: 'notebook' },
    ])
    expect(ws.links).toEqual([
      ['lakehouse.bronze', 'notebook.clean_orders', 'reads'],
      ['lakehouse.bronze', 'notebook.clean_orders', 'reads'],
      ['notebook.clean_orders', 'lakehouse.silver', 'writes'],
    ])
  })

  it('lakehouse level carries its own tables plus touching notebooks, keyed with a tbl: drill', () => {
    const bronze = levels['lake:lakehouse.bronze']
    expect(bronze.nodes).toEqual([
      { id: 'table.raw_orders', label: 'raw_orders', c: 'bronze', r: 13, sub: 'table · 2 cols', drill: 'tbl:raw_orders' },
      { id: 'table.customers', label: 'customers', c: 'bronze', r: 13, sub: 'table · 1 cols', drill: 'tbl:customers' },
      { id: 'notebook.clean_orders', label: 'clean_orders', c: 'notebook', r: 10, sub: 'notebook' },
    ])
    expect(bronze.links).toEqual([
      ['table.raw_orders', 'notebook.clean_orders', 'reads'],
      ['table.customers', 'notebook.clean_orders', 'reads'],
    ])

    const silver = levels['lake:lakehouse.silver']
    expect(silver.nodes).toEqual([
      { id: 'table.orders_clean', label: 'orders_clean', c: 'silver', r: 13, sub: 'table · 2 cols', drill: 'tbl:orders_clean' },
      { id: 'notebook.clean_orders', label: 'clean_orders', c: 'notebook', r: 10, sub: 'notebook' },
    ])
    expect(silver.links).toEqual([['notebook.clean_orders', 'table.orders_clean', 'writes']])
  })

  it('levelTable maps each tbl: key to its short table id', () => {
    expect(levelTable).toEqual({
      'tbl:raw_orders': 'raw_orders',
      'tbl:customers': 'customers',
      'tbl:orders_clean': 'orders_clean',
    })
  })
})
