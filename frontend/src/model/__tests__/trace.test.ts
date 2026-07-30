import { describe, expect, it } from 'vitest'
import { buildIndex } from '../index'
import { traceFrom } from '../trace'
import type { LineageModel } from '../types'

/**
 * Three layers, two chains that never meet:
 *
 *   raw.id     -> nb.raw.id     -> silver.id     -> gold.id
 *   raw.amount -> nb.raw.amount -> silver.total
 *   junk.x     -> (nothing)
 *
 * The `junk` object is the control: nothing may reach it, or "only related"
 * means nothing.
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
            id: 'raw',
            name: 'raw_orders',
            children: [
              { id: 'raw.id', name: 'id', children: [] },
              { id: 'raw.amount', name: 'amount', children: [] },
            ],
          },
          { id: 'junk', name: 'unrelated', children: [{ id: 'junk.x', name: 'x', children: [] }] },
        ],
      },
      {
        id: 'L2',
        name: 'Notebooks',
        objects: [
          {
            id: 'nb',
            name: 'enrich',
            children: [
              {
                id: 'nb.raw',
                name: 'raw_orders',
                children: [
                  { id: 'nb.raw.id', name: 'id', children: [] },
                  { id: 'nb.raw.amount', name: 'amount', children: [] },
                ],
              },
            ],
          },
        ],
      },
      {
        id: 'L3',
        name: 'Curated',
        objects: [
          {
            id: 'silver',
            name: 'silver_orders',
            children: [
              { id: 'silver.id', name: 'id', children: [] },
              { id: 'silver.total', name: 'total', children: [] },
            ],
          },
          { id: 'gold', name: 'gold_orders', children: [{ id: 'gold.id', name: 'id', children: [] }] },
        ],
      },
    ],
    transitions: [
      { id: 't1', source: 'raw.id', target: 'nb.raw.id' },
      { id: 't2', source: 'raw.amount', target: 'nb.raw.amount' },
      { id: 't3', source: 'nb.raw.id', target: 'silver.id' },
      { id: 't4', source: 'nb.raw.amount', target: 'silver.total' },
      { id: 't5', source: 'silver.id', target: 'gold.id' },
    ],
    properties: {},
    views: [],
  }
}

const trace = (seeds: string[]) => traceFrom(buildIndex(model()), seeds)

describe('traceFrom', () => {
  it('walks upstream and downstream from an attribute', () => {
    const out = trace(['silver.id'])
    // Upstream to the source, downstream to gold — "leads to that OR goes
    // through that" is both halves of the question.
    expect(out.has('raw.id')).toBe(true)
    expect(out.has('nb.raw.id')).toBe(true)
    expect(out.has('gold.id')).toBe(true)
  })

  it('leaves the unrelated chain out', () => {
    const out = trace(['silver.id'])
    expect(out.has('junk')).toBe(false)
    expect(out.has('junk.x')).toBe(false)
    // The sibling column is a different chain and must not come along.
    expect(out.has('raw.amount')).toBe(false)
    expect(out.has('silver.total')).toBe(false)
  })

  it('keeps the containers so a traced row has a card to sit in', () => {
    const out = trace(['silver.id'])
    for (const id of ['raw', 'L1', 'nb', 'nb.raw', 'L2', 'silver', 'L3', 'gold'])
      expect(out.has(id), `missing container ${id}`).toBe(true)
  })

  it('traces a whole table from the object, via its columns', () => {
    // A table's transitions hang off its COLUMNS — the object itself has no
    // edge at all here. Seeding only what was clicked would trace it to nothing.
    const out = trace(['raw'])
    expect(out.has('silver.id')).toBe(true)
    expect(out.has('silver.total')).toBe(true)
    expect(out.has('gold.id')).toBe(true)
    expect(out.has('junk.x')).toBe(false)
  })

  it('does not drag in the whole schema of a table it merely reaches', () => {
    // silver is reached through `silver.id`; `silver.total` belongs to the other
    // chain and stays out. Descending applies to the seeds only — otherwise a
    // trace returns most of the model, which is the one answer it must not give.
    const out = trace(['raw.id'])
    expect(out.has('silver')).toBe(true)
    expect(out.has('silver.total')).toBe(false)
  })

  it('unions several seeds', () => {
    const out = trace(['raw.id', 'raw.amount'])
    expect(out.has('gold.id')).toBe(true)
    expect(out.has('silver.total')).toBe(true)
    expect(out.has('junk.x')).toBe(false)
  })

  it('returns nothing for no seeds, and ignores ids not in the model', () => {
    expect(traceFrom(buildIndex(model()), []).size).toBe(0)
    expect(traceFrom(buildIndex(model()), ['nope']).size).toBe(0)
  })
})
