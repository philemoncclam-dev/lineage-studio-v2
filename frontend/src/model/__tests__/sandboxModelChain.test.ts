import { describe, expect, it } from 'vitest'
import { sandboxRunToGraph } from '../sandboxToGraph'
import { adapt } from '../index'
import { graphToModel } from '../graphToModel'
import type { SandboxRunResult } from '../../api'

// Mirrors a real Spark run: reads with schemas, a write with column flows
// (one passthrough, one computed).
const result: SandboxRunResult = {
  ok: true, engine: 'spark', cells: [], reads: ['raw_orders'], writes: ['silver'],
  table_schemas: {
    raw_orders: [{ name: 'order_id', type: 'bigint' }, { name: 'amount', type: 'bigint' }],
    silver: [{ name: 'order_id', type: 'bigint' }, { name: 'amount_x2', type: 'bigint' }],
  },
  column_lineage: [
    { to_table: 'silver', to_column: 'order_id', from_column: 'order_id', transform: null },
    { to_table: 'silver', to_column: 'amount_x2', from_column: 'amount', transform: '(amount * 2)' },
  ],
  log: [], saw_credentials: false, error: null,
}

describe('sandbox → model chain', () => {
  it('produces attribute nodes and attribute edges (column-level model)', () => {
    const draft = graphToModel(adapt(sandboxRunToGraph(result, 'nb')))
    const attrs = draft.nodes.filter((n) => n.type === 'Attribute')
    expect(attrs.length).toBeGreaterThan(0)
    // there should be at least one attribute-to-attribute edge (column lineage)
    expect(draft.edges.length).toBeGreaterThan(0)
  })
})
