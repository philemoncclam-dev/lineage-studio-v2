import { describe, expect, it } from 'vitest'
import { buildIndex } from '../index'
import { explain, impactOf } from '../explain'
import type { LineageModel } from '../types'

/**
 * landing.customers_raw.email → the step's hop row → bronze.customers.email,
 * which a second table then reads. One straight line, three objects.
 */
function model(): LineageModel {
  const attr = (id: string, name: string) => ({ id, name, children: [] })
  return {
    id: 'm',
    name: 'M',
    layers: [
      {
        id: 'L-eng',
        name: 'Engineering',
        objects: [{ id: 'nb', name: 'nb_22', children: [attr('hop', 'customers_raw → customers')] }],
      },
      {
        id: 'L-plat',
        name: 'Platform',
        objects: [
          { id: 'raw', name: 'customers_raw', children: [attr('raw.email', 'email_address')] },
          { id: 'cus', name: 'customers', children: [attr('cus.email', 'email')] },
          { id: 'rep', name: 'report', children: [attr('rep.email', 'email')] },
        ],
      },
    ],
    transitions: [
      { id: 't1', source: 'raw.email', target: 'hop' },
      { id: 't2', source: 'hop', target: 'cus.email' },
      { id: 't3', source: 'cus.email', target: 'rep.email' },
    ],
    properties: {
      nb: { Tags: 'Notebook, Step 2', Step: '2', Source: 'Fabric sandbox' },
      hop: { Tags: 'Staged' },
      t2: { Derives: 'customers_raw.email_address', Transform: 'lower(email_address)' },
    },
  } as unknown as LineageModel
}

describe('explain', () => {
  const m = model()
  const index = buildIndex(m)

  it('answers where a column came from and what it fed, in one line each', () => {
    const e = explain(m, index, 'cus.email')!
    expect(e.kind).toBe('column')
    expect(e.where).toBe('customers · Platform')
    expect(e.headline).toContain('is built from 1 upstream source')
    expect(e.upstream.map((u) => [u.what, u.how])).toEqual([
      ['nb_22.customers_raw → customers', 'lower(email_address)'],
    ])
    expect(e.downstream.map((d) => d.what)).toEqual(['report.email'])
  })

  it('calls a straight copy unchanged rather than saying nothing', () => {
    expect(explain(m, index, 'rep.email')!.upstream[0].how).toBe('unchanged')
  })

  it('says so when nothing feeds a thing, instead of leaving it blank', () => {
    expect(explain(m, index, 'raw.email')!.headline).toContain('is a starting point')
  })

  it('reads the kind off the tag, so a hop row is a step and not a group', () => {
    expect(explain(m, index, 'hop')!.kind).toBe('step')
    expect(explain(m, index, 'nb')!.kind).toBe('notebook')
  })

  it('surfaces run provenance as facts', () => {
    expect(explain(m, index, 'nb')!.facts).toContainEqual({
      label: 'Runs',
      value: 'step 2 of the sequence',
    })
  })
})

describe('impactOf', () => {
  const m = model()
  const index = buildIndex(m)

  it('walks forwards only — upstream is not at risk from a change here', () => {
    const impact = impactOf(index, 'cus.email')
    expect(impact.objects.map((o) => o.name)).toEqual(['report'])
    expect(impact.total).toBe(1)
  })

  it('starts from a table’s columns, since that is where its edges hang', () => {
    // Changing the TABLE means changing its columns, and the table itself has
    // no transition of its own.
    const impact = impactOf(index, 'cus')
    expect(impact.objects.map((o) => o.name)).toEqual(['report'])
    expect(impact.objects[0].items).toEqual(['email'])
  })

  it('reaches the whole chain from the source', () => {
    const impact = impactOf(index, 'raw')
    expect(impact.objects.map((o) => o.name).sort()).toEqual(['customers', 'nb_22', 'report'])
  })

  it('groups what breaks under the thing that holds it', () => {
    const impact = impactOf(index, 'raw.email')
    const report = impact.objects.find((o) => o.name === 'report')!
    expect(report.where).toBe('Platform')
    expect(report.items).toEqual(['email'])
  })
})
