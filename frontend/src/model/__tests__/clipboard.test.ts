import { describe, expect, it } from 'vitest'
import { copyEntities, paste } from '../clipboard'
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
