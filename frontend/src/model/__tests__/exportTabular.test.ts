import { describe, expect, it } from 'vitest'
import {
  DEFAULT_EXPORT_OPTIONS,
  propertyNames,
  slugify,
  toCsv,
  toRows,
} from '../exportTabular'
import { planImport, parseCsv } from '../importTabular'
import { buildIndex, countEntities } from '../index'
import { sampleModel } from '../sample'
import { emptyModel } from '../store'

describe('toRows', () => {
  it('emits a header whose structural columns match the Full importer', () => {
    const [header] = toRows(sampleModel(), DEFAULT_EXPORT_OPTIONS)
    expect(header.slice(0, 6)).toEqual(['ID', 'TYPE', 'PARENT', 'NAME', 'SOURCE', 'TARGET'])
    expect(header).toContain('PROPERTIES:')
  })

  it('writes one row per entity plus one per transition', () => {
    const model = sampleModel()
    const rows = toRows(model, DEFAULT_EXPORT_OPTIONS)
    expect(rows.length - 1).toBe(countEntities(model) + model.transitions.length)
  })

  it('honours the include options', () => {
    const model = sampleModel()
    const rows = toRows(model, {
      ...DEFAULT_EXPORT_OPTIONS,
      includeTransitions: false,
      includeAttributes: false,
    })
    expect(rows.some((r) => r[1] === 'Transition')).toBe(false)
    expect(rows.some((r) => r[1] === 'Attribute')).toBe(false)
    expect(rows.some((r) => r[1] === 'Layer')).toBe(true)
  })

  it('drops transitions whose endpoints were excluded', () => {
    const model = sampleModel()
    const rows = toRows(model, { ...DEFAULT_EXPORT_OPTIONS, includeAttributes: false })
    // Every sample transition is attribute-to-attribute, so none can survive.
    expect(rows.some((r) => r[1] === 'Transition')).toBe(false)
  })

  it('labels an attribute with children as Group', () => {
    const rows = toRows(sampleModel(), DEFAULT_EXPORT_OPTIONS)
    const applicant = rows.find((r) => r[3] === 'Applicant')!
    expect(applicant[1]).toBe('Group')
  })
})

describe('toCsv', () => {
  it('quotes values containing a comma, quote, or newline', () => {
    expect(toCsv([['plain', 'a,b', 'say "hi"', 'two\nlines']])).toBe(
      'plain,"a,b","say ""hi""","two\nlines"'
    )
  })
})

describe('propertyNames', () => {
  it('collects every property name in sorted order', () => {
    expect(propertyNames(sampleModel())).toEqual(['CDE', 'Classification'])
  })
})

describe('slugify', () => {
  it('makes a filename-safe slug', () => {
    expect(slugify('Consumer Mortgages')).toBe('consumer-mortgages')
    expect(slugify('  //  ')).toBe('model')
  })
})

// The round trip is the reason the Default column set exists at all.
describe('export -> import round trip', () => {
  it('reimports its own export without duplicating anything', () => {
    const model = sampleModel()
    const csv = toCsv(toRows(model, DEFAULT_EXPORT_OPTIONS))
    const preview = planImport(model, parseCsv(csv))

    expect(preview.added).toMatchObject({
      layers: 0,
      objects: 0,
      attributes: 0,
      transitions: 0,
    })
    expect(countEntities(preview.model)).toBe(countEntities(model))
  })

  it('rebuilds an equivalent model when imported into an empty one', () => {
    const model = sampleModel()
    const csv = toCsv(toRows(model, DEFAULT_EXPORT_OPTIONS))
    const rebuilt = planImport(emptyModel('fresh'), parseCsv(csv)).model

    expect(countEntities(rebuilt)).toBe(countEntities(model))
    expect(rebuilt.transitions).toHaveLength(model.transitions.length)

    const before = buildIndex(model)
    const after = buildIndex(rebuilt)
    const nameOf = (i: typeof before) =>
      [...i.entries.values()].map((e) => `${e.kind}:${e.name}`).sort()
    expect(nameOf(after)).toEqual(nameOf(before))
  })
})
