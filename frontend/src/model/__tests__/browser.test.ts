import { describe, expect, it } from 'vitest'
import {
  EMPTY_FILTER,
  filterModels,
  isFilterActive,
  modelsToCsv,
  parseSolBundle,
  prepareImport,
  sortModels,
  tagCounts,
  toSolBundle,
  type BrowserFilter,
} from '../browser'
import type { LineageModel, ModelSummary } from '../types'

function summary(over: Partial<ModelSummary> & { id: string; name: string }): ModelSummary {
  return {
    createdAt: 0,
    updatedAt: 0,
    lastViewedAt: 0,
    layerCount: 0,
    entityCount: 0,
    transitionCount: 0,
    description: '',
    tags: [],
    starred: false,
    ...over,
  }
}

const filter = (over: Partial<BrowserFilter>): BrowserFilter => ({ ...EMPTY_FILTER, ...over })

describe('filterModels', () => {
  const models = [
    summary({ id: '1', name: 'Mortgage lineage', tags: ['Logical', 'Demo'] }),
    summary({ id: '2', name: 'Fork of mortgage', tags: ['Demo'], starred: true }),
    summary({ id: '3', name: 'Payments', description: 'card fork', tags: ['Physical'] }),
  ]

  it('returns everything for an empty filter', () => {
    expect(filterModels(models, EMPTY_FILTER)).toHaveLength(3)
  })

  it('matches search against name, description and tags', () => {
    expect(filterModels(models, filter({ search: 'fork' })).map((m) => m.id)).toEqual(['2', '3'])
    expect(filterModels(models, filter({ search: 'logical' })).map((m) => m.id)).toEqual(['1'])
  })

  it('is case-insensitive', () => {
    expect(filterModels(models, filter({ search: 'MORTGAGE' })).map((m) => m.id)).toEqual(['1', '2'])
  })

  it('ORs within the tag facet', () => {
    expect(filterModels(models, filter({ tags: ['Logical', 'Physical'] })).map((m) => m.id)).toEqual(
      ['1', '3'],
    )
  })

  it('ANDs the tag facet with search and starred', () => {
    const result = filterModels(models, filter({ tags: ['Demo'], starredOnly: true }))
    expect(result.map((m) => m.id)).toEqual(['2'])
  })

  it('matches tags case-insensitively', () => {
    expect(filterModels(models, filter({ tags: ['demo'] })).map((m) => m.id)).toEqual(['1', '2'])
  })

  it('knows when a filter is active', () => {
    expect(isFilterActive(EMPTY_FILTER)).toBe(false)
    expect(isFilterActive(filter({ search: '   ' }))).toBe(false)
    expect(isFilterActive(filter({ starredOnly: true }))).toBe(true)
    expect(isFilterActive(filter({ tags: ['a'] }))).toBe(true)
  })
})

describe('sortModels', () => {
  const models = [
    summary({ id: 'b', name: 'Beta', createdAt: 3, updatedAt: 1, lastViewedAt: 2 }),
    summary({ id: 'a', name: 'Alpha', createdAt: 1, updatedAt: 3, lastViewedAt: 2 }),
    summary({ id: 'c', name: 'Gamma', createdAt: 2, updatedAt: 2, lastViewedAt: 1 }),
  ]

  it('sorts by each key, newest first', () => {
    expect(sortModels(models, 'created').map((m) => m.id)).toEqual(['b', 'c', 'a'])
    expect(sortModels(models, 'modified').map((m) => m.id)).toEqual(['a', 'c', 'b'])
    expect(sortModels(models, 'name').map((m) => m.id)).toEqual(['a', 'b', 'c'])
  })

  it('breaks ties on name so the order is stable', () => {
    // a and b both have lastViewedAt 2; Alpha must come first regardless of input order.
    expect(sortModels(models, 'viewed').map((m) => m.id)).toEqual(['a', 'b', 'c'])
  })

  it('does not mutate its input', () => {
    const before = models.map((m) => m.id)
    sortModels(models, 'name')
    expect(models.map((m) => m.id)).toEqual(before)
  })
})

describe('tagCounts', () => {
  it('counts across all models, most used first', () => {
    const counts = tagCounts([
      summary({ id: '1', name: 'a', tags: ['Demo', 'Logical'] }),
      summary({ id: '2', name: 'b', tags: ['Demo'] }),
      summary({ id: '3', name: 'c', tags: ['demo'] }),
    ])
    expect(counts).toEqual([
      { tag: 'Demo', count: 3 },
      { tag: 'Logical', count: 1 },
    ])
  })

  it('is empty when nothing is tagged', () => {
    expect(tagCounts([summary({ id: '1', name: 'a' })])).toEqual([])
  })
})

describe('modelsToCsv', () => {
  it('writes a header plus one row per model', () => {
    const csv = modelsToCsv([summary({ id: '1', name: 'Mortgage', tags: ['a', 'b'] })])
    const lines = csv.split('\r\n')
    expect(lines).toHaveLength(2)
    expect(lines[0]).toContain('"Model ID","Name"')
    expect(lines[1]).toContain('"a; b"')
  })

  it('escapes embedded quotes', () => {
    const csv = modelsToCsv([summary({ id: '1', name: 'The "real" one' })])
    expect(csv).toContain('"The ""real"" one"')
  })

  it('emits a header-only file for an empty list', () => {
    expect(modelsToCsv([]).split('\r\n')).toHaveLength(1)
  })
})

describe('the SOL bundle', () => {
  const model = (over: Partial<LineageModel> = {}): LineageModel => ({
    id: 'm1',
    name: 'Mortgage',
    createdAt: 5,
    updatedAt: 5,
    layers: [],
    transitions: [],
    properties: {},
    ...over,
  })

  it('round-trips through the envelope', () => {
    const text = JSON.stringify(toSolBundle([model(), model({ id: 'm2', name: 'Payments' })]))
    expect(parseSolBundle(text).map((m) => m.name)).toEqual(['Mortgage', 'Payments'])
  })

  it('accepts a bare model, as the Model Viewer’s JSON export produces', () => {
    expect(parseSolBundle(JSON.stringify(model()))).toHaveLength(1)
  })

  it('accepts a bare array of models', () => {
    expect(parseSolBundle(JSON.stringify([model()]))).toHaveLength(1)
  })

  it('rejects invalid JSON and model-free files with readable messages', () => {
    expect(() => parseSolBundle('{nope')).toThrow(/valid JSON/)
    expect(() => parseSolBundle('{"models":[]}')).toThrow(/No models/)
    expect(() => parseSolBundle('{"hello":"world"}')).toThrow(/No models/)
  })

  it('gives imports fresh ids so a re-import cannot overwrite the original', () => {
    const source = model()
    const [imported] = prepareImport([source], 99)
    expect(imported.id).not.toBe(source.id)
    expect(imported.name).toBe('Mortgage')
    expect(imported.updatedAt).toBe(99)
    // The original's creation date is history, and is preserved.
    expect(imported.createdAt).toBe(5)
  })
})
