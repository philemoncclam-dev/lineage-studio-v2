// What actually ran, merged across a sequence — the report's only outside evidence.
//
// The three buckets are the whole feature, and the one that earns it is
// `observedOnly`: a table the real run touched that no amount of reading the
// source predicted. Everything here is about keeping those three honest,
// especially in the several different ways a notebook can have no history.
import { describe, expect, it } from 'vitest'
import { observedAgrees, observedHeadline, observedSummary } from '../observed'
import type { StepResult } from '../sequence'
import type { SandboxObservedRun, SandboxRunComparison, SandboxRunResult } from '../../api'

const observedRun = (over: Partial<SandboxObservedRun> = {}): SandboxObservedRun => ({
  available: true,
  livy_id: 'l1',
  application_id: 'app_1',
  state: 'Success',
  submitted_at: '2026-08-01T09:00:00Z',
  submitter: 'Ada',
  reads: [],
  writes: [],
  statements: [],
  tables: {},
  statements_seen: 1,
  statements_resolved: 1,
  unrecognised: [],
  notes: [],
  ...over,
})

const comparison = (over: Partial<SandboxRunComparison> = {}): SandboxRunComparison => ({
  agreed_reads: [],
  agreed_writes: [],
  predicted_only_reads: [],
  predicted_only_writes: [],
  observed_only_reads: [],
  observed_only_writes: [],
  ...over,
})

const result = (over: Partial<SandboxRunResult>): SandboxRunResult => ({
  ok: true,
  engine: 'stub',
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

const results = (...rs: SandboxRunResult[]): Map<string, StepResult> =>
  new Map(
    rs.map((r, i) => [
      `s${i}`,
      { status: 'ok', runs: [{ name: `nb${i}`, status: 'ok', result: r }] } as StepResult,
    ]),
  )

describe('observedSummary', () => {
  it('is empty when nothing asked for run history', () => {
    // The toggle is off, or the backend predates the feature. Render nothing —
    // an empty section reads as "we checked and found nothing", which is a
    // different and much stronger claim.
    const s = observedSummary(results(result({ writes: ['a'] })))
    expect(s.empty).toBe(true)
    expect(observedHeadline(s)).toBe('')
  })

  it('sorts tables into agreed, predicted-only and observed-only', () => {
    const s = observedSummary(
      results(
        result({
          observed: observedRun({ reads: ['raw'], writes: ['silver', 'surprise'] }),
          comparison: comparison({
            agreed_reads: ['raw'],
            agreed_writes: ['silver'],
            predicted_only_writes: ['never_ran'],
            observed_only_writes: ['surprise'],
          }),
        }),
      ),
    )
    expect([...s.agreed].sort()).toEqual(['raw', 'silver'])
    expect([...s.predictedOnly]).toEqual(['never_ran'])
    expect([...s.observedOnly]).toEqual(['surprise'])
    expect(s.available).toBe(1)
  })

  it('a table confirmed by one notebook is not unconfirmed by another', () => {
    // Two notebooks touch `shared`. One has history that confirms it; the other
    // has none. The optimistic merge is the honest one — the confirmation
    // happened, and a second notebook lacking history is not evidence against it.
    const s = observedSummary(
      results(
        result({
          observed: observedRun({ writes: ['shared'] }),
          comparison: comparison({ agreed_writes: ['shared'] }),
        }),
        result({
          observed: observedRun({ submitted_at: '2026-07-01T09:00:00Z' }),
          comparison: comparison({ predicted_only_writes: ['shared'] }),
        }),
      ),
    )
    expect(s.agreed.has('shared')).toBe(true)
    expect(s.predictedOnly.has('shared')).toBe(false)
  })

  it('reports the newest run for the summary line', () => {
    const s = observedSummary(
      results(
        result({
          observed: observedRun({ submitted_at: '2026-07-01T09:00:00Z', submitter: 'Old' }),
          comparison: comparison(),
        }),
        result({
          observed: observedRun({
            submitted_at: '2026-08-01T09:00:00Z',
            submitter: 'Ada',
            state: 'Success',
          }),
          comparison: comparison(),
        }),
      ),
    )
    expect(s.lastRunBy).toBe('Ada')
    expect(s.lastRunState).toBe('Success')
  })

  it('carries the ref side table so an observed-only table can be labelled', () => {
    // An observed-only table appears in NO sandbox result by definition, so its
    // parts have to come from the observed run or the list renders raw refs.
    const s = observedSummary(
      results(
        result({
          observed: observedRun({
            writes: ['Finance/Bronze/surprise'],
            tables: {
              'Finance/Bronze/surprise': {
                workspace: 'Finance',
                lakehouse: 'Bronze',
                table: 'surprise',
                resolved: true,
              },
            },
          }),
          comparison: comparison({ observed_only_writes: ['Finance/Bronze/surprise'] }),
        }),
      ),
    )
    expect(s.tables['Finance/Bronze/surprise'].table).toBe('surprise')
  })

  describe('when there is no readable history', () => {
    it('keeps the reasons rather than reporting a silent zero', () => {
      const s = observedSummary(
        results(
          result({
            observed: observedRun({
              available: false,
              notes: ['this notebook has no recorded Spark runs.'],
            }),
          }),
        ),
      )
      expect(s.empty).toBe(false)
      expect(s.available).toBe(0)
      expect(s.notes).toEqual(['this notebook has no recorded Spark runs.'])
      expect(observedHeadline(s)).toBe('No readable run history for these notebooks.')
    })

    it('does not count an unavailable run as agreement', () => {
      const s = observedSummary(
        results(result({ observed: observedRun({ available: false, notes: ['refused'] }) })),
      )
      expect(observedAgrees(s)).toBe(false)
    })
  })
})

describe('observedHeadline', () => {
  it('leads with the confirmation, not the discrepancy', () => {
    // The common case is agreement, and a report that opens with a warning on a
    // healthy run trains people to stop reading it.
    const s = observedSummary(
      results(
        result({
          observed: observedRun({ writes: ['a'] }),
          comparison: comparison({ agreed_writes: ['a'] }),
        }),
      ),
    )
    expect(observedHeadline(s)).toBe('1 of 1 predicted table confirmed by the last real run')
    expect(observedAgrees(s)).toBe(true)
  })

  it('names the find when the run touched something unpredicted', () => {
    const s = observedSummary(
      results(
        result({
          observed: observedRun({ writes: ['a', 'b'] }),
          comparison: comparison({ agreed_writes: ['a'], observed_only_writes: ['b'] }),
        }),
      ),
    )
    expect(observedHeadline(s)).toContain('1 table the run touched that this analysis did not predict')
    expect(observedAgrees(s)).toBe(false)
  })
})
