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
