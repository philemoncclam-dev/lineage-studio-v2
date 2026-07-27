import { describe, expect, it } from 'vitest'
import { allTags, parseTags, setTags, tagsOf, TAGS_KEY } from '../tags'
import { emptyModel } from '../store'
import type { LineageModel } from '../types'

const withProps = (properties: LineageModel['properties']): LineageModel => ({
  ...emptyModel('M'),
  properties,
})

describe('parseTags', () => {
  it('splits, trims, dedupes case-insensitively and sorts', () => {
    expect(parseTags('Notebook, gold ,notebook,  Table')).toEqual(['gold', 'Notebook', 'Table'])
  })
  it('treats absent and empty as no tags', () => {
    expect(parseTags(undefined)).toEqual([])
    expect(parseTags('')).toEqual([])
    expect(parseTags(' , ')).toEqual([])
  })
})

describe('setTags', () => {
  it('writes a comma-separated list readable by tagsOf', () => {
    const next = setTags(emptyModel('M'), ['a1'], ['Gold', 'Notebook'])
    expect(next.properties.a1[TAGS_KEY]).toBe('Gold, Notebook')
    expect(tagsOf(next, 'a1')).toEqual(['Gold', 'Notebook'])
  })

  it('replaces rather than merges', () => {
    const model = withProps({ a1: { [TAGS_KEY]: 'Old' } })
    expect(tagsOf(setTags(model, ['a1'], ['New']), 'a1')).toEqual(['New'])
  })

  it('preserves other properties on the same entity', () => {
    const model = withProps({ a1: { Classification: 'PII' } })
    const next = setTags(model, ['a1'], ['Gold'])
    expect(next.properties.a1).toEqual({ Classification: 'PII', [TAGS_KEY]: 'Gold' })
  })

  it('clears the key entirely when given no tags, rather than storing ""', () => {
    const model = withProps({ a1: { [TAGS_KEY]: 'Gold', Classification: 'PII' } })
    const next = setTags(model, ['a1'], [])
    expect(next.properties.a1).toEqual({ Classification: 'PII' })
  })

  it('drops the whole bag when tags were the only property', () => {
    const model = withProps({ a1: { [TAGS_KEY]: 'Gold' } })
    expect(setTags(model, ['a1'], []).properties.a1).toBeUndefined()
  })

  it('tags many entities at once and does not mutate the input', () => {
    const model = withProps({ a1: { [TAGS_KEY]: 'Old' } })
    const next = setTags(model, ['a1', 'a2', 'a3'], ['Reviewed'])
    expect(['a1', 'a2', 'a3'].map((id) => tagsOf(next, id))).toEqual([
      ['Reviewed'],
      ['Reviewed'],
      ['Reviewed'],
    ])
    expect(model.properties.a1[TAGS_KEY]).toBe('Old')
  })
})

describe('allTags', () => {
  it('collects every tag in the model once', () => {
    const model = withProps({
      a1: { [TAGS_KEY]: 'Notebook, gold' },
      a2: { [TAGS_KEY]: 'Gold, Table' },
      a3: { Classification: 'PII' },
    })
    expect(allTags(model)).toEqual(['gold', 'Notebook', 'Table'])
  })
})
