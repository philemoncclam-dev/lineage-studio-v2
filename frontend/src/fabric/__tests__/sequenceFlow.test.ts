import { describe, expect, it } from 'vitest'
import { buildFlow } from '../SequenceCanvas'
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
  tables: {},
  workspace: '',
  log: [],
  saw_credentials: false,
  error: null,
  ...over,
})

const ran = (name: string, r: SandboxRunResult): StepResult => ({
  status: 'ok',
  runs: [{ name, status: 'ok', result: r }],
})

describe('buildFlow', () => {
  it('gives a table card one row per column of the resolved schema', () => {
    const s = step('a', 'load')
    const results = new Map([
      [
        s.key,
        ran(
          'load',
          result({
            writes: ['silver.customer'],
            table_schemas: {
              'silver.customer': [
                { name: 'id', type: 'bigint' },
                { name: 'email', type: 'string' },
              ],
            },
          }),
        ),
      ],
    ])

    const { nodes } = buildFlow([s], results)
    const table = nodes.find((n) => n.kind === 'table')!
    expect(table.label).toBe('silver.customer')
    expect(table.rows.map((r) => r.label)).toEqual(['id', 'email'])
    expect(table.rows.every((r) => r.tone === 'col')).toBe(true)
    expect(table.rows[0].meta).toBe('bigint')
    expect(table.sub).toBe('2 cols')
  })

  it('leaves a table bare when no run resolved its schema (stub engine)', () => {
    const s = step('a', 'load')
    const results = new Map([[s.key, ran('load', result({ reads: ['bronze.raw'] }))]])
    const { nodes } = buildFlow([s], results)
    const table = nodes.find((n) => n.kind === 'table')!
    expect(table.rows).toEqual([])
    expect(table.sub).toBeUndefined()
  })

  it('describes a table from whichever step resolved its columns', () => {
    const a = step('a', 'writer')
    const b = step('b', 'reader')
    const results = new Map([
      // The reader touches the table first in step order but knows no schema.
      [a.key, ran('writer', result({ reads: ['gold.sales'] }))],
      [
        b.key,
        ran('reader', result({ writes: ['gold.sales'], table_schemas: { 'gold.sales': [{ name: 'amt' }] } })),
      ],
    ])
    const { nodes } = buildFlow([a, b], results)
    const table = nodes.find((n) => n.kind === 'table')!
    expect(table.rows.map((r) => r.label)).toEqual(['amt'])
  })
})


// --- workspaces ------------------------------------------------------------
// A notebook can read and write across workspaces, so a bare table name is not
// an identity. These pin the two behaviours that follow from that.

const ref = (ws: string, lh: string, t: string) => `${ws}/${lh}/${t}`
const refs = (...rs: [string, string, string][]) =>
  Object.fromEntries(
    rs.map(([ws, lh, t]) => [ref(ws, lh, t), { workspace: ws, lakehouse: lh, table: t, resolved: true }]),
  )

describe('buildFlow across workspaces', () => {
  it('keeps two same-named tables in different workspaces as separate cards', () => {
    const s = step('a', 'nb')
    const results = new Map<string, StepResult>([
      [
        'a',
        {
          status: 'ok',
          runs: [
            {
              name: 'nb',
              status: 'ok',
              result: result({
                workspace: 'Analytics',
                reads: [ref('Finance', 'Gold', 'customers'), ref('Marketing', 'Gold', 'customers')],
                tables: refs(['Finance', 'Gold', 'customers'], ['Marketing', 'Gold', 'customers']),
              }),
            },
          ],
        },
      ],
    ])
    const { nodes } = buildFlow([s], results)
    const tables = nodes.filter((n) => n.kind === 'table')
    expect(tables).toHaveLength(2)
    // both display as `customers`, but carry different workspaces
    expect(tables.map((t) => t.label)).toEqual(['customers', 'customers'])
    expect(tables.map((t) => t.ws).sort()).toEqual(['Finance', 'Marketing'])
  })

  it("marks a step's I/O row when the table is in another workspace", () => {
    const s = step('a', 'nb')
    const results = new Map<string, StepResult>([
      [
        'a',
        {
          status: 'ok',
          runs: [
            {
              name: 'nb',
              status: 'ok',
              result: result({
                workspace: 'Analytics',
                reads: [ref('Analytics', 'Bronze', 'orders')],
                writes: [ref('Finance', 'Gold', 'ltv')],
                tables: refs(['Analytics', 'Bronze', 'orders'], ['Finance', 'Gold', 'ltv']),
              }),
            },
          ],
        },
      ],
    ])
    const { nodes } = buildFlow([s], results)
    const stepNode = nodes.find((n) => n.kind === 'notebook')!
    const own = stepNode.rows.find((r) => r.label === 'orders')!
    const foreign = stepNode.rows.find((r) => r.label === 'ltv')!
    // the notebook's own workspace is not repeated on the row; another one is
    expect(own.meta).toBeUndefined()
    expect(foreign.meta).toBe('Finance')
  })
})
