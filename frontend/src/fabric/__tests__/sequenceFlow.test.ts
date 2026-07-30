import { describe, expect, it } from 'vitest'
import { buildFlow, truncateRows, type FlowNode, type FlowRow } from '../SequenceCanvas'
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


// --- columns nested under an access ----------------------------------------
// A step card's table rows carry the table's schema underneath them, so an edge
// leaves a column and lands on that column. Without it the relationship between
// an access and the table's attributes is only the indent, which is what the
// canvas is supposed to be replacing.

const pipelineStep = (key: string, name: string): Step => ({
  key,
  kind: 'pipeline',
  ws: 'ws1',
  itemId: `it-${key}`,
  name,
})

describe('buildFlow columns under a step access', () => {
  const schema = {
    'silver.customer': [
      { name: 'id', type: 'bigint' },
      { name: 'email', type: 'string' },
    ],
  }

  it('nests a table’s columns under the row that reads it', () => {
    const s = step('a', 'load')
    const results = new Map([
      [s.key, ran('load', result({ reads: ['silver.customer'], table_schemas: schema }))],
    ])
    const { nodes } = buildFlow([s], results)
    const stepNode = nodes.find((n) => n.kind === 'notebook')!
    expect(stepNode.rows.map((r) => r.label)).toEqual(['silver.customer', 'id', 'email'])
    const [table, ...cols] = stepNode.rows
    expect(table.tone).toBe('read')
    // One level in from the access, and owned by it.
    expect(cols.every((c) => c.tone === 'col' && c.depth === 1 && c.group === table.key)).toBe(true)
    expect(cols[0].meta).toBe('bigint')
  })

  it('nests them one level deeper inside a pipeline, under the activity', () => {
    const p = pipelineStep('p', 'nightly')
    const results = new Map<string, StepResult>([
      [
        'p',
        {
          status: 'ok',
          runs: [
            {
              name: 'nb_silver',
              status: 'ok',
              result: result({ writes: ['silver.customer'], table_schemas: schema }),
            },
          ],
        },
      ],
    ])
    const { nodes } = buildFlow([p], results)
    const rows = nodes.find((n) => n.kind === 'pipeline')!.rows
    // activity -> table -> columns, each a level in from the last
    expect(rows.map((r) => [r.label, r.tone, r.depth ?? 0])).toEqual([
      ['nb_silver', 'run', 0],
      ['silver.customer', 'write', 1],
      ['id', 'col', 2],
      ['email', 'col', 2],
    ])
  })

  it('keeps the same table under two activities as two independent groups', () => {
    const p = pipelineStep('p', 'nightly')
    const runOf = (name: string) => ({
      name,
      status: 'ok' as const,
      result: result({ reads: ['silver.customer'], table_schemas: schema }),
    })
    const results = new Map<string, StepResult>([
      ['p', { status: 'ok', runs: [runOf('nb_one'), runOf('nb_two')] }],
    ])
    const { nodes } = buildFlow([p], results)
    const cols = nodes.find((n) => n.kind === 'pipeline')!.rows.filter((r) => r.tone === 'col')
    // Two accesses, so the schema appears twice — and the two runs must not
    // share a group, or expanding one would expand both.
    expect(cols).toHaveLength(4)
    expect(new Set(cols.map((c) => c.group)).size).toBe(2)
    expect(new Set(cols.map((c) => c.key)).size).toBe(4)
  })

  it('leaves the access bare when no schema was resolved', () => {
    const s = step('a', 'load')
    const results = new Map([[s.key, ran('load', result({ reads: ['bronze.raw'] }))]])
    const { nodes } = buildFlow([s], results)
    const rows = nodes.find((n) => n.kind === 'notebook')!.rows
    expect(rows.map((r) => r.tone)).toEqual(['read'])
  })
})

describe('buildFlow column edges', () => {
  const schema = { 'gold.sales': [{ name: 'amt', type: 'double' }] }

  it('pairs every table-level edge with a column edge that shares its group', () => {
    const s = step('a', 'load')
    const results = new Map([
      [s.key, ran('load', result({ writes: ['gold.sales'], table_schemas: schema }))],
    ])
    const { nodes, edges } = buildFlow([s], results)
    const stepId = nodes.find((n) => n.kind === 'notebook')!.id
    const tableId = nodes.find((n) => n.kind === 'table')!.id

    const table = edges.find((e) => e.kind === 'table')!
    const column = edges.find((e) => e.kind === 'column')!
    expect(table.group).toBe(column.group)

    // The column edge runs row-to-row: the step's nested column across to the
    // same column on the table card.
    expect(column.from).toBe(stepId)
    expect(column.to).toBe(tableId)
    expect(column.toRow).toBe('c:amt')
    expect(column.fromRow?.endsWith('>c:amt')).toBe(true)
    expect(column.tone).toBe('write')
  })

  it('emits no column edge for a table whose schema is unknown', () => {
    const s = step('a', 'load')
    const results = new Map([[s.key, ran('load', result({ writes: ['gold.sales'] }))]])
    const { edges } = buildFlow([s], results)
    expect(edges.filter((e) => e.kind === 'column')).toHaveLength(0)
    expect(edges.filter((e) => e.kind === 'table')).toHaveLength(1)
  })

  it('points a read column edge from the table into the step', () => {
    const s = step('a', 'load')
    const results = new Map([
      [s.key, ran('load', result({ reads: ['gold.sales'], table_schemas: schema }))],
    ])
    const { nodes, edges } = buildFlow([s], results)
    const tableId = nodes.find((n) => n.kind === 'table')!.id
    const column = edges.find((e) => e.kind === 'column')!
    // Built in true direction; the sequence view flips it for layout.
    expect(column.from).toBe(tableId)
    expect(column.fromRow).toBe('c:amt')
    expect(column.tone).toBe('read')
  })
})

// --- truncation ------------------------------------------------------------
// Each run of column rows collapses on its own. A step card holds one run per
// access, so a shared expansion key would open every table's columns at once.

describe('truncateRows', () => {
  const cols = (group: string | undefined, n: number): FlowRow[] =>
    Array.from({ length: n }, (_, i) => ({
      key: `${group ?? 't'}:c${i}`,
      label: `c${i}`,
      tone: 'col' as const,
      group,
    }))
  const node = (rows: FlowRow[]): FlowNode => ({
    id: 'n1',
    kind: 'notebook',
    label: 'nb',
    rows,
    allRows: rows,
  })

  it('caps a table card’s own columns at eight and offers the rest', () => {
    const out = truncateRows(node(cols(undefined, 12)), new Set())
    expect(out).toHaveLength(9)
    expect(out[8].label).toBe('+4 more')
  })

  it('caps a nested group at five, lower than a whole card', () => {
    const out = truncateRows(node(cols('r:orders', 12)), new Set())
    expect(out).toHaveLength(6)
    expect(out[5].label).toBe('+7 more')
  })

  it('expands one group without touching its neighbour', () => {
    const rows = [
      { key: 'r:a', label: 'a', tone: 'read' as const },
      ...cols('r:a', 8),
      { key: 'r:b', label: 'b', tone: 'read' as const },
      ...cols('r:b', 8),
    ]
    const out = truncateRows(node(rows), new Set(['n1::r:a']))
    const labels = out.map((r) => r.label)
    // a is open: all eight and a "Show less"; b is still capped at five.
    expect(labels.filter((l) => l === 'Show less')).toHaveLength(1)
    expect(labels.filter((l) => l === '+3 more')).toHaveLength(1)
    expect(out.filter((r) => r.tone === 'col' && r.group === 'r:a' && !r.key.startsWith('__more')))
      .toHaveLength(8)
    expect(out.filter((r) => r.tone === 'col' && r.group === 'r:b' && !r.key.startsWith('__more')))
      .toHaveLength(5)
  })

  it('leaves short runs and non-column rows alone', () => {
    const rows = [
      { key: 'a:0', label: 'act', tone: 'run' as const },
      { key: 'r:a', label: 'orders', tone: 'read' as const },
      ...cols('r:a', 2),
    ]
    expect(truncateRows(node(rows), new Set())).toEqual(rows)
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
