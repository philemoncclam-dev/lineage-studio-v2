// The "What actually ran" section of the run report, rendered.
//
// The aggregation is covered in `observed.test.ts`; this covers the thing a
// user actually sees, and the distinctions that are easy to lose in markup:
// that nothing renders when nothing was asked, that a discrepancy is visible
// without expanding anything, and that a run with no history explains itself
// instead of showing a silent zero.
import { describe, expect, it } from 'vitest'
import { render, screen } from '@testing-library/react'
import { SequenceCanvas } from '../SequenceCanvas'
import type { Step, StepResult } from '../sequence'
import type { SandboxObservedRun, SandboxRunComparison, SandboxRunResult } from '../../api'

const STEP: Step = { key: 's1', kind: 'notebook', ws: 'ws1', itemId: 'it1', name: 'silver_load' }

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
  statements_seen: 2,
  statements_resolved: 2,
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
  tables: {},
  log: [],
  saw_credentials: false,
  error: null,
  ...over,
})

const results = (r: SandboxRunResult): Map<string, StepResult> =>
  new Map([['s1', { status: 'ok', runs: [{ name: 'silver_load', status: 'ok', result: r }] }]])

const renderReport = (r: SandboxRunResult) =>
  render(<SequenceCanvas steps={[STEP]} results={results(r)} pane="report" />)

describe('the run report’s "What actually ran" section', () => {
  it('is absent entirely when run history was not requested', () => {
    // Not the same as "we checked and found nothing", which is a much stronger
    // claim — so the section must not appear at all.
    renderReport(result({ writes: ['Finance/Bronze/silver'] }))
    expect(screen.queryByLabelText('What actually ran')).toBeNull()
  })

  it('confirms the prediction when the real run agrees', () => {
    renderReport(
      result({
        writes: ['Finance/Bronze/silver'],
        observed: observedRun({ writes: ['Finance/Bronze/silver'] }),
        comparison: comparison({ agreed_writes: ['Finance/Bronze/silver'] }),
      }),
    )
    expect(screen.getByLabelText('What actually ran')).toBeTruthy()
    expect(screen.getByText(/1 of 1 predicted table confirmed/)).toBeTruthy()
    expect(screen.getByText('Matches')).toBeTruthy()
  })

  it('shows an unpredicted table without needing anything expanded', () => {
    // The find. It is the one thing in this report that cannot be learned any
    // other way, so it must not be behind a disclosure triangle.
    const { container } = renderReport(
      result({
        writes: ['Finance/Bronze/silver'],
        observed: observedRun({
          writes: ['Finance/Bronze/silver', 'Finance/Bronze/audit_log'],
          tables: {
            'Finance/Bronze/audit_log': {
              workspace: 'Finance',
              lakehouse: 'Bronze',
              table: 'audit_log',
              resolved: true,
            },
          },
        }),
        comparison: comparison({
          agreed_writes: ['Finance/Bronze/silver'],
          observed_only_writes: ['Finance/Bronze/audit_log'],
        }),
      }),
    )
    expect(screen.getByText('Differs')).toBeTruthy()
    // Labelled by its leaf, not shown as a raw ref — the side table has to have
    // survived the merge for this to read as a table name.
    expect(screen.getByText('audit_log')).toBeTruthy()
    // The callout itself, not the headline that summarises it — and NOT inside a
    // <details>, which is the property being pinned: this must be visible on
    // arrival, not one click away.
    const find = container.querySelector('.sbx-observed-find')
    expect(find?.textContent).toMatch(/did not predict/)
    expect(find?.closest('details')).toBeNull()
    expect(find?.textContent).toContain('audit_log')
  })

  it('does not call an unconfirmed prediction wrong', () => {
    renderReport(
      result({
        writes: ['Finance/Bronze/silver'],
        observed: observedRun({ writes: [] }),
        comparison: comparison({ predicted_only_writes: ['Finance/Bronze/silver'] }),
      }),
    )
    expect(screen.getByText(/unconfirmed, not necessarily wrong/)).toBeTruthy()
  })

  it('explains itself when there is no run history to compare against', () => {
    renderReport(
      result({
        writes: ['Finance/Bronze/silver'],
        observed: observedRun({
          available: false,
          notes: ['this notebook has no recorded Spark runs.'],
        }),
      }),
    )
    expect(screen.getByText(/No readable run history/)).toBeTruthy()
    expect(screen.getByText(/no recorded Spark runs/)).toBeTruthy()
    // No verdict pill: there is nothing to have matched or differed from.
    expect(screen.queryByText('Matches')).toBeNull()
    expect(screen.queryByText('Differs')).toBeNull()
  })

  it('adds a Confirmed figure to the report header', () => {
    renderReport(
      result({
        writes: ['Finance/Bronze/silver'],
        observed: observedRun({ writes: ['Finance/Bronze/silver'] }),
        comparison: comparison({ agreed_writes: ['Finance/Bronze/silver'] }),
      }),
    )
    expect(screen.getByText('Confirmed')).toBeTruthy()
    expect(screen.getByText('1/1')).toBeTruthy()
  })
})
