// /fabric/sandbox — a sequence builder. The user stacks notebooks and pipelines
// as ordered steps (1, 2, 3 …) on the left; the right panel draws them as a
// live lineage and, on Run, executes each notebook in the isolated backend
// harness (scrubbed env, no Fabric creds, no real writes) and reports what each
// step reads and writes. A pipeline step runs each of its notebook activities
// in dependency order; its other activity types are shown structurally only.
//
// A notebook opened from Explore arrives via ?ws/?item/?name and seeds step 1.
import { useEffect, useMemo, useState } from 'react'
import { createFileRoute } from '@tanstack/react-router'
import {
  runSandbox,
  fetchFabricCatalog,
  fetchFabricPipelineDefinition,
  type SandboxRunResult,
  type FabricCatalogEntry,
  type FabricPipelineActivity,
} from '../../api'
import { BarsSpinner } from '../../shell/BarsSpinner'
import '../../views/fabric.css'

interface SandboxSearch {
  ws?: string
  item?: string
  name?: string
}

export const Route = createFileRoute('/fabric/sandbox')({
  validateSearch: (s: Record<string, unknown>): SandboxSearch => ({
    ws: typeof s.ws === 'string' ? s.ws : undefined,
    item: typeof s.item === 'string' ? s.item : undefined,
    name: typeof s.name === 'string' ? s.name : undefined,
  }),
  component: SandboxRoute,
})

type StepKind = 'notebook' | 'pipeline'
interface Step {
  key: string
  kind: StepKind
  ws: string
  itemId: string
  name: string
}

type StepStatus = 'pending' | 'running' | 'ok' | 'error' | 'skipped'
// One executed notebook — the step itself for a notebook, or one notebook
// activity for a pipeline.
interface RunEntry {
  name: string
  status: 'ok' | 'error'
  result?: SandboxRunResult
  error?: string
}
interface StepResult {
  status: StepStatus
  runs: RunEntry[]
  /** Full activity list for a pipeline (structure, incl. non-notebook ones). */
  activities?: FabricPipelineActivity[]
  error?: string
}

const stepReads = (r?: StepResult): string[] => [...new Set((r?.runs ?? []).flatMap((x) => x.result?.reads ?? []))]
const stepWrites = (r?: StepResult): string[] => [...new Set((r?.runs ?? []).flatMap((x) => x.result?.writes ?? []))]

let seq = 0
const newKey = () => `step-${++seq}`

// Order a pipeline's activities so every activity follows the ones it depends
// on. Kahn's algorithm, keeping the definition order among ready activities;
// anything left in a dependency cycle (or naming a missing activity) is
// appended in definition order rather than dropped.
function orderActivities(activities: FabricPipelineActivity[]): FabricPipelineActivity[] {
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

const isPipelineEntry = (e: FabricCatalogEntry) =>
  e.kind === 'item' && (e.item_type ?? '').toLowerCase().includes('pipeline')

// --- generic layered flow layout (reads → notebook → writes, plus order) ---
type FlowKind = 'notebook' | 'pipeline' | 'table'
interface FlowNode {
  id: string
  kind: FlowKind
  label: string
  sub?: string
  badge?: string
}
interface FlowEdge {
  from: string
  to: string
  dashed?: boolean
}

const NW = 184
const NH = 58
const GX = 60
const GY = 20
const PAD = 12

function layoutFlow(nodes: FlowNode[], edges: FlowEdge[]) {
  const incoming = new Map<string, string[]>()
  nodes.forEach((n) => incoming.set(n.id, []))
  edges.forEach((e) => {
    if (incoming.has(e.to)) incoming.get(e.to)!.push(e.from)
  })
  const colOf = new Map<string, number>()
  const visiting = new Set<string>()
  function col(id: string): number {
    const c = colOf.get(id)
    if (c !== undefined) return c
    if (visiting.has(id)) return 0
    visiting.add(id)
    const parents = incoming.get(id) ?? []
    const v = parents.length ? 1 + Math.max(...parents.map(col)) : 0
    visiting.delete(id)
    colOf.set(id, v)
    return v
  }
  nodes.forEach((n) => col(n.id))

  const rows = new Map<number, number>()
  const pos = new Map<string, { x: number; y: number }>()
  nodes.forEach((n) => {
    const c = colOf.get(n.id)!
    const r = rows.get(c) ?? 0
    rows.set(c, r + 1)
    pos.set(n.id, { x: c * (NW + GX), y: r * (NH + GY) })
  })
  const maxCol = Math.max(0, ...colOf.values())
  const maxRow = Math.max(1, ...rows.values())
  return {
    pos,
    width: (maxCol + 1) * (NW + GX) - GX,
    height: maxRow * (NH + GY) - GY,
  }
}

function FlowCanvas({ nodes, edges }: { nodes: FlowNode[]; edges: FlowEdge[] }) {
  const { pos, width, height } = useMemo(() => layoutFlow(nodes, edges), [nodes, edges])
  const w = width + PAD * 2
  const h = height + PAD * 2
  return (
    <div className="fx-flow">
      <div className="fx-flow-canvas" style={{ width: w, height: h }}>
        <svg className="fx-flow-edges" width={w} height={h}>
          <defs>
            <marker id="fx-flow-arrow" markerWidth="9" markerHeight="9" refX="7" refY="4" orient="auto">
              <path d="M0 0l8 4-8 4z" fill="currentColor" />
            </marker>
          </defs>
          {edges.map((e, i) => {
            const s = pos.get(e.from)
            const t = pos.get(e.to)
            if (!s || !t) return null
            const sx = s.x + NW + PAD
            const sy = s.y + NH / 2 + PAD
            const tx = t.x + PAD
            const ty = t.y + NH / 2 + PAD
            const mx = (sx + tx) / 2
            return (
              <path
                key={i}
                d={`M${sx} ${sy}C${mx} ${sy} ${mx} ${ty} ${tx} ${ty}`}
                fill="none"
                strokeDasharray={e.dashed ? '4 4' : undefined}
                markerEnd="url(#fx-flow-arrow)"
              />
            )
          })}
        </svg>
        {nodes.map((n) => {
          const p = pos.get(n.id)!
          return (
            <div
              key={n.id}
              className="fx-flow-node"
              data-kind={n.kind}
              style={{ left: p.x + PAD, top: p.y + PAD, width: NW, height: NH }}
              title={n.sub ? `${n.label} · ${n.sub}` : n.label}
            >
              {n.badge && <span className="fx-flow-badge">{n.badge}</span>}
              <span className="fx-flow-node-name">{n.label}</span>
              {n.sub && <span className="fx-flow-node-sub">{n.sub}</span>}
            </div>
          )
        })}
      </div>
    </div>
  )
}

// Build the flow graph from the steps and (optionally) their run results.
function buildFlow(steps: Step[], results: Map<string, StepResult>): { nodes: FlowNode[]; edges: FlowEdge[] } {
  const nodes: FlowNode[] = []
  const edges: FlowEdge[] = []
  const tableSeen = new Set<string>()
  const ensureTable = (name: string) => {
    const id = `t:${name.toLowerCase()}`
    if (!tableSeen.has(id)) {
      tableSeen.add(id)
      nodes.push({ id, kind: 'table', label: name })
    }
    return id
  }

  steps.forEach((step, i) => {
    const stepId = `s:${step.key}`
    const res = results.get(step.key)
    const sub =
      res?.status === 'running'
        ? 'running…'
        : res?.status === 'error'
          ? 'error'
          : step.kind === 'pipeline' && res?.activities
            ? `${res.activities.length} activities · ${res.runs.length} run`
            : undefined
    nodes.push({ id: stepId, kind: step.kind, label: step.name, sub, badge: String(i + 1) })

    for (const r of stepReads(res)) edges.push({ from: ensureTable(r), to: stepId })
    for (const wr of stepWrites(res)) edges.push({ from: stepId, to: ensureTable(wr) })
  })

  // Faint order edges between consecutive steps so the sequence reads clearly
  // even before a run (and where steps share no table).
  for (let i = 1; i < steps.length; i++) {
    edges.push({ from: `s:${steps[i - 1].key}`, to: `s:${steps[i].key}`, dashed: true })
  }
  return { nodes, edges }
}

function StepIcon({ kind }: { kind: StepKind }) {
  return (
    <svg className="fx-icon" data-kind={kind === 'pipeline' ? 'item' : 'notebook'} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinejoin="round">
      {kind === 'pipeline' ? (
        <path d="M4 5h6v5H4zM14 14h6v5h-6zM10 7.5h2.5a1.5 1.5 0 0 1 1.5 1.5v6" />
      ) : (
        <path d="M6 3h9l4 4v14H6z M15 3v4h4M9 12h6M9 16h6" />
      )}
    </svg>
  )
}

function SandboxRoute() {
  const { ws, item, name } = Route.useSearch()
  const [steps, setSteps] = useState<Step[]>(() =>
    ws && item && name ? [{ key: newKey(), kind: 'notebook', ws, itemId: item, name }] : [],
  )
  const [catalog, setCatalog] = useState<FabricCatalogEntry[] | null>(null)
  const [catalogErr, setCatalogErr] = useState<string | null>(null)
  const [pickerOpen, setPickerOpen] = useState(false)
  const [pickerQuery, setPickerQuery] = useState('')
  const [results, setResults] = useState<Map<string, StepResult>>(new Map())
  const [running, setRunning] = useState(false)

  useEffect(() => {
    let alive = true
    fetchFabricCatalog()
      .then((c) => alive && setCatalog(c))
      .catch((e) => alive && setCatalogErr(e instanceof Error ? e.message : String(e)))
    return () => {
      alive = false
    }
  }, [])

  const addable = useMemo(() => {
    if (!catalog) return []
    const q = pickerQuery.trim().toLowerCase()
    return catalog
      .filter((e) => e.kind === 'notebook' || isPipelineEntry(e))
      .filter((e) => !q || e.name.toLowerCase().includes(q) || e.workspace_name.toLowerCase().includes(q))
      .slice(0, 60)
  }, [catalog, pickerQuery])

  const addStep = (e: FabricCatalogEntry) => {
    setSteps((s) => [
      ...s,
      { key: newKey(), kind: isPipelineEntry(e) ? 'pipeline' : 'notebook', ws: e.workspace_id, itemId: e.id, name: e.name },
    ])
    setPickerOpen(false)
    setPickerQuery('')
  }
  const removeStep = (key: string) => setSteps((s) => s.filter((x) => x.key !== key))
  const move = (key: string, dir: -1 | 1) =>
    setSteps((s) => {
      const i = s.findIndex((x) => x.key === key)
      const j = i + dir
      if (i < 0 || j < 0 || j >= s.length) return s
      const copy = s.slice()
      ;[copy[i], copy[j]] = [copy[j], copy[i]]
      return copy
    })

  const runAll = async () => {
    setRunning(true)
    const next = new Map<string, StepResult>()
    steps.forEach((s) => next.set(s.key, { status: 'pending', runs: [] }))
    setResults(new Map(next))

    for (const step of steps) {
      next.set(step.key, { status: 'running', runs: [] })
      setResults(new Map(next))
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
                error: result.ok ? undefined : result.error ?? undefined,
              },
            ],
            error: result.ok ? undefined : result.error ?? undefined,
          })
        } else {
          const activities = await fetchFabricPipelineDefinition(step.ws, step.itemId)
          next.set(step.key, { status: 'running', runs: [], activities })
          setResults(new Map(next))

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
                error: result.ok ? undefined : result.error ?? undefined,
              })
            } catch (e) {
              runs.push({ name: a.name, status: 'error', error: e instanceof Error ? e.message : String(e) })
            }
            next.set(step.key, { status: 'running', runs: runs.slice(), activities })
            setResults(new Map(next))
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
      setResults(new Map(next))
    }
    setRunning(false)
  }

  const flow = useMemo(() => buildFlow(steps, results), [steps, results])
  const ran = results.size > 0

  // Every executed notebook across all steps — a notebook step contributes one,
  // a pipeline step one per notebook activity.
  const notebookRuns = steps
    .flatMap((s) => (results.get(s.key)?.runs ?? []).map((e) => ({ s, name: e.name, r: e.result })))
    .filter((x): x is { s: Step; name: string; r: SandboxRunResult } => !!x.r)

  const anyBreach = notebookRuns.some(({ r }) => r.saw_credentials)

  return (
    <div className="fx-page">
      <div className="fx-explorer sbx-shell">
        {/* Left: the step builder */}
        <div className="fx-explorer-tree">
          <div className="fx-panel-head">Sequence</div>
          <div className="sbx-steps">
            {steps.length === 0 && (
              <p className="fx-empty">Add notebooks and pipelines to build a run sequence. They execute top-to-bottom.</p>
            )}
            {steps.map((step, i) => {
              const st = results.get(step.key)?.status
              return (
                <div className="sbx-step" key={step.key} data-status={st}>
                  <span className="sbx-step-num">{i + 1}</span>
                  <StepIcon kind={step.kind} />
                  <span className="sbx-step-name" title={step.name}>{step.name}</span>
                  {st === 'running' && <BarsSpinner size={14} />}
                  {st === 'ok' && <span className="sbx-step-dot" data-ok />}
                  {st === 'error' && <span className="sbx-step-dot" data-err />}
                  <div className="sbx-step-ctrls">
                    <button onClick={() => move(step.key, -1)} disabled={i === 0} aria-label="Move up">↑</button>
                    <button onClick={() => move(step.key, 1)} disabled={i === steps.length - 1} aria-label="Move down">↓</button>
                    <button onClick={() => removeStep(step.key)} aria-label="Remove">×</button>
                  </div>
                </div>
              )
            })}

            {pickerOpen ? (
              <div className="sbx-picker">
                <input
                  className="sbx-picker-input"
                  autoFocus
                  placeholder="Search notebooks & pipelines…"
                  value={pickerQuery}
                  onChange={(e) => setPickerQuery(e.target.value)}
                />
                <div className="sbx-picker-list">
                  {catalogErr && <div className="fx-note" data-error="true">{catalogErr}</div>}
                  {!catalog && !catalogErr && <div className="fx-note"><BarsSpinner size={14} /> Loading…</div>}
                  {addable.map((e) => (
                    <button className="sbx-picker-row" key={`${e.kind}:${e.workspace_id}:${e.id}`} onClick={() => addStep(e)}>
                      <StepIcon kind={isPipelineEntry(e) ? 'pipeline' : 'notebook'} />
                      <span className="sbx-picker-name">{e.name}</span>
                      <span className="sbx-picker-ws">{e.workspace_name}</span>
                    </button>
                  ))}
                  {catalog && addable.length === 0 && <div className="fx-note">No matches.</div>}
                </div>
                <button className="fx-btn sbx-picker-close" onClick={() => setPickerOpen(false)}>Done</button>
              </div>
            ) : (
              <button className="fx-btn sbx-add" onClick={() => setPickerOpen(true)}>+ Add step</button>
            )}
          </div>

          <div className="sbx-run-bar">
            <button className="fx-btn fx-btn--primary" onClick={runAll} disabled={steps.length === 0 || running}>
              {running ? 'Running…' : `Run sequence${steps.length ? ` (${steps.length})` : ''}`}
            </button>
          </div>
        </div>

        {/* Right: the lineage + report */}
        <div className="fx-explorer-detail sbx-canvas-wrap">
          {steps.length === 0 ? (
            <div className="fx-detail-empty">
              <StepIcon kind="notebook" />
              <p>Your sequence lineage will appear here as you add notebooks and pipelines.</p>
            </div>
          ) : (
            <div className="sbx-canvas-body">
              <FlowCanvas nodes={flow.nodes} edges={flow.edges} />

              {ran && (
                <div className="sbx-report">
                  {notebookRuns.length > 0 && (
                    <div className="sbx-safety" data-breach={anyBreach}>
                      {anyBreach
                        ? '⚠ Isolation breach: credentials were visible to the sandbox.'
                        : `✓ Ran isolated — no Fabric credentials reachable · engine: ${notebookRuns[0].r.engine}`}
                    </div>
                  )}

                  {steps.map((step, i) => {
                    const r = results.get(step.key)
                    if (!r) return null
                    return (
                      <div className="sbx-step-report" key={step.key} data-status={r.status}>
                        <div className="sbx-step-report-head">
                          <span className="sbx-step-num">{i + 1}</span>
                          <StepIcon kind={step.kind} />
                          <strong>{step.name}</strong>
                          <span className="sbx-step-report-status">{r.status}</span>
                        </div>
                        {r.error && <div className="fx-note" data-error="true">{r.error}</div>}
                        {step.kind === 'pipeline' && r.activities && (
                          <div className="fx-note">
                            {r.activities.length} activities — {r.runs.length} notebook
                            {r.runs.length === 1 ? '' : 's'} executed in dependency order; other activity types are
                            shown structurally.
                          </div>
                        )}
                        {r.runs.map((run) => (
                          <div className="sbx-run" key={run.name}>
                            {step.kind === 'pipeline' && <div className="sbx-run-name">{run.name}</div>}
                            {run.error && <div className="fx-note" data-error="true">{run.error}</div>}
                            {run.result && (
                              <div className="sbx-io">
                                <div>
                                  <span className="sbx-io-label">Reads</span>
                                  {run.result.reads.length ? run.result.reads.map((x) => <code key={x} className="sbx-chip">{x}</code>) : <span className="fx-note">none</span>}
                                </div>
                                <div>
                                  <span className="sbx-io-label">Writes</span>
                                  {run.result.writes.length ? run.result.writes.map((x) => <code key={x} className="sbx-chip sbx-write">{x}</code>) : <span className="fx-note">none</span>}
                                </div>
                              </div>
                            )}
                          </div>
                        ))}
                      </div>
                    )
                  })}

                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
