// The sandbox run sequence, held OUTSIDE the components so the tree (which
// adds steps), the sequence panel (which orders and runs them) and the canvas
// (which draws them) are three views of one thing.
//
// A plain module store + useSyncExternalStore rather than context — the state
// has to survive route changes, and the views mount independently.
import { useSyncExternalStore } from 'react'
import {
  runSandbox,
  refParts,
  type SandboxColumn,
  type SandboxTableRef,
  fetchFabricPipelineDefinition,
  type SandboxRunResult,
  type FabricPipelineActivity,
} from '../api'

export type StepKind = 'notebook' | 'pipeline'

export interface Step {
  key: string
  kind: StepKind
  ws: string
  itemId: string
  name: string
}

export type StepStatus = 'pending' | 'running' | 'ok' | 'error' | 'skipped'

/** One executed notebook — the step itself, or one notebook activity of a pipeline. */
export interface RunEntry {
  name: string
  status: 'ok' | 'error'
  result?: SandboxRunResult
  error?: string
}

export interface StepResult {
  status: StepStatus
  runs: RunEntry[]
  /** Full activity list for a pipeline (structure, incl. non-notebook ones). */
  activities?: FabricPipelineActivity[]
  error?: string
}

export interface SequenceState {
  steps: Step[]
  results: Map<string, StepResult>
  running: boolean
  /**
   * The results the CURRENT run replaced, kept so Diff has something to compare
   * against.
   *
   * Snapshotted when a run starts rather than when it ends: at that moment the
   * old results are complete and about to be thrown away, which is exactly what
   * "last time" means. Null until a second run — one run has no previous.
   */
  previous: Map<string, StepResult> | null
}

export const stepReads = (r?: StepResult): string[] =>
  [...new Set((r?.runs ?? []).flatMap((x) => x.result?.reads ?? []))]
export const stepWrites = (r?: StepResult): string[] =>
  [...new Set((r?.runs ?? []).flatMap((x) => x.result?.writes ?? []))]

/** Every table ref this step touched, merged across its runs. */
export const stepTables = (r?: StepResult): Record<string, SandboxTableRef> =>
  Object.assign({}, ...(r?.runs ?? []).map((x) => x.result?.tables ?? {}))

/**
 * A Copy activity as a run entry, without anything having run.
 *
 * A pipeline is not Spark, so the sandbox has nothing to execute for one — and
 * a pipeline whose whole job was a Copy used to contribute NO lineage at all,
 * because the loop below only ran activities that referenced a notebook. But a
 * Copy declares its source and sink datasets inline, and its translator is a
 * literal column map, so the backend reads that lineage straight out of the
 * definition.
 *
 * It is shaped as a `SandboxRunResult` so every downstream consumer — the
 * canvas, the report, `sequenceToModel` — treats it identically to a real run
 * without knowing it exists. `engine: 'definition'` is what keeps that from
 * being a lie: the report says where the lineage came from.
 *
 * Returns null for an activity that named no tables, so a Lookup or a Wait
 * doesn't become an empty node.
 */
export function copyActivityRun(a: FabricPipelineActivity): RunEntry | null {
  const reads = a.reads ?? []
  const writes = a.writes ?? []
  if (!reads.length && !writes.length) return null

  const tables: Record<string, SandboxTableRef> = {}
  for (const ref of [...reads, ...writes]) tables[ref] = refParts(ref)

  // Columns come from the mapping rather than from a schema fetch: a Copy names
  // exactly the columns it moves, and those are the ones worth drawing.
  const table_schemas: Record<string, { name: string; type?: string | null }[]> = {}
  const add = (ref: string | null | undefined, column: string) => {
    if (!ref) return
    const columns = (table_schemas[ref] ??= [])
    if (!columns.some((c) => c.name === column)) columns.push({ name: column, type: null })
  }
  for (const flow of a.column_lineage ?? []) {
    add(flow.from_table, flow.from_column)
    add(flow.to_table, flow.to_column)
  }

  return {
    name: a.name,
    status: 'ok',
    result: {
      ok: true,
      engine: 'definition',
      cells: [],
      reads,
      writes,
      table_schemas,
      column_lineage: a.column_lineage ?? [],
      tables,
      log: [`[definition] ${a.type} activity — lineage read from the pipeline definition.`],
      saw_credentials: false,
      error: null,
    },
  }
}

let seq = 0
const newKey = () => `step-${++seq}`

let state: SequenceState = { steps: [], results: new Map(), running: false, previous: null }
const listeners = new Set<() => void>()

function set(next: Partial<SequenceState>) {
  state = { ...state, ...next }
  listeners.forEach((l) => l())
}

const subscribe = (l: () => void) => {
  listeners.add(l)
  return () => listeners.delete(l)
}

export function useSequence(): SequenceState {
  return useSyncExternalStore(subscribe, () => state)
}

/** Append a step. Duplicates are allowed — running a notebook twice in one
 * sequence is a legitimate thing to model. */
export function addStep(step: Omit<Step, 'key'>) {
  set({ steps: [...state.steps, { ...step, key: newKey() }] })
}

export function removeStep(key: string) {
  const results = new Map(state.results)
  results.delete(key)
  set({ steps: state.steps.filter((s) => s.key !== key), results })
}

export function clearSteps() {
  set({ steps: [], results: new Map() })
}

export function moveStep(key: string, dir: -1 | 1) {
  const i = state.steps.findIndex((x) => x.key === key)
  const j = i + dir
  if (i < 0 || j < 0 || j >= state.steps.length) return
  const copy = state.steps.slice()
  ;[copy[i], copy[j]] = [copy[j], copy[i]]
  set({ steps: copy })
}

// Order a pipeline's activities so every activity follows the ones it depends
// on. Kahn's algorithm, keeping the definition order among ready activities;
// anything left in a dependency cycle (or naming a missing activity) is
// appended in definition order rather than dropped.
export function orderActivities(activities: FabricPipelineActivity[]): FabricPipelineActivity[] {
  const known = new Set(activities.map((a) => a.name))
  const pending = activities.slice()
  const done = new Set<string>()
  const out: FabricPipelineActivity[] = []
  while (pending.length) {
    const i = pending.findIndex((a) => a.depends_on.every((d) => !known.has(d) || done.has(d)))
    if (i < 0) break
    const [a] = pending.splice(i, 1)
    done.add(a.name)
    out.push(a)
  }
  return [...out, ...pending]
}

export async function runAll() {
  if (state.running || state.steps.length === 0) return
  const steps = state.steps
  const next = new Map<string, StepResult>()
  steps.forEach((s) => next.set(s.key, { status: 'pending', runs: [] }))
  // The run about to be overwritten becomes "last time". Only a run that
  // produced something counts — comparing against a sequence that never ran
  // would report every table as newly added.
  const had = [...state.results.values()].some((r) => r.runs.length > 0)
  set({ running: true, results: new Map(next), previous: had ? state.results : state.previous })

  // Schemas observed so far, carried forward into every later step.
  //
  // A sequence is a chain: bronze creates a table, silver reads it, gold reads
  // what silver wrote. But each step is its own backend call and its own child
  // process, so the downstream steps arrived knowing nothing — the table they
  // read may not exist in OneLake yet, so its columns came back empty and the
  // whole downstream half of a medallion sequence produced no column lineage.
  // The run that WROTE a table is the best authority on its columns, and this
  // is the only place that knows the run order.
  //
  // The backend uses these to fill gaps only; a schema OneLake answers for is
  // never overridden (see `carried_schemas` in sandbox/router.py).
  const carried: Record<string, SandboxColumn[]> = {}
  const carry = (result: SandboxRunResult) => {
    for (const [ref, columns] of Object.entries(result.table_schemas ?? {})) {
      // Later wins: within one sequence the most recent run to touch a table
      // has the most current shape of it.
      if (columns?.length) carried[ref] = columns
    }
  }

  for (const step of steps) {
    next.set(step.key, { status: 'running', runs: [] })
    set({ results: new Map(next) })
    try {
      if (step.kind === 'notebook') {
        const result = await runSandbox({
          name: step.name,
          workspace_id: step.ws,
          item_id: step.itemId,
          carried_schemas: carried,
        })
        carry(result)
        next.set(step.key, {
          status: result.ok ? 'ok' : 'error',
          runs: [
            {
              name: step.name,
              status: result.ok ? 'ok' : 'error',
              result,
              error: result.ok ? undefined : (result.error ?? undefined),
            },
          ],
          error: result.ok ? undefined : (result.error ?? undefined),
        })
      } else {
        const activities = await fetchFabricPipelineDefinition(step.ws, step.itemId)
        next.set(step.key, { status: 'running', runs: [], activities })
        set({ results: new Map(next) })

        // Walk the pipeline's activities in dependency order. Notebooks are
        // executed in the sandbox; a Copy contributes the lineage it declared,
        // which needs no execution at all.
        const runs: RunEntry[] = []
        for (const a of orderActivities(activities)) {
          if (!a.notebook_id) {
            const declared = copyActivityRun(a)
            if (declared) {
              // A Copy declares its column mapping inline, so it too knows the
              // shape of the table it lands — worth carrying to the next step.
              if (declared.result) carry(declared.result)
              runs.push(declared)
              next.set(step.key, { status: 'running', runs: runs.slice(), activities })
              set({ results: new Map(next) })
            }
            continue
          }
          try {
            const result = await runSandbox({
              name: a.name,
              workspace_id: a.workspace_id ?? step.ws,
              item_id: a.notebook_id,
              carried_schemas: carried,
            })
            // A pipeline's activities run in dependency order, so the carry
            // matters most here — this IS the medallion chain, declared.
            carry(result)
            runs.push({
              name: a.name,
              status: result.ok ? 'ok' : 'error',
              result,
              error: result.ok ? undefined : (result.error ?? undefined),
            })
          } catch (e) {
            runs.push({ name: a.name, status: 'error', error: e instanceof Error ? e.message : String(e) })
          }
          next.set(step.key, { status: 'running', runs: runs.slice(), activities })
          set({ results: new Map(next) })
        }
        const failed = runs.filter((r) => r.status === 'error')
        next.set(step.key, {
          status: failed.length ? 'error' : 'ok',
          runs,
          activities,
          error: failed.length ? `${failed.length} of ${runs.length} notebook activities failed` : undefined,
        })
      }
    } catch (e) {
      next.set(step.key, { status: 'error', runs: [], error: e instanceof Error ? e.message : String(e) })
    }
    set({ results: new Map(next) })
  }
  set({ running: false })
}

/** Test seam — reset the module store between cases. */
export function __resetSequence() {
  state = { steps: [], results: new Map(), running: false, previous: null }
  listeners.forEach((l) => l())
}
