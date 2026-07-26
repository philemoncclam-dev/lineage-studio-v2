// The overview dashboard's headline numbers are only as trustworthy as the
// bucketing, and the bucketing is the one place a Fabric item type can be
// silently miscounted. These pin the contract: a table and a Power BI report
// are both "data assets", dataflows count as pipelines, and nothing that isn't
// a workspace ever falls out of the total.
import { describe, expect, it } from 'vitest'
import type { FabricCatalogEntry } from '../../api'
import { bucketOf, countByWorkspace, countEntries } from '../fabric/-assetTypes'
import { scopeLabel } from '../fabric/-exportOverview'

const entry = (e: Partial<FabricCatalogEntry>): FabricCatalogEntry => ({
  kind: 'item',
  workspace_id: 'ws1',
  workspace_name: 'Sales',
  id: 'x',
  name: 'x',
  ...e,
})

describe('bucketOf', () => {
  it('counts tables, lakehouses and BI items as data assets', () => {
    expect(bucketOf(entry({ kind: 'table', item_type: 'Table' }))).toBe('data')
    expect(bucketOf(entry({ kind: 'lakehouse', item_type: 'Lakehouse' }))).toBe('data')
    expect(bucketOf(entry({ item_type: 'Report' }))).toBe('data')
    expect(bucketOf(entry({ item_type: 'SemanticModel' }))).toBe('data')
    expect(bucketOf(entry({ item_type: 'Warehouse' }))).toBe('data')
  })

  it('counts data pipelines and dataflows as pipelines', () => {
    expect(bucketOf(entry({ item_type: 'DataPipeline' }))).toBe('pipeline')
    expect(bucketOf(entry({ item_type: 'Dataflow' }))).toBe('pipeline')
  })

  it('counts notebooks as notebooks, and unknown types as other', () => {
    expect(bucketOf(entry({ kind: 'notebook', item_type: 'Notebook' }))).toBe('notebook')
    expect(bucketOf(entry({ item_type: 'Environment' }))).toBe('other')
    expect(bucketOf(entry({ item_type: 'SomeFutureItem' }))).toBe('other')
  })

  it('excludes the workspace row itself from every bucket', () => {
    expect(bucketOf(entry({ kind: 'workspace' }))).toBeNull()
  })
})

describe('countEntries', () => {
  const entries = [
    entry({ kind: 'workspace', id: 'ws1', name: 'Sales' }),
    entry({ kind: 'table', item_type: 'Table', name: 't1' }),
    entry({ kind: 'table', item_type: 'Table', name: 't2' }),
    entry({ kind: 'lakehouse', item_type: 'Lakehouse', name: 'LH' }),
    entry({ item_type: 'Report', name: 'r1' }),
    entry({ kind: 'notebook', item_type: 'Notebook', name: 'nb' }),
    entry({ item_type: 'DataPipeline', name: 'pl' }),
    entry({ item_type: 'Environment', name: 'env' }),
  ]

  it('splits the totals across the four tiles', () => {
    const c = countEntries(entries)
    expect(c.data).toBe(4)
    expect(c.notebook).toBe(1)
    expect(c.pipeline).toBe(1)
    expect(c.other).toBe(1)
    expect(c.total).toBe(7) // everything but the workspace row
  })

  it('breaks data assets into table / store / BI slices that re-sum to data', () => {
    const c = countEntries(entries)
    expect([c.table, c.store, c.bi]).toEqual([2, 1, 1])
    expect(c.table + c.store + c.bi).toBe(c.data)
  })
})

describe('countByWorkspace', () => {
  it('keeps a row for a workspace with no items', () => {
    const rows = countByWorkspace([
      entry({ kind: 'workspace', workspace_id: 'ws2', workspace_name: 'Empty', id: 'ws2' }),
    ])
    expect(rows).toHaveLength(1)
    expect(rows[0]).toMatchObject({ id: 'ws2', name: 'Empty', total: 0 })
  })

  it('sorts the richest workspace first', () => {
    const rows = countByWorkspace([
      entry({ kind: 'workspace', workspace_id: 'ws1', workspace_name: 'Sales', id: 'ws1' }),
      entry({ kind: 'workspace', workspace_id: 'ws2', workspace_name: 'Ops', id: 'ws2' }),
      entry({ kind: 'table', workspace_id: 'ws2', workspace_name: 'Ops', name: 't1' }),
      entry({ kind: 'table', workspace_id: 'ws2', workspace_name: 'Ops', name: 't2' }),
      entry({ kind: 'notebook', item_type: 'Notebook', workspace_id: 'ws1', name: 'nb' }),
    ])
    expect(rows.map((r) => r.name)).toEqual(['Ops', 'Sales'])
    expect(rows[0].data).toBe(2)
    expect(rows[1].notebook).toBe(1)
  })
})

describe('scopeLabel', () => {
  // The export is a snapshot of a filtered view, so the scope has to be stated
  // — an unlabelled sheet of counts reads as if it covered the whole tenant.
  it('names the workspaces when the filter is narrow', () => {
    expect(scopeLabel([])).toBe('All workspaces')
    expect(scopeLabel(['Sales'])).toBe('Sales')
    expect(scopeLabel(['Sales', 'Ops'])).toBe('Sales, Ops')
  })

  it('falls back to a count once naming them would be unreadable', () => {
    expect(scopeLabel(['a', 'b', 'c', 'd'])).toBe('4 workspaces')
  })
})
