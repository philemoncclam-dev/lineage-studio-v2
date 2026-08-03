import { describe, expect, it } from 'vitest'
import { diffHeadline, diffVersions } from '../versionDiff'
import type { LineageModel } from '../types'

const model = (over: Partial<LineageModel> = {}): LineageModel => ({
  id: 'm',
  name: 'm',
  createdAt: 0,
  updatedAt: 0,
  layers: [
    {
      id: 'L1',
      name: 'Raw',
      objects: [
        { id: 'o1', name: 'orders', children: [{ id: 'a1', name: 'id', children: [] }] },
      ],
    },
  ],
  transitions: [],
  properties: {},
  ...over,
})

describe('diffVersions', () => {
  it('is empty for two identical models', () => {
    const diff = diffVersions(model(), model())
    expect(diff.empty).toBe(true)
    expect(diffHeadline(diff)).toMatch(/Identical/)
  })

  it('reads a rename as a rename, not a delete plus an add', () => {
    // Matching by ID is the whole reason this is structural — a textual diff of
    // the JSON reports the single most common edit in the most confusing way.
    const after = model({
      layers: [
        {
          id: 'L1',
          name: 'Raw',
          objects: [
            { id: 'o1', name: 'orders_v2', children: [{ id: 'a1', name: 'id', children: [] }] },
          ],
        },
      ],
    })
    const diff = diffVersions(model(), after)
    expect(diff.renamed).toEqual([{ id: 'o1', name: 'orders_v2', was: 'orders', kind: 'object' }])
    expect(diff.added).toEqual([])
    expect(diff.removed).toEqual([])
  })

  it('counts what the newer side gained and lost', () => {
    const after = model({
      layers: [
        {
          id: 'L1',
          name: 'Raw',
          objects: [{ id: 'o2', name: 'items', children: [] }],
        },
      ],
    })
    const diff = diffVersions(model(), after)
    expect(diff.added.map((e) => e.id)).toEqual(['o2'])
    // Both the object and the attribute under it are gone.
    expect(diff.removed.map((e) => e.id).sort()).toEqual(['a1', 'o1'])
  })

  it('is directional — from is the snapshot, to is what you have now', () => {
    const richer = model({
      layers: [
        {
          id: 'L1',
          name: 'Raw',
          objects: [
            { id: 'o1', name: 'orders', children: [{ id: 'a1', name: 'id', children: [] }] },
            { id: 'o2', name: 'new_thing', children: [] },
          ],
        },
      ],
    })
    // Restoring the older snapshot would REMOVE o2, so it must read as "added
    // since" — the panel's whole warning depends on this direction.
    expect(diffVersions(model(), richer).added.map((e) => e.id)).toEqual(['o2'])
    expect(diffVersions(richer, model()).removed.map((e) => e.id)).toEqual(['o2'])
  })

  it('identifies a transition by its endpoints, not its own id', () => {
    const withEdge = (id: string) =>
      model({ transitions: [{ id, source: 'o1', target: 'a1' }] })
    // The same edge redrawn is not a change.
    expect(diffVersions(withEdge('t1'), withEdge('t2')).empty).toBe(true)
  })

  it('counts transitions each way', () => {
    const before = model({ transitions: [{ id: 't1', source: 'o1', target: 'a1' }] })
    const after = model({ transitions: [{ id: 't2', source: 'a1', target: 'o1' }] })
    const diff = diffVersions(before, after)
    expect(diff.transitionsAdded).toBe(1)
    expect(diff.transitionsRemoved).toBe(1)
  })

  it('summarises in one line', () => {
    const after = model({
      layers: [{ id: 'L1', name: 'Raw', objects: [{ id: 'o2', name: 'x', children: [] }] }],
    })
    expect(diffHeadline(diffVersions(model(), after))).toMatch(/1 added since/)
  })
})
