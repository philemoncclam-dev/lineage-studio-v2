import { describe, expect, it } from 'vitest'
import {
  commonProperties,
  compactProperties,
  isReservedKey,
  orphanedPropertyCount,
  propertiesOf,
  propertyKeyCounts,
  removeProperty,
  renameProperty,
  setProperty,
  valuesForKey,
} from '../properties'
import type { LineageModel } from '../types'

function model(properties: LineageModel['properties'] = {}): LineageModel {
  return {
    id: 'm',
    name: 'M',
    createdAt: 0,
    updatedAt: 0,
    layers: [],
    transitions: [],
    properties,
  }
}

describe('commonProperties', () => {
  it('reads one subject straight through', () => {
    const m = model({ a: { Source: 'Fabric sandbox', Access: 'Read' } })
    expect(commonProperties(m, ['a'])).toEqual([
      { key: 'Access', value: 'Read', mixed: false, present: 1 },
      { key: 'Source', value: 'Fabric sandbox', mixed: false, present: 1 },
    ])
  })

  it('marks a key the subjects disagree on as mixed, with no value', () => {
    const m = model({ a: { Access: 'Read' }, b: { Access: 'Write' } })
    expect(commonProperties(m, ['a', 'b'])).toEqual([
      { key: 'Access', value: '', mixed: true, present: 2 },
    ])
  })

  it('keeps a key only some subjects carry, and says how many', () => {
    const m = model({ a: { CDE: 'true' }, b: {} })
    expect(commonProperties(m, ['a', 'b'])).toEqual([
      { key: 'CDE', value: '', mixed: true, present: 1 },
    ])
  })

  it('excludes the reserved Tags key — it has its own editor', () => {
    const m = model({ a: { Tags: 'notebook, table', Source: 'x' } })
    expect(commonProperties(m, ['a']).map((r) => r.key)).toEqual(['Source'])
  })

  it('treats a transition id as any other subject', () => {
    const m = model({ t1: { Confidence: '92', Algorithm: 'fast' } })
    expect(commonProperties(m, ['t1']).map((r) => r.key)).toEqual(['Algorithm', 'Confidence'])
  })
})

describe('setProperty', () => {
  it('writes to every subject', () => {
    const next = setProperty(model(), ['a', 'b'], 'Owner', 'phil')
    expect(propertiesOf(next, 'a')).toEqual({ Owner: 'phil' })
    expect(propertiesOf(next, 'b')).toEqual({ Owner: 'phil' })
  })

  it('deletes the key on an empty value rather than storing an empty string', () => {
    const m = model({ a: { Owner: 'phil', Source: 'x' } })
    expect(propertiesOf(setProperty(m, ['a'], 'Owner', ''), 'a')).toEqual({ Source: 'x' })
  })

  it('drops the whole bag once its last key goes', () => {
    const m = model({ a: { Owner: 'phil' } })
    expect(removeProperty(m, ['a'], 'Owner').properties).toEqual({})
  })

  it('refuses the reserved key', () => {
    const m = model()
    expect(setProperty(m, ['a'], 'Tags', 'nope')).toBe(m)
    expect(setProperty(m, ['a'], '  tags ', 'nope')).toBe(m)
  })

  it('refuses a blank key and leaves the model identical', () => {
    const m = model()
    expect(setProperty(m, ['a'], '   ', 'v')).toBe(m)
  })

  it('trims the key so " Owner" and "Owner" are one property', () => {
    const next = setProperty(model({ a: { Owner: 'phil' } }), ['a'], ' Owner ', 'sam')
    expect(propertiesOf(next, 'a')).toEqual({ Owner: 'sam' })
  })

  it('does not touch bags it was not asked about', () => {
    const m = model({ a: { Owner: 'phil' }, b: { Owner: 'sam' } })
    expect(propertiesOf(setProperty(m, ['a'], 'Owner', 'kim'), 'b')).toEqual({ Owner: 'sam' })
  })
})

describe('renameProperty', () => {
  it('keeps each subject its own value', () => {
    const m = model({ a: { Owner: 'phil' }, b: { Owner: 'sam' } })
    const next = renameProperty(m, ['a', 'b'], 'Owner', 'Steward')
    expect(propertiesOf(next, 'a')).toEqual({ Steward: 'phil' })
    expect(propertiesOf(next, 'b')).toEqual({ Steward: 'sam' })
  })

  it('is scoped to the subjects — a key elsewhere is untouched', () => {
    const m = model({ a: { Owner: 'phil' }, b: { Owner: 'sam' } })
    expect(propertiesOf(renameProperty(m, ['a'], 'Owner', 'Steward'), 'b')).toEqual({
      Owner: 'sam',
    })
  })

  it('overwrites when renamed onto an existing key', () => {
    const m = model({ a: { Owner: 'phil', Steward: 'sam' } })
    expect(propertiesOf(renameProperty(m, ['a'], 'Owner', 'Steward'), 'a')).toEqual({
      Steward: 'phil',
    })
  })

  it('skips a subject that does not carry the key', () => {
    const m = model({ a: { Owner: 'phil' }, b: { Source: 'x' } })
    expect(propertiesOf(renameProperty(m, ['a', 'b'], 'Owner', 'Steward'), 'b')).toEqual({
      Source: 'x',
    })
  })

  it('refuses to rename to or from the reserved key', () => {
    const m = model({ a: { Tags: 'x', Owner: 'phil' } })
    expect(renameProperty(m, ['a'], 'Owner', 'Tags')).toBe(m)
    expect(renameProperty(m, ['a'], 'Tags', 'Labels')).toBe(m)
  })
})

describe('vocabulary helpers', () => {
  it('counts keys across every bag, reserved excluded', () => {
    const m = model({
      a: { Source: 'x', Tags: 'y' },
      b: { Source: 'z' },
      t1: { Confidence: '90' },
    })
    expect([...propertyKeyCounts(m).entries()].sort()).toEqual([
      ['Confidence', 1],
      ['Source', 2],
    ])
  })

  it('collects the distinct values already used for a key', () => {
    const m = model({ a: { Access: 'Read' }, b: { Access: 'Write' }, c: { Access: 'Read' } })
    expect(valuesForKey(m, 'Access')).toEqual(['Read', 'Write'])
  })

  it('knows the reserved key case-insensitively', () => {
    expect(isReservedKey('tags')).toBe(true)
    expect(isReservedKey('Tagging')).toBe(false)
  })
})

describe('compactProperties', () => {
  const withProps = (): LineageModel => ({
    id: 'm',
    name: 'm',
    createdAt: 0,
    updatedAt: 0,
    layers: [
      {
        id: 'L1',
        name: 'Raw',
        objects: [{ id: 'o1', name: 'orders', children: [{ id: 'a1', name: 'id', children: [] }] }],
      },
    ],
    transitions: [],
    properties: {
      L1: { Owner: 'ada' },
      o1: { Owner: 'ada' },
      a1: { Type: 'bigint' },
      ghost: { Owner: 'someone deleted' },
    },
  })

  it('drops bags whose entity is gone and keeps every live one', () => {
    const out = compactProperties(withProps())
    expect(Object.keys(out.properties).sort()).toEqual(['L1', 'a1', 'o1'])
  })

  it('reaches nested attributes, not just top-level rows', () => {
    expect(compactProperties(withProps()).properties.a1).toEqual({ Type: 'bigint' })
  })

  it('does not mutate the model it compacts', () => {
    const model = withProps()
    const before = JSON.stringify(model)
    compactProperties(model)
    expect(JSON.stringify(model)).toBe(before)
  })

  it('counts the orphans', () => {
    expect(orphanedPropertyCount(withProps())).toBe(1)
    expect(orphanedPropertyCount(compactProperties(withProps()))).toBe(0)
  })
})
