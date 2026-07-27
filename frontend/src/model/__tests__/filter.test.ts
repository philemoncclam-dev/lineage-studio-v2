import { describe, expect, it } from 'vitest'
import {
  activeFilterCount,
  applyFilter,
  EMPTY_FILTER,
  isEmptyFilter,
  visibleTransitions,
} from '../filter'
import type { LineageModel } from '../types'

/**
 * Raw -> Curated. `orders` in Curated has a Read row and a Write row, so the
 * Access facet has something to bite on at attribute level.
 */
function model(): LineageModel {
  return {
    id: 'm',
    name: 'm',
    createdAt: 0,
    updatedAt: 0,
    layers: [
      {
        id: 'L1',
        name: 'Raw',
        objects: [
          {
            id: 'O1',
            name: 'raw_orders',
            children: [
              { id: 'A1', name: 'id', children: [] },
              { id: 'A2', name: 'amount', children: [] },
            ],
          },
        ],
      },
      {
        id: 'L2',
        name: 'Curated',
        objects: [
          {
            id: 'O2',
            name: 'orders',
            children: [
              { id: 'A3', name: 'raw_orders', children: [] },
              { id: 'A4', name: 'gold_orders', children: [] },
            ],
          },
        ],
      },
    ],
    transitions: [],
    properties: {
      O1: { Tags: 'Table', Source: 'Fabric sandbox' },
      O2: { Tags: 'Notebook', Source: 'Fabric sandbox' },
      A3: { Access: 'Read' },
      A4: { Access: 'Write' },
      A2: { 'Data type': 'double' },
    },
  }
}

describe('isEmptyFilter', () => {
  it('is empty by default, and hide alone does not narrow', () => {
    expect(isEmptyFilter(EMPTY_FILTER)).toBe(true)
    expect(isEmptyFilter({ ...EMPTY_FILTER, hide: true })).toBe(true)
  })
  it('a blank property key does not count as a term', () => {
    expect(isEmptyFilter({ ...EMPTY_FILTER, properties: [{ key: '  ', value: 'x' }] })).toBe(true)
    expect(activeFilterCount({ ...EMPTY_FILTER, properties: [{ key: 'Source', value: '' }] })).toBe(1)
  })
})

describe('applyFilter', () => {
  it('matches nothing when no term is set, so the canvas stays undimmed', () => {
    expect(applyFilter(model(), EMPTY_FILTER).size).toBe(0)
  })

  it('matches on name, case-insensitively', () => {
    const hits = applyFilter(model(), { ...EMPTY_FILTER, name: 'AMOUNT' })
    expect(hits.has('A2')).toBe(true)
    expect(hits.has('A1')).toBe(false)
  })

  it('keeps the ancestors of a match so it is not orphaned', () => {
    const hits = applyFilter(model(), { ...EMPTY_FILTER, name: 'amount' })
    // The column matched; its object and layer come along as containers.
    expect(hits.has('O1')).toBe(true)
    expect(hits.has('L1')).toBe(true)
    // But a matching object does NOT drag its own columns in.
    const objectHit = applyFilter(model(), { ...EMPTY_FILTER, name: 'raw_orders' })
    expect(objectHit.has('O1')).toBe(true)
    expect(objectHit.has('A1')).toBe(false)
  })

  it('filters on Access, which is a property and not a tag', () => {
    const reads = applyFilter(model(), { ...EMPTY_FILTER, access: ['Read'] })
    expect(reads.has('A3')).toBe(true)
    expect(reads.has('A4')).toBe(false)
    // Entities with no Access at all are not reads.
    expect(reads.has('A1')).toBe(false)
  })

  it('ORs within tags and ANDs across fields', () => {
    const either = applyFilter(model(), { ...EMPTY_FILTER, tags: ['Table', 'Notebook'] })
    expect(either.has('O1')).toBe(true)
    expect(either.has('O2')).toBe(true)

    // Adding a name can only narrow, never widen.
    const narrowed = applyFilter(model(), {
      ...EMPTY_FILTER,
      tags: ['Table', 'Notebook'],
      name: 'raw',
    })
    expect(narrowed.has('O1')).toBe(true)
    expect(narrowed.has('O2')).toBe(false)
  })

  it('filters by kind', () => {
    const layersOnly = applyFilter(model(), { ...EMPTY_FILTER, kinds: ['layer'] })
    expect([...layersOnly].sort()).toEqual(['L1', 'L2'])
  })

  it('a property key with no value means "carries this property at all"', () => {
    const any = applyFilter(model(), { ...EMPTY_FILTER, properties: [{ key: 'Data type', value: '' }] })
    expect(any.has('A2')).toBe(true)
    expect(any.has('A1')).toBe(false)

    const specific = applyFilter(model(), {
      ...EMPTY_FILTER,
      properties: [{ key: 'Data type', value: 'int' }],
    })
    expect(specific.has('A2')).toBe(false)
  })
})

describe('visibleTransitions', () => {
  const edges = [
    { id: 'T1', source: 'A1', target: 'A3' },
    { id: 'T2', source: 'A2', target: 'A4' },
  ]
  const matched = new Set(['A1', 'A3'])

  it('keeps every edge when no filter is running', () => {
    expect(visibleTransitions(edges, new Set(), false, true)).toBe(edges)
  })

  it('keeps every edge in dim mode — the renderer fades them instead', () => {
    expect(visibleTransitions(edges, matched, true, false)).toBe(edges)
  })

  it('drops an edge in hide mode when EITHER endpoint is hidden', () => {
    // T2's rows are not painted in hide mode, so drawing T2 would leave a line
    // hanging off a row that is not on screen.
    expect(visibleTransitions(edges, matched, true, true).map((t) => t.id)).toEqual(['T1'])
  })
})
