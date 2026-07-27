import { describe, expect, it } from 'vitest'
import { EMPTY_FILTER, type ViewFilter } from '../filter'
import { activeView, deleteView, listViews, sameFilter, saveView, toggleView } from '../views'
import type { LineageModel } from '../types'

function model(): LineageModel {
  return {
    id: 'm',
    name: 'm',
    createdAt: 0,
    updatedAt: 0,
    layers: [],
    transitions: [],
    properties: {},
  }
}

const gold: ViewFilter = { ...EMPTY_FILTER, tags: ['gold'], hide: true }

describe('saved views', () => {
  it('a model saved before views existed reads as having none', () => {
    expect(listViews(model())).toEqual([])
  })

  it('saves the current filter under a name', () => {
    const next = saveView(model(), '  Gold layer  ', gold)
    expect(listViews(next)).toHaveLength(1)
    expect(listViews(next)[0].name).toBe('Gold layer')
    expect(listViews(next)[0].filter.tags).toEqual(['gold'])
  })

  it('saving the same name again replaces rather than duplicates', () => {
    const once = saveView(model(), 'Gold layer', gold)
    const twice = saveView(once, 'gold layer', { ...gold, tags: ['gold', 'curated'] })
    expect(listViews(twice)).toHaveLength(1)
    expect(listViews(twice)[0].id).toBe(listViews(once)[0].id)
    expect(listViews(twice)[0].filter.tags).toEqual(['gold', 'curated'])
  })

  it('a blank name saves nothing', () => {
    const m = model()
    expect(saveView(m, '   ', gold)).toBe(m)
  })

  it('does not share array state with the live filter', () => {
    const live: ViewFilter = { ...EMPTY_FILTER, tags: ['gold'] }
    const next = saveView(model(), 'Gold', live)
    live.tags.push('mutated')
    expect(listViews(next)[0].filter.tags).toEqual(['gold'])
  })

  it('recognises the view it is in, whatever order the facets were picked in', () => {
    const saved = saveView(model(), 'Two tags', { ...EMPTY_FILTER, tags: ['a', 'b'] })
    expect(activeView(saved, { ...EMPTY_FILTER, tags: ['b', 'a'] })?.name).toBe('Two tags')
    expect(activeView(saved, { ...EMPTY_FILTER, tags: ['a'] })).toBeNull()
  })

  it('counts the dim/hide mode as part of the view', () => {
    expect(sameFilter(gold, { ...gold, hide: false })).toBe(false)
  })

  it('ignores a half-typed property row with no key', () => {
    const a: ViewFilter = { ...EMPTY_FILTER, name: 'x' }
    const b: ViewFilter = { ...EMPTY_FILTER, name: 'x', properties: [{ key: '', value: '' }] }
    expect(sameFilter(a, b)).toBe(true)
  })

  it('applying is a toggle — picking the view you are in clears the filter', () => {
    const saved = saveView(model(), 'Gold layer', gold)
    const id = listViews(saved)[0].id
    const applied = toggleView(saved, EMPTY_FILTER, id)
    expect(applied.tags).toEqual(['gold'])
    expect(toggleView(saved, applied, id)).toEqual(EMPTY_FILTER)
  })

  it('deletes by id', () => {
    const saved = saveView(model(), 'Gold layer', gold)
    expect(listViews(deleteView(saved, listViews(saved)[0].id))).toEqual([])
  })
})
