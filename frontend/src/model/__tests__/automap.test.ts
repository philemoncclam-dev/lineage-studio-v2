import { describe, expect, it } from 'vitest'
import {
  applySuggestions,
  defaultConfig,
  generateSuggestions,
  groupSuggestions,
  similarity,
  type AutoMapConfig,
} from '../automap'
import type { Attribute, LineageModel } from '../types'

const attr = (id: string, name: string, children: Attribute[] = []): Attribute => ({
  id,
  name,
  children,
})

/**
 * Two layers, each holding one object that describes the same customer. The
 * single object-to-object transition is what puts everything in scope when
 * both ends are set to Auto.
 */
function fixture(): LineageModel {
  return {
    id: 'm',
    name: 'test',
    createdAt: 0,
    updatedAt: 0,
    layers: [
      {
        id: 'L1',
        name: 'Source',
        objects: [
          {
            id: 'O1',
            name: 'Customer',
            children: [
              attr('a1', 'Customer_Name'),
              attr('a2', 'Customer Fax'),
              attr('a3', 'Nickname'),
              attr('g1', 'Address', [attr('a4', 'Postcode')]),
            ],
          },
        ],
      },
      {
        id: 'L2',
        name: 'Warehouse',
        objects: [
          {
            id: 'O2',
            name: 'Cust',
            children: [
              attr('b1', 'customer name'),
              attr('b2', 'Customer Fax'),
              attr('b3', 'Zzzzzz'),
              attr('g2', 'Address', [attr('b4', 'Postcode')]),
            ],
          },
        ],
      },
    ],
    transitions: [{ id: 't1', source: 'O1', target: 'O2' }],
    properties: {},
  }
}

const config = (over: Partial<AutoMapConfig> = {}): AutoMapConfig => ({
  ...defaultConfig(),
  ...over,
})

const pairs = (model: LineageModel, c: AutoMapConfig) =>
  generateSuggestions(model, c).map((s) => `${s.source}>${s.target}`)

describe('scope resolution', () => {
  it('Auto on both sides walks out from what is already connected', () => {
    // The one transition is O1 → O2, so both objects' whole subtrees are in
    // scope and the obvious name matches are found.
    expect(pairs(fixture(), config())).toEqual(
      expect.arrayContaining(['a1>b1', 'a2>b2', 'a4>b4']),
    )
  })

  it('finds nothing at all when no transition exists to grow from', () => {
    const model = { ...fixture(), transitions: [] }
    expect(generateSuggestions(model, config())).toEqual([])
  })

  it('narrows to a named scope root and its descendants', () => {
    // Sourcing from the Address group only: Postcode is the sole candidate.
    const found = pairs(fixture(), config({ source: 'g1' }))
    expect(found).toEqual(['a4>b4'])
  })

  it('never suggests a mapping within one layer', () => {
    const model = fixture()
    // A second object in the SAME layer with identical attribute names.
    model.layers[0].objects.push({
      id: 'O3',
      name: 'Customer copy',
      children: [attr('c1', 'Customer_Name')],
    })
    model.transitions.push({ id: 't2', source: 'O3', target: 'O2' })
    const found = pairs(model, config())
    expect(found).not.toContain('a1>c1')
    expect(found).not.toContain('c1>a1')
  })

  it('leaves groups out unless asked for them', () => {
    expect(pairs(fixture(), config())).not.toContain('g1>g2')
    expect(pairs(fixture(), config({ includeGroups: true }))).toContain('g1>g2')
  })

  it('does not re-suggest a transition that already exists', () => {
    const model = fixture()
    model.transitions.push({ id: 't2', source: 'a2', target: 'b2' })
    expect(pairs(model, config())).not.toContain('a2>b2')
  })
})

describe('similarity', () => {
  it('fast ignores case, spacing and separators', () => {
    expect(similarity('Customer_Name', 'customer name', 'fast', false)).toBe(100)
    expect(similarity('Customer', 'Client', 'fast', false)).toBe(0)
  })

  it('exhaustive 1 is case sensitive and scores partial matches', () => {
    expect(similarity('Customer', 'customer', 'exhaustive1', false)).toBeLessThan(100)
    expect(similarity('Customer', 'Customer', 'exhaustive1', false)).toBe(100)
  })

  it('exhaustive 2 ignores case and degrades gently on long strings', () => {
    const a = 'customer_postal_address_line_one'
    const b = 'Customer_Postal_Address_Line_1'
    expect(similarity(a, b, 'exhaustive2', false)).toBeGreaterThan(80)
    expect(similarity(a, b, 'exhaustive2', false)).toBeLessThan(100)
  })

  it('scores differently-written dates as identical when date matching is on', () => {
    expect(similarity('2024-01-05T00:00:00Z', '5 Jan 2024 00:00:00 GMT', 'fast', false)).toBe(0)
    expect(similarity('2024-01-05T00:00:00Z', '5 Jan 2024 00:00:00 GMT', 'fast', true)).toBe(100)
  })
})

describe('the confidence threshold', () => {
  it('drops suggestions below it', () => {
    const loose = config({ algorithm: 'exhaustive2', confidence: 50 })
    const strict = config({ algorithm: 'exhaustive2', confidence: 99 })
    expect(pairs(fixture(), loose).length).toBeGreaterThan(pairs(fixture(), strict).length)
  })

  it('never returns anything below the threshold', () => {
    const found = generateSuggestions(fixture(), config({ algorithm: 'exhaustive2', confidence: 70 }))
    expect(found.every((s) => s.confidence >= 70)).toBe(true)
  })
})

describe('one-to-many', () => {
  it('claims each endpoint once by default, best match first', () => {
    const model = fixture()
    // Two plausible targets for a1 in the other layer.
    model.layers[1].objects[0].children.push(attr('b5', 'Customer_Name'))
    const found = generateSuggestions(model, config({ algorithm: 'exhaustive2', confidence: 60 }))
    const sources = found.map((s) => s.source)
    expect(new Set(sources).size).toBe(sources.length)
  })

  it('keeps every match when one-to-many is allowed', () => {
    const model = fixture()
    model.layers[1].objects[0].children.push(attr('b5', 'Customer_Name'))
    const found = pairs(model, config({ allowOneToMany: true }))
    expect(found).toContain('a1>b1')
    expect(found).toContain('a1>b5')
  })
})

describe('grouping and committing', () => {
  it('rolls suggestions up to the object pair, biggest first', () => {
    const found = generateSuggestions(fixture(), config())
    const groups = groupSuggestions(fixture(), found)
    expect(groups).toHaveLength(1)
    expect(groups[0].sourceLabel).toBe('Source · Customer')
    expect(groups[0].targetLabel).toBe('Warehouse · Cust')
    expect(groups[0].suggestions.length).toBe(found.length)
  })

  it('adds accepted suggestions as transitions and records the confidence', () => {
    const model = fixture()
    const found = generateSuggestions(model, config())
    const next = applySuggestions(model, found, config())

    expect(next.transitions).toHaveLength(model.transitions.length + found.length)
    const added = next.transitions.find((t) => t.source === 'a1' && t.target === 'b1')!
    expect(added).toBeDefined()
    expect(next.properties[added.id].Confidence).toBe('100')
    expect(next.properties[added.id]['Mapped by']).toBe('name')
    // The original model is untouched — every edit in this codebase is pure.
    expect(model.transitions).toHaveLength(1)
  })

  it('is a no-op when nothing was accepted', () => {
    const model = fixture()
    expect(applySuggestions(model, [], config())).toBe(model)
  })
})
