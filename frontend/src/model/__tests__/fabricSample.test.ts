// The four-layer worked example.
//
// A sample is a fixture the whole app is judged on, so the assertions here are
// about its SHAPE staying true rather than its exact contents: the layer order,
// the hierarchy meaning per layer, and — most of it — the three imperfections
// it carries on purpose. A tidied-up sample would quietly stop demonstrating
// the distinctions the assistant exists to report.
import { describe, expect, it } from 'vitest'
import { fabricSampleModel } from '../fabricSample'
import { buildIndex } from '../index'
import type { Attribute, ModelObject } from '../types'

const model = fabricSampleModel()
const index = buildIndex(model)

const layer = (name: string) => model.layers.find((l) => l.name === name)!
const object = (layerName: string, name: string) =>
  layer(layerName).objects.find((o) => o.name === name)!
/** A named child of an object or of an attribute group. */
const attrIn = (parent: ModelObject | Attribute, name: string): Attribute =>
  parent.children.find((c) => c.name === name)!

const edgesFrom = (id: string) => model.transitions.filter((t) => t.source === id)
const edgesTo = (id: string) => model.transitions.filter((t) => t.target === id)

describe('fabricSampleModel', () => {
  it('has the four layers in pipeline order', () => {
    expect(model.layers.map((l) => l.name)).toEqual([
      'Data Sources',
      'Transformations',
      'Workspace',
      'Catalogued Assets',
    ])
  })

  it('puts the medallion stages in the workspace layer, in order', () => {
    expect(layer('Workspace').objects.map((o) => o.name)).toEqual([
      'Landing',
      'Bronze',
      'Silver',
      'Gold',
    ])
  })

  it('nests notebooks inside pipelines', () => {
    const ingest = object('Transformations', 'pl_ingest_daily')
    expect(ingest.children.map((c) => c.name)).toEqual(['nb_land_sources', 'nb_bronze_load'])
  })

  it('connects every layer to the next, so nothing floats', () => {
    for (const l of model.layers) {
      for (const o of l.objects) {
        const ids = [o.id, ...o.children.flatMap((c) => [c.id, ...c.children.map((g) => g.id)])]
        const touched = ids.some((i) => edgesFrom(i).length || edgesTo(i).length)
        expect(touched, `${l.name} / ${o.name} has no lineage at all`).toBe(true)
      }
    }
  })

  it('references only entities that exist', () => {
    // A dangling endpoint is dropped by every walk, so a typo here would make
    // lineage silently vanish rather than fail.
    for (const t of model.transitions) {
      expect(index.entries.has(t.source), `dangling source on ${t.id}`).toBe(true)
      expect(index.entries.has(t.target), `dangling target on ${t.id}`).toBe(true)
    }
  })

  // --- the deliberate imperfections ----------------------------------------

  it('leaves one column with no lineage, so gaps are demonstrable', () => {
    const currency = attrIn(attrIn(object('Workspace', 'Bronze'), 'bronze_invoices'), 'currency')
    expect(edgesFrom(currency.id)).toHaveLength(0)
    expect(edgesTo(currency.id)).toHaveLength(0)
  })

  it('leaves one edge hand-drawn, so unverified lineage is demonstrable', () => {
    const region = attrIn(attrIn(object('Workspace', 'Silver'), 'silver_customer'), 'region')
    const [edge] = edgesFrom(region.id)
    expect(edge).toBeDefined()
    // No `Source` is what "a person drew this and nothing checked it" means.
    expect(model.properties[edge.id]?.Source).toBeUndefined()
  })

  it('keeps Landing to table-level edges, as a file source really behaves', () => {
    // A CSV drop has no columns to trace, so these must not be column edges —
    // otherwise the sample teaches that file lineage resolves to columns.
    const landing = object('Workspace', 'Landing')
    for (const file of landing.children) {
      expect(file.children).toHaveLength(0)
      expect(edgesFrom(file.id).length).toBeGreaterThan(0)
    }
  })

  it('marks derived edges with their source and step', () => {
    const bronzeAccounts = attrIn(object('Workspace', 'Bronze'), 'bronze_accounts')
    const [edge] = edgesFrom(attrIn(bronzeAccounts, 'account_id').id)
    expect(model.properties[edge.id]).toMatchObject({
      Source: 'Fabric sandbox',
      Via: 'nb_silver_conform',
    })
  })

  it('records a transform where one genuinely applies', () => {
    const amount = attrIn(attrIn(object('Workspace', 'Bronze'), 'bronze_invoices'), 'amount')
    const [edge] = edgesFrom(amount.id)
    expect(model.properties[edge.id]?.Transform).toBe('amount * fx_rate')
  })

  it('is regenerated with stable ids', () => {
    // Two calls must agree, or reopening the sample would orphan its properties.
    expect(JSON.stringify(fabricSampleModel().layers)).toBe(JSON.stringify(model.layers))
  })
})
