import { describe, expect, it } from 'vitest'
import type { LineageGraph, LineageNode } from '../../api'
import { graphToModel } from '../graphToModel'

const node = (id: string, kind: LineageNode['kind'], name: string, extra: Partial<LineageNode> = {}): LineageNode => ({
  id,
  kind,
  name,
  columns: [],
  meta: {},
  ...extra,
})

/**
 * The shape the crawl returns for a small workspace:
 *
 *   Bronze/raw_orders -> enrich -> Silver/clean_orders
 *   nightly (pipeline) calls enrich
 */
function graph(): LineageGraph {
  return {
    nodes: [
      node('workspace.ws1', 'workspace', 'Analytics'),
      node('lakehouse.lh1', 'lakehouse', 'Bronze', { parent_id: 'workspace.ws1' }),
      node('table.a', 'table', 'raw_orders', { parent_id: 'lakehouse.lh1' }),
      node('lakehouse.lh2', 'lakehouse', 'Silver', { parent_id: 'workspace.ws1' }),
      node('table.b', 'table', 'clean_orders', { parent_id: 'lakehouse.lh2' }),
      node('notebook.nb1', 'notebook', 'enrich', { parent_id: 'workspace.ws1' }),
      node('pipeline.pl1', 'pipeline', 'nightly', { parent_id: 'workspace.ws1' }),
    ],
    edges: [
      { source: 'table.a', target: 'notebook.nb1', kind: 'reads', columns: [] },
      { source: 'notebook.nb1', target: 'table.b', kind: 'writes', columns: [] },
      { source: 'pipeline.pl1', target: 'notebook.nb1', kind: 'calls', columns: [] },
    ],
  }
}

const cards = (m: ReturnType<typeof graphToModel>['model']) =>
  m.layers.flatMap((l) => l.objects.map((o) => o.id))

describe('graphToModel', () => {
  it('makes one card per item and nests tables inside their lakehouse', () => {
    const { model } = graphToModel(graph())
    expect(cards(model)).toEqual(
      expect.arrayContaining(['lakehouse.lh1', 'lakehouse.lh2', 'notebook.nb1', 'pipeline.pl1']),
    )
    const bronze = model.layers.flatMap((l) => l.objects).find((o) => o.id === 'lakehouse.lh1')!
    expect(bronze.children.map((c) => c.id)).toEqual(['table.a'])
    // A table is never its own card when it has a lakehouse to sit in.
    expect(cards(model)).not.toContain('table.a')
  })

  it('drops the workspace node and takes its name for the model', () => {
    const { model } = graphToModel(graph())
    expect(model.name).toBe('Analytics')
    expect(cards(model)).not.toContain('workspace.ws1')
  })

  it('orders columns so every dependency points right', () => {
    const { model } = graphToModel(graph())
    const columnOf = (id: string) => model.layers.findIndex((l) => l.objects.some((o) => o.id === id))
    expect(columnOf('lakehouse.lh1')).toBeLessThan(columnOf('notebook.nb1'))
    expect(columnOf('notebook.nb1')).toBeLessThan(columnOf('lakehouse.lh2'))
  })

  it('keeps table-level endpoints so the canvas can roll them up itself', () => {
    // The item reading is what a COLLAPSED card gives; hard-coding the card
    // here would throw the table-level reading away for good.
    const { model } = graphToModel(graph())
    expect(model.transitions).toContainEqual({
      id: 'tr:table.a->notebook.nb1',
      source: 'table.a',
      target: 'notebook.nb1',
    })
  })

  it('gives a table with no lakehouse its own card', () => {
    const g = graph()
    g.nodes.push(node('table.x', 'table', 'dim_customer', { meta: { inferred: true } }))
    g.edges.push({ source: 'table.x', target: 'notebook.nb1', kind: 'reads', columns: [] })
    const { model } = graphToModel(g)
    expect(cards(model)).toContain('table.x')
    expect(model.properties['table.x'].Tags).toBe('External')
  })

  it('reports items nothing could be crawled for', () => {
    const g = graph()
    g.nodes.push(node('item.r1', 'item', 'Exec Summary', { meta: { opaque: true, item_type: 'Report' } }))
    const { model, opaque } = graphToModel(g)
    expect(opaque).toEqual(['Exec Summary'])
    // Badged with its real Fabric type, not the generic kind.
    expect(model.properties['item.r1'].Tags).toBe('Report')
  })

  it('survives a cycle between two lakehouses', () => {
    const g = graph()
    g.edges.push({ source: 'table.b', target: 'notebook.nb1', kind: 'reads', columns: [] })
    expect(() => graphToModel(g)).not.toThrow()
  })

  it('drops an edge whose endpoint was never drawn', () => {
    const g = graph()
    g.edges.push({ source: 'table.a', target: 'notebook.ghost', kind: 'reads', columns: [] })
    const { model } = graphToModel(g)
    expect(model.transitions.some((t) => t.target === 'notebook.ghost')).toBe(false)
  })
})
