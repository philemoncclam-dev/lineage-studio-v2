import { describe, expect, it } from 'vitest'
import { pipelineWaves } from '../fabric/explore'
import type { FabricPipelineActivity } from '../../api'

const act = (
  name: string,
  depends_on: string[] = [],
  over: Partial<FabricPipelineActivity> = {},
): FabricPipelineActivity => ({
  name,
  type: 'TridentNotebook',
  depends_on,
  reads: [],
  writes: [],
  column_lineage: [],
  ...over,
})

describe('pipelineWaves — a pipeline’s order of events', () => {
  it('numbers a straight chain 1, 2, 3', () => {
    const out = pipelineWaves([act('a'), act('b', ['a']), act('c', ['b'])])
    expect(out.map((c) => [c.name, c.wave])).toEqual([
      ['a', 1],
      ['b', 2],
      ['c', 3],
    ])
  })

  it('gives activities that can start together the same number', () => {
    // b and c both wait only on a, so they are one step, not two.
    const out = pipelineWaves([act('a'), act('b', ['a']), act('c', ['a'])])
    expect(out.find((x) => x.name === 'b')!.wave).toBe(2)
    expect(out.find((x) => x.name === 'c')!.wave).toBe(2)
  })

  it('marks those as concurrent, so the badge is not read as a position', () => {
    const out = pipelineWaves([act('a'), act('b', ['a']), act('c', ['a'])])
    expect(out.find((x) => x.name === 'a')!.concurrent).toBe(false)
    expect(out.find((x) => x.name === 'b')!.concurrent).toBe(true)
  })

  it('waits for the DEEPEST dependency, not the first', () => {
    // d depends on a (wave 1) and c (wave 3); it cannot start before 4.
    const out = pipelineWaves([act('a'), act('b', ['a']), act('c', ['b']), act('d', ['a', 'c'])])
    expect(out.find((x) => x.name === 'd')!.wave).toBe(4)
  })

  it('returns cards already in order, so the view does not re-sort', () => {
    const out = pipelineWaves([act('c', ['b']), act('a'), act('b', ['a'])])
    expect(out.map((c) => c.name)).toEqual(['a', 'b', 'c'])
  })

  it('ignores a dependency on something not in the pipeline', () => {
    expect(pipelineWaves([act('a', ['ghost'])])[0].wave).toBe(1)
  })

  it('survives a dependency cycle instead of hanging', () => {
    const out = pipelineWaves([act('a', ['b']), act('b', ['a'])])
    expect(out).toHaveLength(2)
  })

  it('carries a Copy activity’s declared I/O as rows', () => {
    const copy = act('load', [], {
      type: 'Copy',
      reads: ['Landing/lh/Files%2Forders%2F*.csv'],
      writes: ['Analytics/Bronze/bronze_orders'],
    })
    const [card] = pipelineWaves([copy])
    expect(card.rows.map((r) => [r.label, r.tone])).toEqual([
      ['Files/orders/*.csv', 'read'],
      ['bronze_orders', 'write'],
    ])
  })

  it('leaves a notebook activity with no rows until it is run', () => {
    // Nothing is declared for one, and guessing would invent lineage.
    expect(pipelineWaves([act('transform')])[0].rows).toEqual([])
  })
})
