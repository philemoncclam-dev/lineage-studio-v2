// Data Flow: the same run with the notebooks contracted into their lines.
//
// A different level of abstraction rather than another axis — which is why the
// tests are about what SURVIVES the contraction and what must not be invented
// by it.
import { describe, expect, it } from 'vitest'
import { buildFlow, contractSteps, layoutDataFlow } from '../SequenceCanvas'
import type { Step, StepResult } from '../sequence'
import type { SandboxRunResult } from '../../api'

const result = (over: Partial<SandboxRunResult>): SandboxRunResult => ({
  ok: true, engine: 'spark', cells: [], reads: [], writes: [], table_schemas: {},
  column_lineage: [], tables: {}, workspace: 'plat', log: [], saw_credentials: false,
  error: null, ...over,
})

const nb = (key: string, name: string): Step => ({ key, kind: 'notebook', ws: 'plat', itemId: key, name })
const ran = (name: string, r: SandboxRunResult): StepResult => ({
  status: 'ok', runs: [{ name, status: 'ok', result: r }],
})

/** landing -> bronze -> silver, one notebook per hop. */
const medallion = () => {
  const a = nb('a', 'nb_bronze')
  const b = nb('b', 'nb_silver')
  return {
    steps: [a, b],
    results: new Map([
      [a.key, ran('nb_bronze', result({ reads: ['raw'], writes: ['bronze'] }))],
      [b.key, ran('nb_silver', result({ reads: ['bronze'], writes: ['silver'] }))],
    ]),
  }
}

const contracted = () => {
  const { steps, results } = medallion()
  const flow = buildFlow(steps, results, true)
  return contractSteps(flow.nodes, flow.edges)
}

describe('contractSteps', () => {
  it('leaves only tables on the canvas', () => {
    const { nodes } = contracted()
    expect(nodes.every((n) => n.kind === 'table')).toBe(true)
    expect(nodes.length).toBeGreaterThan(0)
  })

  it('joins each table to the one it was made from', () => {
    const { edges } = contracted()
    // Two hops, and the notebook that made each rides on the line — it has no
    // card left to be named on.
    expect(edges.map((e) => e.label).sort()).toEqual(['nb_bronze', 'nb_silver'])
    expect(edges.every((e) => e.tone === 'write')).toBe(true)
  })

  it('fans one step reading three tables into three arrows', () => {
    const s = nb('j', 'nb_join')
    const results = new Map([
      [s.key, ran('nb_join', result({ reads: ['a', 'b', 'c'], writes: ['out'] }))],
    ])
    const flow = buildFlow([s], results, true)
    const { edges } = contractSteps(flow.nodes, flow.edges)
    expect(edges).toHaveLength(3)
    expect(edges.every((e) => e.label === 'nb_join')).toBe(true)
  })

  it('draws no arrow for a table refreshed in place', () => {
    // Read and written by one step is a refresh, not a hop, and an arrow from a
    // row to itself is a dot.
    const s = nb('r', 'nb_refresh')
    const results = new Map([[s.key, ran('nb_refresh', result({ reads: ['t'], writes: ['t'] }))]])
    const flow = buildFlow([s], results, true)
    expect(contractSteps(flow.nodes, flow.edges).edges).toHaveLength(0)
  })

  it('keeps a table nothing writes, with nothing pointing into it', () => {
    const s = nb('s', 'nb_read')
    const results = new Map([[s.key, ran('nb_read', result({ reads: ['source'], writes: [] }))]])
    const flow = buildFlow([s], results, true)
    const { nodes, edges } = contractSteps(flow.nodes, flow.edges)
    expect(nodes.length).toBe(1)
    expect(edges).toHaveLength(0)
  })

  it('invents no column edges', () => {
    // Which input column fed which output is what `column_lineage` resolves;
    // pairing a read column with a write column across the step cannot know it,
    // and guessing would put edges on screen the run itself refused to draw.
    const { edges } = contracted()
    expect(edges.every((e) => e.kind === 'table')).toBe(true)
  })
})

describe('layoutDataFlow', () => {
  it('puts sources on the left and what they feed to the right', () => {
    const { nodes, edges } = contracted()
    const { pos, bands } = layoutDataFlow(nodes, edges)
    // No lakehouse resolved for these refs, so each table is its own card.
    const x = (label: string) => pos.get(nodes.find((n) => n.label === label)!.id)!.x
    expect(x('raw')).toBeLessThan(x('bronze'))
    expect(x('bronze')).toBeLessThan(x('silver'))
    expect(bands.map((b) => b.label)).toEqual(['Sources', 'Derived 1', 'Outputs'])
  })
})
