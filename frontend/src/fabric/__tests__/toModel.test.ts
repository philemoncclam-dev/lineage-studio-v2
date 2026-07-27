import { describe, expect, it } from 'vitest'
import { sequenceToModel, defaultModelName } from '../toModel'
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

  it('draws a column transition and records its transform', () => {
    const { steps, results } = simpleRun()
    const { model, stats } = sequenceToModel(steps, results, 'M')
    const amount = model.layers[0].objects[0].children.find((a) => a.name === 'amount')!
    const total = model.layers[2].objects[0].children.find((a) => a.name === 'total')!
    const t = model.transitions.find((x) => x.source === amount.id && x.target === total.id)
    expect(t).toBeDefined()
    expect(model.properties[t!.id]).toMatchObject({ Via: 'enrich', Transform: 'amount * 1.2' })
    expect(stats.columnEdges).toBe(1)
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
    // The object-level lineage still stands.
    expect(stats.transitions).toBe(3)
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

    const rightId = model.layers[0].objects.find((o) => o.name === 'right_t')!.children[0]
    const leftId = model.layers[0].objects.find((o) => o.name === 'left_t')!.children[0]
    const outId = model.layers[2].objects[0].children[0]
    expect(model.transitions.some((t) => t.source === rightId.id && t.target === outId.id)).toBe(
      true,
    )
    // ...and emphatically not from the other side of the join.
    expect(model.transitions.some((t) => t.source === leftId.id && t.target === outId.id)).toBe(
      false,
    )
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

  it('leaves a notebook step flat — it IS the notebook', () => {
    const { steps, results } = simpleRun()
    const { model } = sequenceToModel(steps, results, 'M')
    const nb = model.layers[1].objects[0]
    expect(nb.children.map((c) => c.name)).toEqual(['raw_orders', 'silver_orders'])
    expect(nb.children.every((c) => c.children.length === 0)).toBe(true)
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
