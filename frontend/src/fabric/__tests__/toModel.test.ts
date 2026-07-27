import { describe, expect, it } from 'vitest'
import { sequenceToModel, defaultModelName } from '../toModel'
import type { Step, StepResult } from '../sequence'
import type { SandboxRunResult } from '../../api'

const step = (key: string, name: string): Step => ({
  key,
  kind: 'notebook',
  ws: 'ws1',
  itemId: `it-${key}`,
  name,
})

const result = (over: Partial<SandboxRunResult>): SandboxRunResult => ({
  ok: true,
  engine: 'spark',
  cells: [],
  reads: [],
  writes: [],
  table_schemas: {},
  column_lineage: [],
  log: [],
  saw_credentials: false,
  error: null,
  ...over,
})

const ran = (name: string, r: SandboxRunResult): StepResult => ({
  status: 'ok',
  runs: [{ name, status: 'ok', result: r }],
})

/** raw -> notebook -> silver, with schemas on both tables. */
function simpleRun() {
  const s = step('a', 'enrich')
  const results = new Map([
    [
      s.key,
      ran(
        'enrich',
        result({
          reads: ['raw_orders'],
          writes: ['silver_orders'],
          table_schemas: {
            raw_orders: [
              { name: 'id', type: 'bigint' },
              { name: 'amount', type: 'double' },
            ],
            silver_orders: [
              { name: 'id', type: 'bigint' },
              { name: 'total', type: 'double' },
            ],
          },
          column_lineage: [
            { to_table: 'silver_orders', to_column: 'total', from_column: 'amount', transform: 'amount * 1.2' },
          ],
        }),
      ),
    ],
  ])
  return { steps: [s], results }
}

describe('sequenceToModel', () => {
  it('lays sources, steps and outputs into dependency-ordered layers', () => {
    const { steps, results } = simpleRun()
    const { model } = sequenceToModel(steps, results, 'M')
    expect(model.layers.map((l) => l.name)).toEqual([
      'Source tables',
      'Notebooks & pipelines',
      'Output tables',
    ])
    expect(model.layers[0].objects.map((o) => o.name)).toEqual(['raw_orders'])
    expect(model.layers[1].objects.map((o) => o.name)).toEqual(['enrich'])
    expect(model.layers[2].objects.map((o) => o.name)).toEqual(['silver_orders'])
  })

  it('gives table objects their columns as attributes, typed via properties', () => {
    const { steps, results } = simpleRun()
    const { model } = sequenceToModel(steps, results, 'M')
    const raw = model.layers[0].objects[0]
    expect(raw.children.map((a) => a.name)).toEqual(['id', 'amount'])
    expect(model.properties[raw.children[1].id]).toEqual({ 'Data type': 'double' })
    // A notebook is an object with no attributes — its I/O is the transitions.
    expect(model.layers[1].objects[0].children).toEqual([])
  })

  it('draws read and write transitions between objects', () => {
    const { steps, results } = simpleRun()
    const { model } = sequenceToModel(steps, results, 'M')
    const [raw] = model.layers[0].objects
    const [nb] = model.layers[1].objects
    const [silver] = model.layers[2].objects
    const pair = (s: string, t: string) =>
      model.transitions.find((x) => x.source === s && x.target === t)
    expect(model.properties[pair(raw.id, nb.id)!.id].Access).toBe('Read')
    expect(model.properties[pair(nb.id, silver.id)!.id].Access).toBe('Write')
  })

  it('draws a column transition and records its transform', () => {
    const { steps, results } = simpleRun()
    const { model, stats } = sequenceToModel(steps, results, 'M')
    const amount = model.layers[0].objects[0].children.find((a) => a.name === 'amount')!
    const total = model.layers[2].objects[0].children.find((a) => a.name === 'total')!
    const t = model.transitions.find((x) => x.source === amount.id && x.target === total.id)
    expect(t).toBeDefined()
    expect(model.properties[t!.id]).toMatchObject({ Via: 'enrich', Transform: 'amount * 1.2' })
    expect(stats.columnEdges).toBe(1)
  })

  it('skips a column edge when the source column name is ambiguous', () => {
    const s = step('a', 'join')
    const results = new Map([
      [
        s.key,
        ran(
          'join',
          result({
            reads: ['left_t', 'right_t'],
            writes: ['out_t'],
            table_schemas: {
              left_t: [{ name: 'id' }],
              right_t: [{ name: 'id' }],
              out_t: [{ name: 'id' }],
            },
            // `id` exists on both inputs — unresolvable, so no column edge.
            column_lineage: [{ to_table: 'out_t', to_column: 'id', from_column: 'id' }],
          }),
        ),
      ],
    ])
    const { stats } = sequenceToModel([s], results, 'M')
    expect(stats.columnEdges).toBe(0)
    // The object-level lineage still stands.
    expect(stats.transitions).toBe(3)
  })

  it('chains two steps so a written table feeds the next step', () => {
    const a = step('a', 'build_silver')
    const b = step('b', 'build_gold')
    const results = new Map([
      [a.key, ran('build_silver', result({ reads: ['raw'], writes: ['silver'] }))],
      [b.key, ran('build_gold', result({ reads: ['silver'], writes: ['gold'] }))],
    ])
    const { model } = sequenceToModel([a, b], results, 'M')
    expect(model.layers.map((l) => l.name)).toEqual([
      'Source tables',
      'Notebooks & pipelines',
      'Tables',
      'Notebooks & pipelines',
      'Output tables',
    ])
    expect(model.layers[2].objects.map((o) => o.name)).toEqual(['silver'])
  })

  it('records provenance properties on every object', () => {
    const { steps, results } = simpleRun()
    const { model } = sequenceToModel(steps, results, 'M')
    expect(model.properties[model.layers[1].objects[0].id]).toMatchObject({
      Source: 'Fabric sandbox',
      Kind: 'Notebook',
      Step: '1',
      Workspace: 'ws1',
    })
  })
})

describe('defaultModelName', () => {
  it('names a single-step sequence after its step', () => {
    expect(defaultModelName([step('a', 'ltv')])).toBe('ltv')
  })
  it('counts the rest for a multi-step sequence', () => {
    expect(defaultModelName([step('a', 'ltv'), step('b', 'x'), step('c', 'y')])).toBe('ltv +2')
  })
})
