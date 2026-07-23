import { describe, expect, it } from 'vitest'
import type { NB, Table } from '../../data'
import { colSourceHandle, colTargetHandle, NODE_SOURCE_HANDLE, NODE_TARGET_HANDLE } from './types'
import { NOTEBOOK_NODE_TYPE, TABLE_NODE_TYPE, toXyflow } from './toXyflow'

const rawOrders: Table = {
  id: 'raw',
  name: 'raw_orders',
  layer: 'bronze',
  c: 'bronze',
  x: 0,
  y: 0,
  columns: [{ key: 'raw.order_id', name: 'order_id', type: 'long' }],
}
const cleanOrders: Table = {
  id: 'clean',
  name: 'clean_orders',
  layer: 'silver',
  c: 'silver',
  x: 0,
  y: 0,
  columns: [{ key: 'clean.order_id', name: 'order_id', type: 'long' }],
}
const nb: NB = { id: 'nb', name: 'clean_orders_nb', x: 0, y: 0 }

const colEdges: [string, string][] = [['raw.order_id', 'clean.order_id']]
const ops: [string, string, 'reads' | 'writes'][] = [
  ['raw', 'nb', 'reads'],
  ['nb', 'clean', 'writes'],
]
const positions = new Map([
  ['raw', { x: 0, y: 0 }],
  ['clean', { x: 300, y: 0 }],
  ['nb', { x: 150, y: 0 }],
])

describe('toXyflow', () => {
  it('resolves column edges to per-row handle ids in Column mode', () => {
    const { edges } = toXyflow([rawOrders, cleanOrders], [nb], colEdges, [], positions, 'column')
    const colEdge = edges.find((e) => e.data.from === 'raw.order_id')!
    expect(colEdge.sourceHandle).toBe(colSourceHandle('raw.order_id'))
    expect(colEdge.targetHandle).toBe(colTargetHandle('clean.order_id'))
    expect(colEdge.source).toBe('raw')
    expect(colEdge.target).toBe('clean')
  })

  it('resolves the same column edge to the __node__* fallback pair in Table mode', () => {
    const { edges } = toXyflow([rawOrders, cleanOrders], [nb], colEdges, [], positions, 'table')
    const colEdge = edges.find((e) => e.data.from === 'raw.order_id')!
    expect(colEdge.sourceHandle).toBe(NODE_SOURCE_HANDLE)
    expect(colEdge.targetHandle).toBe(NODE_TARGET_HANDLE)
    expect(colEdge.source).toBe('raw')
    expect(colEdge.target).toBe('clean')
  })

  it('always uses the __node__* fallback pair for object-level ops edges, in either mode', () => {
    for (const mode of ['column', 'table'] as const) {
      const { edges } = toXyflow([rawOrders, cleanOrders], [nb], [], ops, positions, mode)
      for (const e of edges) {
        expect(e.sourceHandle).toBe(NODE_SOURCE_HANDLE)
        expect(e.targetHandle).toBe(NODE_TARGET_HANDLE)
      }
    }
  })

  it('marks every emitted edge as inferred provenance (D-09)', () => {
    const { edges } = toXyflow([rawOrders, cleanOrders], [nb], colEdges, ops, positions, 'column')
    expect(edges.length).toBeGreaterThan(0)
    for (const e of edges) {
      expect(e.data.provenance).toBe('inferred')
    }
  })

  it('emits table/notebook nodes with the correct type, mode, and dagre position', () => {
    const { nodes } = toXyflow([rawOrders, cleanOrders], [nb], colEdges, ops, positions, 'column')
    const rawNode = nodes.find((n) => n.id === 'raw')!
    expect(rawNode.type).toBe(TABLE_NODE_TYPE)
    expect(rawNode.data).toMatchObject({ mode: 'column' })
    expect(rawNode.position).toEqual({ x: 0, y: 0 })

    const nbNode = nodes.find((n) => n.id === 'nb')!
    expect(nbNode.type).toBe(NOTEBOOK_NODE_TYPE)
    expect(nbNode.position).toEqual({ x: 150, y: 0 })
  })
})
