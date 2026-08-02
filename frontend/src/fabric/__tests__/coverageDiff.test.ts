// What the canvas now claims about a run, and what changed since the last one.
import { describe, expect, it } from 'vitest'
import { coverageOf, coverageSummary } from '../coverage'
import { columnKey, diffIsClean, diffRuns } from '../runDiff'
import type { StepResult } from '../sequence'
import type { SandboxRunResult } from '../../api'

const result = (over: Partial<SandboxRunResult>): SandboxRunResult => ({
  ok: true,
  engine: 'stub',
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

const step = (r: SandboxRunResult): StepResult => ({
  status: 'ok',
  runs: [{ name: 'nb', status: 'ok', result: r }],
})

const results = (...rs: SandboxRunResult[]) =>
  new Map(rs.map((r, i) => [`s${i}`, step(r)] as const))

describe('coverageOf', () => {
  it('calls a table traced when the run resolved lineage into it', () => {
    const r = results(
      result({
        reads: ['raw'],
        writes: ['silver'],
        table_schemas: { raw: [{ name: 'id' }], silver: [{ name: 'id' }] },
        column_lineage: [{ to_table: 'silver', to_column: 'id', from_column: 'id' }],
      }),
    )
    expect(coverageOf(r).get('silver')!.level).toBe('traced')
  })

  it('names the DataFrame API when a write came back bare on a SQL-only engine', () => {
    const r = results(
      result({
        writes: ['silver'],
        table_schemas: { silver: [{ name: 'id' }] },
        coverage: {
          cells: 1, sql_cells: 0, sql_statements: 0,
          dataframe_write_cells: 1, dynamic_sql_cells: 0, unparsable_cells: 0,
          writes: 1, writes_with_column_lineage: 0, writes_without_column_lineage: ['silver'],
        },
      }),
    )
    const cov = coverageOf(r).get('silver')!
    expect(cov.level).toBe('columns-only')
    expect(cov.reason).toContain('DataFrame API')
  })

  it('separates "schema unreadable" from "no lineage" — they are different claims', () => {
    const r = results(
      result({
        reads: ['locked'],
        schema_resolution: { requested: ['locked'], resolved: [], unresolved: ['locked'], failures: ['403 Forbidden'] },
      }),
    )
    const cov = coverageOf(r).get('locked')!
    expect(cov.level).toBe('bare')
    expect(cov.reason).toContain('403 Forbidden')
  })

  it('merges optimistically — one run resolving a table settles it', () => {
    // Step 1 could not read the schema; step 2 wrote it and traced it. The
    // pessimistic merge would report it bare on the strength of step 1.
    const r = results(
      result({
        reads: ['t'],
        schema_resolution: { requested: ['t'], resolved: [], unresolved: ['t'], failures: [] },
      }),
      result({
        writes: ['t'],
        table_schemas: { t: [{ name: 'id' }] },
        column_lineage: [{ to_table: 't', to_column: 'id', from_column: 'id' }],
      }),
    )
    expect(coverageOf(r).get('t')!.level).toBe('traced')
  })

  it('counts the run for the strip above the canvas', () => {
    const r = results(
      result({
        reads: ['raw'],
        writes: ['silver'],
        table_schemas: { raw: [{ name: 'id' }], silver: [{ name: 'id' }] },
        column_lineage: [{ to_table: 'silver', to_column: 'id', from_column: 'id' }],
      }),
    )
    expect(coverageSummary(r)).toMatchObject({ tables: 2, traced: 1, columnsOnly: 1, bare: 0 })
  })
})

describe('diffRuns', () => {
  const before = results(
    result({
      reads: ['raw'],
      writes: ['silver'],
      table_schemas: { silver: [{ name: 'id' }, { name: 'total' }] },
      column_lineage: [{ to_table: 'silver', to_column: 'id', from_column: 'id' }],
    }),
  )

  it('has nothing to say without a previous run', () => {
    expect(diffRuns(null, before).empty).toBe(true)
  })

  it('finds a new table, a dropped one, and the columns either way', () => {
    const after = results(
      result({
        reads: ['raw'],
        writes: ['gold'],
        table_schemas: { gold: [{ name: 'id' }] },
        column_lineage: [{ to_table: 'gold', to_column: 'id', from_column: 'id' }],
      }),
    )
    const d = diffRuns(before, after)
    expect([...d.addedTables]).toEqual(['gold'])
    expect([...d.removedTables]).toEqual(['silver'])
    expect([...d.removedColumns].sort()).toEqual([columnKey('silver', 'id'), columnKey('silver', 'total')])
    expect(diffIsClean(d)).toBe(false)
  })

  it('reports lineage that stopped resolving on a table still being written', () => {
    // The regression a sandbox exists to catch: same tables, same columns, but
    // the run no longer knows where anything came from.
    const after = results(
      result({
        reads: ['raw'],
        writes: ['silver'],
        table_schemas: { silver: [{ name: 'id' }, { name: 'total' }] },
      }),
    )
    const d = diffRuns(before, after)
    expect([...d.lostLineage]).toEqual(['silver'])
    expect(d.removedTables.size).toBe(0)
  })

  it('says nothing changed when nothing changed', () => {
    expect(diffIsClean(diffRuns(before, before))).toBe(true)
  })
})
