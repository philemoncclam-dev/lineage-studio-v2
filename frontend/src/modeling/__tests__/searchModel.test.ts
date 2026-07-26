import { describe, expect, it } from 'vitest'
import { buildIndex } from '../../model/index'
import { sampleModel } from '../../model/sample'
import { highlightParts, searchModel } from '../searchModel'

const index = buildIndex(sampleModel())

describe('searchModel', () => {
  it('returns nothing for an empty or whitespace query', () => {
    expect(searchModel(index, '')).toEqual([])
    expect(searchModel(index, '   ')).toEqual([])
  })

  it('groups every entity sharing a name into one hit', () => {
    // `postalcode` exists in the source object and in the mapping output.
    const hit = searchModel(index, 'postalcode').find((h) => h.name === 'postalcode')
    expect(hit).toBeDefined()
    expect(hit!.ids.length).toBeGreaterThan(1)
    expect(new Set(hit!.ids).size).toBe(hit!.ids.length)
  })

  it('matches case-insensitively but keeps the original name', () => {
    const hits = searchModel(index, 'APPLICANT')
    expect(hits.some((h) => h.name === 'Applicant')).toBe(true)
  })

  it('ranks exact over prefix over substring', () => {
    const hits = searchModel(index, 'name')
    // `name` (exact) must come before `m_customer_name` (substring).
    const exactAt = hits.findIndex((h) => h.name === 'name')
    const substringAt = hits.findIndex((h) => h.name === 'm_customer_name')
    expect(exactAt).toBeGreaterThanOrEqual(0)
    expect(substringAt).toBeGreaterThan(exactAt)
  })

  it('finds layers and objects, not just attributes', () => {
    expect(searchModel(index, 'Origination').some((h) => h.kind === 'layer')).toBe(true)
    expect(searchModel(index, 'Mappings').some((h) => h.kind === 'object')).toBe(true)
  })

  it('separates identical names of different kinds', () => {
    const hits = searchModel(index, 'tft_applicant')
    // It is an attribute in several layers — one group, several ids.
    expect(hits).toHaveLength(1)
    expect(hits[0].kind).toBe('attribute')
    expect(hits[0].ids.length).toBeGreaterThan(1)
  })

  it('honours the limit as a cap on groups', () => {
    expect(searchModel(index, 'a', 3)).toHaveLength(3)
  })

  it('returns an empty list when nothing matches', () => {
    expect(searchModel(index, 'zzzz-no-such-thing')).toEqual([])
  })
})

describe('highlightParts', () => {
  it('splits around the match', () => {
    expect(highlightParts('m_customer_name', 'customer')).toEqual(['m_', 'customer', '_name'])
  })

  it('is case-insensitive but preserves the original casing', () => {
    expect(highlightParts('Applicant', 'app')).toEqual(['', 'App', 'licant'])
  })

  it('degrades to the whole name when there is no match', () => {
    expect(highlightParts('abc', 'zzz')).toEqual(['abc', '', ''])
    expect(highlightParts('abc', '')).toEqual(['abc', '', ''])
  })
})
