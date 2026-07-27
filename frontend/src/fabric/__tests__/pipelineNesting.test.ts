// A pipeline card shows its ACTIVITIES, with the tables each one touched nested
// under it — not a flat merge of every table the pipeline touched.
//
// The flat merge answered "what did this pipeline touch" but lost "which step
// touched it", which is the question a pipeline card exists to answer.
import { describe, expect, it } from 'vitest'
import { buildFlow } from '../SequenceCanvas'
import type { Step, StepResult } from '../sequence'
import type { SandboxRunResult } from '../../api'

const pipeline = (key: string, name: string): Step => ({
  key,
  kind: 'pipeline',
  ws: 'ws1',
  itemId: `it-${key}`,
  name,
})

const notebook = (key: string, name: string): Step => ({ ...pipeline(key, name), kind: 'notebook' })

const result = (over: Partial<SandboxRunResult>): SandboxRunResult => ({
  ok: true,
  engine: 'stub',
  cells: [],
  reads: [],
  writes: [],
  table_schemas: {},
  column_lineage: [],
  tables: {},
  workspace: '',
  log: [],
  saw_credentials: false,
  error: null,
  ...over,
})

/** A pipeline whose two notebooks chain raw → silver → gold. */
function chained() {
  const p = pipeline('p', 'PL_nightly')
  const results = new Map<string, StepResult>([
    [
      p.key,
      {
        status: 'ok',
        runs: [
          { name: 'build_silver', status: 'ok', result: result({ reads: ['raw'], writes: ['silver'] }) },
          { name: 'build_gold', status: 'ok', result: result({ reads: ['silver'], writes: ['gold'] }) },
        ],
        activities: [],
      },
    ],
  ])
  return { p, results }
}

describe('a pipeline card', () => {
  it('heads each activity, then nests the tables it touched', () => {
    const { p, results } = chained()
    const { nodes } = buildFlow([p], results)
    const card = nodes.find((n) => n.id === `s:${p.key}`)!
    expect(card.rows.map((r) => [r.tone, r.label, r.depth ?? 0])).toEqual([
      ['run', 'build_silver', 0],
      ['read', 'raw', 1],
      ['write', 'silver', 1],
      ['run', 'build_gold', 0],
      ['read', 'silver', 1],
      ['write', 'gold', 1],
    ])
  })

  it('shows a table twice when two activities both touch it', () => {
    // `silver` is written by the first and read by the second. That is two
    // accesses, and collapsing them to one row is what hid which step did what.
    const { p, results } = chained()
    const card = buildFlow([p], results).nodes.find((n) => n.id === `s:${p.key}`)!
    expect(card.rows.filter((r) => r.label === 'silver')).toHaveLength(2)
  })

  it('gives each nested row its own key so edges land on the right one', () => {
    const { p, results } = chained()
    const { nodes, edges } = buildFlow([p], results)
    const card = nodes.find((n) => n.id === `s:${p.key}`)!
    expect(new Set(card.rows.map((r) => r.key)).size).toBe(card.rows.length)

    // The write of `silver` and the read of `silver` are different endpoints.
    const write = edges.find((e) => e.to === 't:silver' && e.tone === 'write')!
    const read = edges.find((e) => e.from === 't:silver' && e.tone === 'read')!
    expect(write.fromRow).not.toBe(read.toRow)
    expect(card.rows.some((r) => r.key === write.fromRow)).toBe(true)
    expect(card.rows.some((r) => r.key === read.toRow)).toBe(true)
  })

  it('keeps an activity that touched nothing, and says so', () => {
    const p = pipeline('p', 'PL')
    const results = new Map<string, StepResult>([
      [p.key, { status: 'ok', runs: [{ name: 'Wait', status: 'ok', result: result({}) }] }],
    ])
    const card = buildFlow([p], results).nodes.find((n) => n.id === `s:${p.key}`)!
    expect(card.rows).toEqual([{ key: 'a:a0', label: 'Wait', tone: 'run', meta: 'no tables' }])
  })

  it('marks a failed activity on its own row', () => {
    const p = pipeline('p', 'PL')
    const results = new Map<string, StepResult>([
      [p.key, { status: 'error', runs: [{ name: 'boom', status: 'error', error: 'nope' }] }],
    ])
    const card = buildFlow([p], results).nodes.find((n) => n.id === `s:${p.key}`)!
    expect(card.rows[0]).toMatchObject({ tone: 'run', label: 'boom', meta: 'error' })
  })

  it('leaves a notebook step flat — it IS the notebook, so there is nothing to nest under', () => {
    const n = notebook('n', 'enrich')
    const results = new Map<string, StepResult>([
      [
        n.key,
        {
          status: 'ok',
          runs: [{ name: 'enrich', status: 'ok', result: result({ reads: ['raw'], writes: ['silver'] }) }],
        },
      ],
    ])
    const card = buildFlow([n], results).nodes.find((n2) => n2.id === `s:${n.key}`)!
    expect(card.rows.map((r) => [r.tone, r.label, r.depth ?? 0])).toEqual([
      ['read', 'raw', 0],
      ['write', 'silver', 0],
    ])
    // ...and its keys are unchanged, so its edges anchor exactly as before.
    expect(card.rows.map((r) => r.key)).toEqual(['r:raw', 'w:silver'])
  })

  it('still draws a pipeline with no runs as a bare card', () => {
    const p = pipeline('p', 'PL')
    const results = new Map<string, StepResult>([[p.key, { status: 'pending', runs: [] }]])
    const card = buildFlow([p], results).nodes.find((n) => n.id === `s:${p.key}`)!
    expect(card.rows).toEqual([])
  })
})
