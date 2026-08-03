import { describe, expect, it } from 'vitest'
import type { SandboxCellResult, SandboxRunResult } from '../../api'
import { runFailures, runNarrative } from '../runSummary'
import type { Step, StepResult } from '../sequence'

const cell = (index: number, over: Partial<SandboxCellResult> = {}): SandboxCellResult => ({
  index,
  status: 'ok',
  reads: [],
  writes: [],
  stdout: '',
  error: null,
  ...over,
})

const run = (over: Partial<SandboxRunResult> = {}): SandboxRunResult =>
  ({
    engine: 'spark',
    cells: [cell(0), cell(1)],
    reads: ['ws/lh/a', 'ws/lh/b'],
    writes: ['ws/lh/c'],
    saw_credentials: false,
    error: null,
    ...over,
  }) as SandboxRunResult

const step = (key: string, name: string): Step =>
  ({ key, name, kind: 'notebook' }) as Step

const results = (entries: [string, StepResult][]) => new Map(entries)

describe('runFailures', () => {
  it('finds a failed cell inside a step that reports ok', () => {
    // The executor keeps going after a cell raises, so the STEP is fine while
    // the run quietly did less than it looks like it did. This is the case the
    // old report buried hardest.
    const failures = runFailures(
      [step('s1', 'silver_load')],
      results([
        [
          's1',
          {
            status: 'ok',
            runs: [
              {
                name: 'silver_load',
                status: 'ok',
                result: run({ cells: [cell(0), cell(1, { status: 'error', error: 'NameError: df' })] }),
              },
            ],
          } as StepResult,
        ],
      ]),
    )
    expect(failures.cells).toEqual([
      { run: 'silver_load', cell: 2, error: 'NameError: df' },
    ])
  })

  it('reports cell numbers 1-based, matching everything else on the report', () => {
    const failures = runFailures(
      [step('s1', 'n')],
      results([
        [
          's1',
          {
            status: 'ok',
            runs: [{ name: 'n', status: 'ok', result: run({ cells: [cell(0, { status: 'error', error: 'boom' })] }) }],
          } as StepResult,
        ],
      ]),
    )
    expect(failures.cells[0].cell).toBe(1)
  })

  it('collects step-level and run-level errors too', () => {
    const failures = runFailures(
      [step('s1', 'broken')],
      results([
        [
          's1',
          { status: 'error', error: 'fetch refused', runs: [{ name: 'nb', status: 'error', error: 'decode failed', result: null }] } as unknown as StepResult,
        ],
      ]),
    )
    expect(failures.steps).toEqual([
      { name: 'broken', error: 'fetch refused' },
      { name: 'nb', error: 'decode failed' },
    ])
  })

  it('is empty for a clean run', () => {
    const failures = runFailures(
      [step('s1', 'n')],
      results([['s1', { status: 'ok', runs: [{ name: 'n', status: 'ok', result: run() }] } as StepResult]]),
    )
    expect(failures).toEqual({ steps: [], cells: [] })
  })
})

describe('runNarrative', () => {
  const clean = { steps: [], cells: [] }

  it('says what the run touched, in one sentence', () => {
    expect(runNarrative([run()], clean)).toBe(
      'Ran 1 notebook, 2 cells — read 2 tables, wrote 1.',
    )
  })

  it('ends on the failure, so it cannot be missed', () => {
    expect(
      runNarrative([run()], { steps: [], cells: [{ run: 'n', cell: 4, error: 'x' }] }),
    ).toMatch(/— 1 cell failed$/)
  })

  it('mentions missing column lineage as a caveat, not the headline', () => {
    const text = runNarrative(
      [run({ coverage: { writes_without_column_lineage: ['ws/lh/c'] } } as Partial<SandboxRunResult> as SandboxRunResult)],
      clean,
    )
    // The tables written still lead; the gap trails.
    expect(text).toMatch(/wrote 1, 1 without column lineage/)
  })

  it('counts a table touched by two notebooks once', () => {
    expect(runNarrative([run(), run()], clean)).toMatch(/read 2 tables, wrote 1/)
  })

  it('does not claim I/O when there was none', () => {
    expect(runNarrative([run({ reads: [], writes: [] })], clean)).toMatch(/touched no tables/)
  })

  it('handles a run that produced nothing at all', () => {
    expect(runNarrative([], clean)).toBe('Nothing ran.')
  })
})
