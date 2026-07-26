import { describe, expect, it } from 'vitest'
import { addTransition, deleteEntities, renameEntity, withDescendants } from '../edit'
import { buildIndex, countEntities } from '../index'
import { sampleModel } from '../sample'
import type { LineageModel } from '../types'

function findByName(model: LineageModel, name: string): string {
  const index = buildIndex(model)
  for (const entry of index.entries.values()) if (entry.name === name) return entry.id
  throw new Error(`no entity named ${name}`)
}

describe('withDescendants', () => {
  it('expands a group to include its whole subtree', () => {
    const model = sampleModel()
    const applicant = findByName(model, 'Applicant')
    const doomed = withDescendants(model, [applicant])
    // Applicant itself plus its 13 leaf attributes.
    expect(doomed.size).toBe(14)
    expect(doomed.has(findByName(model, 'idcardno'))).toBe(true)
  })

  it('expands a layer through objects to leaves', () => {
    const model = sampleModel()
    const layer = model.layers[0].id
    const doomed = withDescendants(model, [layer])
    expect(doomed.has(model.layers[0].objects[0].id)).toBe(true)
    expect(doomed.has(findByName(model, 'ficoscore'))).toBe(true)
  })
})

describe('deleteEntities', () => {
  it('removes a leaf attribute and leaves siblings intact', () => {
    const model = sampleModel()
    const before = countEntities(model)
    const next = deleteEntities(model, [findByName(model, 'ficoscore')])
    expect(countEntities(next)).toBe(before - 1)
    expect(() => findByName(next, 'netincome')).not.toThrow()
  })

  it('takes the subtree when deleting a group', () => {
    const model = sampleModel()
    const next = deleteEntities(model, [findByName(model, 'Applicant Financials')])
    expect(() => findByName(next, 'ficoscore')).toThrow()
    expect(() => findByName(next, 'netincome')).toThrow()
  })

  it('drops transitions touching anything deleted', () => {
    const model = sampleModel()
    const applicant = findByName(model, 'Applicant')
    const doomed = withDescendants(model, [applicant])
    expect(model.transitions.some((t) => doomed.has(t.source) || doomed.has(t.target))).toBe(true)

    const next = deleteEntities(model, [applicant])
    expect(next.transitions.some((t) => doomed.has(t.source) || doomed.has(t.target))).toBe(false)
  })

  it('keeps property values behind, so an undo can recover them', () => {
    const model = sampleModel()
    const ficoscore = findByName(model, 'ficoscore')
    expect(model.properties[ficoscore]).toBeDefined()
    const next = deleteEntities(model, [ficoscore])
    expect(next.properties[ficoscore]).toBeDefined()
  })

  it('does not mutate the input model', () => {
    const model = sampleModel()
    const before = countEntities(model)
    deleteEntities(model, [findByName(model, 'Applicant')])
    expect(countEntities(model)).toBe(before)
  })

  it('is a no-op for an empty selection', () => {
    const model = sampleModel()
    expect(deleteEntities(model, [])).toBe(model)
  })
})

describe('addTransition', () => {
  it('connects two attributes', () => {
    const model = sampleModel()
    const a = findByName(model, 'ficoscore')
    const b = findByName(model, 'm_gender')
    const next = addTransition(model, a, b)
    expect(next.transitions).toHaveLength(model.transitions.length + 1)
    expect(next.transitions.some((t) => t.source === a && t.target === b)).toBe(true)
  })

  it('connects entities of different kinds', () => {
    const model = sampleModel()
    const layer = model.layers[0].id
    const obj = model.layers[1].objects[0].id
    expect(addTransition(model, layer, obj).transitions).toHaveLength(
      model.transitions.length + 1,
    )
  })

  it('rejects self-links and duplicates', () => {
    const model = sampleModel()
    const a = findByName(model, 'ficoscore')
    expect(addTransition(model, a, a)).toBe(model)

    const b = findByName(model, 'm_gender')
    const once = addTransition(model, a, b)
    expect(addTransition(once, a, b)).toBe(once)
  })

  it('allows the reverse of an existing transition', () => {
    const model = sampleModel()
    const a = findByName(model, 'ficoscore')
    const b = findByName(model, 'm_gender')
    const forward = addTransition(model, a, b)
    const both = addTransition(forward, b, a)
    expect(both.transitions).toHaveLength(model.transitions.length + 2)
  })

  it('ignores unknown endpoints', () => {
    const model = sampleModel()
    expect(addTransition(model, 'nope', findByName(model, 'm_gender'))).toBe(model)
  })
})

describe('renameEntity', () => {
  it('renames a nested attribute without touching same-named siblings elsewhere', () => {
    const model = sampleModel()
    // 'name' appears under Applicant, Applicant Financials, Loan Detail and more.
    const target = findByName(model, 'ficoscore')
    const next = renameEntity(model, target, 'credit_score')
    expect(() => findByName(next, 'credit_score')).not.toThrow()
    expect(() => findByName(next, 'netincome')).not.toThrow()
  })

  it('renames a layer', () => {
    const model = sampleModel()
    const next = renameEntity(model, model.layers[0].id, 'Sources')
    expect(next.layers[0].name).toBe('Sources')
  })
})
