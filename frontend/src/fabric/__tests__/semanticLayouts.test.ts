// The two semantic canvas layouts. They were once relabellings of the flow and
// sequence columns; these tests pin the two properties that made them worth
// having as layouts of their own — Stages reads left to right, Workspace
// zig-zags — plus the lakehouse and pipeline containers both of them draw.
import { describe, expect, it } from 'vitest'
import { layoutStages, layoutWorkspaces, stageRank, type FlowNode } from '../SequenceCanvas'

const table = (name: string, lakehouse: string, ws = 'platform'): FlowNode => ({
  id: `t:${name}`,
  kind: 'table',
  label: name,
  lakehouse,
  ws,
  rows: [],
})

const step = (id: string, ws: string, kind: 'notebook' | 'pipeline' = 'notebook'): FlowNode => ({
  id: `s:${id}`,
  kind,
  label: id,
  ws,
  rows: [],
})

/** A medallion run: landing -> bronze -> silver -> gold, one notebook per hop. */
function medallion() {
  const nodes: FlowNode[] = [
    table('raw.orders', 'lh_landing'),
    step('to_bronze', 'engineering'),
    table('bronze.orders', 'lh_bronze'),
    step('to_silver', 'engineering'),
    table('silver.orders', 'lh_silver'),
    step('to_gold', 'engineering'),
    table('gold.orders', 'lh_gold'),
  ]
  const edges = [
    { from: 't:raw.orders', to: 's:to_bronze', tone: 'read' as const, kind: 'table' as const },
    { from: 's:to_bronze', to: 't:bronze.orders', tone: 'write' as const, kind: 'table' as const },
    { from: 't:bronze.orders', to: 's:to_silver', tone: 'read' as const, kind: 'table' as const },
    { from: 's:to_silver', to: 't:silver.orders', tone: 'write' as const, kind: 'table' as const },
    { from: 't:silver.orders', to: 's:to_gold', tone: 'read' as const, kind: 'table' as const },
    { from: 's:to_gold', to: 't:gold.orders', tone: 'write' as const, kind: 'table' as const },
  ]
  return { nodes, edges }
}

describe('stageRank', () => {
  it('finds a medallion stage as a token inside a lakehouse name', () => {
    expect(stageRank('lh_bronze')).toBeLessThan(stageRank('lh_silver'))
    expect(stageRank('Gold_LH')).toBe(stageRank('gold'))
  })

  it('does not match a stage buried in another word', () => {
    expect(stageRank('goldilocks')).toBe(-1)
    expect(stageRank('finance')).toBe(-1)
  })
})

describe('layoutStages', () => {
  it('orders bands by medallion stage and runs every edge to the right', () => {
    const { nodes, edges } = medallion()
    const { pos, bands } = layoutStages(nodes, edges)
    expect(bands.map((b) => b.label)).toEqual([
      'platform', // lh_landing
      'Into lh_bronze',
      'platform',
      'Into lh_silver',
      'platform',
      'Into lh_gold',
      'platform',
    ])
    for (const e of edges) expect(pos.get(e.from)!.x).toBeLessThan(pos.get(e.to)!.x)
  })

  it('points a write back into an earlier stage leftwards, and only that one', () => {
    const { nodes, edges } = medallion()
    // A gold job that back-fills bronze — the one thing this view exists to show.
    nodes.push(step('backfill', 'engineering'))
    edges.push(
      { from: 't:gold.orders', to: 's:backfill', tone: 'read' as const, kind: 'table' as const },
      { from: 's:backfill', to: 't:bronze.orders', tone: 'write' as const, kind: 'table' as const },
    )
    const { pos } = layoutStages(nodes, edges)
    const backward = edges.filter((e) => pos.get(e.to)!.x < pos.get(e.from)!.x)
    expect(backward).toEqual([{ from: 's:backfill', to: 't:bronze.orders', tone: 'write', kind: 'table' }])
  })

  it('keeps a table in its own stage however late it is written', () => {
    const { nodes, edges } = medallion()
    // A late step that re-reads gold and re-writes bronze would drag the bronze
    // table rightwards under dependency depth. Its stage is a property of the
    // table, so it does not move.
    const before = layoutStages(nodes, edges).pos.get('t:bronze.orders')!.x
    nodes.push(step('late', 'engineering'))
    edges.push(
      { from: 't:gold.orders', to: 's:late', tone: 'read' as const, kind: 'table' as const },
      { from: 's:late', to: 't:bronze.orders', tone: 'write' as const, kind: 'table' as const },
    )
    expect(layoutStages(nodes, edges).pos.get('t:bronze.orders')!.x).toBe(before)
  })

  it('boxes each lakehouse, and each pipeline on its own', () => {
    const nodes: FlowNode[] = [
      table('bronze.a', 'lh_bronze'),
      table('bronze.b', 'lh_bronze'),
      step('pl', 'engineering', 'pipeline'),
    ]
    const edges = [
      { from: 's:pl', to: 't:bronze.a', tone: 'write' as const, kind: 'table' as const },
      { from: 's:pl', to: 't:bronze.b', tone: 'write' as const, kind: 'table' as const },
    ]
    const { containers } = layoutStages(nodes, edges)
    expect(containers!.map((c) => [c.kind, c.label])).toEqual([
      ['pipeline', 'pl'],
      ['lakehouse', 'lh_bronze'],
    ])
    // The lakehouse box encloses both of its tables and nothing else.
    const lh = containers!.find((c) => c.kind === 'lakehouse')!
    const { pos } = layoutStages(nodes, edges)
    for (const id of ['t:bronze.a', 't:bronze.b']) {
      const p = pos.get(id)!
      expect(p.y).toBeGreaterThanOrEqual(lh.y)
      expect(p.y).toBeLessThan(lh.y + lh.height)
    }
  })
})

describe('layoutWorkspaces', () => {
  it('gives each workspace one band and descends on every hop', () => {
    const { nodes, edges } = medallion()
    const { pos, bands } = layoutWorkspaces(nodes, edges)
    expect(bands.map((b) => b.label)).toEqual(['platform', 'engineering'])
    // Depth runs down: every edge lands strictly lower than it left.
    for (const e of edges) expect(pos.get(e.to)!.y).toBeGreaterThan(pos.get(e.from)!.y)
  })

  it('zig-zags — consecutive hops alternate direction across the bands', () => {
    const { nodes, edges } = medallion()
    const { pos } = layoutWorkspaces(nodes, edges)
    const dir = edges.map((e) => Math.sign(pos.get(e.to)!.x - pos.get(e.from)!.x))
    // platform -> engineering -> platform -> …, never two hops the same way.
    expect(dir).toEqual([1, -1, 1, -1, 1, -1])
  })

  it('sorts an unresolved workspace last', () => {
    const nodes: FlowNode[] = [table('a', 'lh_bronze', ''), table('b', 'lh_bronze', 'platform')]
    const { bands } = layoutWorkspaces(nodes, [])
    expect(bands.map((b) => b.label)).toEqual(['platform', 'workspace unresolved'])
  })
})
