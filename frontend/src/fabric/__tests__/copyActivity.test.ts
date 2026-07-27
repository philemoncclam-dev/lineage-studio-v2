// A pipeline Copy activity contributing lineage without anything running.
//
// The sandbox has nothing to execute for a pipeline, and the run loop used to
// skip any activity without a notebook — so a pipeline whose whole job was a
// Copy produced no lineage at all. A Copy declares its datasets and its column
// mapping inline, so the backend parses them and this shapes them as a run.
import { describe, expect, it } from 'vitest'
import { copyActivityRun } from '../sequence'
import { refParts } from '../../api'
import type { FabricPipelineActivity } from '../../api'

const activity = (over: Partial<FabricPipelineActivity> = {}): FabricPipelineActivity => ({
  name: 'Copy customers',
  type: 'Copy',
  depends_on: [],
  reads: [],
  writes: [],
  column_lineage: [],
  ...over,
})

const RAW = 'Finance/Bronze/raw_customers'
const DIM = 'Finance/Gold/dim_customer'

describe('copyActivityRun', () => {
  it('is null for an activity that named no tables', () => {
    // A Lookup or a Wait must not become an empty node on the canvas.
    expect(copyActivityRun(activity({ type: 'Wait' }))).toBeNull()
  })

  it('carries the declared tables through as a run', () => {
    const run = copyActivityRun(activity({ reads: [RAW], writes: [DIM] }))!
    expect(run.status).toBe('ok')
    expect(run.result!.reads).toEqual([RAW])
    expect(run.result!.writes).toEqual([DIM])
  })

  it('says the lineage came from a definition, not from an engine', () => {
    const run = copyActivityRun(activity({ writes: [DIM] }))!
    expect(run.result!.engine).toBe('definition')
  })

  it('builds the table side table itself, since no backend run supplied one', () => {
    const run = copyActivityRun(activity({ writes: [DIM] }))!
    expect(run.result!.tables![DIM]!).toEqual({
      workspace: 'Finance',
      lakehouse: 'Gold',
      table: 'dim_customer',
      resolved: true,
    })
  })

  it('takes each table’s columns from the mapping that moves them', () => {
    const run = copyActivityRun(
      activity({
        reads: [RAW],
        writes: [DIM],
        column_lineage: [
          { to_table: DIM, to_column: 'customer_id', from_column: 'id', from_table: RAW },
          { to_table: DIM, to_column: 'name', from_column: 'nm', from_table: RAW },
        ],
      }),
    )!
    expect(run.result!.table_schemas[RAW].map((c) => c.name)).toEqual(['id', 'nm'])
    expect(run.result!.table_schemas[DIM].map((c) => c.name)).toEqual(['customer_id', 'name'])
    expect(run.result!.column_lineage).toHaveLength(2)
  })

  it('does not repeat a column that several mappings read from', () => {
    const run = copyActivityRun(
      activity({
        reads: [RAW],
        writes: [DIM],
        column_lineage: [
          { to_table: DIM, to_column: 'a', from_column: 'id', from_table: RAW },
          { to_table: DIM, to_column: 'b', from_column: 'id', from_table: RAW },
        ],
      }),
    )!
    expect(run.result!.table_schemas[RAW].map((c) => c.name)).toEqual(['id'])
  })
})

describe('refParts', () => {
  it('splits a canonical ref the way the Python does', () => {
    expect(refParts('Finance/Gold/dim_customer')).toEqual({
      workspace: 'Finance',
      lakehouse: 'Gold',
      table: 'dim_customer',
      resolved: true,
    })
  })

  it('reads an unknown workspace as unresolved rather than guessing one', () => {
    expect(refParts('//customers').resolved).toBe(false)
  })

  it('unescapes a segment that contained a separator', () => {
    expect(refParts('Fin%2FOps/Gold/t').workspace).toBe('Fin/Ops')
  })
})
