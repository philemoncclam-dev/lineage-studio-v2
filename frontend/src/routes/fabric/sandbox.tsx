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

// --- layered flow layout, drawn in the Modeling canvas idiom ---
// A node is an *object card*: a header naming it and a stack of attribute rows
// (its reads and writes). Edges anchor to the row they belong to, not to the
// card, so a table's line lands on the exact row that reads or writes it —
// same reading as `modeling/ModelViewer`.
type FlowKind = 'notebook' | 'pipeline' | 'table'
type RowTone = 'read' | 'write'
interface FlowRow {
  key: string
  label: string
  tone: RowTone
}
interface FlowNode {
  id: string
  kind: FlowKind
  label: string
  sub?: string
  badge?: string
  rows: FlowRow[]
}
/** `row` is a row key on that node; omitted means "anchor to the header". */
interface FlowEdge {
  from: string
  fromRow?: string
  to: string
  toRow?: string
  tone?: RowTone
  dashed?: boolean
}

const NW = 208
const HEAD_H = 26
const ROW_H = 20
const GX = 76
const GY = 26
const PAD = 18
const BAND_H = 26

const nodeHeight = (n: FlowNode) => HEAD_H + n.rows.length * ROW_H
/** Vertical centre of a row (or of the header when `rowKey` is undefined). */
function anchorY(n: FlowNode, rowKey?: string) {
  const i = rowKey ? n.rows.findIndex((r) => r.key === rowKey) : -1
  return i < 0 ? HEAD_H / 2 : HEAD_H + i * ROW_H + ROW_H / 2
}

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

  // Stack each column top-down; cards have different heights now.
  const nextY = new Map<number, number>()
  const pos = new Map<string, { x: number; y: number }>()
  nodes.forEach((n) => {
    const c = colOf.get(n.id)!
    const y = nextY.get(c) ?? 0
    nextY.set(c, y + nodeHeight(n) + GY)
    pos.set(n.id, { x: c * (NW + GX), y })
  })

  const maxCol = Math.max(0, ...colOf.values())
  const height = Math.max(1, ...[...nextY.values()].map((y) => y - GY))

  // One band segment per column, named for what the column holds — the
  // Modeling layer band. Segments meet mid-gutter so a column reads as running
  // divider-to-divider (see the handoff note on contiguous segments).
  const bands = Array.from({ length: maxCol + 1 }, (_, c) => {
    const inCol = nodes.filter((n) => colOf.get(n.id) === c)
    const tables = inCol.filter((n) => n.kind === 'table').length
    const label = !inCol.length
      ? ''
      : tables === inCol.length
        ? c === 0
          ? 'Source tables'
          : 'Tables'
        : 'Notebooks & pipelines'
    const left = c * (NW + GX) - (c === 0 ? 0 : GX / 2)
    const right = c * (NW + GX) + NW + (c === maxCol ? 0 : GX / 2)
    return { key: c, label, left, width: right - left, centerX: c * (NW + GX) + NW / 2 }
  })

  return { pos, bands, width: (maxCol + 1) * (NW + GX) - GX, height }
}

function FlowCanvas({ nodes, edges }: { nodes: FlowNode[]; edges: FlowEdge[] }) {
  const { pos, bands, width, height } = useMemo(() => layoutFlow(nodes, edges), [nodes, edges])
  const byId = useMemo(() => new Map(nodes.map((n) => [n.id, n])), [nodes])
  const w = width + PAD * 2
  const h = height + PAD * 2
  return (
    <div className="sbx-flow">
      <div className="sbx-flow-world" style={{ width: w }}>
        <div className="sbx-flow-band" style={{ height: BAND_H }}>
          {bands.map((b) => (
            <div key={b.key} className="sbx-flow-layer" style={{ left: b.left + PAD, width: b.width, height: BAND_H }}>
              <span className="sbx-flow-layer-center" style={{ left: b.centerX - b.left }}>
                <span className="sbx-flow-layer-name">{b.label}</span>
              </span>
            </div>
          ))}
        </div>

        <div className="sbx-flow-canvas" style={{ width: w, height: h }}>
          <svg className="sbx-flow-edges" width={w} height={h}>
            <defs>
              <marker id="sbx-arrow" markerWidth="8" markerHeight="8" refX="6.5" refY="3.5" orient="auto">
                <path d="M0 0l7 3.5-7 3.5z" fill="currentColor" />
              </marker>
            </defs>
            {edges.map((e, i) => {
              const sn = byId.get(e.from)
              const tn = byId.get(e.to)
              const s = pos.get(e.from)
              const t = pos.get(e.to)
              if (!sn || !tn || !s || !t) return null
              const sx = s.x + NW + PAD
              const sy = s.y + anchorY(sn, e.fromRow) + PAD
              const tx = t.x + PAD
              const ty = t.y + anchorY(tn, e.toRow) + PAD
              const mx = (sx + tx) / 2
              return (
                <path
                  key={i}
                  className="sbx-flow-edge"
                  data-tone={e.tone}
                  data-dashed={e.dashed || undefined}
                  d={`M${sx} ${sy}C${mx} ${sy} ${mx} ${ty} ${tx} ${ty}`}
                  fill="none"
                  strokeDasharray={e.dashed ? '4 4' : undefined}
                  markerEnd="url(#sbx-arrow)"
                />
              )
            })}
          </svg>
          {nodes.map((n) => {
            const p = pos.get(n.id)!
            return (
              <div
                key={n.id}
                className="sbx-flow-card"
                data-kind={n.kind}
                style={{ left: p.x + PAD, top: p.y + PAD, width: NW }}
              >
                <div className="sbx-flow-card-head" title={n.sub ? `${n.label} · ${n.sub}` : n.label}>
                  {n.badge && <span className="sbx-flow-num">{n.badge}</span>}
                  <span className="sbx-flow-card-name">{n.label}</span>
                  {n.sub && <span className="sbx-flow-card-sub">{n.sub}</span>}
                  {!n.sub && n.rows.length > 0 && <span className="sbx-flow-count">{n.rows.length}</span>}
                </div>
                {n.rows.map((r) => (
                  <div key={r.key} className="sbx-flow-row" data-tone={r.tone} style={{ height: ROW_H }}>
                    <span className="sbx-flow-row-name" title={r.label}>
                      {r.label}
                    </span>
                    <span className="sbx-flow-tag" data-tone={r.tone}>
                      {r.tone === 'read' ? 'R' : 'W'}
                    </span>
                  </div>
                ))}
              </div>
            )
          })}
        </div>
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
      nodes.push({ id, kind: 'table', label: name, rows: [] })
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
            ? `${res.activities.length} act · ${res.runs.length} run`
            : undefined
    const reads = stepReads(res)
    const writes = stepWrites(res)
    const rows: FlowRow[] = [
      ...reads.map((r) => ({ key: `r:${r}`, label: r, tone: 'read' as const })),
      ...writes.map((r) => ({ key: `w:${r}`, label: r, tone: 'write' as const })),
    ]
    nodes.push({ id: stepId, kind: step.kind, label: step.name, sub, badge: String(i + 1), rows })

    for (const r of reads) edges.push({ from: ensureTable(r), to: stepId, toRow: `r:${r}`, tone: 'read' })
    for (const wr of writes) edges.push({ from: stepId, fromRow: `w:${wr}`, to: ensureTable(wr), tone: 'write' })
  })

  // Faint order edges between consecutive steps so the sequence reads clearly
  // even before a run (and where steps share no table).
  for (let i = 1; i < steps.length; i++) {
    edges.push({ from: `s:${steps[i - 1].key}`, to: `s:${steps[i].key}`, dashed: true })
  }
  return { nodes, edges }
}

/**
 * One side of a run's I/O. A vertical list of table names under a counted
 * heading, rather than a wrapping row of fat pills: table names are long and
 * similar, and a column lets the eye scan them.
 */
function IoColumn({ tone, tables }: { tone: RowTone; tables: string[] }) {
  return (
    <div className="sbx-io-col" data-tone={tone}>
      <div className="sbx-io-label">
        {tone === 'read' ? 'Reads' : 'Writes'}
        <span className="sbx-io-n">{tables.length}</span>
      </div>
      {tables.length === 0 ? (
        <p className="sbx-io-none">none</p>
      ) : (
        <ul className="sbx-io-list">
          {tables.map((t) => (
            <li key={t} title={t}>
              {t}
            </li>
          ))}
        </ul>
      )}
    </div>
  )
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
  // Distinct tables across the whole run — the same table read by three steps
  // is one table, which is what the summary line should say.
  const totalReads = new Set(notebookRuns.flatMap(({ r }) => r.reads)).size
  const totalWrites = new Set(notebookRuns.flatMap(({ r }) => r.writes)).size

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
                <section className="sbx-report" aria-label="Run report">
                  {/* A summary line, not a full-bleed tinted banner. The
                      isolation verdict is the one thing that must be
                      unmissable, so it is the only coloured element here; the
                      run's shape (engine, notebooks, I/O totals) sits beside it
                      as plain metadata. */}
                  <header className="sbx-report-head">
                    <h3 className="sbx-report-title">Run report</h3>
                    {notebookRuns.length > 0 && (
                      <>
                        <span className="sbx-verdict" data-breach={anyBreach || undefined}>
                          {anyBreach ? 'Isolation breach' : 'Isolated'}
                        </span>
                        <dl className="sbx-report-meta">
                          <div>
                            <dt>Engine</dt>
                            <dd>{notebookRuns[0].r.engine}</dd>
                          </div>
                          <div>
                            <dt>Notebooks</dt>
                            <dd>{notebookRuns.length}</dd>
                          </div>
                          <div>
                            <dt>Reads</dt>
                            <dd>{totalReads}</dd>
                          </div>
                          <div>
                            <dt>Writes</dt>
                            <dd>{totalWrites}</dd>
                          </div>
                        </dl>
                      </>
                    )}
                  </header>

                  {anyBreach && (
                    <p className="sbx-breach" role="alert">
                      Fabric credentials were reachable from inside the sandbox. Treat these results
                      as untrusted and check the harness before running again.
                    </p>
                  )}

                  <div className="sbx-report-list">
                    {steps.map((step, i) => {
                      const r = results.get(step.key)
                      if (!r) return null
                      return (
                        <article className="sbx-step-report" key={step.key} data-status={r.status}>
                          <div className="sbx-step-report-head">
                            <span className="sbx-step-num">{i + 1}</span>
                            <StepIcon kind={step.kind} />
                            <span className="sbx-step-report-name" title={step.name}>{step.name}</span>
                            <span className="sbx-status-pill" data-status={r.status}>{r.status}</span>
                          </div>
                          {r.error && <div className="fx-note" data-error="true">{r.error}</div>}
                          {step.kind === 'pipeline' && r.activities && (
                            <p className="sbx-step-report-note">
                              {r.activities.length} activities — {r.runs.length} notebook
                              {r.runs.length === 1 ? '' : 's'} executed in dependency order; other
                              activity types are shown structurally.
                            </p>
                          )}
                          {r.runs.map((run) => (
                            <div className="sbx-run" key={run.name}>
                              {step.kind === 'pipeline' && <div className="sbx-run-name">{run.name}</div>}
                              {run.error && <div className="fx-note" data-error="true">{run.error}</div>}
                              {run.result && (
                                <div className="sbx-io">
                                  <IoColumn tone="read" tables={run.result.reads} />
                                  <IoColumn tone="write" tables={run.result.writes} />
                                </div>
                              )}
                            </div>
                          ))}
                        </article>
                      )
                    })}
                  </div>
                </section>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
