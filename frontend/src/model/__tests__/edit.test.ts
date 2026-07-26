import { describe, expect, it } from 'vitest'
import {
  UNNAMED,
  addAttribute,
  addLayer,
  addObject,
  addTransition,
  deleteEntities,
  deletePreservingTransitions,
  renameEntity,
  sortChildren,
  withDescendants,
} from '../edit'
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

describe('add operations', () => {
  it('appends a layer, and can place one before or after another', () => {
    const model = sampleModel()
    const appended = addLayer(model)
    expect(appended.model.layers).toHaveLength(model.layers.length + 1)
    expect(appended.model.layers[appended.model.layers.length - 1].id).toBe(appended.id)

    const before = addLayer(model, { relativeTo: model.layers[1].id, side: 'before' })
    expect(before.model.layers[1].id).toBe(before.id)

    const after = addLayer(model, { relativeTo: model.layers[0].id, side: 'after' })
    expect(after.model.layers[1].id).toBe(after.id)
  })

  it('adds an object to the named layer only', () => {
    const model = sampleModel()
    const { model: next, id } = addObject(model, model.layers[1].id)
    expect(next.layers[1].objects).toHaveLength(model.layers[1].objects.length + 1)
    expect(next.layers[0].objects).toHaveLength(model.layers[0].objects.length)
    expect(next.layers[1].objects.at(-1)!.id).toBe(id)
  })

  it('adds an attribute under an object', () => {
    const model = sampleModel()
    const object = model.layers[1].objects[0]
    const { model: next, id } = addAttribute(model, object.id)
    expect(next.layers[1].objects[0].children.at(-1)!.id).toBe(id)
  })

  it('nesting under a leaf attribute turns it into a group', () => {
    const model = sampleModel()
    const leaf = findByName(model, 'ficoscore')
    expect(buildIndex(model).entries.get(leaf)!.hasChildren).toBe(false)
    const { model: next } = addAttribute(model, leaf)
    expect(buildIndex(next).entries.get(leaf)!.hasChildren).toBe(true)
  })

  it('places an attribute before or after a sibling', () => {
    const model = sampleModel()
    const sibling = findByName(model, 'netincome')
    const parent = buildIndex(model).entries.get(sibling)!.parentId!
    const { model: next, id } = addAttribute(model, parent, {
      relativeTo: sibling,
      side: 'before',
    })
    const index = buildIndex(next)
    const order = [...index.entries.values()].filter((e) => e.parentId === parent).map((e) => e.id)
    expect(order.indexOf(id)).toBe(order.indexOf(sibling) - 1)
  })

  it('names new entities Unnamed so they can be typed over immediately', () => {
    const model = sampleModel()
    const { model: next, id } = addLayer(model)
    expect(buildIndex(next).entries.get(id)!.name).toBe(UNNAMED)
  })
})

describe('deletePreservingTransitions', () => {
  /** A leaf with both an incoming and an outgoing edge — the only case that bridges. */
  function findMidChainAttribute(model: LineageModel): string {
    const index = buildIndex(model)
    for (const entry of index.entries.values()) {
      if (entry.kind !== 'attribute' || entry.hasChildren) continue
      if ((index.incoming.get(entry.id)?.length ?? 0) === 0) continue
      if ((index.outgoing.get(entry.id)?.length ?? 0) === 0) continue
      return entry.id
    }
    throw new Error('sample has no mid-chain attribute')
  }

  it('bridges upstream to downstream across the deleted entity', () => {
    const model = sampleModel()
    const target = findMidChainAttribute(model)
    const before = buildIndex(model)
    const sources = before.incoming.get(target)!
    const targets = before.outgoing.get(target)!

    const next = deletePreservingTransitions(model, [target])
    for (const from of sources) {
      for (const to of targets) {
        expect(next.transitions.some((t) => t.source === from && t.target === to)).toBe(true)
      }
    }
  })

  it('still removes the entity itself', () => {
    const model = sampleModel()
    const target = findMidChainAttribute(model)
    const next = deletePreservingTransitions(model, [target])
    expect(buildIndex(next).entries.has(target)).toBe(false)
  })

  it('leaves no transition pointing at the deleted entity', () => {
    const model = sampleModel()
    const target = findMidChainAttribute(model)
    const next = deletePreservingTransitions(model, [target])
    expect(next.transitions.some((t) => t.source === target || t.target === target)).toBe(false)
  })

  it('leaves a dead-end deletion with no bridge to build', () => {
    const model = sampleModel()
    const leaf = findByName(model, 'ficoscore') // no transitions at all
    const next = deletePreservingTransitions(model, [leaf])
    expect(next.transitions).toHaveLength(model.transitions.length)
  })
})

describe('sortChildren', () => {
  it('sorts an object’s attributes A-Z and Z-A', () => {
    const model = sampleModel()
    const object = model.layers[1].objects.find((o) => o.name === 'Targets')!
    const group = object.children[0].id

    const asc = sortChildren(model, group, 'asc')
    const ascNames = findChildNames(asc, group)
    expect(ascNames).toEqual([...ascNames].sort((a, b) => a.localeCompare(b, undefined, { numeric: true })))

    const desc = sortChildren(model, group, 'desc')
    expect(findChildNames(desc, group)).toEqual([...ascNames].reverse())
  })

  it('does not sort deeper levels', () => {
    const model = sampleModel()
    const applicant = findByName(model, 'Applicant')
    const parent = buildIndex(model).entries.get(applicant)!.parentId!
    const before = findChildNames(model, applicant)
    const next = sortChildren(model, parent, 'asc')
    expect(findChildNames(next, applicant)).toEqual(before)
  })
})

function findChildNames(model: LineageModel, parentId: string): string[] {
  const index = buildIndex(model)
  return [...index.entries.values()].filter((e) => e.parentId === parentId).map((e) => e.name)
}

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
