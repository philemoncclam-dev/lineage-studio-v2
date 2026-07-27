import { describe, expect, it } from 'vitest'
import {
  addTagTo,
  deleteTag,
  entitiesWithTag,
  liveIds,
  renameTag,
  tagCounts,
  tagsOf,
} from '../tags'
import type { LineageModel } from '../types'

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
          { id: 'O1', name: 'a', children: [{ id: 'A1', name: 'c', children: [] }] },
          { id: 'O2', name: 'b', children: [] },
        ],
      },
    ],
    transitions: [],
    properties: {
      O1: { Tags: 'Table, Gold' },
      O2: { Tags: 'table' },
      A1: { Tags: 'Gold', 'Data type': 'int' },
      // A bag left behind by a deleted entity — must not be counted.
      GHOST: { Tags: 'Table' },
    },
  }
}

describe('tagCounts', () => {
  it('counts live entities only, ignoring bags of deleted ones', () => {
    const counts = tagCounts(model())
    // O1 and O2 carry Table/table; the GHOST bag has no entity and is skipped.
    expect(counts.get('Table')).toBe(1)
    expect(counts.get('table')).toBe(1)
    expect(counts.get('Gold')).toBe(2)
  })
})

describe('entitiesWithTag', () => {
  it('matches case-insensitively', () => {
    expect(entitiesWithTag(model(), 'TABLE').sort()).toEqual(['O1', 'O2'])
  })
  it('never returns an id that is not in the hierarchy', () => {
    const live = new Set(liveIds(model()))
    expect(entitiesWithTag(model(), 'Table').every((id) => live.has(id))).toBe(true)
  })
})

describe('renameTag', () => {
  it('renames everywhere the tag appears, case-insensitively', () => {
    const next = renameTag(model(), 'table', 'Dataset')
    expect(tagsOf(next, 'O1')).toContain('Dataset')
    expect(tagsOf(next, 'O2')).toEqual(['Dataset'])
    expect(tagsOf(next, 'O1')).not.toContain('Table')
  })

  it('renaming onto an existing tag merges rather than duplicating', () => {
    const next = renameTag(model(), 'Gold', 'Table')
    // O1 held both Table and Gold; it must end up with one Table, not two.
    expect(tagsOf(next, 'O1').filter((t) => t.toLowerCase() === 'table')).toHaveLength(1)
  })

  it('is a no-op for a blank target or a rename to itself', () => {
    const m = model()
    expect(renameTag(m, 'Gold', '   ')).toBe(m)
    expect(renameTag(m, 'Gold', 'Gold')).toBe(m)
  })
})

describe('deleteTag', () => {
  it('removes the tag but leaves the entity and its other properties', () => {
    const next = deleteTag(model(), 'Gold')
    expect(tagsOf(next, 'O1')).toEqual(['Table'])
    expect(tagsOf(next, 'A1')).toEqual([])
    // The non-tag property survives losing the tag key.
    expect(next.properties.A1?.['Data type']).toBe('int')
  })
})

describe('addTagTo', () => {
  it('adds without clobbering what an entity already carries', () => {
    const next = addTagTo(model(), ['O1', 'O2'], 'Certified')
    expect(tagsOf(next, 'O1')).toContain('Table')
    expect(tagsOf(next, 'O1')).toContain('Certified')
    expect(tagsOf(next, 'O2')).toContain('Certified')
  })
  it('ignores a blank tag', () => {
    const m = model()
    expect(addTagTo(m, ['O1'], '  ')).toBe(m)
  })
})
