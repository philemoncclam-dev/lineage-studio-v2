// The sandbox sequence drawn as lineage, plus the run report. Lives in the
// Explore detail column's "Sandbox" tab — there is no separate sandbox page.
//
// A node is an *object card*: a header naming it and a stack of attribute rows
// (its reads and writes). Edges anchor to the row they belong to, not to the
// card, so a table's line lands on the exact row that reads or writes it —
// same reading as `modeling/ModelViewer`.
import { useMemo, useState } from 'react'
import { useNavigate } from '@tanstack/react-router'
import type { SandboxColumn, SandboxRunResult } from '../api'
import { StepIcon } from './SequencePanel'
import { stepReads, stepWrites, type Step, type StepResult } from './sequence'
import { sequenceToModel, defaultModelName } from './toModel'
import { localStore } from '../model/store'

type FlowKind = 'notebook' | 'pipeline' | 'table'
/** `read`/`write` are a notebook's I/O rows; `col` is a table's own column. */
type RowTone = 'read' | 'write' | 'col'
/** The tone an edge can carry — a column row is never an edge endpoint. */
type EdgeTone = 'read' | 'write'
interface FlowRow {
  key: string
  label: string
  tone: RowTone
  /** Column type, shown to the right of the name on a table card. */
  meta?: string
}
interface FlowNode {
  id: string
  kind: FlowKind
  label: string
  sub?: string
  badge?: string
  rows: FlowRow[]
  /**
   * A table's full column list. `rows` is the truncated view the card shows
   * until it is expanded — a 60-column table would otherwise be a mile of card
   * and push every other node off the canvas.
   */
  allRows?: FlowRow[]
}

/** How many columns a table card shows before it needs expanding. */
const MAX_TABLE_ROWS = 8
/** `row` is a row key on that node; omitted means "anchor to the header". */
interface FlowEdge {
  from: string
  fromRow?: string
  to: string
  toRow?: string
  tone?: EdgeTone
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

  // Stack each column top-down; cards have different heights.
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

function FlowCanvas({ nodes: rawNodes, edges }: { nodes: FlowNode[]; edges: FlowEdge[] }) {
  // Which table cards are showing their whole schema. Truncation happens here
  // rather than in buildFlow so expanding is a pure re-layout — the graph
  // itself never changes.
  const [expanded, setExpanded] = useState<Set<string>>(new Set())
  const toggle = (id: string) =>
    setExpanded((s) => {
      const next = new Set(s)
      if (!next.delete(id)) next.add(id)
      return next
    })

  const nodes = useMemo(
    () =>
      rawNodes.map((n) => {
        if (!n.allRows || n.allRows.length <= MAX_TABLE_ROWS) return n
        const open = expanded.has(n.id)
        const shown = open ? n.allRows : n.allRows.slice(0, MAX_TABLE_ROWS)
        const rest = n.allRows.length - shown.length
        return {
          ...n,
          rows: [
            ...shown,
            { key: '__more', label: open ? 'Show less' : `+${rest} more`, tone: 'col' as const },
          ],
        }
      }),
    [rawNodes, expanded],
  )

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
                {n.rows.map((r) =>
                  r.key === '__more' ? (
                    <button
                      key={r.key}
                      className="sbx-flow-row sbx-flow-more"
                      style={{ height: ROW_H }}
                      onClick={() => toggle(n.id)}
                    >
                      {r.label}
                    </button>
                  ) : (
                    <div key={r.key} className="sbx-flow-row" data-tone={r.tone} style={{ height: ROW_H }}>
                      <span className="sbx-flow-row-name" title={r.meta ? `${r.label} · ${r.meta}` : r.label}>
                        {r.label}
                      </span>
                      {r.tone === 'col' ? (
                        r.meta && <span className="sbx-flow-type">{r.meta}</span>
                      ) : (
                        <span className="sbx-flow-tag" data-tone={r.tone}>
                          {r.tone === 'read' ? 'R' : 'W'}
                        </span>
                      )}
                    </div>
                  ),
                )}
              </div>
            )
          })}
        </div>
      </div>
    </div>
  )
}

/**
 * Every table schema the run resolved, keyed by table name. A table touched by
 * several steps is described by whichever run resolved columns for it; they
 * are the same table, so the first non-empty answer wins.
 */
function collectSchemas(results: Map<string, StepResult>): Map<string, SandboxColumn[]> {
  const out = new Map<string, SandboxColumn[]>()
  for (const res of results.values())
    for (const run of res.runs)
      for (const [table, cols] of Object.entries(run.result?.table_schemas ?? {}))
        if (cols.length && !out.get(table)?.length) out.set(table, cols)
  return out
}

// Build the flow graph from the steps and (optionally) their run results.
export function buildFlow(steps: Step[], results: Map<string, StepResult>): { nodes: FlowNode[]; edges: FlowEdge[] } {
  const nodes: FlowNode[] = []
  const edges: FlowEdge[] = []
  const schemas = collectSchemas(results)
  const tableSeen = new Set<string>()
  const ensureTable = (name: string) => {
    const id = `t:${name.toLowerCase()}`
    if (!tableSeen.has(id)) {
      tableSeen.add(id)
      // A table card carries its schema as attribute rows — the same reading as
      // an object card in Modeling, and the reason the canvas is worth looking
      // at rather than just the report.
      const allRows: FlowRow[] = (schemas.get(name) ?? []).map((c) => ({
        key: `c:${c.name}`,
        label: c.name,
        tone: 'col' as const,
        meta: c.type ?? undefined,
      }))
      nodes.push({
        id,
        kind: 'table',
        label: name,
        sub: allRows.length ? `${allRows.length} cols` : undefined,
        rows: allRows,
        allRows,
      })
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
 * One touched table: its name, and — when the run resolved a schema for it —
 * its columns behind a disclosure. Collapsed by default because a run touches
 * many tables and an expanded stack of schemas would bury the lineage; the
 * column count on the row is enough to decide whether to open it.
 */
function TableRow({ name, columns }: { name: string; columns?: SandboxColumn[] }) {
  const [open, setOpen] = useState(false)
  const has = !!columns?.length
  return (
    <li className="sbx-io-item" data-open={open || undefined}>
      <button
        className="sbx-io-row"
        onClick={() => has && setOpen((o) => !o)}
        disabled={!has}
        title={has ? `${name} — ${columns!.length} columns` : `${name} — no schema resolved`}
        aria-expanded={has ? open : undefined}
      >
        {has && (
          <svg className="sbx-io-chev" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden>
            <path d="m9 6 6 6-6 6" />
          </svg>
        )}
        <span className="sbx-io-name">{name}</span>
        {has && <span className="sbx-io-n">{columns!.length}</span>}
      </button>
      {open && has && (
        <table className="fx-cols sbx-io-schema">
          <tbody>
            {columns!.map((c) => (
              <tr key={c.name}>
                <td>{c.name}</td>
                <td className="fx-cols-type">{c.type ?? '—'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </li>
  )
}

/**
 * One side of a run's I/O. A vertical list of table names under a counted
 * heading, rather than a wrapping row of fat pills: table names are long and
 * similar, and a column lets the eye scan them.
 */
function IoColumn({
  tone,
  tables,
  schemas,
}: {
  tone: RowTone
  tables: string[]
  schemas: Record<string, SandboxColumn[]>
}) {
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
            <TableRow key={t} name={t} columns={schemas[t]} />
          ))}
        </ul>
      )}
    </div>
  )
}

/**
 * Hands the observed lineage over to Modeling as a new, editable model, then
 * opens it. A one-way snapshot — see the note in `toModel.ts`. Needs a run:
 * before one there are no tables and no columns, so the model would be a row of
 * disconnected notebook cards.
 */
function ToModelBar({
  steps,
  results,
  ran,
}: {
  steps: Step[]
  results: Map<string, StepResult>
  ran: boolean
}) {
  const navigate = useNavigate()
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const create = async () => {
    setBusy(true)
    setError(null)
    try {
      const { model } = sequenceToModel(steps, results, defaultModelName(steps))
      await localStore.save(model)
      await navigate({ to: '/model/$modelId', params: { modelId: model.id } })
    } catch (e) {
      setBusy(false)
      setError(e instanceof Error ? e.message : String(e))
    }
  }

  return (
    <div className="sbx-bar">
      <span className="sbx-bar-title">Sequence lineage</span>
      {error && (
        <span className="fx-note" data-error="true">
          {error}
        </span>
      )}
      <button
        className="fx-btn"
        onClick={create}
        disabled={!ran || busy}
        title={ran ? 'Create an editable model from this run' : 'Run the sequence first'}
      >
        {busy ? 'Creating…' : 'Create model'}
      </button>
    </div>
  )
}

export function SequenceCanvas({ steps, results }: { steps: Step[]; results: Map<string, StepResult> }) {
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

  if (steps.length === 0)
    return (
      <div className="fx-detail-empty">
        <StepIcon kind="notebook" />
        <p>
          Add notebooks and pipelines to the sequence on the right; their lineage is drawn here, and
          Run executes them in the isolated harness.
        </p>
      </div>
    )

  return (
    <div className="sbx-canvas-body">
      <ToModelBar steps={steps} results={results} ran={ran} />
      <FlowCanvas nodes={flow.nodes} edges={flow.edges} />

      {ran && (
        <section className="sbx-report" aria-label="Run report">
          {/* A summary line, not a full-bleed tinted banner. The isolation
              verdict is the one thing that must be unmissable, so it is the
              only coloured element here; the run's shape (engine, notebooks,
              I/O totals) sits beside it as plain metadata. */}
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
              Fabric credentials were reachable from inside the sandbox. Treat these results as
              untrusted and check the harness before running again.
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
                    <span className="sbx-step-report-name" title={step.name}>
                      {step.name}
                    </span>
                    <span className="sbx-status-pill" data-status={r.status}>
                      {r.status}
                    </span>
                  </div>
                  {r.error && (
                    <div className="fx-note" data-error="true">
                      {r.error}
                    </div>
                  )}
                  {step.kind === 'pipeline' && r.activities && (
                    <p className="sbx-step-report-note">
                      {r.activities.length} activities — {r.runs.length} notebook
                      {r.runs.length === 1 ? '' : 's'} executed in dependency order; other activity
                      types are shown structurally.
                    </p>
                  )}
                  {r.runs.map((run) => (
                    <div className="sbx-run" key={run.name}>
                      {step.kind === 'pipeline' && <div className="sbx-run-name">{run.name}</div>}
                      {run.error && (
                        <div className="fx-note" data-error="true">
                          {run.error}
                        </div>
                      )}
                      {run.result && (
                        <div className="sbx-io">
                          <IoColumn
                            tone="read"
                            tables={run.result.reads}
                            schemas={run.result.table_schemas ?? {}}
                          />
                          <IoColumn
                            tone="write"
                            tables={run.result.writes}
                            schemas={run.result.table_schemas ?? {}}
                          />
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
  )
}
