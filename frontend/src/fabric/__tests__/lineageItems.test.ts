import { describe, expect, it } from 'vitest'
import type { LineageGraph, LineageNode } from '../../api'
import { toItemGraph } from '../lineageItems'

const node = (id: string, kind: LineageNode['kind'], name: string, extra: Partial<LineageNode> = {}): LineageNode => ({
  id,
  kind,
  name,
  columns: [],
  meta: {},
  ...extra,
})

/**
 * Bronze holds two tables, and the notebook reads BOTH of them — which is the
 * case the roll-up exists for: one arrow, not two.
 */
function graph(): LineageGraph {
  return {
    nodes: [
      node('workspace.ws1', 'workspace', 'Analytics'),
      node('lakehouse.lh1', 'lakehouse', 'Bronze', { parent_id: 'workspace.ws1' }),
      node('table.a', 'table', 'raw_orders', { parent_id: 'lakehouse.lh1' }),
      node('table.b', 'table', 'raw_items', { parent_id: 'lakehouse.lh1' }),
      node('notebook.nb1', 'notebook', 'enrich', { parent_id: 'workspace.ws1' }),
    ],
    edges: [
      { source: 'table.a', target: 'notebook.nb1', kind: 'reads', columns: [] },
      { source: 'table.b', target: 'notebook.nb1', kind: 'reads', columns: [] },
    ],
  }
}

describe('toItemGraph', () => {
  it('draws lakehouses, not the tables inside them', () => {
    const { items } = toItemGraph(graph())
    expect(items.map((i) => i.id)).toEqual(['lakehouse.lh1', 'notebook.nb1'])
  })

  it('merges the tables of one lakehouse into a single arrow that counts them', () => {
    const { links } = toItemGraph(graph())
    expect(links).toEqual([{ from: 'lakehouse.lh1', to: 'notebook.nb1', count: 2 }])
  })

  it('drops the workspace box', () => {
    const { items } = toItemGraph(graph())
    expect(items.some((i) => i.id === 'workspace.ws1')).toBe(false)
  })

  it('keeps a table whose lakehouse was never crawled, as external', () => {
    const g = graph()
    g.nodes.push(node('table.x', 'table', 'dim_customer', { meta: { inferred: true } }))
    g.edges.push({ source: 'table.x', target: 'notebook.nb1', kind: 'reads', columns: [] })
    const { items, links } = toItemGraph(g)
    const external = items.find((i) => i.id === 'table.x')!
    expect(external.external).toBe(true)
    expect(external.typeLabel).toBe('External table')
    expect(links).toContainEqual({ from: 'table.x', to: 'notebook.nb1', count: 1 })
  })

  it('never draws a lakehouse depending on itself', () => {
    // A notebook rewriting a table in the lakehouse it read would fold both
    // ends onto the same box — an arrow from a thing to itself, saying nothing.
    const g = graph()
    g.nodes.push(node('table.c', 'table', 'clean', { parent_id: 'lakehouse.lh1' }))
    g.edges.push({ source: 'table.a', target: 'table.c', kind: 'derives', columns: [] })
    expect(toItemGraph(g).links.some((l) => l.from === l.to)).toBe(false)
  })

  it('badges Fabric item types it knows', () => {
    const g = graph()
    g.nodes.push(node('item.r1', 'item', 'Exec', { meta: { item_type: 'Report', opaque: true } }))
    g.nodes.push(node('item.s1', 'item', 'Sales', { meta: { item_type: 'SemanticModel', opaque: true } }))
    g.nodes.push(node('item.e1', 'item', 'Odd', { meta: { item_type: 'MLExperiment', opaque: true } }))
    const items = toItemGraph(g).items
    const byId = new Map(items.map((i) => [i.id, i]))
    expect(byId.get('item.r1')!.kind).toBe('report')
    expect(byId.get('item.s1')!.kind).toBe('semanticmodel')
    expect(byId.get('item.s1')!.typeLabel).toBe('Semantic model')
    // An unknown type keeps its own name rather than being called "Item".
    expect(byId.get('item.e1')!.kind).toBe('item')
    expect(byId.get('item.e1')!.typeLabel).toBe('ML Experiment')
  })

  it('drops an edge whose endpoint is not drawn', () => {
    const g = graph()
    g.edges.push({ source: 'table.a', target: 'notebook.ghost', kind: 'reads', columns: [] })
    expect(toItemGraph(g).links.every((l) => l.to !== 'notebook.ghost')).toBe(true)
  })
})

describe('the BI half', () => {
  it('draws semantic models, reports and dashboards as their own kinds', () => {
    const g = graph()
    g.nodes.push(
      node('semanticmodel.ds1', 'semanticmodel', 'Finance Model'),
      node('report.rep1', 'report', 'Exec Summary'),
      node('dashboard.dash1', 'dashboard', 'Board'),
    )
    g.edges.push(
      { source: 'lakehouse.lh1', target: 'semanticmodel.ds1', kind: 'reads', columns: [] },
      { source: 'semanticmodel.ds1', target: 'report.rep1', kind: 'reads', columns: [] },
      { source: 'report.rep1', target: 'dashboard.dash1', kind: 'reads', columns: [] },
    )
    const { items, links } = toItemGraph(g)
    const byId = new Map(items.map((i) => [i.id, i]))
    expect(byId.get('semanticmodel.ds1')!.kind).toBe('semanticmodel')
    expect(byId.get('semanticmodel.ds1')!.typeLabel).toBe('Semantic model')
    expect(byId.get('dashboard.dash1')!.kind).toBe('dashboard')
    // The whole chain survives the roll-up, so a lakehouse reaches a dashboard.
    expect(links).toContainEqual({ from: 'lakehouse.lh1', to: 'semanticmodel.ds1', count: 1 })
    expect(links).toContainEqual({ from: 'report.rep1', to: 'dashboard.dash1', count: 1 })
  })
})
