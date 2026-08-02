import { describe, expect, it } from 'vitest'
import { sequenceToModel, defaultModelName, DEFAULT_PORT_OPTIONS } from '../toModel'
import { tagsOf } from '../../model/tags'
import type { Step, StepResult } from '../sequence'
import type { SandboxRunResult } from '../../api'

const step = (key: string, name: string): Step => ({
  key,
  kind: 'notebook',
  ws: 'ws1',
  itemId: `it-${key}`,
  name,
})

const result = (over: Partial<SandboxRunResult>): SandboxRunResult => ({
  ok: true,
  engine: 'spark',
  cells: [],
  reads: [],
  writes: [],
  table_schemas: {},
  column_lineage: [],
  log: [],
  saw_credentials: false,
  error: null,
  ...over,
})

const ran = (name: string, r: SandboxRunResult): StepResult => ({
  status: 'ok',
  runs: [{ name, status: 'ok', result: r }],
})

/** raw -> notebook -> silver, with schemas on both tables. */
function simpleRun() {
  const s = step('a', 'enrich')
  const results = new Map([
    [
      s.key,
      ran(
        'enrich',
        result({
          reads: ['raw_orders'],
          writes: ['silver_orders'],
          table_schemas: {
            raw_orders: [
              { name: 'id', type: 'bigint' },
              { name: 'amount', type: 'double' },
            ],
            silver_orders: [
              { name: 'id', type: 'bigint' },
              { name: 'total', type: 'double' },
            ],
          },
          column_lineage: [
            { to_table: 'silver_orders', to_column: 'total', from_column: 'amount', transform: 'amount * 1.2' },
          ],
        }),
      ),
    ],
  ])
  return { steps: [s], results }
}

describe('sequenceToModel', () => {
  it('lays sources, steps and outputs into dependency-ordered layers', () => {
    const { steps, results } = simpleRun()
    const { model } = sequenceToModel(steps, results, 'M')
    expect(model.layers.map((l) => l.name)).toEqual([
      'Source tables',
      'Notebooks & pipelines',
      'Output tables',
    ])
    expect(model.layers[0].objects.map((o) => o.name)).toEqual(['raw_orders'])
    expect(model.layers[1].objects.map((o) => o.name)).toEqual(['enrich'])
    expect(model.layers[2].objects.map((o) => o.name)).toEqual(['silver_orders'])
  })

  it('gives table objects their columns as attributes, typed via properties', () => {
    const { steps, results } = simpleRun()
    const { model } = sequenceToModel(steps, results, 'M')
    const raw = model.layers[0].objects[0]
    expect(raw.children.map((a) => a.name)).toEqual(['id', 'amount'])
    expect(model.properties[raw.children[1].id]).toEqual({ 'Data type': 'double' })
    // A notebook's attributes are its I/O rows, mirroring its canvas card.
    const nb = model.layers[1].objects[0]
    expect(nb.children.map((a) => a.name)).toEqual(['raw_orders', 'silver_orders'])
    expect(model.properties[nb.children[0].id]).toEqual({ Access: 'Read' })
    expect(model.properties[nb.children[1].id]).toEqual({ Access: 'Write' })
  })

  it('keeps true direction in the flow view, anchored on the step I/O row', () => {
    const { steps, results } = simpleRun()
    const { model } = sequenceToModel(steps, results, 'M')
    const [raw] = model.layers[0].objects
    const [nb] = model.layers[1].objects
    const [silver] = model.layers[2].objects
    const readRow = nb.children.find((a) => a.name === 'raw_orders')!
    const writeRow = nb.children.find((a) => a.name === 'silver_orders')!
    const pair = (s: string, t: string) =>
      model.transitions.find((x) => x.source === s && x.target === t)
    // Read: the source table into the notebook's read row.
    expect(model.properties[pair(raw.id, readRow.id)!.id].Access).toBe('Read')
    // Write: out of the notebook's write row into the target table.
    expect(model.properties[pair(writeRow.id, silver.id)!.id].Access).toBe('Write')
  })

  it('records a derivation on the edge that produces the column', () => {
    const { steps, results } = simpleRun()
    const { model, stats } = sequenceToModel(steps, results, 'M')
    const nb = model.layers[1].objects[0]
    const onStep = nb.children
      .find((c) => c.name === 'silver_orders')!
      .children.find((c) => c.name === 'total')!
    const onTable = model.layers[2].objects[0].children.find((a) => a.name === 'total')!
    const t = model.transitions.find((x) => x.source === onStep.id && x.target === onTable.id)
    expect(t).toBeDefined()
    expect(model.properties[t!.id]).toMatchObject({
      Via: 'enrich',
      Transform: 'amount * 1.2',
      Derives: 'raw_orders.amount',
    })
    expect(stats.columnEdges).toBe(1)
  })

  it('never joins one table’s column straight to another’s', () => {
    // The regression: as its own edge, column lineage was the one transition
    // that did not run table -> step -> table. In the flow view it leapt the
    // notebooks layer entirely; in the sequence view, where every table shares
    // a layer, it doubled back from the output table to the source underneath.
    const { steps, results } = simpleRun()
    for (const view of ['flow', 'sequence'] as const) {
      const { model } = sequenceToModel(steps, results, 'M', view)
      const tableAttrs = new Set(
        model.layers
          .flatMap((l) => l.objects)
          .filter((o) => o.name === 'raw_orders' || o.name === 'silver_orders')
          .flatMap((o) => o.children.map((c) => c.id)),
      )
      const both = model.transitions.filter(
        (t) => tableAttrs.has(t.source) && tableAttrs.has(t.target),
      )
      expect(both, `${view} view joined two table columns directly`).toEqual([])
    }
  })

  it('skips a column edge when the source column name is ambiguous', () => {
    const s = step('a', 'join')
    const results = new Map([
      [
        s.key,
        ran(
          'join',
          result({
            reads: ['left_t', 'right_t'],
            writes: ['out_t'],
            table_schemas: {
              left_t: [{ name: 'id' }],
              right_t: [{ name: 'id' }],
              out_t: [{ name: 'id' }],
            },
            // `id` exists on both inputs — unresolvable, so no column edge.
            column_lineage: [{ to_table: 'out_t', to_column: 'id', from_column: 'id' }],
          }),
        ),
      ],
    ])
    const { stats } = sequenceToModel([s], results, 'M')
    expect(stats.columnEdges).toBe(0)
    // The object-level lineage still stands: 3 accesses, plus the mechanical
    // access->table column edge each one draws for its single `id` column.
    // Those are counted apart precisely so an unresolvable join still reads as
    // zero resolved lineage above.
    expect(stats.accessColumnEdges).toBe(3)
    expect(stats.transitions).toBe(6)
  })

  it('uses from_table when the engine reported it, resolving the ambiguous join', () => {
    // The exact case above, except the flow says which side it came from. The
    // sqlglot engine qualifies every column against the schemas, so it knows;
    // the Spark engine reports names only and has to fall back to guessing.
    const s = step('a', 'join')
    const results = new Map([
      [
        s.key,
        ran(
          'join',
          result({
            engine: 'stub',
            reads: ['left_t', 'right_t'],
            writes: ['out_t'],
            table_schemas: {
              left_t: [{ name: 'id' }],
              right_t: [{ name: 'id' }],
              out_t: [{ name: 'id' }],
            },
            column_lineage: [
              { to_table: 'out_t', to_column: 'id', from_column: 'id', from_table: 'right_t' },
            ],
          }),
        ),
      ],
    ])
    const { model, stats } = sequenceToModel([s], results, 'M')
    expect(stats.columnEdges).toBe(1)

    // The derivation names the side the engine reported...
    const nb = model.layers[1].objects[0]
    const onStep = nb.children.find((c) => c.name === 'out_t')!.children[0]
    const onTable = model.layers[2].objects[0].children[0]
    const t = model.transitions.find((x) => x.source === onStep.id && x.target === onTable.id)!
    expect(model.properties[t.id]).toMatchObject({ Derives: 'right_t.id' })
    // ...and emphatically not the other side of the join.
    expect(model.properties[t.id].Derives).not.toContain('left_t')
  })

  // --- pipelines port their notebooks ---------------------------------------
  // A pipeline used to export as a flat merge of every table it touched, which
  // left the notebooks — the things actually doing the work — out of the model
  // entirely.

  /** A pipeline whose two notebooks chain raw → silver → gold. */
  function pipelineRun() {
    const p: Step = { key: 'p', kind: 'pipeline', ws: 'ws1', itemId: 'it-p', name: 'PL_nightly' }
    const results = new Map<string, StepResult>([
      [
        p.key,
        {
          status: 'ok',
          runs: [
            { name: 'build_silver', status: 'ok', result: result({ reads: ['raw'], writes: ['silver'] }) },
            { name: 'build_gold', status: 'ok', result: result({ reads: ['silver'], writes: ['gold'] }) },
          ],
          activities: [
            {
              name: 'build_silver',
              type: 'TridentNotebook',
              depends_on: [],
              notebook_id: 'nb1',
              reads: [],
              writes: [],
              column_lineage: [],
            },
            {
              name: 'build_gold',
              type: 'TridentNotebook',
              depends_on: ['build_silver'],
              notebook_id: 'nb2',
              reads: [],
              writes: [],
              column_lineage: [],
            },
          ],
        },
      ],
    ])
    return { p, results }
  }

  const pipelineObject = (model: ReturnType<typeof sequenceToModel>['model']) =>
    model.layers.flatMap((l) => l.objects).find((o) => o.name === 'PL_nightly')!

  it('ports a pipeline as its notebooks, with their tables nested inside', () => {
    const { p, results } = pipelineRun()
    const { model } = sequenceToModel([p], results, 'M')
    const pl = pipelineObject(model)
    expect(pl.children.map((c) => c.name)).toEqual(['build_silver', 'build_gold'])
    expect(pl.children[0].children.map((c) => c.name)).toEqual(['raw', 'silver'])
    expect(pl.children[1].children.map((c) => c.name)).toEqual(['silver', 'gold'])
  })

  it('tags each notebook group, so it badges as one on the card', () => {
    const { p, results } = pipelineRun()
    const { model } = sequenceToModel([p], results, 'M')
    const pl = pipelineObject(model)
    expect(tagsOf(model, pl.children[0].id)).toEqual(['Notebook'])
  })

  it('names a non-notebook activity by its own type instead', () => {
    const { p, results } = pipelineRun()
    const res = results.get(p.key)!
    res.activities![0] = { ...res.activities![0], type: 'Copy', notebook_id: null }
    const { model } = sequenceToModel([p], results, 'M')
    expect(tagsOf(model, pipelineObject(model).children[0].id)).toEqual(['Copy'])
  })

  it('keeps the R/W on the nested table rows', () => {
    const { p, results } = pipelineRun()
    const { model } = sequenceToModel([p], results, 'M')
    const [read, write] = pipelineObject(model).children[0].children
    expect(model.properties[read.id]!.Access).toBe('Read')
    expect(model.properties[write.id]!.Access).toBe('Write')
  })

  it('anchors each edge on the activity that made that access', () => {
    // `silver` is written by the first notebook and read by the second. Two
    // accesses, two rows — and each edge must land on its own.
    const { p, results } = pipelineRun()
    const { model } = sequenceToModel([p], results, 'M')
    const pl = pipelineObject(model)
    const writtenSilver = pl.children[0].children[1]
    const readSilver = pl.children[1].children[0]
    expect(writtenSilver.id).not.toBe(readSilver.id)

    const silver = model.layers.flatMap((l) => l.objects).find((o) => o.name === 'silver')!
    expect(model.transitions.some((t) => t.source === writtenSilver.id && t.target === silver.id)).toBe(true)
    expect(model.transitions.some((t) => t.source === silver.id && t.target === readSilver.id)).toBe(true)
  })

  it('counts the nested rows in the attribute total', () => {
    const { p, results } = pipelineRun()
    const { stats } = sequenceToModel([p], results, 'M')
    // 2 groups + 4 nested I/O rows on the pipeline; the tables carry no schema.
    expect(stats.attributes).toBe(6)
  })

  it('leaves a notebook step ungrouped — it IS the notebook', () => {
    const { steps, results } = simpleRun()
    const { model } = sequenceToModel(steps, results, 'M')
    const nb = model.layers[1].objects[0]
    // No activity groups in between, unlike a pipeline: the accesses are the
    // object's own children. Their columns sit one level further in, which is
    // the nesting the canvas card draws.
    expect(nb.children.map((c) => c.name)).toEqual(['raw_orders', 'silver_orders'])
    expect(nb.children.map((c) => c.children.map((g) => g.name))).toEqual([
      ['id', 'amount'],
      ['id', 'total'],
    ])
  })

  it('chains two steps so a written table feeds the next step', () => {
    const a = step('a', 'build_silver')
    const b = step('b', 'build_gold')
    const results = new Map([
      [a.key, ran('build_silver', result({ reads: ['raw'], writes: ['silver'] }))],
      [b.key, ran('build_gold', result({ reads: ['silver'], writes: ['gold'] }))],
    ])
    const { model } = sequenceToModel([a, b], results, 'M')
    expect(model.layers.map((l) => l.name)).toEqual([
      'Source tables',
      'Notebooks & pipelines',
      'Tables',
      'Notebooks & pipelines',
      'Output tables',
    ])
    expect(model.layers[2].objects.map((o) => o.name)).toEqual(['silver'])
  })

  it('records provenance properties on every object', () => {
    const { steps, results } = simpleRun()
    const { model } = sequenceToModel(steps, results, 'M')
    expect(model.properties[model.layers[1].objects[0].id]).toMatchObject({
      Source: 'Fabric sandbox',
      Step: '1',
      Workspace: 'ws1',
    })
  })

  it('tags each object with its kind, so the card badges it', () => {
    const { steps, results } = simpleRun()
    const { model } = sequenceToModel(steps, results, 'M')
    expect(tagsOf(model, model.layers[1].objects[0].id)).toEqual(['Notebook'])
    expect(tagsOf(model, model.layers[0].objects[0].id)).toEqual(['Table'])
    // Attributes are left untagged — tagging a column is the user's call.
    expect(tagsOf(model, model.layers[0].objects[0].children[0].id)).toEqual([])
  })

  it('tags a pipeline step as a Pipeline', () => {
    const p: Step = { key: 'p', kind: 'pipeline', ws: 'ws1', itemId: 'pl-1', name: 'nightly' }
    const results = new Map([[p.key, ran('nightly', result({ writes: ['out'] }))]])
    const { model } = sequenceToModel([p], results, 'M')
    const obj = model.layers.flatMap((l) => l.objects).find((o) => o.name === 'nightly')!
    expect(tagsOf(model, obj.id)).toEqual(['Pipeline'])
  })
})

describe('sequenceToModel — sequence view', () => {
  /** Two steps chained through silver, so the flow view would need 5 layers. */
  function chained() {
    const a = step('a', 'build_silver')
    const b = step('b', 'build_gold')
    const results = new Map([
      [a.key, ran('build_silver', result({ reads: ['raw'], writes: ['silver'] }))],
      [b.key, ran('build_gold', result({ reads: ['silver'], writes: ['gold'] }))],
    ])
    return { steps: [a, b], results }
  }

  it('collapses to exactly two layers, steps then tables', () => {
    const { steps, results } = chained()
    const { model } = sequenceToModel(steps, results, 'M', 'sequence')
    expect(model.layers.map((l) => l.name)).toEqual(['Notebooks & pipelines', 'Tables'])
  })

  it('keeps the steps in the order the user stacked them', () => {
    const { steps, results } = chained()
    const { model } = sequenceToModel(steps, results, 'M', 'sequence')
    expect(model.layers[0].objects.map((o) => o.name)).toEqual(['build_silver', 'build_gold'])
  })

  it('holds every table once, in first-touch order', () => {
    const { steps, results } = chained()
    const { model } = sequenceToModel(steps, results, 'M', 'sequence')
    expect(model.layers[1].objects.map((o) => o.name)).toEqual(['raw', 'silver', 'gold'])
  })

  it('draws the same number of edges as the flow view — only layering and orientation differ', () => {
    const { steps, results } = chained()
    const seq = sequenceToModel(steps, results, 'M', 'sequence')
    const flow = sequenceToModel(steps, results, 'M', 'flow')
    expect(seq.stats.transitions).toBe(flow.stats.transitions)
    expect(seq.stats.objects).toBe(flow.stats.objects)
  })

  it('runs EVERY transition from a step out to a table — nothing points back', () => {
    const { steps, results } = chained()
    const { model } = sequenceToModel(steps, results, 'M', 'sequence')
    const tableIds = new Set(model.layers[1].objects.map((o) => o.id))
    // Sources are the steps' own I/O attributes; targets are always tables.
    const stepAttrIds = new Set(model.layers[0].objects.flatMap((o) => o.children.map((a) => a.id)))
    for (const t of model.transitions) {
      expect(stepAttrIds.has(t.source)).toBe(true)
      expect(tableIds.has(t.target)).toBe(true)
    }
  })

  it('keeps read/write legible on the transition and the row it leaves', () => {
    const { steps, results } = chained()
    const { model } = sequenceToModel(steps, results, 'M', 'sequence')
    const silverStep = model.layers[0].objects[0]
    const readRow = silverStep.children.find((a) => a.name === 'raw')!
    const writeRow = silverStep.children.find((a) => a.name === 'silver')!
    expect(model.properties[readRow.id].Access).toBe('Read')
    expect(model.properties[writeRow.id].Access).toBe('Write')
    const from = (id: string) => model.transitions.find((t) => t.source === id)!
    expect(model.properties[from(readRow.id).id].Access).toBe('Read')
    expect(model.properties[from(writeRow.id).id].Access).toBe('Write')
  })
})

describe('defaultModelName', () => {
  it('names a single-step sequence after its step', () => {
    expect(defaultModelName([step('a', 'ltv')])).toBe('ltv')
  })
  it('counts the rest for a multi-step sequence', () => {
    expect(defaultModelName([step('a', 'ltv'), step('b', 'x'), step('c', 'y')])).toBe('ltv +2')
  })
})

describe('port options', () => {
  /** Every property bag on every attribute of every object. */
  const attrBags = (m: ReturnType<typeof sequenceToModel>['model']) =>
    m.layers.flatMap((l) =>
      l.objects.flatMap((o) => o.children.map((a) => m.properties[a.id] ?? {})),
    )

  it('carries tags, access, provenance, columns and column edges by default', () => {
    const { steps, results } = simpleRun()
    const { model, stats } = sequenceToModel(steps, results, 'M')
    const objects = model.layers.flatMap((l) => l.objects)
    expect(objects.some((o) => tagsOf(model, o.id).includes('Notebook'))).toBe(true)
    expect(attrBags(model).some((b) => b.Access === 'Read')).toBe(true)
    expect(attrBags(model).some((b) => b.Access === 'Write')).toBe(true)
    expect(objects.some((o) => model.properties[o.id]?.Source === 'Fabric sandbox')).toBe(true)
    expect(attrBags(model).some((b) => b['Data type'])).toBe(true)
    expect(stats.columnEdges).toBeGreaterThan(0)
  })

  it('drops only what is switched off, leaving the graph shape alone', () => {
    const { steps, results } = simpleRun()
    const full = sequenceToModel(steps, results, 'M')
    const bare = sequenceToModel(steps, results, 'M', 'flow', {
      kindTags: false,
      accessTags: false,
      provenance: false,
      columns: true,
      columnEdges: true,
    })

    const objects = bare.model.layers.flatMap((l) => l.objects)
    expect(objects.every((o) => tagsOf(bare.model, o.id).length === 0)).toBe(true)
    expect(attrBags(bare.model).every((b) => !b.Access)).toBe(true)
    expect(objects.every((o) => !bare.model.properties[o.id]?.Source)).toBe(true)
    // Structure is untouched: same layers, objects and transitions as a full port.
    expect(bare.stats.layers).toBe(full.stats.layers)
    expect(bare.stats.objects).toBe(full.stats.objects)
    expect(bare.stats.transitions).toBe(full.stats.transitions)
    // The I/O rows themselves survive losing their Access label.
    expect(bare.stats.attributes).toBe(full.stats.attributes)
  })

  it('columns off removes attributes and, with them, every column edge', () => {
    const { steps, results } = simpleRun()
    const { model, stats } = sequenceToModel(steps, results, 'M', 'flow', {
      kindTags: true,
      accessTags: true,
      provenance: true,
      columns: false,
      // On, but it cannot apply: with no column attributes there is nothing for
      // a column edge to land on, so the export must force it off.
      columnEdges: true,
    })
    expect(stats.columnEdges).toBe(0)
    expect(attrBags(model).every((b) => !b['Data type'])).toBe(true)
    // The step's own Read/Write rows are structure and stay.
    expect(attrBags(model).some((b) => b.Access)).toBe(true)
  })

  it('leaves no empty property bags behind', () => {
    const { steps, results } = simpleRun()
    const { model } = sequenceToModel(steps, results, 'M', 'flow', {
      kindTags: false,
      accessTags: false,
      provenance: false,
      columns: false,
      columnEdges: false,
    })
    expect(Object.values(model.properties).every((b) => Object.keys(b).length > 0)).toBe(true)
  })
})

describe('the raw file layer becomes an object', () => {
  const FILE = 'Landing/lh_landing/Files%2Forders%2F*.csv'

  /** A landing file read into a bronze table — the start of every medallion. */
  function fileRun() {
    const s = step('a', 'ingest')
    return {
      s,
      results: new Map([
        [
          s.key,
          ran('ingest', result({ reads: [FILE], writes: ['bronze_orders'] })),
        ],
      ]),
    }
  }

  it('exports the file as an object named for the file itself', () => {
    const { s, results } = fileRun()
    const { model } = sequenceToModel([s], results, 'M')
    const names = model.layers.flatMap((l) => l.objects.map((o) => o.name))
    expect(names).toContain('Files/orders/*.csv')
  })

  it('tags it File, not Table', () => {
    const { s, results } = fileRun()
    const { model } = sequenceToModel([s], results, 'M')
    const file = model.layers.flatMap((l) => l.objects).find((o) => o.name.startsWith('Files/'))!
    expect(tagsOf(model, file.id)).toEqual(['File'])
  })

  it('still carries the edge into the table it lands in', () => {
    // The whole point: bronze is no longer written from nowhere.
    const { s, results } = fileRun()
    const { model } = sequenceToModel([s], results, 'M')
    const objects = model.layers.flatMap((l) => l.objects)
    const file = objects.find((o) => o.name.startsWith('Files/'))!
    const ids = new Set([file.id, ...file.children.map((c) => c.id)])
    expect(model.transitions.some((t) => ids.has(t.source) || ids.has(t.target))).toBe(true)
  })
})

describe('column edges with workspace-qualified refs', () => {
  // Every earlier fixture uses bare refs ('raw_orders'), where the ref and the
  // display label happen to be the same string. A real Fabric run never does —
  // its refs are 'Workspace/Lakehouse/table'. Keying the attribute lookup by
  // label instead of ref therefore passed every test and dropped every column
  // edge in production.
  const BRONZE = 'Analytics/Bronze/bronze_orders'
  const SILVER = 'Analytics/Silver/silver_orders'

  function qualifiedRun() {
    const s = step('a', 'enrich')
    return {
      s,
      results: new Map([
        [
          s.key,
          ran('enrich', result({
            reads: [BRONZE],
            writes: [SILVER],
            table_schemas: {
              [BRONZE]: [{ name: 'amount', type: 'double' }],
              [SILVER]: [{ name: 'amount_usd', type: null }],
            },
            column_lineage: [{
              to_table: SILVER, to_column: 'amount_usd',
              from_table: BRONZE, from_column: 'amount',
              transform: 'amount * 1.1',
            }],
          })),
        ],
      ]),
    }
  }

  it('creates the attribute-level edge', () => {
    const { s, results } = qualifiedRun()
    const { stats } = sequenceToModel([s], results, 'M')
    expect(stats.columnEdges).toBe(1)
  })

  it('routes the derivation through the step, on a qualified ref', () => {
    const { s, results } = qualifiedRun()
    const { model } = sequenceToModel([s], results, 'M')
    const objects = model.layers.flatMap((l) => l.objects)
    const nb = objects.find((o) => o.name === 'enrich')!
    const silver = objects.find((o) => o.name === 'silver_orders')!
    const onStep = nb.children.find((c) => c.name === 'silver_orders')!.children[0]
    const onTable = silver.children[0]
    const t = model.transitions.find((x) => x.source === onStep.id && x.target === onTable.id)!
    expect(t).toBeDefined()
    // The label is the leaf, not the whole `Analytics/Bronze/...` ref.
    expect(model.properties[t.id]).toMatchObject({ Derives: 'bronze_orders.amount' })
  })

  it('carries the transform onto the edge', () => {
    const { s, results } = qualifiedRun()
    const { model } = sequenceToModel([s], results, 'M')
    const withTransform = Object.values(model.properties).filter((p) => p['Transform'])
    expect(withTransform).toEqual([
      expect.objectContaining({ Transform: 'amount * 1.1' }),
    ])
  })
})

// --- the port matches the canvas -------------------------------------------
// The canvas nests a table's columns under the access that touched it and
// draws a line from each across to the same column on the table card. A model
// ported from that run has to carry the same shape, or pressing "Create model"
// hands back something other than the picture it was pressed on.

describe('columns under an access', () => {
  const WS = 'Analytics/Silver/silver_orders'
  const RAW = 'Analytics/Bronze/raw_orders'

  function run() {
    const s = step('a', 'enrich')
    return {
      s,
      results: new Map([
        [
          s.key,
          ran(
            'enrich',
            result({
              reads: [RAW],
              writes: [WS],
              table_schemas: {
                [RAW]: [{ name: 'id', type: 'bigint' }],
                [WS]: [{ name: 'id', type: 'bigint' }, { name: 'total', type: 'double' }],
              },
            }),
          ),
        ],
      ]),
    }
  }

  it('nests the table’s columns under the step’s access row, typed', () => {
    const { s, results } = run()
    const { model } = sequenceToModel([s], results, 'M')
    const nb = model.layers.flatMap((l) => l.objects).find((o) => o.name === 'enrich')!
    const write = nb.children.find((c) => c.name === 'silver_orders')!
    expect(write.children.map((c) => c.name)).toEqual(['id', 'total'])
    expect(model.properties[write.children[1].id]).toEqual({ 'Data type': 'double' })
  })

  it('joins each nested column across to the same column on the table', () => {
    const { s, results } = run()
    const { model, stats } = sequenceToModel([s], results, 'M')
    const objects = model.layers.flatMap((l) => l.objects)
    const nb = objects.find((o) => o.name === 'enrich')!
    const silver = objects.find((o) => o.name === 'silver_orders')!
    const onStep = nb.children.find((c) => c.name === 'silver_orders')!.children.find((c) => c.name === 'total')!
    const onTable = silver.children.find((c) => c.name === 'total')!
    expect(
      model.transitions.some((t) => t.source === onStep.id && t.target === onTable.id),
    ).toBe(true)
    // 1 read column + 2 write columns; no `column_lineage`, so no resolved edges.
    expect(stats.accessColumnEdges).toBe(3)
    expect(stats.columnEdges).toBe(0)
  })

  it('points a read’s column edge from the table into the step, in flow view', () => {
    const { s, results } = run()
    const { model } = sequenceToModel([s], results, 'M', 'flow')
    const objects = model.layers.flatMap((l) => l.objects)
    const nb = objects.find((o) => o.name === 'enrich')!
    const raw = objects.find((o) => o.name === 'raw_orders')!
    const onStep = nb.children.find((c) => c.name === 'raw_orders')!.children.find((c) => c.name === 'id')!
    const onTable = raw.children.find((c) => c.name === 'id')!
    expect(model.transitions.some((t) => t.source === onTable.id && t.target === onStep.id)).toBe(true)
  })

  it('runs every column edge step -> table in sequence view', () => {
    const { s, results } = run()
    const { model } = sequenceToModel([s], results, 'M', 'sequence')
    const objects = model.layers.flatMap((l) => l.objects)
    const nb = objects.find((o) => o.name === 'enrich')!
    const raw = objects.find((o) => o.name === 'raw_orders')!
    const onStep = nb.children.find((c) => c.name === 'raw_orders')!.children.find((c) => c.name === 'id')!
    const onTable = raw.children.find((c) => c.name === 'id')!
    // A read, but pointed step -> table like everything else in this layout.
    expect(model.transitions.some((t) => t.source === onStep.id && t.target === onTable.id)).toBe(true)
  })

  it('nests them inside a pipeline’s activity groups too', () => {
    const p: Step = { key: 'p', kind: 'pipeline', ws: 'ws1', itemId: 'it-p', name: 'nightly' }
    const results = new Map<string, StepResult>([
      [
        'p',
        {
          status: 'ok',
          runs: [
            {
              name: 'nb_silver',
              status: 'ok',
              result: result({ writes: [WS], table_schemas: { [WS]: [{ name: 'id' }] } }),
            },
          ],
        },
      ],
    ])
    const { model } = sequenceToModel([p], results, 'M')
    const pipe = model.layers.flatMap((l) => l.objects).find((o) => o.name === 'nightly')!
    // object -> activity group -> access -> column
    expect(pipe.children[0].name).toBe('nb_silver')
    expect(pipe.children[0].children[0].name).toBe('silver_orders')
    expect(pipe.children[0].children[0].children.map((c) => c.name)).toEqual(['id'])
  })

  it('carries no nested columns, and no column edges, with columns off', () => {
    const { s, results } = run()
    const { model, stats } = sequenceToModel([s], results, 'M', 'flow', {
      ...DEFAULT_PORT_OPTIONS,
      columns: false,
    })
    const nb = model.layers.flatMap((l) => l.objects).find((o) => o.name === 'enrich')!
    expect(nb.children.every((c) => c.children.length === 0)).toBe(true)
    expect(stats.accessColumnEdges).toBe(0)
    // The table-level lineage is untouched — the toggles are subtractive and
    // never change the shape of the graph.
    expect(stats.transitions).toBe(2)
  })
})

// --- semantic layouts ------------------------------------------------------
//
// `view` names layers after a position in a computed layout ("Source tables").
// These two name them after the workspace that owns them, and gather tables
// under their lakehouse. They differ only in how many layers that makes.

/** Engineering notebook reading bronze and writing silver, in Platform. */
function medallionRun() {
  const s: Step = { key: 'a', kind: 'notebook', ws: 'Engineering', itemId: 'it-a', name: 'nb_silver' }
  const BRONZE = 'Platform/lh_bronze/orders'
  const SILVER = 'Platform/lh_silver/orders_enriched'
  const results = new Map([
    [
      s.key,
      ran(
        'nb_silver',
        result({
          reads: [BRONZE],
          writes: [SILVER],
          table_schemas: {
            [BRONZE]: [{ name: 'order_id', type: 'string' }],
            [SILVER]: [{ name: 'order_id', type: 'string' }],
          },
          tables: {
            [BRONZE]: { workspace: 'Platform', lakehouse: 'lh_bronze', table: 'orders', resolved: true },
            [SILVER]: {
              workspace: 'Platform', lakehouse: 'lh_silver', table: 'orders_enriched', resolved: true,
            },
          },
        }),
      ),
    ],
  ])
  return { steps: [s], results }
}

const layoutModel = (layout: 'workspace' | 'stages') => {
  const { steps, results } = medallionRun()
  return sequenceToModel(steps, results, 'M', 'flow', { ...DEFAULT_PORT_OPTIONS, layout }).model
}

describe('semantic layouts', () => {
  it('names layers after the workspace alone — a lakehouse is an object, not a layer', () => {
    const model = layoutModel('workspace')
    // Ordered by where the run STARTS, not by kind: the bronze table it reads
    // is in Platform, so Platform heads the model and the notebook that reads
    // it follows. The layout used to be steps-left/tables-right, which is two
    // layers whatever the run contains and says nothing about ownership.
    expect(model.layers.map((l) => l.name)).toEqual(['Platform', 'Engineering'])
  })

  it('gives one layer per workspace in the workspace layout', () => {
    expect(layoutModel('workspace').layers).toHaveLength(2)
  })

  it('keeps the whole medallion in one layer in the stages layout', () => {
    const model = layoutModel('stages')
    // One layer per WORKSPACE, not per stage: the platform holds every
    // lakehouse it owns, in medallion order, and the engineering workspace
    // holds the notebook. It used to be a layer per stage, which drew the same
    // workspace band three times for one run.
    expect(model.layers.map((l) => l.name)).toEqual(['Platform', 'Engineering'])
    expect(model.layers.map((l) => l.objects.map((o) => o.name))).toEqual([
      ['lh_bronze', 'lh_silver'],
      ['nb_silver'],
    ])
  })

  it('orders the lakehouses by medallion stage, not by first touch', () => {
    const { steps, results } = medallionRun()
    // The run touches silver first (as the write) in ref order; the stage order
    // is what the view is for, so bronze still leads.
    const stages = sequenceToModel(steps, results, 'M', 'flow', {
      ...DEFAULT_PORT_OPTIONS, layout: 'stages',
    }).model
    expect(stages.layers[0].objects.map((o) => o.name)).toEqual(['lh_bronze', 'lh_silver'])
  })

  it('folds a read and a write into one staged hop, not two rows', () => {
    // The notebook reads bronze `orders` and writes silver `orders_enriched` —
    // one move, so ONE row. Two rows stopped the trace dead between them.
    const model = layoutModel('stages')
    const step = model.layers.find((l) => l.name === 'Engineering')!.objects[0]
    expect(step.children.map((c) => c.name)).toEqual(['orders → orders_enriched'])
    expect(tagsOf(model, step.children[0].id)).toEqual(['Staged'])
    // and the column is one row too, so the read lands on it and the write
    // leaves it — the pass-through that makes the zig-zag continuous.
    const hop = step.children[0]
    expect(hop.children.map((c) => c.name)).toEqual(['order_id'])
    const into = model.transitions.filter((t) => t.target === hop.children[0].id)
    const outOf = model.transitions.filter((t) => t.source === hop.children[0].id)
    expect(into).toHaveLength(1)
    expect(outOf).toHaveLength(1)
  })

  it('carries a column the step ADDS on the same hop row', () => {
    const { steps, results } = medallionRun()
    // The write side has a column the read side never had. It has no read edge
    // to arrive on, so it simply appears on the hop with its write leaving.
    const schemas = [...results.values()][0].runs[0].result!.table_schemas!
    schemas['Platform/lh_silver/orders_enriched'].push({ name: 'loaded_at', type: 'timestamp' })
    const model = sequenceToModel(steps, results, 'M', 'flow', {
      ...DEFAULT_PORT_OPTIONS, layout: 'stages',
    }).model
    const hop = model.layers.find((l) => l.name === 'Engineering')!.objects[0].children[0]
    expect(hop.children.map((c) => c.name)).toEqual(['order_id', 'loaded_at'])
    const added = hop.children[1]
    expect(model.transitions.filter((t) => t.target === added.id)).toHaveLength(0)
    expect(model.transitions.filter((t) => t.source === added.id)).toHaveLength(1)
  })

  it('makes the lakehouse the object and its tables the children', () => {
    const platform = layoutModel('workspace').layers.find((l) => l.name === 'Platform')!
    expect(platform.objects.map((o) => o.name).sort()).toEqual(['lh_bronze', 'lh_silver'])
    const bronze = platform.objects.find((o) => o.name === 'lh_bronze')!
    expect(bronze.children.map((c) => c.name)).toEqual(['orders'])
    // and the table keeps its columns beneath it
    expect(bronze.children[0].children.map((c) => c.name)).toEqual(['order_id'])
  })

  it('tags the lakehouse so it reads as one on the card', () => {
    const model = layoutModel('workspace')
    const platform = model.layers.find((l) => l.name === 'Platform')!
    expect(tagsOf(model, platform.objects[0].id)).toEqual(['Lakehouse'])
  })

  it('marks a one-sided access staged where it sits inside a step', () => {
    // A step's own rows are the table AS THE NOTEBOOK SAW IT, which is not the
    // table in the lakehouse layer even though both are called `orders`. A step
    // that only writes has no hop to fold into, so it keeps the suffixed row.
    const T = 'Platform/lh_bronze/orders'
    const s: Step = { key: 'w', kind: 'notebook', ws: 'Engineering', itemId: 'it', name: 'nb_load' }
    const model = sequenceToModel(
      [s],
      new Map([[s.key, ran('nb_load', result({
        writes: [T],
        tables: { [T]: { workspace: 'Platform', lakehouse: 'lh_bronze', table: 'orders', resolved: true } },
      }))]]),
      'M', 'flow', { ...DEFAULT_PORT_OPTIONS, layout: 'workspace' },
    ).model
    const step = model.layers.find((l) => l.name === 'Engineering')!.objects[0]
    expect(step.children.map((c) => c.name)).toEqual(['orders (staged)'])
    // and the real table, in its lakehouse, keeps its plain name
    const bronze = model.layers.find((l) => l.name === 'Platform')!.objects[0]
    expect(bronze.children.map((c) => c.name)).toEqual(['orders'])
  })

  it('leaves the default layout exactly as it was', () => {
    const { steps, results } = medallionRun()
    const before = sequenceToModel(steps, results, 'M', 'flow').model
    expect(before.layers.map((l) => l.name)).toEqual(['Source tables', 'Notebooks & pipelines', 'Output tables'])
  })
})

describe('pipeline grouping in the semantic layouts', () => {
  /** Two notebooks reached through the same expanded pipeline. */
  function nestedRun() {
    const mk = (key: string, name: string): Step => ({
      key, kind: 'notebook', ws: 'Engineering', itemId: `it-${key}`, name,
    })
    const a = mk('a', 'invoke pl_20_bronze / run nb_customers')
    const b = mk('b', 'invoke pl_20_bronze / run nb_products')
    const T = 'Platform/lh_bronze/customers'
    const r = (w: string) =>
      ran('x', result({
        writes: [w],
        table_schemas: { [w]: [{ name: 'id', type: 'string' }] },
        tables: { [w]: { workspace: 'Platform', lakehouse: 'lh_bronze', table: 'customers', resolved: true } },
      }))
    return { steps: [a, b], results: new Map([[a.key, r(T)], [b.key, r(T)]]) }
  }

  it('puts notebooks under the pipeline that reached them', () => {
    const { steps, results } = nestedRun()
    const model = sequenceToModel(steps, results, 'M', 'flow', {
      ...DEFAULT_PORT_OPTIONS, layout: 'workspace',
    }).model
    const eng = model.layers.find((l) => l.name === 'Engineering')!
    expect(eng.objects.map((o) => o.name)).toEqual(['invoke pl_20_bronze'])
    // and the orchestration prefix is stripped off the steps themselves
    expect(eng.objects[0].children.map((c) => c.name).sort()).toEqual(['run nb_customers', 'run nb_products'])
  })

  it('nests an invoked pipeline inside the master that invoked it', () => {
    const mk = (key: string, name: string): Step => ({
      key, kind: 'notebook', ws: 'Engineering', itemId: `it-${key}`, name,
    })
    const a = mk('a', 'invoke pl_00_master / invoke pl_20_bronze / run nb_customers')
    const b = mk('b', 'invoke pl_00_master / invoke pl_30_silver / run nb_orders')
    const T = 'Platform/lh_bronze/customers'
    const res = ran('x', result({
      writes: [T],
      tables: { [T]: { workspace: 'Platform', lakehouse: 'lh_bronze', table: 'customers', resolved: true } },
    }))
    const model = sequenceToModel([a, b], new Map([[a.key, res], [b.key, res]]), 'M', 'flow', {
      ...DEFAULT_PORT_OPTIONS, layout: 'stages',
    }).model
    const eng = model.layers.find((l) => l.name === 'Engineering')!
    // One object, not two paths flattened into sibling labels.
    expect(eng.objects.map((o) => o.name)).toEqual(['invoke pl_00_master'])
    expect(eng.objects[0].children.map((c) => c.name)).toEqual([
      'invoke pl_20_bronze',
      'invoke pl_30_silver',
    ])
    expect(eng.objects[0].children[0].children.map((c) => c.name)).toEqual(['run nb_customers'])
  })

  it('leaves a directly-run notebook as its own object', () => {
    const { steps, results } = medallionRun()
    const model = sequenceToModel(steps, results, 'M', 'flow', {
      ...DEFAULT_PORT_OPTIONS, layout: 'workspace',
    }).model
    expect(model.layers.find((l) => l.name === 'Engineering')!.objects.map((o) => o.name)).toEqual([
      'nb_silver',
    ])
  })
})
