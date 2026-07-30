import { describe, expect, it } from 'vitest'
import { copyEntities, paste } from '../clipboard'
import { deleteEntities } from '../edit'
import { buildIndex, countEntities } from '../index'
import { sampleModel } from '../sample'
import type { LineageModel } from '../types'

function idOf(model: LineageModel, name: string): string {
  for (const entry of buildIndex(model).entries.values()) {
    if (entry.name === name) return entry.id
  }
  throw new Error(`no entity named ${name}`)
}

function namesOf(model: LineageModel, name: string): string[] {
  return [...buildIndex(model).entries.values()]
    .filter((e) => e.name === name)
    .map((e) => e.id)
}

describe('copyEntities', () => {
  it('returns null for an empty selection', () => {
    expect(copyEntities(sampleModel(), [])).toBeNull()
  })

  it('captures the whole subtree', () => {
    const model = sampleModel()
    const clip = copyEntities(model, [idOf(model, 'Applicant Financials')])!
    expect(clip.nodes).toHaveLength(1)
    expect(clip.nodes[0].children.map((c) => c.name)).toEqual([
      'name',
      'zipcode',
      'netincome',
      'availableincome',
      'ficoscore',
    ])
  })

  it('drops ids already covered by another selected ancestor', () => {
    const model = sampleModel()
    const clip = copyEntities(model, [
      idOf(model, 'Applicant Financials'),
      idOf(model, 'ficoscore'),
    ])!
    // ficoscore is inside Applicant Financials, so only one root is captured.
    expect(clip.nodes).toHaveLength(1)
  })

  it('carries properties along', () => {
    const model = sampleModel()
    const clip = copyEntities(model, [idOf(model, 'Applicant Financials')])!
    const fico = clip.nodes[0].children.find((c) => c.name === 'ficoscore')!
    expect(fico.properties).toEqual({ Classification: 'SPI' })
  })

  it('sorts transitions into internal, inbound and outbound', () => {
    const model = sampleModel()
    // OUTPUT1 has edges coming in from the source and going out to the target.
    const clip = copyEntities(model, [idOf(model, 'OUTPUT1')])!
    expect(clip.inbound.length).toBeGreaterThan(0)
    expect(clip.outbound.length).toBeGreaterThan(0)
  })
})

describe('paste', () => {
  it('duplicates an object inside its own layer', () => {
    const model = sampleModel()
    const clip = copyEntities(model, [idOf(model, 'Targets')])!
    const next = paste(model, clip, { mode: 'after', id: idOf(model, 'Targets') })
    expect(namesOf(next, 'Targets')).toHaveLength(2)
  })

  it('gives the clones fresh ids', () => {
    const model = sampleModel()
    const source = idOf(model, 'Targets')
    const next = paste(model, copyEntities(model, [source])!, { mode: 'after', id: source })
    const ids = namesOf(next, 'Targets')
    expect(new Set(ids).size).toBe(2)
    expect(ids).toContain(source)
  })

  it('re-kinds the roots according to where they land', () => {
    const model = sampleModel()
    // An OBJECT pasted onto blank canvas becomes a LAYER.
    const clip = copyEntities(model, [idOf(model, 'Targets')])!
    const next = paste(model, clip, { mode: 'canvas' })
    expect(next.layers).toHaveLength(model.layers.length + 1)
    expect(next.layers[next.layers.length - 1].name).toBe('Targets')
    // Its attributes became objects one level down.
    expect(next.layers[next.layers.length - 1].objects[0].name).toBe('tft_applicant')
  })

  it('pastes an attribute inside an object', () => {
    const model = sampleModel()
    const clip = copyEntities(model, [idOf(model, 'ficoscore')])!
    const target = idOf(model, 'Targets')
    const next = paste(model, clip, { mode: 'into', id: target })
    expect(namesOf(next, 'ficoscore')).toHaveLength(2)
  })

  it('replicates transitions between copied entities', () => {
    const model = sampleModel()
    // Applicant and OUTPUT1 are connected; copying both must copy those edges,
    // and — per spec — the boundary edges to entities outside the selection too.
    const clip = copyEntities(model, [idOf(model, 'Applicant'), idOf(model, 'OUTPUT1')])!
    expect(clip.internal.length).toBeGreaterThan(0)

    const next = paste(model, clip, { mode: 'canvas' })
    expect(next.transitions.length).toBe(
      model.transitions.length + clip.internal.length + clip.inbound.length + clip.outbound.length,
    )
  })

  it('re-attaches boundary transitions to the surviving outside entity', () => {
    const model = sampleModel()
    const clip = copyEntities(model, [idOf(model, 'OUTPUT1')])!
    const next = paste(model, clip, { mode: 'canvas' })
    // The clone arrives already wired to the same neighbours.
    expect(next.transitions.length).toBe(
      model.transitions.length + clip.inbound.length + clip.outbound.length,
    )
  })

  it('gives a pasted attribute no transitions at all', () => {
    const model = sampleModel()
    // A column-level edge: OUTPUT1.name feeds tft_applicant.m_customer_name.
    const source = idOf(model, 'm_customer_name')
    const clip = copyEntities(model, [source])!
    expect(clip.inbound.length + clip.outbound.length).toBeGreaterThan(0)

    // The clone is a structure, not a derivation — it arrives unwired.
    const next = paste(model, clip, { mode: 'after', id: source })
    expect(namesOf(next, 'm_customer_name')).toHaveLength(
      namesOf(model, 'm_customer_name').length + 1,
    )
    expect(next.transitions.length).toBe(model.transitions.length)
  })

  it('still copies an attribute\'s properties even though it drops its edges', () => {
    const model = sampleModel()
    const source = idOf(model, 'ficoscore')
    const next = paste(model, copyEntities(model, [source])!, { mode: 'after', id: source })
    const clone = namesOf(next, 'ficoscore').find((id) => id !== source)!
    expect(next.properties[clone]).toEqual({ Classification: 'SPI' })
  })

  it('does not restore an attribute\'s transitions across a cut and paste', () => {
    const model = sampleModel()
    const source = idOf(model, 'm_customer_name')
    // Cut is copy + delete; the delete takes the edges and paste does not
    // bring them back, so a moved column lands unwired under its new parent.
    const clip = copyEntities(model, [source])!
    const afterCut = deleteEntities(model, [source])
    expect(afterCut.transitions.length).toBeLessThan(model.transitions.length)

    const next = paste(afterCut, clip, { mode: 'into', id: idOf(model, 'tft_applicant') })
    expect(next.transitions.length).toBe(afterCut.transitions.length)
  })

  it('gives a pasted object no transitions at all', () => {
    const model = sampleModel()
    // Targets is wired on both sides: Mappings feeds its columns, and it feeds
    // Mortgage's. None of that is a claim about a copy dropped somewhere else.
    const source = idOf(model, 'Targets')
    const clip = copyEntities(model, [source])!
    expect(clip.inbound.length + clip.outbound.length).toBeGreaterThan(0)

    const next = paste(model, clip, { mode: 'into', id: idOf(model, 'Origination System') })
    expect(namesOf(next, 'Targets')).toHaveLength(2)
    expect(next.transitions.length).toBe(model.transitions.length)
  })

  it('still copies an object\'s properties even though it drops its edges', () => {
    const model = sampleModel()
    const source = idOf(model, 'Targets')
    const withProps = { ...model, properties: { ...model.properties, [source]: { Source: 'Fabric' } } }
    const next = paste(withProps, copyEntities(withProps, [source])!, {
      mode: 'into',
      id: idOf(model, 'Origination System'),
    })
    const clone = namesOf(next, 'Targets').find((id) => id !== source)!
    expect(next.properties[clone]).toEqual({ Source: 'Fabric' })
  })

  it('does not restore an object\'s transitions when it is moved between layers', () => {
    const model = sampleModel()
    const source = idOf(model, 'Targets')
    // A cut is copy + delete; the delete takes the edges with it and the paste
    // does not bring them back, so a moved object lands unwired in its new
    // layer for the user to map.
    const clip = copyEntities(model, [source])!
    const afterCut = deleteEntities(model, [source])
    expect(afterCut.transitions.length).toBeLessThan(model.transitions.length)

    const next = paste(afterCut, clip, { mode: 'into', id: idOf(model, 'Origination System') })
    expect(next.transitions.length).toBe(afterCut.transitions.length)
  })

  it('keeps carrying transitions for a pasted layer', () => {
    const model = sampleModel()
    // Onto blank canvas the roots become LAYERS, which still duplicate their
    // wiring — a layer paste copies a subgraph, not a single new entity.
    const clip = copyEntities(model, [idOf(model, 'OUTPUT1')])!
    const next = paste(model, clip, { mode: 'canvas' })
    expect(next.transitions.length).toBeGreaterThan(model.transitions.length)
  })

  it('does not mutate the source model', () => {
    const model = sampleModel()
    const before = countEntities(model)
    paste(model, copyEntities(model, [idOf(model, 'Targets')])!, { mode: 'canvas' })
    expect(countEntities(model)).toBe(before)
  })

  it('is a no-op when the paste target no longer exists', () => {
    const model = sampleModel()
    const clip = copyEntities(model, [idOf(model, 'Targets')])!
    expect(paste(model, clip, { mode: 'into', id: 'gone' })).toBe(model)
  })
})
