// Zig-Zag, the canvas layout that names its bands for what is in them. These
// pin what makes it a layout of its own rather than a relabelled column order:
// one band per owner with the steps' band first, lakehouses ordered by
// medallion stage inside it, and a heading per lakehouse and pipeline.
import { describe, expect, it } from 'vitest'
import { layoutMedallion, layoutStages, stageRank, type FlowNode } from '../SequenceCanvas'

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
    // owner rather than sitting in an unnamed one of its own — and that lone
    // owner then splits by role, which is what stops it being one tall stack.
    expect(layoutStages(nodes, edges).bands.map((b) => b.label)).toEqual([
      'lh_bronze · workspace unknown · runs',
      'lh_bronze · workspace unknown · tables',
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

describe('layoutMedallion', () => {
  it('gives one band per stage, in the order data moves through them', () => {
    const { nodes, edges } = medallion()
    const { bands } = layoutMedallion(nodes, edges)
    // The business reading: Landing -> Bronze -> Silver -> Gold, left to right.
    // Zig-Zag deliberately does NOT do this — there the band is the owner and
    // the whole medallion collapses into one column.
    expect(bands.map((b) => b.label)).toEqual(['Landing', 'Bronze', 'Silver', 'Gold'])
  })

  it('puts a notebook in the stage it produces, not the one it reads', () => {
    const { nodes, edges } = medallion()
    const { pos } = layoutMedallion(nodes, edges)
    // `to_silver` reads bronze and writes silver. It belongs with what it
    // builds — "Silver: these tables, and the notebooks that make them".
    expect(pos.get('s:to_silver')!.x).toBe(pos.get('t:silver.orders')!.x)
    expect(pos.get('s:to_gold')!.x).toBe(pos.get('t:gold.orders')!.x)
  })

  it('keeps a lakehouse that names no stage in a band of its own, last', () => {
    const nodes: FlowNode[] = [table('ref.codes', 'lh_reference'), table('bronze.a', 'lh_bronze')]
    const { bands, pos } = layoutMedallion(nodes, [])
    // Guessing a stage from anything but the name would invent a fact about
    // the data, so an unrecognised lakehouse is named as what it is.
    expect(bands.map((b) => b.label)).toEqual(['Bronze', 'Unstaged'])
    expect(pos.get('t:ref.codes')!.x).toBeGreaterThan(pos.get('t:bronze.a')!.x)
  })

  it('draws no band for a stage the run never touched', () => {
    // An empty Landing column between the left edge and Bronze would say
    // something false: that there is a landing layer here and it is empty.
    const nodes: FlowNode[] = [table('bronze.a', 'lh_bronze'), table('gold.a', 'lh_gold')]
    expect(layoutMedallion(nodes, []).bands.map((b) => b.label)).toEqual(['Bronze', 'Gold'])
  })
})

describe('one workspace owning everything', () => {
  // The COMMON case, not the exotic one: a notebook usually lives in the same
  // workspace as the lakehouse it writes into. Owner bands then say nothing.
  const sameWorkspace = () => {
    const nodes: FlowNode[] = [
      step('to_bronze', 'plat'),
      table('bronze.orders', 'lh_bronze', 'plat'),
      table('landing.raw', 'lh_landing', 'plat'),
    ]
    const edges = [
      { from: 't:landing.raw', to: 's:to_bronze', tone: 'read' as const, kind: 'table' as const },
      { from: 's:to_bronze', to: 't:bronze.orders', tone: 'write' as const, kind: 'table' as const },
    ]
    return { nodes, edges }
  }

  it('splits by role rather than drawing one tall column', () => {
    const { nodes, edges } = sameWorkspace()
    const { bands, pos } = layoutStages(nodes, edges)
    // One owner used to mean one band — every step and every table in a single
    // stack, with no band to cross and nothing left of the zig-zag.
    expect(bands.map((b) => b.label)).toEqual(['plat · runs', 'plat · tables'])
    expect(pos.get('s:to_bronze')!.x).toBeLessThan(pos.get('t:bronze.orders')!.x)
  })

  it('keeps owner bands as soon as there are two owners', () => {
    const { nodes, edges } = medallion()
    expect(layoutStages(nodes, edges).bands.map((b) => b.label)).toEqual(['engineering', 'platform'])
  })

  it('does not split a single owner that has no tables to separate', () => {
    const nodes: FlowNode[] = [step('a', 'plat'), step('b', 'plat')]
    expect(layoutStages(nodes, []).bands.map((b) => b.label)).toEqual(['plat'])
  })
})

describe('Medallion card order inside a band', () => {
  it('puts the producers above what they produced, never interleaved', () => {
    // Node order follows what the run touched first, which drew notebook,
    // lakehouse, notebook down one column — three kinds alternating for no
    // reason a reader can see.
    const nodes: FlowNode[] = [
      step('nb_one', 'plat'),
      table('bronze.a', 'lh_bronze'),
      step('nb_two', 'plat'),
    ]
    const edges = [
      { from: 's:nb_one', to: 't:bronze.a', tone: 'write' as const, kind: 'table' as const },
      { from: 's:nb_two', to: 't:bronze.a', tone: 'write' as const, kind: 'table' as const },
    ]
    const { pos } = layoutMedallion(nodes, edges)
    const order = nodes
      .map((n) => ({ id: n.id, y: pos.get(n.id)!.y }))
      .sort((a, b) => a.y - b.y)
      .map((n) => n.id)
    expect(order).toEqual(['s:nb_one', 's:nb_two', 't:bronze.a'])
  })
})
