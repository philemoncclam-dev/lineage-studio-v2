// Zig-Zag, the canvas layout that names its bands for what is in them. These
// pin what makes it a layout of its own rather than a relabelled column order:
// one band per owner with the steps' band first, lakehouses ordered by
// medallion stage inside it, and a heading per lakehouse and pipeline.
import { describe, expect, it } from 'vitest'
import { layoutStages, stageRank, type FlowNode } from '../SequenceCanvas'

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
  it('gives the whole medallion one band, because it is one workspace', () => {
    const { nodes, edges } = medallion()
    const { pos, bands } = layoutStages(nodes, edges)
    // A band per OWNER, not per stage: four lakehouses of one platform are one
    // band. It used to draw seven, four of them carrying the same name. The
    // band that RUNS things comes first, whatever the run touched first.
    expect(bands.map((b) => b.label)).toEqual(['engineering', 'platform'])
    // and every hop crosses between the two — the zig-zag the port exports.
    const dir = edges.map((e) => Math.sign(pos.get(e.to)!.x - pos.get(e.from)!.x))
    expect(dir).toEqual([-1, 1, -1, 1, -1, 1])
  })

  it('orders the lakehouse cards by medallion stage within a lane', () => {
    // Four lakehouses, all at the same depth, so only the stage tie-break
    // decides. The lakehouse is the CARD now (its tables are rows inside it),
    // so this is about card order, not about headings.
    const nodes: FlowNode[] = [
      table('gold.orders', 'lh_gold'),
      table('bronze.orders', 'lh_bronze'),
      table('landing.orders', 'lh_landing'),
      table('silver.orders', 'lh_silver'),
    ]
    const { pos } = layoutStages(nodes, [])
    const order = nodes
      .map((n) => ({ lake: n.lakehouse!, y: pos.get(n.id)!.y }))
      .sort((a, b) => a.y - b.y)
      .map((n) => n.lake)
    expect(order).toEqual(['lh_landing', 'lh_bronze', 'lh_silver', 'lh_gold'])
  })

  it('keeps a table in its owner band however late it is written', () => {
    const { nodes, edges } = medallion()
    // Ownership is not a function of the run, and a table hopping between
    // columns is the thing this view exists to avoid.
    const before = layoutStages(nodes, edges).pos.get('t:bronze.orders')!
    nodes.push(step('late', 'engineering'))
    edges.push(
      { from: 't:gold.orders', to: 's:late', tone: 'read' as const, kind: 'table' as const },
      { from: 's:late', to: 't:bronze.orders', tone: 'write' as const, kind: 'table' as const },
    )
    expect(layoutStages(nodes, edges).pos.get('t:bronze.orders')!.x).toBe(before.x)
  })

  it('starts every band at the top, with no depth gaps', () => {
    const { nodes, edges } = medallion()
    const { pos } = layoutStages(nodes, edges)
    // The layers of the ported model, drawn as columns: each band packs from
    // y=0 down. Aligning them on dependency depth instead left the deepest
    // lakehouse alone at the bottom and the short steps band adrift in space.
    for (const c of [0, 1])
      expect(
        Math.min(...nodes.map((n) => pos.get(n.id)!).filter((p) => p.x === c * (208 + 150)).map((p) => p.y)),
      ).toBe(0)
  })

  it('says so when a band stands in for an unknown workspace', () => {
    const nodes: FlowNode[] = [table('bronze.a', 'lh_bronze', ''), step('nb', '')]
    const edges = [{ from: 's:nb', to: 't:bronze.a', tone: 'write' as const, kind: 'table' as const }]
    // The step falls back to the lakehouse it writes into, so it shares the
    // band rather than sitting in an unnamed one of its own.
    expect(layoutStages(nodes, edges).bands.map((b) => b.label)).toEqual([
      'lh_bronze · workspace unknown',
    ])
  })

  it('draws a pipeline as a plain card, with no heading above it', () => {
    const nodes: FlowNode[] = [
      table('bronze.a', 'lh_bronze'),
      table('bronze.b', 'lh_bronze'),
      step('pl', 'engineering', 'pipeline'),
    ]
    const edges = [
      { from: 's:pl', to: 't:bronze.a', tone: 'write' as const, kind: 'table' as const },
      { from: 's:pl', to: 't:bronze.b', tone: 'write' as const, kind: 'table' as const },
    ]
    // The pipeline card already carries its name, and no other view repeats it
    // above the card — this one used to, as a dotted label, and it read as a
    // second unexplained object.
    const layout = layoutStages(nodes, edges)
    expect('groups' in layout).toBe(false)
    expect(layout.pos.get('s:pl')).toEqual({ x: 0, y: 0 })
  })
})
