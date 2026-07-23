import { describe, expect, it } from 'vitest'
import type { NB, Table } from '../../data'
import { buildDagreLayout, nodeHeight } from './useDagreLayout'

function fixtureTable(id: string, name: string, columnCount: number): Table {
  return {
    id,
    name,
    layer: 'bronze',
    c: 'bronze',
    x: 0,
    y: 0,
    columns: Array.from({ length: columnCount }, (_, i) => ({ key: `${id}.col${i}`, name: `col${i}`, type: 'string' })),
  }
}

function fixtureNotebook(id: string, name: string): NB {
  return { id, name, x: 0, y: 0 }
}

const rawOrders = fixtureTable('raw_orders', 'raw_orders', 4)
const cleanOrders = fixtureTable('clean_orders', 'clean_orders', 4)
const nb = fixtureNotebook('nb', 'clean_orders_nb')
const ops: [string, string, 'reads' | 'writes'][] = [
  ['raw_orders', 'nb', 'reads'],
  ['nb', 'clean_orders', 'writes'],
]

describe('nodeHeight', () => {
  it('is 40 for table mode regardless of column count', () => {
    expect(nodeHeight('table', 4)).toBe(40)
  })

  it('is 40 + columnCount*28 for column mode, capped at 10 rows', () => {
    expect(nodeHeight('column', 4)).toBe(40 + 4 * 28)
    expect(nodeHeight('column', 20)).toBe(320)
  })

  it('is 40 for a zero-column table in column mode (collapsed, never broken)', () => {
    expect(nodeHeight('column', 0)).toBe(40)
  })
})

describe('buildDagreLayout', () => {
  it('lays out left-to-right: a downstream table x is strictly greater than its upstream table x', () => {
    const positions = buildDagreLayout([rawOrders, cleanOrders], [nb], ops, 'column')
    const rawX = positions.get('raw_orders')!.x
    const cleanX = positions.get('clean_orders')!.x
    expect(cleanX).toBeGreaterThan(rawX)
  })

  it('returns one position per table + notebook, each with an {x, y}', () => {
    const positions = buildDagreLayout([rawOrders, cleanOrders], [nb], ops, 'column')
    expect(positions.size).toBe(2 + 1)
    for (const id of ['raw_orders', 'clean_orders', 'nb']) {
      const pos = positions.get(id)
      expect(pos).toBeDefined()
      expect(typeof pos!.x).toBe('number')
      expect(typeof pos!.y).toBe('number')
    }
  })

  it('is deterministic: calling twice with the same (graph, mode) returns byte-identical positions', () => {
    const first = buildDagreLayout([rawOrders, cleanOrders], [nb], ops, 'column')
    const second = buildDagreLayout([rawOrders, cleanOrders], [nb], ops, 'column')
    expect(Object.fromEntries(second)).toEqual(Object.fromEntries(first))
  })
})
