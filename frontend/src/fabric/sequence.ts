// The sandbox run sequence, held OUTSIDE the components so the tree (which
// adds steps), the sequence panel (which orders and runs them) and the canvas
// (which draws them) are three views of one thing.
//
// A plain module store + useSyncExternalStore rather than context — the state
// has to survive route changes, and the views mount independently.
import { useSyncExternalStore } from 'react'
import {
  runSandbox,
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
}

export const stepReads = (r?: StepResult): string[] =>
  [...new Set((r?.runs ?? []).flatMap((x) => x.result?.reads ?? []))]
export const stepWrites = (r?: StepResult): string[] =>
  [...new Set((r?.runs ?? []).flatMap((x) => x.result?.writes ?? []))]

let seq = 0
const newKey = () => `step-${++seq}`

let state: SequenceState = { steps: [], results: new Map(), running: false }
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
  set({ running: true, results: new Map(next) })

  for (const step of steps) {
    next.set(step.key, { status: 'running', runs: [] })
    set({ results: new Map(next) })
    try {
      if (step.kind === 'notebook') {
        const result = await runSandbox({ name: step.name, workspace_id: step.ws, item_id: step.itemId })
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

        // Execute the pipeline's notebook activities in dependency order.
        const runs: RunEntry[] = []
        for (const a of orderActivities(activities)) {
          if (!a.notebook_id) continue
          try {
            const result = await runSandbox({
              name: a.name,
              workspace_id: a.workspace_id ?? step.ws,
              item_id: a.notebook_id,
            })
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
  state = { steps: [], results: new Map(), running: false }
  listeners.forEach((l) => l())
}
