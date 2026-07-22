import { isValidElement } from 'react'
import { describe, expect, it } from 'vitest'
import type { AppModel } from '../../model'
import { GROUP_ORDER, MAX_PER_GROUP, hl, search } from '../search'

function baseModel(): AppModel {
  return {
    source: 'sample',
    tables: [],
    notebooks: [],
    colEdges: [],
    ops: [],
    xform: {},
    levels: {},
    levelTable: {},
    notebookCode: {},
    context: {},
  }
}

describe('search (NAV-01, ported from SearchPalette.tsx)', () => {
  it('returns [] for an empty (or whitespace-only) query', () => {
    const model = baseModel()
    model.tables = [{ id: 't1', name: 'orders_clean', layer: 'silver', c: 'silver', x: 0, y: 0, columns: [] }]
    expect(search(model, '')).toEqual([])
    expect(search(model, '   ')).toEqual([])
  })

  it('returns matches from every kind, grouped in GROUP_ORDER (table -> column -> notebook -> code)', () => {
    const model = baseModel()
    model.tables = [
      { id: 't1', name: 'orders_clean', layer: 'silver', c: 'silver', x: 0, y: 0, columns: [
        { key: 't1.order_id', name: 'order_id', type: 'long', pk: true },
      ] },
    ]
    model.notebooks = [{ id: 'nb1', name: 'order_report', x: 0, y: 0 }]
    model.notebookCode = { nb1: 'print("order total")\nother line' }

    const results = search(model, 'order')

    // Assert stable GROUP_ORDER: once we've moved past a kind, no earlier
    // kind can reappear later in the array.
    let lastKindIndex = -1
    for (const r of results) {
      const kindIndex = GROUP_ORDER.indexOf(r.kind)
      expect(kindIndex).toBeGreaterThanOrEqual(lastKindIndex)
      lastKindIndex = kindIndex
    }
    expect(results.some((r) => r.kind === 'table' && r.label === 'orders_clean')).toBe(true)
    expect(results.some((r) => r.kind === 'column' && r.label === 'order_id')).toBe(true)
    expect(results.some((r) => r.kind === 'notebook' && r.label === 'order_report')).toBe(true)
    expect(results.some((r) => r.kind === 'code' && r.notebookId === 'nb1')).toBe(true)
  })

  it('caps a group exceeding MAX_PER_GROUP (8) matches at 8', () => {
    const model = baseModel()
    model.tables = Array.from({ length: 12 }, (_, i) => ({
      id: `t${i}`, name: `zzz_table_${i}`, layer: 'bronze', c: 'bronze', x: 0, y: 0, columns: [],
    }))

    const results = search(model, 'zzz_table')
    const tableResults = results.filter((r) => r.kind === 'table')
    expect(tableResults).toHaveLength(MAX_PER_GROUP)
  })

  it('a code match carries the notebook label, a line number, and the matched line text as context', () => {
    const model = baseModel()
    model.notebooks = [{ id: 'nb1', name: 'clean_orders', x: 0, y: 0 }]
    model.notebookCode = { nb1: 'line one\nspark.read.table("bronze.raw_orders")\nline three' }

    const results = search(model, 'spark.read')
    const codeResults = results.filter((r) => r.kind === 'code')
    expect(codeResults).toHaveLength(1)
    expect(codeResults[0]).toMatchObject({
      kind: 'code',
      notebookId: 'nb1',
      label: 'clean_orders',
      line: 2,
      context: 'spark.read.table("bronze.raw_orders")',
    })
  })
})

describe('hl (highlight helper)', () => {
  it('returns the plain text unchanged when the query is empty', () => {
    expect(hl('hello world', '')).toBe('hello world')
  })

  it('produces React nodes (a <mark> element per match), never an HTML string', () => {
    const nodes = hl('order_id and order_date', 'order')
    expect(Array.isArray(nodes)).toBe(true)
    const marks = (nodes as unknown[]).filter(isValidElement)
    expect(marks.length).toBe(2)
    for (const mark of marks) {
      expect((mark as { type: string }).type).toBe('mark')
    }
    // Never a concatenated HTML string (T-02-06).
    expect(typeof nodes).not.toBe('string')
  })
})
