// The sandbox sequence drawn as lineage, plus the run report. Lives in the
// Explore detail column's "Sandbox" tab — there is no separate sandbox page.
//
// A node is an *object card*: a header naming it and a stack of attribute rows
// (its reads and writes). Edges anchor to the row they belong to, not to the
// card, so a table's line lands on the exact row that reads or writes it —
// same reading as `modeling/ModelViewer`.
import { useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate } from '@tanstack/react-router'
import { refKind, refLabel, refWorkspace, type SandboxColumn, type SandboxRunResult, type SandboxTableRef } from '../api'
import { StepIcon } from './SequencePanel'
import { stepReads, stepTables, stepWrites, type Step, type StepResult } from './sequence'
import {
  sequenceToModel,
  defaultModelName,
  DEFAULT_PORT_OPTIONS,
  type PortOptions,
} from './toModel'
import { localStore } from '../model/store'

type FlowKind = 'notebook' | 'pipeline' | 'table'
/**
 * `read`/`write` are a step's I/O rows; `col` is a table's own column; `run` is
 * one activity INSIDE a pipeline, heading the tables that activity touched.
 */
type RowTone = 'read' | 'write' | 'col' | 'run'
/** The tone an edge can carry — a column row is never an edge endpoint. */
type EdgeTone = 'read' | 'write'
interface FlowRow {
  key: string
  label: string
  tone: RowTone
  /** Column type, shown to the right of the name on a table card. */
  meta?: string
  /**
   * Indent level. Only a pipeline card nests: its rows are its notebooks, and
   * under each one the tables THAT notebook read and wrote.
   *
   * A flat merge of every table the pipeline touched — which is what this was —
   * answers "what did this pipeline touch" but loses "which step touched it",
   * and that is the question a pipeline card exists to answer. A table read by
   * two of its notebooks now appears under both, because it genuinely is two
   * accesses.
   */
  depth?: number
}
interface FlowNode {
  id: string
  kind: FlowKind
  label: string
  sub?: string
  badge?: string
  rows: FlowRow[]
  /**
   * A table's workspace — the grouping key for the tables column, and shown on
   * the card. Empty means the run could not resolve one, which is deliberately
   * distinct from "the notebook's own" and renders as `unknown`.
   */
  ws?: string
  /**
   * A raw-file source rather than a Delta table.
   *
   * Deliberately NOT a new `FlowKind`: `kind === 'table'` is what puts a node in
   * the tables column, in six places across this file and toModel, and a landing
   * folder belongs in that column — it is a data source like any other. Only its
   * appearance differs, so only its appearance is carried here.
   */
  isFile?: boolean
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
/** Bezier reach of a backward (write-back) edge. */
const LOOP = 46

const nodeHeight = (n: FlowNode) => HEAD_H + n.rows.length * ROW_H
/** Vertical centre of a row (or of the header when `rowKey` is undefined). */
function anchorY(n: FlowNode, rowKey?: string) {
  const i = rowKey ? n.rows.findIndex((r) => r.key === rowKey) : -1
  return i < 0 ? HEAD_H / 2 : HEAD_H + i * ROW_H + ROW_H / 2
}

/**
 * How the canvas arranges the same graph.
 *
 * `flow` — one column per dependency depth. Reads left-to-right end to end, but
 * a long sequence walks off to the right and the same table can appear far from
 * the step that wrote it.
 *
 * `sequence` — two columns: every notebook and pipeline on the LEFT in the
 * order the user stacked them (step 1 on top), every table on the right.
 * Process-centric: what the run DID, in order, against one canonical column of
 * tables, so a table written and then re-read is one card rather than two.
 *
 * Every edge runs step -> table, leaving the step's own read or write row and
 * landing on the table. A read is data moving the other way in reality, but
 * orienting it that way would loop it back under the whole tables column; the
 * direction of travel is carried by the row it leaves and the edge's colour.
 * The flow view keeps true edge direction.
 */
export type CanvasView = 'flow' | 'sequence'

interface Layout {
  pos: Map<string, { x: number; y: number }>
  bands: { key: number; label: string; left: number; width: number; centerX: number }[]
  /**
   * Workspace headers above the tables column (sequence view only). A group's
   * name is drawn once rather than badged on every card: the column is already
   * ordered by workspace, so one header per run of cards says it without
   * repeating the same word down the canvas.
   */
  groups: { key: string; label: string; x: number; y: number }[]
  width: number
  height: number
}

/** Stack a column of nodes top-down, returning the column's total height. */
function stackColumn(column: FlowNode[], x: number, pos: Layout['pos']): number {
  let y = 0
  for (const n of column) {
    pos.set(n.id, { x, y })
    y += nodeHeight(n) + GY
  }
  return Math.max(0, y - GY)
}

function band(key: number, label: string, col: number, lastCol: number) {
  const left = col * (NW + GX) - (col === 0 ? 0 : GX / 2)
  const right = col * (NW + GX) + NW + (col === lastCol ? 0 : GX / 2)
  return { key, label, left, width: right - left, centerX: col * (NW + GX) + NW / 2 }
}

/** Extra vertical space between two workspace groups in the tables column. */
const GROUP_GAP = 22
/** Height reserved for a workspace header above its group of table cards. */
const GROUP_H = 18

/**
 * Order the tables column by workspace, keeping first-touched order within each
 * group, and return the group each table starts (so the card can be labelled).
 *
 * Grouping rather than one flat column because a notebook that writes into
 * another workspace is the thing that is hard to see otherwise: interleaved,
 * two `customers` cards from two workspaces read as a duplicate rather than as
 * a cross-workspace write. Unresolved workspaces sort last — they are the least
 * trustworthy rows and should not head the column.
 */
function groupByWorkspace(tables: FlowNode[]): { table: FlowNode; startsGroup: boolean }[] {
  const order: string[] = []
  for (const t of tables) {
    const ws = t.ws ?? ''
    if (!order.includes(ws)) order.push(ws)
  }
  order.sort((a, b) => (a === '' ? 1 : b === '' ? -1 : 0))
  const out: { table: FlowNode; startsGroup: boolean }[] = []
  for (const ws of order) {
    tables
      .filter((t) => (t.ws ?? '') === ws)
      .forEach((table, i) => out.push({ table, startsGroup: i === 0 }))
  }
  return out
}

/**
 * Two columns, tables then steps. Node order is preserved from `buildFlow`,
 * which pushes steps in sequence order — so "first step on top" needs no
 * sorting. The tables column is regrouped by workspace.
 */
function layoutSequence(nodes: FlowNode[]): Layout {
  const steps = nodes.filter((n) => n.kind !== 'table')
  const tables = nodes.filter((n) => n.kind === 'table')
  const pos: Layout['pos'] = new Map()
  const stepH = stackColumn(steps, 0, pos)

  const grouped = groupByWorkspace(tables)
  const groups: Layout['groups'] = []
  let y = 0
  grouped.forEach(({ table, startsGroup }, i) => {
    if (startsGroup) {
      if (i > 0) y += GROUP_GAP
      groups.push({
        key: table.ws || '__unknown',
        label: table.ws || 'workspace unresolved',
        x: NW + GX,
        y,
      })
      y += GROUP_H
    }
    pos.set(table.id, { x: NW + GX, y })
    y += nodeHeight(table) + GY
  })
  const tableH = Math.max(0, y - GY)

  const spaces = new Set(tables.map((t) => t.ws ?? '').filter(Boolean))
  return {
    pos,
    bands: [
      band(0, 'Notebooks & pipelines', 0, 1),
      band(1, spaces.size > 1 ? `Tables · ${spaces.size} workspaces` : 'Tables', 1, 1),
    ],
    groups,
    width: 2 * (NW + GX) - GX,
    height: Math.max(1, stepH, tableH),
  }
}

/**
 * The sequence view's edges: order edges dropped (the column order already
 * says it), and reads flipped to leave the step's read row so every line runs
 * left-to-right into the tables column. See the CanvasView note.
 */
function sequenceEdges(edges: FlowEdge[], stepIds: ReadonlySet<string>): FlowEdge[] {
  const out: FlowEdge[] = []
  for (const e of edges) {
    if (e.dashed) continue
    if (e.tone === 'read' && stepIds.has(e.to))
      out.push({ from: e.to, fromRow: e.toRow, to: e.from, tone: 'read' })
    else out.push(e)
  }
  return out
}

function layoutFlow(nodes: FlowNode[], edges: FlowEdge[]): Layout {
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
    return band(c, label, c, maxCol)
  })

  return { pos, bands, groups: [], width: (maxCol + 1) * (NW + GX) - GX, height }
}

function FlowCanvas({
  nodes: rawNodes,
  edges,
  view,
}: {
  nodes: FlowNode[]
  edges: FlowEdge[]
  view: CanvasView
}) {
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

  const shown = useMemo(() => {
    if (view !== 'sequence') return edges
    const stepIds = new Set(rawNodes.filter((n) => n.kind !== 'table').map((n) => n.id))
    return sequenceEdges(edges, stepIds)
  }, [edges, rawNodes, view])
  const { pos, bands, groups, width, height } = useMemo(
    () => (view === 'sequence' ? layoutSequence(nodes) : layoutFlow(nodes, edges)),
    [nodes, edges, view],
  )
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
          {groups.map((g) => (
            <div
              key={g.key}
              className="sbx-flow-ws"
              data-unknown={g.key === '__unknown' || undefined}
              style={{ left: g.x + PAD, top: g.y + PAD, width: NW, height: GROUP_H }}
              title={g.key === '__unknown' ? 'the run could not resolve a workspace' : g.label}
            >
              {g.label}
            </div>
          ))}
          <svg className="sbx-flow-edges" width={w} height={h}>
            <defs>
              <marker id="sbx-arrow" markerWidth="8" markerHeight="8" refX="6.5" refY="3.5" orient="auto">
                <path d="M0 0l7 3.5-7 3.5z" fill="currentColor" />
              </marker>
            </defs>
            {shown.map((e, i) => {
              const sn = byId.get(e.from)
              const tn = byId.get(e.to)
              const s = pos.get(e.from)
              const t = pos.get(e.to)
              if (!sn || !tn || !s || !t) return null
              const sy = s.y + anchorY(sn, e.fromRow) + PAD
              const ty = t.y + anchorY(tn, e.toRow) + PAD
              // A backward edge — in the sequence view, a step writing to a
              // table in the column on its LEFT. It leaves the step's left edge
              // and lands on the table's right edge, so the return trip reads
              // as a return trip rather than crossing straight through both
              // cards. Forward edges keep the plain right-to-left curve.
              const backward = t.x <= s.x
              const sx = (backward ? s.x : s.x + NW) + PAD
              const tx = (backward ? t.x + NW : t.x) + PAD
              const d = backward
                ? `M${sx} ${sy}C${sx - LOOP} ${sy} ${tx + LOOP} ${ty} ${tx} ${ty}`
                : `M${sx} ${sy}C${(sx + tx) / 2} ${sy} ${(sx + tx) / 2} ${ty} ${tx} ${ty}`
              return (
                <path
                  key={i}
                  className="sbx-flow-edge"
                  data-tone={e.tone}
                  data-dashed={e.dashed || undefined}
                  data-backward={backward || undefined}
                  d={d}
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
                data-kind={n.isFile ? 'file' : n.kind}
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
                    <div
                      key={r.key}
                      className="sbx-flow-row"
                      data-tone={r.tone}
                      // Inline, like the Modeling canvas's row indent — the row
                      // height is fixed by the layout, so the nesting must not
                      // come from anything that could change it.
                      style={{ height: ROW_H, paddingLeft: 8 + (r.depth ?? 0) * 10 }}
                    >
                      <span className="sbx-flow-row-name" title={r.meta ? `${r.label} · ${r.meta}` : r.label}>
                        {r.label}
                      </span>
                      {r.tone === 'col' || r.tone === 'run' ? (
                        // A run row heads its own tables; the R/W belongs to
                        // those, and a tag here would read as the activity
                        // itself being an access.
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
  // Ref → parts, merged over every step, so a table read by one notebook and
  // written by another is one card carrying one workspace.
  const refs: Record<string, SandboxTableRef> = Object.assign(
    {},
    ...steps.map((s) => stepTables(results.get(s.key))),
  )
  const tableSeen = new Set<string>()
  const ensureTable = (ref: string) => {
    // Keyed by the full ref, not the leaf name: two workspaces can hold a
    // `customers`, and they are two tables, not one.
    const id = `t:${ref.toLowerCase()}`
    if (!tableSeen.has(id)) {
      tableSeen.add(id)
      // A table card carries its schema as attribute rows — the same reading as
      // an object card in Modeling, and the reason the canvas is worth looking
      // at rather than just the report.
      const allRows: FlowRow[] = (schemas.get(ref) ?? []).map((c) => ({
        key: `c:${c.name}`,
        label: c.name,
        tone: 'col' as const,
        meta: c.type ?? undefined,
      }))
      nodes.push({
        id,
        kind: 'table',
        label: refLabel(ref, refs),
        ws: refWorkspace(ref, refs),
        isFile: refKind(ref, refs) === 'file',
        // A raw file has no schema to count, so it says what it is instead of
        // showing "0 cols" — which would read as a table we failed to resolve.
        sub: refKind(ref, refs) === 'file' ? 'raw files' : allRows.length ? `${allRows.length} cols` : undefined,
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
    // The step's own workspace — anything else is a cross-workspace access,
    // which is the fact this view exists to make visible.
    const own = res?.runs.find((x) => x.result?.workspace)?.result?.workspace ?? ''
    const io = (
      ref: string,
      tone: 'read' | 'write',
      opts: { depth?: number; scope?: string } = {},
    ): FlowRow => {
      const ws = refWorkspace(ref, refs)
      const foreign = !!own && !!ws && ws !== own
      return {
        // Scoped by activity inside a pipeline: the same table under two
        // notebooks is two rows, and two rows need two keys or the edges into
        // them both land on the first.
        key: `${tone[0]}:${opts.scope ? `${opts.scope}:` : ''}${ref}`,
        label: refLabel(ref, refs),
        tone,
        meta: foreign ? ws : undefined,
        depth: opts.depth,
      }
    }

    const rows: FlowRow[] = []
    /** `[table ref, row key]` per access, so the edges follow the rows. */
    const readAnchors: [string, string][] = []
    const writeAnchors: [string, string][] = []

    const runs = res?.runs ?? []
    if (step.kind === 'pipeline' && runs.length) {
      // A pipeline's rows are its ACTIVITIES, each heading the tables it
      // touched — the shape of the pipeline, not a merged inventory.
      runs.forEach((run, ri) => {
        const scope = `a${ri}`
        const runReads = run.result?.reads ?? []
        const runWrites = run.result?.writes ?? []
        rows.push({
          key: `a:${scope}`,
          label: run.name,
          tone: 'run',
          meta:
            run.status === 'error'
              ? 'error'
              : runReads.length + runWrites.length === 0
                ? 'no tables'
                : undefined,
        })
        for (const r of runReads) {
          const row = io(r, 'read', { depth: 1, scope })
          rows.push(row)
          readAnchors.push([r, row.key])
        }
        for (const w of runWrites) {
          const row = io(w, 'write', { depth: 1, scope })
          rows.push(row)
          writeAnchors.push([w, row.key])
        }
      })
    } else {
      // A notebook step IS the notebook, so there is nothing to nest under.
      for (const r of stepReads(res)) {
        const row = io(r, 'read')
        rows.push(row)
        readAnchors.push([r, row.key])
      }
      for (const w of stepWrites(res)) {
        const row = io(w, 'write')
        rows.push(row)
        writeAnchors.push([w, row.key])
      }
    }

    nodes.push({ id: stepId, kind: step.kind, label: step.name, sub, badge: String(i + 1), rows })

    for (const [ref, key] of readAnchors)
      edges.push({ from: ensureTable(ref), to: stepId, toRow: key, tone: 'read' })
    for (const [ref, key] of writeAnchors)
      edges.push({ from: stepId, fromRow: key, to: ensureTable(ref), tone: 'write' })
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
  view,
  onView,
}: {
  steps: Step[]
  results: Map<string, StepResult>
  ran: boolean
  view: CanvasView
  onView: (v: CanvasView) => void
}) {
  const navigate = useNavigate()
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [options, setOptions] = usePortOptions()
  const [settingsOpen, setSettingsOpen] = useState(false)

  const create = async () => {
    setBusy(true)
    setError(null)
    try {
      // The model is built in whichever view is on screen — what you export is
      // what you were looking at.
      const { model } = sequenceToModel(steps, results, defaultModelName(steps), view, options)
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
      <div className="sbx-views" role="tablist" aria-label="Canvas layout">
        {(
          [
            ['flow', 'Flow', 'One column per dependency depth'],
            ['sequence', 'Sequence', 'Tables in one column, steps in run order in the other'],
          ] as const
        ).map(([key, label, hint]) => (
          <button
            key={key}
            className="sbx-view"
            role="tab"
            aria-selected={view === key}
            data-active={view === key || undefined}
            title={hint}
            onClick={() => onView(key)}
          >
            {label}
          </button>
        ))}
      </div>
      {error && (
        <span className="fx-note" data-error="true">
          {error}
        </span>
      )}
      <PortSettings
        options={options}
        onChange={setOptions}
        open={settingsOpen}
        onOpen={setSettingsOpen}
      />
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

const PORT_OPTIONS_KEY = 'lineage.port.options'

/**
 * The port settings, persisted.
 *
 * They live in localStorage rather than in component state because they are a
 * preference about how this user works, not about this run: having to re-tick
 * the same boxes after every run is exactly the friction the setting was added
 * to remove. Unknown or corrupt stored values fall back to the defaults rather
 * than throwing — a bad key must never make the sandbox unusable.
 */
function usePortOptions(): [PortOptions, (next: PortOptions) => void] {
  const [options, setOptions] = useState<PortOptions>(() => {
    try {
      const raw = localStorage.getItem(PORT_OPTIONS_KEY)
      if (!raw) return DEFAULT_PORT_OPTIONS
      const saved = JSON.parse(raw) as Partial<PortOptions>
      // Spread over the defaults so a setting added later is ON for someone who
      // already has a stored blob, matching a first-time user.
      return { ...DEFAULT_PORT_OPTIONS, ...saved }
    } catch {
      return DEFAULT_PORT_OPTIONS
    }
  })
  const update = (next: PortOptions) => {
    setOptions(next)
    try {
      localStorage.setItem(PORT_OPTIONS_KEY, JSON.stringify(next))
    } catch {
      // A full or blocked localStorage must not stop the user changing the
      // setting for this session.
    }
  }
  return [options, update]
}

/** Label and hint for each toggle, in the order they appear in the popover. */
const PORT_SETTINGS: { key: keyof PortOptions; label: string; hint: string }[] = [
  { key: 'kindTags', label: 'Entity tags', hint: 'Badge each object Notebook, Pipeline or Table' },
  { key: 'accessTags', label: 'Access tags (R/W)', hint: "Badge a step's rows as Read or Write" },
  { key: 'provenance', label: 'Provenance', hint: 'Source, Step number and Workspace properties' },
  { key: 'columns', label: 'Table columns', hint: 'Carry each table schema across as attributes' },
  { key: 'columnEdges', label: 'Column-level edges', hint: 'Column-to-column lineage, where resolved' },
]

/** The gear beside "Create model": what the port carries into the model. */
function PortSettings({
  options,
  onChange,
  open,
  onOpen,
}: {
  options: PortOptions
  onChange: (next: PortOptions) => void
  open: boolean
  onOpen: (open: boolean) => void
}) {
  const ref = useRef<HTMLDivElement | null>(null)

  // Close on an outside click or Escape. Pointerdown rather than click so the
  // popover is gone before whatever was clicked underneath reacts.
  useEffect(() => {
    if (!open) return
    const onDown = (e: PointerEvent) => {
      if (!ref.current?.contains(e.target as Node)) onOpen(false)
    }
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onOpen(false)
    }
    document.addEventListener('pointerdown', onDown)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('pointerdown', onDown)
      document.removeEventListener('keydown', onKey)
    }
  }, [open, onOpen])

  const off = PORT_SETTINGS.filter(({ key }) => !options[key]).length

  return (
    <div className="sbx-portset" ref={ref}>
      <button
        className="fx-btn"
        data-quiet="true"
        aria-expanded={open}
        aria-haspopup="true"
        title="Choose what the model carries across from this run"
        onClick={() => onOpen(!open)}
      >
        Port settings{off > 0 && <span className="sbx-portset-count">{off} off</span>}
      </button>
      {open && (
        <div className="sbx-portset-pop" role="group" aria-label="Port settings">
          <p className="sbx-portset-lead">
            What the new model carries across. None of these changes the lineage itself — the same
            objects and table-level edges come across either way.
          </p>
          {PORT_SETTINGS.map(({ key, label, hint }) => {
            // Column edges have nothing to attach to without the columns, so
            // the UI shows the implication rather than letting it look enabled.
            const disabled = key === 'columnEdges' && !options.columns
            return (
              <label key={key} className="sbx-portset-row" data-disabled={disabled || undefined}>
                <input
                  type="checkbox"
                  checked={options[key] && !disabled}
                  disabled={disabled}
                  onChange={(e) => onChange({ ...options, [key]: e.target.checked })}
                />
                <span className="sbx-portset-label">
                  {label}
                  <span className="sbx-portset-hint">
                    {disabled ? 'Needs table columns' : hint}
                  </span>
                </span>
              </label>
            )
          })}
        </div>
      )}
    </div>
  )
}

export function SequenceCanvas({ steps, results }: { steps: Step[]; results: Map<string, StepResult> }) {
  const [view, setView] = useState<CanvasView>('flow')
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

  // Input schemas, across the run. These decide whether column lineage is
  // possible at all off-engine, so a run that resolved none of them has to say
  // so — otherwise the empty result is read as "this notebook has no columns"
  // when it actually means "this principal cannot read OneLake".
  const schemaReports = notebookRuns.map(({ r }) => r.schema_resolution).filter((x) => !!x)
  const schemaRequested = new Set(schemaReports.flatMap((s) => s.requested))
  const schemaResolved = new Set(schemaReports.flatMap((s) => s.resolved))
  const schemaUnresolved = [...new Set(schemaReports.flatMap((s) => s.unresolved))].sort()
  const schemaFailures = [...new Set(schemaReports.flatMap((s) => s.failures))]

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
      <ToModelBar steps={steps} results={results} ran={ran} view={view} onView={setView} />
      <FlowCanvas nodes={flow.nodes} edges={flow.edges} view={view} />

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
                  {schemaRequested.size > 0 && (
                    <div>
                      <dt>Schemas</dt>
                      <dd data-warn={schemaUnresolved.length > 0 || undefined}>
                        {schemaResolved.size}/{schemaRequested.size}
                      </dd>
                    </div>
                  )}
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

          {/* Not an error — the run is valid, its column lineage is just
              incomplete in a way nothing else on screen would show. The
              failures are listed verbatim because the distinction that matters
              (refused vs genuinely absent) lives in the message. */}
          {schemaUnresolved.length > 0 && (
            <details className="sbx-schema-gap">
              <summary>
                {schemaUnresolved.length} input table
                {schemaUnresolved.length === 1 ? '' : 's'} had no readable schema — columns and
                column lineage for {schemaUnresolved.length === 1 ? 'it' : 'them'} are missing, not
                absent.
              </summary>
              <ul>
                {schemaUnresolved.map((ref) => (
                  <li key={ref}>{ref}</li>
                ))}
              </ul>
              {schemaFailures.length > 0 && (
                <ul className="sbx-schema-why">
                  {schemaFailures.map((f) => (
                    <li key={f}>{f}</li>
                  ))}
                </ul>
              )}
            </details>
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
