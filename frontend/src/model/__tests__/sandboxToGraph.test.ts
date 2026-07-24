import { describe, expect, it } from 'vitest'
import { sandboxRunToGraph } from '../sandboxToGraph'
import type { SandboxRunResult } from '../../api'

const run = (reads: string[], writes: string[]): SandboxRunResult => ({
  ok: true,
  engine: 'stub',
  cells: [],
  reads,
  writes,
  log: [],
  saw_credentials: false,
  error: null,
})

describe('sandboxRunToGraph', () => {
  it('builds a workspace → notebook → tables graph with reads/writes edges', () => {
    const g = sandboxRunToGraph(run(['raw_orders'], ['vw_sales']), 'load_sales')
    const kinds = g.nodes.map((n) => `${n.kind}:${n.name}`)
    expect(kinds).toContain('notebook:load_sales')
    expect(kinds).toContain('table:raw_orders')
    expect(kinds).toContain('table:vw_sales')

    const read = g.edges.find((e) => e.kind === 'reads')!
    const write = g.edges.find((e) => e.kind === 'writes')!
    expect(read.target).toBe('notebook.load_sales')
    expect(read.source).toBe('table.raw_orders')
    expect(write.source).toBe('notebook.load_sales')
    expect(write.target).toBe('table.vw_sales')
  })

  it('emits one table node when a table is both read and written', () => {
    const g = sandboxRunToGraph(run(['t'], ['t']), 'nb')
    expect(g.nodes.filter((n) => n.kind === 'table')).toHaveLength(1)
  })
})
