// The run report's answer to "what actually happened in there".
//
// The aggregation is covered in `runSummary.test.ts`; this covers what a user
// sees. Three things the old report got wrong and must not regress: no sentence
// saying what the run did, failures buried below everything that succeeded, and
// per-cell output captured by the executor but rendered nowhere.
import { describe, expect, it } from 'vitest'
import { render, screen } from '@testing-library/react'
import { SequenceCanvas } from '../SequenceCanvas'
import type { Step, StepResult } from '../sequence'
import type { SandboxCellResult, SandboxRunResult } from '../../api'

const STEP: Step = { key: 's1', kind: 'notebook', ws: 'ws1', itemId: 'it1', name: 'silver_load' }

const cell = (index: number, over: Partial<SandboxCellResult> = {}): SandboxCellResult => ({
  index,
  status: 'ok',
  reads: [],
  writes: [],
  stdout: '',
  error: null,
  ...over,
})

const result = (over: Partial<SandboxRunResult> = {}): SandboxRunResult => ({
  ok: true,
  engine: 'spark',
  cells: [],
  reads: ['Finance/Bronze/raw'],
  writes: ['Finance/Silver/clean'],
  table_schemas: {},
  column_lineage: [],
  tables: {},
  log: [],
  saw_credentials: false,
  error: null,
  ...over,
})

const renderReport = (r: SandboxRunResult, status: 'ok' | 'error' = 'ok') =>
  render(
    <SequenceCanvas
      steps={[STEP]}
      results={new Map<string, StepResult>([
        ['s1', { status, runs: [{ name: 'silver_load', status, result: r }] } as StepResult],
      ])}
      pane="report"
    />,
  )

describe('the run report', () => {
  it('opens with a sentence saying what the run did', () => {
    renderReport(result({ cells: [cell(0), cell(1)] }))
    expect(screen.getByText(/Ran 1 notebook, 2 cells — read 1 table, wrote 1\./)).toBeInTheDocument()
  })

  it('shows a failed cell even when the step itself reports ok', () => {
    // The executor keeps going after a cell raises. This is the case that used
    // to be invisible: a green step, a quietly incomplete run.
    renderReport(result({ cells: [cell(0), cell(1, { status: 'error', error: 'NameError: df' })] }))
    expect(screen.getByLabelText('Failures')).toBeInTheDocument()
    expect(screen.getAllByText(/NameError: df/).length).toBeGreaterThan(0)
    expect(screen.getByText(/1 cell failed/)).toBeInTheDocument()
  })

  it('renders stdout the executor captured', () => {
    renderReport(result({ cells: [cell(0, { stdout: 'rows written: 42' })] }))
    expect(screen.getByText(/rows written: 42/)).toBeInTheDocument()
  })

  it('says so when a cell printed nothing, rather than showing an empty box', () => {
    renderReport(result({ cells: [cell(0)] }))
    expect(screen.getByText('no output')).toBeInTheDocument()
  })

  it('draws no failure section for a clean run', () => {
    renderReport(result({ cells: [cell(0)] }))
    expect(screen.queryByLabelText('Failures')).not.toBeInTheDocument()
  })

  it('shows nothing cell-shaped when the engine returned no cells', () => {
    // The definition engine runs nothing at all; an empty "0 cells" disclosure
    // would imply it tried.
    renderReport(result({ engine: 'definition', cells: [] }))
    expect(screen.queryByText(/cells$/)).not.toBeInTheDocument()
  })
})

describe('downstream impact in the report', () => {
  const withDownstream = (downstream: SandboxRunResult['downstream']) =>
    renderReport(result({ cells: [cell(0)], downstream }))

  it('names what reads the tables this run wrote', () => {
    withDownstream({
      available: true,
      consumers: [
        { id: 'ds1', name: 'Finance Model', kind: 'semanticmodel', via: 'Silver' },
        { id: 'r1', name: 'Exec Summary', kind: 'report', via: 'Silver' },
      ],
      notes: [],
    })
    expect(screen.getByText('Finance Model')).toBeInTheDocument()
    expect(screen.getByText('Exec Summary')).toBeInTheDocument()
    expect(screen.getByText(/2 things downstream/)).toBeInTheDocument()
  })

  it('distinguishes "checked, nothing reads this" from "not checked"', () => {
    // The distinction the whole `available` flag exists for: an unconfigured
    // tenant must not read as a notebook nobody depends on.
    withDownstream({ available: true, consumers: [], notes: [] })
    expect(screen.getByText(/nothing in Power BI reads/)).toBeInTheDocument()
  })

  it('says why when the scan did not happen', () => {
    withDownstream({
      available: false,
      consumers: [],
      notes: ['downstream impact unavailable — scanner not enabled'],
    })
    expect(screen.getByText(/scanner not enabled/)).toBeInTheDocument()
    expect(screen.queryByText(/nothing in Power BI reads/)).not.toBeInTheDocument()
  })

  it('renders nothing at all when the run carried no downstream field', () => {
    renderReport(result({ cells: [cell(0)] }))
    expect(screen.queryByLabelText('Downstream of this run')).not.toBeInTheDocument()
  })
})
