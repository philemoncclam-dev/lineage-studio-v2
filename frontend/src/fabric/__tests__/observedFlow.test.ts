// The Confirmed view's graph — built only from what a real Fabric run did.
//
// The claim this view makes is stronger than any other in the app: every card
// and every line on it happened. So the tests here are mostly about what must
// NOT appear — a predicted table, a run with no readable history, a statement
// that resolved nothing.
import { describe, expect, it } from 'vitest'
import { buildObservedFlow } from '../SequenceCanvas'
import type { ObservedSummary } from '../observed'
import type { SandboxObservedRun, SandboxObservedStatement } from '../../api'

const statement = (over: Partial<SandboxObservedStatement> = {}): SandboxObservedStatement => ({
  execution_id: 1,
  description: '',
  status: 'COMPLETED',
  submitted: '',
  duration_ms: null,
  reads: [],
  writes: [],
  ...over,
})

const run = (over: Partial<SandboxObservedRun> = {}): SandboxObservedRun => ({
  available: true,
  livy_id: 'l1',
  application_id: 'app1',
  state: 'Success',
  submitted_at: '2026-08-01T09:00:00Z',
  code_changed_at: '',
  submitter: 'Ada',
  reads: [],
  writes: [],
  statements: [],
  tables: {},
  statements_seen: 0,
  statements_resolved: 0,
  unrecognised: [],
  notes: [],
  ...over,
})

const summary = (rows: ObservedSummary['rows'], tables: ObservedSummary['tables'] = {}): ObservedSummary => ({
  asked: rows.length,
  available: rows.filter((r) => r.observed.available).length,
  rows,
  agreed: new Set(),
  predictedOnly: new Set(),
  observedOnly: new Set(),
  notes: [],
  lastRunAt: '',
  lastRunBy: '',
  lastRunState: '',
  codeIsNewer: false,
  tables,
  empty: rows.length === 0,
})

const REF = 'Finance/Bronze/orders'
const OUT = 'Finance/Silver/clean'
const tables = {
  [REF]: { workspace: 'Finance', lakehouse: 'Bronze', table: 'orders', resolved: true, kind: 'table' as const },
  [OUT]: { workspace: 'Finance', lakehouse: 'Silver', table: 'clean', resolved: true, kind: 'table' as const },
}

describe('buildObservedFlow', () => {
  it('draws one card per SQL execution, in the order they ran', () => {
    const { nodes } = buildObservedFlow(
      summary(
        [
          {
            name: 'nb_clean',
            observed: run({
              statements: [
                statement({ execution_id: 7, description: 'save at nb:12', reads: [REF], writes: [OUT] }),
                statement({ execution_id: 9, description: 'count at nb:30', reads: [OUT] }),
              ],
            }),
            comparison: null,
          },
        ],
        tables,
      ),
    )
    // Spark opens one execution per action, so the executions ARE the run's
    // real steps — and their order is the order they happened in.
    const steps = nodes.filter((n) => n.kind !== 'table')
    expect(steps.map((n) => n.label)).toEqual(['save at nb:12', 'count at nb:30'])
    // The tables each execution touched, one card each, no lakehouse nesting.
    expect(nodes.filter((n) => n.kind === 'table').map((n) => n.label).sort()).toEqual([
      'clean',
      'orders',
    ])
  })

  it('joins each execution to the tables that execution really touched', () => {
    const { nodes, edges } = buildObservedFlow(
      summary(
        [
          {
            name: 'nb',
            observed: run({
              statements: [statement({ execution_id: 1, reads: [REF], writes: [OUT] })],
            }),
            comparison: null,
          },
        ],
        tables,
      ),
    )
    const step = nodes.find((n) => n.kind !== 'table')!
    const read = edges.find((e) => e.tone === 'read')!
    const write = edges.find((e) => e.tone === 'write')!
    // A read arrives at the execution, a write leaves it — true direction, and
    // both anchored on the execution's own row for that table.
    expect(read.to).toBe(step.id)
    expect(read.toRow).toBe(`r:${REF}`)
    expect(write.from).toBe(step.id)
    expect(write.fromRow).toBe(`w:${OUT}`)
  })

  it('shows a real execution’s duration, which no prediction can have', () => {
    const { nodes } = buildObservedFlow(
      summary(
        [
          {
            name: 'nb',
            observed: run({ statements: [statement({ execution_id: 1, duration_ms: 4210, writes: [OUT] })] }),
            comparison: null,
          },
        ],
        tables,
      ),
    )
    expect(nodes.find((n) => n.kind !== 'table')!.badge).toBe('4210 ms')
  })

  it('draws nothing for a notebook with no readable run', () => {
    // The whole point of the view is that what is on it happened. A notebook
    // whose history could not be read contributes no cards rather than empty
    // ones — an empty card would claim an execution that did nothing.
    const { nodes, edges } = buildObservedFlow(
      summary([
        { name: 'nb', observed: run({ available: false, notes: ['no runs'] }), comparison: null },
      ]),
    )
    expect([nodes, edges]).toEqual([[], []])
  })

  it('names a table by its leaf even when the run resolved no parts for it', () => {
    const { nodes } = buildObservedFlow(
      summary([
        {
          name: 'nb',
          observed: run({ statements: [statement({ execution_id: 1, writes: ['odd/ref/x'] })] }),
          comparison: null,
        },
      ]),
    )
    // No entry in `tables` — the card still has to render as something, and the
    // ref itself is the honest fallback.
    expect(nodes.find((n) => n.kind === 'table')!.label).toBe('odd/ref/x')
  })
})
