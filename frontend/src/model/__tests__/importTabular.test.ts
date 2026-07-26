import { describe, expect, it } from 'vitest'
import { DEFAULT_IMPORT_OPTIONS, parseCsv, planImport } from '../importTabular'
import { buildIndex, countEntities } from '../index'
import { emptyModel } from '../store'
import type { LineageModel } from '../types'

const rows = (csv: string) => parseCsv(csv.trim())

function names(model: LineageModel): string[] {
  return [...buildIndex(model).entries.values()].map((e) => e.name)
}

describe('parseCsv', () => {
  it('handles quoted fields with commas and embedded quotes', () => {
    expect(parseCsv('a,"b,c","say ""hi"""')).toEqual([['a', 'b,c', 'say "hi"']])
  })

  it('handles quoted newlines', () => {
    expect(parseCsv('a,"line1\nline2"\nb,c')).toEqual([['a', 'line1\nline2'], ['b', 'c']])
  })

  it('treats tabs as delimiters, so pasted spreadsheet data works', () => {
    expect(parseCsv('a\tb\tc')).toEqual([['a', 'b', 'c']])
  })
})

describe('planImport — simple format', () => {
  it('creates the layer, object and attribute hierarchy', () => {
    const csv = rows(`
Layer,Object,Attribute
Source,customers,customer_id
Source,customers,email
`)
    const preview = planImport(emptyModel('m'), csv)
    expect(preview.format).toBe('simple')
    expect(preview.added).toMatchObject({ layers: 1, objects: 1, attributes: 2 })
    expect(names(preview.model)).toEqual(
      expect.arrayContaining(['Source', 'customers', 'customer_id', 'email']),
    )
  })

  it('reuses existing entities instead of duplicating them', () => {
    const csv = rows(`
Layer,Object,Attribute
Source,customers,customer_id
`)
    const once = planImport(emptyModel('m'), csv).model
    const twice = planImport(once, csv)
    expect(twice.added).toMatchObject({ layers: 0, objects: 0, attributes: 0 })
    expect(countEntities(twice.model)).toBe(countEntities(once))
  })

  it('is case-sensitive when matching names', () => {
    const csv = rows(`
Layer,Object,Attribute
Source,customers,id
Source,Customers,id
`)
    const preview = planImport(emptyModel('m'), csv)
    // `customers` and `Customers` are different objects, per the spec.
    expect(preview.added.objects).toBe(2)
  })

  it('assigns properties from columns right of PROPERTIES:', () => {
    const csv = rows(`
Layer,Object,Attribute,PROPERTIES:,Classification
Source,customers,email,,PII
`)
    const preview = planImport(emptyModel('m'), csv)
    const index = buildIndex(preview.model)
    const email = [...index.entries.values()].find((e) => e.name === 'email')!
    expect(preview.model.properties[email.id]).toEqual({ Classification: 'PII' })
    expect(preview.updated.properties).toBe(1)
  })

  it('does not mutate the model it was given', () => {
    const base = emptyModel('m')
    planImport(base, rows('Layer,Object,Attribute\nS,o,a'))
    expect(base.layers).toHaveLength(0)
  })
})

describe('planImport — transitions', () => {
  it('creates transitions from a dedicated transitions sheet', () => {
    const setup = planImport(
      emptyModel('m'),
      rows(`
Layer,Object,Attribute
Source,customers,email
Target,dim,email_address
`),
    ).model

    const preview = planImport(
      setup,
      rows(`
SOURCE_Layer,SOURCE_Object,SOURCE,TARGET_Layer,TARGET_Object,TARGET
Source,customers,email,Target,dim,email_address
`),
    )
    expect(preview.added.transitions).toBe(1)
  })

  it('warns rather than throwing when an endpoint cannot be found', () => {
    const preview = planImport(
      emptyModel('m'),
      rows(`
SOURCE,TARGET
nope,also_nope
`),
    )
    expect(preview.added.transitions).toBe(0)
    expect(preview.warnings.join(' ')).toMatch(/endpoint/i)
  })

  it('honours the generateImplicitTransitions option', () => {
    const csv = rows(`
Layer,Object,Attribute,SOURCE
Source,customers,email,
Target,dim,email_address,email
`)
    const on = planImport(emptyModel('m'), csv, {
      ...DEFAULT_IMPORT_OPTIONS,
      generateImplicitTransitions: true,
    })
    expect(on.added.transitions).toBe(1)

    const off = planImport(emptyModel('m'), csv, {
      ...DEFAULT_IMPORT_OPTIONS,
      generateImplicitTransitions: false,
    })
    expect(off.added.transitions).toBe(0)
  })

  it('does not create duplicate transitions on reimport', () => {
    const csv = rows(`
Layer,Object,Attribute,SOURCE
Source,customers,email,
Target,dim,email_address,email
`)
    const once = planImport(emptyModel('m'), csv).model
    expect(planImport(once, csv).added.transitions).toBe(0)
  })
})

describe('planImport — full format', () => {
  it('builds a hierarchy through PARENT references', () => {
    const preview = planImport(
      emptyModel('m'),
      rows(`
ID,TYPE,PARENT,NAME
1,Layer,,Source
2,Object,1,customers
3,Attribute,2,customer_id
`),
    )
    expect(preview.format).toBe('full')
    expect(preview.added).toMatchObject({ layers: 1, objects: 1, attributes: 1 })

    const index = buildIndex(preview.model)
    const attr = [...index.entries.values()].find((e) => e.name === 'customer_id')!
    const parent = index.entries.get(attr.parentId!)!
    expect(parent.name).toBe('customers')
  })

  it('creates transitions from dedicated Transition rows', () => {
    const preview = planImport(
      emptyModel('m'),
      rows(`
ID,TYPE,PARENT,NAME,SOURCE,TARGET
1,Layer,,Source
2,Object,1,customers
3,Attribute,2,email
4,Layer,,Target
5,Object,4,dim
6,Attribute,5,email_address
7,Transition,,,3,6
`),
    )
    expect(preview.added.transitions).toBe(1)
  })

  it('skips rows with no NAME and says so', () => {
    const preview = planImport(emptyModel('m'), rows(`
ID,TYPE,PARENT,NAME
1,Layer,,
`))
    expect(preview.warnings.join(' ')).toMatch(/no NAME/i)
  })
})

describe('planImport — headerless and empty input', () => {
  it('treats a bare list as attribute names', () => {
    const preview = planImport(emptyModel('m'), rows('alpha\nbeta\ngamma'))
    expect(preview.format).toBe('headerless')
    expect(preview.added.attributes).toBe(3)
  })

  it('reports empty input without changing the model', () => {
    const base = emptyModel('m')
    const preview = planImport(base, [])
    expect(preview.model).toBe(base)
    expect(preview.warnings).toHaveLength(1)
  })

  it('reports unrecognised columns without changing the model', () => {
    const base = emptyModel('m')
    const preview = planImport(base, rows('id,foo\n1,2'))
    expect(preview.format).toBe('unknown')
    expect(preview.model).toBe(base)
  })
})
