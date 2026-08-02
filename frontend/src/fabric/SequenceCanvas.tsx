// The sandbox sequence drawn as lineage, plus the run report. Lives in the
// Explore detail column's "Sandbox" tab — there is no separate sandbox page.
//
// A node is an *object card*: a header naming it and a stack of attribute rows
// (its reads and writes). Edges anchor to the row they belong to, not to the
// card, so a table's line lands on the exact row that reads or writes it —
// same reading as `modeling/ModelViewer`.
import { useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate } from '@tanstack/react-router'
import {
  refKind,
  refLabel,
  refLakehouse,
  refWorkspace,
  type SandboxColumn,
  type SandboxCoverage,
  type SandboxRunResult,
  type SandboxTableRef,
} from '../api'
import { StepIcon } from './SequencePanel'
import { stepReads, stepTables, stepWrites, type Step, type StepResult, type StepStatus } from './sequence'
import { coverageBadge, coverageOf, coverageSummary, type CoverageLevel } from './coverage'
import { columnKey, diffIsClean, diffRuns, type RunDiff } from './runDiff'
import {
  sequenceToModel,
  defaultModelName,
  DEFAULT_PORT_OPTIONS,
  type PortOptions,
} from './toModel'
import { localStore } from '../model/store'

type FlowKind = 'notebook' | 'pipeline' | 'table'
/**
 * `read`/`write` are a step's I/O rows; `hop` is the two of them folded into the
 * single row of a step that does both; `col` is a table's own column; `run` is
 * one activity INSIDE a pipeline, heading the tables that activity touched.
 */
type RowTone = 'read' | 'write' | 'col' | 'run' | 'hop'
/** The tone an edge can carry — a column row is never an edge endpoint. */
type EdgeTone = 'read' | 'write'
export interface FlowRow {
  key: string
  label: string
  tone: RowTone
  /** Column type, shown to the right of the name on a table card. */
  meta?: string
  /**
   * Indent level. A pipeline card nests deepest — its rows are its notebooks,
   * under each the tables THAT notebook touched, and under each of those the
   * table's own columns. A notebook card is the same minus the first level.
   *
   * A flat merge of every table the pipeline touched — which is what this was —
   * answers "what did this pipeline touch" but loses "which step touched it",
   * and that is the question a pipeline card exists to answer. A table read by
   * two of its notebooks now appears under both, because it genuinely is two
   * accesses.
   */
  depth?: number
  /** New since the previous run, when Diff is on. */
  change?: 'added'
  /**
   * For a column row nested under a table row inside a STEP card: the key of
   * that table row.
   *
   * It is what makes a column belong to an access rather than to the card. The
   * same table read by two activities carries its schema twice, under each, and
   * the two runs collapse and expand independently — so truncation state, and
   * the edges that leave these rows, are both keyed by this.
   *
   * Absent on a table card's own columns: those are the card, not a group
   * within it.
   */
  group?: string
}
export interface FlowNode {
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
   * A table's lakehouse. Carried on the node because the semantic views name a
   * band for it, and the refs table is not in scope by the time bands are cut.
   */
  lakehouse?: string
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
   * What the run resolved about this table, and why not where it did not.
   *
   * A bare card and a fully-traced card looked identical, which overstates the
   * result: the reasons a table comes back empty (schema unreadable, DataFrame
   * write on a SQL-only engine, dynamic SQL) are different claims, and the run
   * report knew all of them while the canvas showed none.
   */
  coverage?: { level: CoverageLevel; badge: string; reason: string }
  /** How the step is going, while a sequence is running. Steps only. */
  status?: StepStatus
  /** Diff verdict against the previous run, when Diff is on. */
  change?: 'added' | 'lost-lineage'
  /**
   * A table's full column list. `rows` is the truncated view the card shows
   * until it is expanded — a 60-column table would otherwise be a mile of card
   * and push every other node off the canvas.
   */
  allRows?: FlowRow[]
}

/** How many columns a table card shows before it needs expanding. */
const MAX_TABLE_ROWS = 8
/**
 * How many columns one nested group inside a step card shows before expanding.
 *
 * Lower than a table card's cap because a step card holds many such groups —
 * one per access — and eight rows each turns a three-notebook pipeline into a
 * card taller than the canvas.
 */
const MAX_NESTED_COLS = 5
/** `row` is a row key on that node; omitted means "anchor to the header". */
interface FlowEdge {
  from: string
  fromRow?: string
  to: string
  toRow?: string
  tone?: EdgeTone
  dashed?: boolean
  /**
   * `column` joins a column row to the same column on the other card; `table`
   * is the whole-table access it belongs to. Undefined for the faint order
   * edges, which join nothing in particular.
   */
  kind?: 'table' | 'column'
  /**
   * Ties one table-level edge to the column edges derived from it, so the
   * canvas can show one OR the other and never both: the table edge stands in
   * while the columns are collapsed or unresolved, and steps aside as soon as
   * a single column edge is on screen. Without it a card would carry a line to
   * its header and a line to each of its rows, all saying the same thing.
   */
  group?: string
}

const NW = 208
const HEAD_H = 26
const ROW_H = 20
const GX = 76
/**
 * The gutter Zig-Zag uses instead.
 *
 * Two bands carry ALL of the traffic in that view — every read and every write
 * crosses the same gap — and at the ordinary gutter the curves merged into one
 * band of ink. Wider costs a little scrolling and buys separable lines.
 */
const ZIG_GX = 150
const GY = 26
const PAD = 18
const BAND_H = 26
/** Bezier reach of a backward (write-back) edge. */
const LOOP = 46

/** Height of one note strip under a card head — coverage, or a diff verdict. */
const NOTE_H = 16
/**
 * How many note strips a card carries. Part of the geometry, not decoration:
 * the rows below them shift down by exactly this, and an edge anchored without
 * it lands on the wrong row.
 */
const notesOf = (n: FlowNode) => (n.coverage ? 1 : 0) + (n.change === 'lost-lineage' ? 1 : 0)
const nodeHeight = (n: FlowNode) => HEAD_H + notesOf(n) * NOTE_H + n.rows.length * ROW_H
/** Vertical centre of a row (or of the header when `rowKey` is undefined). */
function anchorY(n: FlowNode, rowKey?: string) {
  const i = rowKey ? n.rows.findIndex((r) => r.key === rowKey) : -1
  const top = HEAD_H + notesOf(n) * NOTE_H
  return i < 0 ? HEAD_H / 2 : top + i * ROW_H + ROW_H / 2
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
/**
 * How the sandbox canvas is arranged.
 *
 * `flow`/`sequence` name bands for a POSITION in the layout ("Source tables").
 * The other two are arrangements in their own right, not relabellings:
 *
 * Both of the others put one band per OWNER — the workspace, or the lakehouse
 * standing in where none resolved — because that is who the thing belongs to.
 * They differ in the axis: `stages` stacks each band's lakehouses in medallion
 * order (landing, bronze, silver, gold) so the boxes read down the band, while
 * `workspace` runs dependency depth down the canvas, so a run hopping between a
 * platform and an engineering workspace draws as a zig-zag: right, down, back
 * left, down.
 *
 * Both mirror the layout of the same name that Create model exports.
 */
export type CanvasView = 'flow' | 'sequence' | 'stages'

/** The view that names bands for what is in them rather than where it sits. */
const SEMANTIC_VIEWS: readonly CanvasView[] = ['stages']

const uniq = (xs: (string | undefined)[]): string[] => [
  ...new Set(xs.filter((x): x is string => !!x)),
]

interface Layout {
  pos: Map<string, { x: number; y: number }>
  bands: { key: number; label: string; left: number; width: number; centerX: number }[]
  /**
   * A heading above a run of cards that belong to one thing — the workspace of
   * the tables below it (sequence view), or the lakehouse holding them and the
   * pipeline running them (the semantic views).
   *
   * A heading rather than a box drawn behind the cards, which is what this was:
   * the box added a second, grey, rounded rectangle behind every card and the
   * canvas read as two nested containers everywhere without saying anything the
   * heading does not. The name is drawn once per run rather than badged on
   * every card, because the column is already ordered by it.
   */
  groups: { key: string; label: string; kind?: 'lakehouse' | 'pipeline'; x: number; y: number }[]
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

function band(key: number, label: string, col: number, lastCol: number, gap = GX) {
  const left = col * (NW + gap) - (col === 0 ? 0 : gap / 2)
  const right = col * (NW + gap) + NW + (col === lastCol ? 0 : gap / 2)
  return { key, label, left, width: right - left, centerX: col * (NW + gap) + NW / 2 }
}

/**
 * The container a card belongs to: the lakehouse holding a table, or the
 * pipeline a step IS. A card with no container sits loose in the band.
 *
 * A pipeline is its own container of one rather than a plain card because the
 * boundary is the point — a pipeline is a unit of orchestration, and the reader
 * needs to see where one ends and the next notebook begins.
 */
function containerOf(n: FlowNode): { key: string; label: string; kind: 'lakehouse' | 'pipeline' } | null {
  if (n.kind === 'table') return n.lakehouse ? { key: `lh:${n.lakehouse}`, label: n.lakehouse, kind: 'lakehouse' } : null
  if (n.kind === 'pipeline') return { key: `pl:${n.id}`, label: n.label, kind: 'pipeline' }
  return null
}

/** Extra vertical space at a group boundary, on top of the usual gap. */
const BOX_GAP = 16

/**
 * Stack one column top-down, keeping cards of the same container together and
 * heading each run with its name.
 *
 * Contiguity is by container, not by sort order: `stableByContainer` runs first
 * so a lakehouse's tables are adjacent even when they were first touched pages
 * apart, which is what lets one heading cover them.
 */
function stackGrouped(column: FlowNode[], x: number, y0: number, pos: Layout['pos'], out: Layout['groups']): number {
  let y = y0
  let prev: string | null = null
  for (const n of column) {
    const box = containerOf(n)
    const key = box?.key ?? null
    if (key !== prev) {
      if (y > y0) y += BOX_GAP
      if (box) {
        out.push({ key: `${box.key}@${x}@${y}`, label: box.label, kind: box.kind, x, y })
        y += GROUP_H
      }
      prev = key
    }
    pos.set(n.id, { x, y })
    y += nodeHeight(n) + GY
  }
  return Math.max(0, y - GY)
}

/** Group a column's cards by container, keeping first-seen order of both. */
function stableByContainer(column: FlowNode[]): FlowNode[] {
  const order: (string | null)[] = []
  const bins = new Map<string | null, FlowNode[]>()
  for (const n of column) {
    const key = containerOf(n)?.key ?? null
    if (!bins.has(key)) {
      bins.set(key, [])
      order.push(key)
    }
    bins.get(key)!.push(n)
  }
  return order.flatMap((k) => bins.get(k)!)
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
    // Flipped end to end, rows included: a column edge has to land back on the
    // table's own column row, not on its header. For a table-level edge
    // `fromRow` is undefined, so `toRow` stays undefined and the edge anchors
    // to the header exactly as it did before.
    if (e.tone === 'read' && stepIds.has(e.to))
      out.push({ ...e, from: e.to, fromRow: e.toRow, to: e.from, toRow: e.fromRow, tone: 'read' })
    else out.push(e)
  }
  return out
}

/**
 * Longest-path depth per node — how many hops of real lineage precede it.
 *
 * Shared by the flow view (which uses it as the x axis) and the workspace view
 * (which uses it as the y axis, so a run that hops between workspaces descends
 * as it zig-zags rather than piling onto one line).
 */
export function depthsOf(
  nodes: FlowNode[],
  edges: FlowEdge[],
  /**
   * Count the faint step-order edges as dependencies.
   *
   * True for the flow view, where they keep an unrelated later step from
   * collapsing back onto column 0. False for the workspace view, where they
   * would make depth track the step NUMBER — every step one row lower than the
   * last — and flatten the table/step alternation the zig-zag is made of.
   */
  includeOrder = false,
): Map<string, number> {
  const incoming = new Map<string, string[]>()
  nodes.forEach((n) => incoming.set(n.id, []))
  edges.forEach((e) => {
    if (incoming.has(e.to) && (includeOrder || !e.dashed)) incoming.get(e.to)!.push(e.from)
  })
  const colOf = new Map<string, number>()
  const visiting = new Set<string>()
  function col(id: string): number {
    const c = colOf.get(id)
    if (c !== undefined) return c
    // A cycle — a table written and then re-read by a later step — has no
    // longest path. Breaking it at 0 keeps the walk total and costs only the
    // precision of one node's depth.
    if (visiting.has(id)) return 0
    visiting.add(id)
    const parents = incoming.get(id) ?? []
    const v = parents.length ? 1 + Math.max(...parents.map(col)) : 0
    visiting.delete(id)
    colOf.set(id, v)
    return v
  }
  nodes.forEach((n) => col(n.id))
  return colOf
}

/**
 * Medallion stage names, in the order data moves through them.
 *
 * Matched as a token inside a lakehouse name, so `lh_bronze`, `bronze_lh` and
 * `Bronze` all rank the same. A lakehouse that matches nothing keeps its own
 * band and sorts after the known ones by dependency depth — an unrecognised
 * name is not a reason to drop a lakehouse out of the picture.
 */
const STAGE_ORDER = [
  'landing',
  'raw',
  'staging',
  'bronze',
  'silver',
  'gold',
  'platinum',
  'curated',
  'serving',
  'mart',
]

/** Where a lakehouse sits in the medallion order, or -1 when it names no stage. */
export function stageRank(name: string): number {
  const low = name.toLowerCase()
  let best = -1
  STAGE_ORDER.forEach((s, i) => {
    if (best < 0 && new RegExp(`(^|[^a-z])${s}([^a-z]|$)`).test(low)) best = i
  })
  return best
}

/**
 * Zig-Zag: owner across, depth DOWN.
 *
 * The x axis is who owns the card — the workspace, or the lakehouse standing in
 * where none resolved — with the bands that RUN things first, so the steps are
 * on the left and the tables they touch on the right.
 *
 * The y axis is dependency depth, and it is what earns the name. Both bands are
 * laid out against the SAME vertical scale, so a step and the table it reads are
 * one lane apart and every hop is a step sideways and a step down: right, down,
 * back left, down. Stacking each band independently from the top — which is what
 * this did — put step five beside the first lakehouse and drew the run as a
 * fan of long diagonals crossing each other. Two columns with lines between them
 * is not a zig-zag.
 *
 * Medallion stage survives as the tie-break INSIDE a lane: two tables at the
 * same depth sort landing before bronze before silver. It cannot be the primary
 * sort any more without breaking the vertical agreement that makes the hops
 * read, and depth already puts the stages in order in the normal case, because
 * that is what a medallion run does.
 *
 * The same arrangement `sequenceToModel`'s `stages` layout exports, so pressing
 * Create model gives back the picture on screen.
 */
export function layoutStages(nodes: FlowNode[], edges: FlowEdge[]): Layout {
  const depth = depthsOf(nodes, edges)
  const owner = ownerOf(nodes, edges)
  const spaces = stepsFirst(nodes, ownerOrder(nodes, edges, owner.key), owner.key)

  // Medallion order within a lane. `sort` is stable, so a lakehouse naming no
  // stage — and every step, which has none — keeps its first-touch place.
  const rank = (n: FlowNode) => (n.kind === 'table' && stageRank(n.lakehouse || '') + 1) || Infinity
  const byStage = [...nodes].sort((a, b) => rank(a) - rank(b))

  const pos: Layout['pos'] = new Map()
  const groups: Layout['groups'] = []
  const maxDepth = Math.max(0, ...depth.values())
  let y = 0
  for (let d = 0; d <= maxDepth; d++) {
    let lane = y
    spaces.forEach((ws, c) => {
      const here = stableByContainer(
        byStage.filter((n) => owner.key(n) === ws && (depth.get(n.id) ?? 0) === d),
      )
      if (!here.length) return
      lane = Math.max(lane, stackGrouped(here, c * (NW + ZIG_GX), y, pos, groups))
    })
    // An empty lane adds nothing: a depth no card lands on is not a gap in the
    // run, it is an artefact of how the depths were numbered.
    y = lane === y ? y : lane + GY * 2
  }

  const lastCol = spaces.length - 1
  return {
    pos,
    groups,
    bands: spaces.map((ws, c) => band(c, owner.label(ws), c, lastCol, ZIG_GX)),
    width: spaces.length * (NW + ZIG_GX) - ZIG_GX,
    height: Math.max(1, y - GY * 2),
  }
}

/**
 * The bands that hold at least one step, moved in front of the ones that hold
 * only tables — engineering on the left, the lakehouses it writes on the right.
 *
 * Zig-Zag only. Ordering the bands by where the run STARTS (which is what
 * `ownerOrder` does, and what the Workspace view keeps) puts the tables first
 * whenever the first thing the run touches is a read, so the same two
 * workspaces swapped sides depending on the sequence.
 */
function stepsFirst(nodes: FlowNode[], spaces: string[], key: (n: FlowNode) => string): string[] {
  const runs = new Set(nodes.filter((n) => n.kind !== 'table').map(key))
  return [...spaces].sort((a, b) => Number(runs.has(b)) - Number(runs.has(a)))
}

/**
 * The owner bands, left to right: earliest in the run first, unresolved last.
 *
 * Kept apart from `layoutStages` because the ordering rule (earliest owner
 * first) and the Zig-Zag override (steps first) are two decisions, and reading
 * one inside the other hid which of them was doing the work.
 */
function ownerOrder(nodes: FlowNode[], edges: FlowEdge[], key: (n: FlowNode) => string): string[] {
  const depth = depthsOf(nodes, edges)
  const first = new Map<string, { depth: number; at: number }>()
  nodes.forEach((n, i) => {
    const k = key(n)
    const d = depth.get(n.id) ?? 0
    const prev = first.get(k)
    if (!prev) first.set(k, { depth: d, at: i })
    else prev.depth = Math.min(prev.depth, d)
  })
  // An unresolved workspace sorts last: it is the least trustworthy column and
  // should not head the canvas.
  return [...first.entries()]
    .sort(([ka, a], [kb, b]) => (ka === '' ? 1 : kb === '' ? -1 : a.depth - b.depth || a.at - b.at))
    .map(([k]) => k)
}

/**
 * Who a card belongs to, for the workspace view's x axis.
 *
 * The workspace when the run resolved one. When it did not — a notebook
 * addressing `lh_bronze.orders` gives a ref with no workspace at all, which is
 * the common case — the LAKEHOUSE stands in, and a step falls back to the
 * lakehouse it writes into. Without the fallback every card shared one key and
 * the whole view drew as a single column, which is not a layout so much as an
 * absence of one.
 *
 * The two are never mixed silently: a band standing in for an unknown owner
 * says so.
 */
function ownerOf(nodes: FlowNode[], edges: FlowEdge[]) {
  const byId = new Map(nodes.map((n) => [n.id, n]))
  const writeTarget = new Map<string, string>()
  for (const e of edges)
    if (e.tone === 'write' && e.kind !== 'column' && !writeTarget.has(e.from)) writeTarget.set(e.from, e.to)

  const lakehouseOf = (n: FlowNode): string =>
    n.kind === 'table' ? n.lakehouse || '' : (byId.get(writeTarget.get(n.id) ?? '')?.lakehouse ?? '')

  const key = (n: FlowNode) => n.ws || (lakehouseOf(n) ? `lh:${lakehouseOf(n)}` : '')
  const label = (k: string) =>
    k.startsWith('lh:') ? `${k.slice(3)} · workspace unknown` : k || 'workspace unresolved'
  return { key, label }
}

function layoutFlow(nodes: FlowNode[], edges: FlowEdge[]): Layout {
  const colOf = depthsOf(nodes, edges, true)

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

/** The expansion key for one collapsible run of columns on a card. */
const groupKey = (nodeId: string, group?: string) => `${nodeId}::${group ?? ''}`

/**
 * Collapse each long run of column rows, independently.
 *
 * A table card's columns are one unnamed run; a step card holds one run per
 * access, each keyed by the table row above it. Both need the same treatment
 * for the same reason — a sixty-column table is a mile of card that pushes
 * every other node off the canvas — but they must open and shut separately, or
 * expanding one table's columns inside a pipeline expands all of them.
 *
 * Runs here rather than in `buildFlow` so expanding is a pure re-layout: the
 * graph, and the edges derived from it, never change.
 */
export function truncateRows(
  n: FlowNode,
  expanded: ReadonlySet<string>,
  /**
   * How many column rows a run shows before it needs opening. Zig-Zag passes 0:
   * card HEIGHT is what makes its diagonals long, and the first read of that
   * view should be boxes and arrows with the schema one click away. The other
   * views show a few, because their columns are the point.
   */
  caps: { table: number; nested: number } = { table: MAX_TABLE_ROWS, nested: MAX_NESTED_COLS },
): FlowRow[] {
  const all = n.allRows ?? n.rows
  const out: FlowRow[] = []
  for (let i = 0; i < all.length; ) {
    const row = all[i]
    if (row.tone !== 'col') {
      out.push(row)
      i++
      continue
    }
    const group = row.group
    let end = i
    while (end < all.length && all[end].tone === 'col' && all[end].group === group) end++
    const run = all.slice(i, end)
    const cap = group ? caps.nested : caps.table
    if (run.length <= cap) out.push(...run)
    else {
      const open = expanded.has(groupKey(n.id, group))
      const shown = open ? run : run.slice(0, cap)
      out.push(...shown, {
        key: `__more:${group ?? ''}`,
        label: open ? 'Show less' : `+${run.length - shown.length} more`,
        tone: 'col',
        depth: row.depth,
        group,
      })
    }
    i = end
  }
  return out
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

  // Zig-Zag opens with the columns shut: its lines are long because its cards
  // are tall, and the schema is one click away on any card that needs it.
  const caps = useMemo(
    () =>
      view === 'stages'
        ? { table: 0, nested: 0 }
        : { table: MAX_TABLE_ROWS, nested: MAX_NESTED_COLS },
    [view],
  )
  const nodes = useMemo(
    () => rawNodes.map((n) => (n.allRows ? { ...n, rows: truncateRows(n, expanded, caps) } : n)),
    [rawNodes, expanded, caps],
  )
  const byId = useMemo(() => new Map(nodes.map((n) => [n.id, n])), [nodes])

  const shown = useMemo(() => {
    const stepIds = new Set(rawNodes.filter((n) => n.kind !== 'table').map((n) => n.id))
    // Only the sequence view flips reads: it is the one layout with a single
    // canonical tables column to point everything at. The workspace view keeps
    // true direction, because a read crossing back to the workspace on the left
    // is a fact about ownership, not a drawing artefact.
    const base = view === 'sequence' ? sequenceEdges(edges, stepIds) : edges
    // A column edge is only drawn when BOTH of its rows are actually on screen
    // — a collapsed group would otherwise anchor every hidden column to the
    // card header, which is a fan of identical lines saying nothing. Whenever
    // no column edge survives for an access, its table-level edge stands in.
    const onScreen = (id: string, rowKey?: string) =>
      !rowKey || !!byId.get(id)?.rows.some((r) => r.key === rowKey)
    const columns = base.filter(
      (e) => e.kind === 'column' && onScreen(e.from, e.fromRow) && onScreen(e.to, e.toRow),
    )
    const covered = new Set(columns.map((e) => e.group).filter(Boolean))
    return [
      ...base.filter((e) => e.kind !== 'column' && !(e.group && covered.has(e.group))),
      ...columns,
    ]
  }, [edges, rawNodes, view, byId])
  const { pos, bands, groups, width, height } = useMemo(
    () =>
      view === 'stages'
        ? layoutStages(nodes, edges)
        : view === 'sequence'
          ? layoutSequence(nodes)
          : layoutFlow(nodes, edges),
    [nodes, edges, view],
  )
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
          {/* One heading per run of cards — the workspace of the tables below
              it, or the lakehouse holding them and the pipeline running them.
              The band says which workspace; this says which thing inside it. */}
          {groups.map((g) => (
            <div
              key={g.key}
              className="sbx-flow-ws"
              data-kind={g.kind}
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
              // A backward edge leaves the source's LEFT side and lands on the
              // target's RIGHT, looping out so a return trip reads as one
              // rather than crossing straight through both cards.
              //
              // Right-to-left is not enough to earn that treatment in Zig-Zag,
              // where every READ crosses right-to-left by construction — half
              // the traffic was drawn in the style that means "this one is
              // unusual". There, an edge is backwards only when it also goes
              // UP: back and above is a genuine write into something already
              // passed, and back-and-down is just the other half of a hop.
              const backward = view === 'stages' ? t.x <= s.x && t.y <= s.y : t.x <= s.x
              const sx = (backward ? s.x : s.x + NW) + PAD
              const tx = (backward ? t.x + NW : t.x) + PAD
              // Control points at a third rather than the midpoint: two bands
              // carrying every edge in the run share one gutter, and curves
              // that all break in the middle merge into a single band of ink.
              const c1 = sx + (tx - sx) * 0.36
              const c2 = sx + (tx - sx) * 0.64
              const d = backward
                ? `M${sx} ${sy}C${sx - LOOP} ${sy} ${tx + LOOP} ${ty} ${tx} ${ty}`
                : `M${sx} ${sy}C${c1} ${sy} ${c2} ${ty} ${tx} ${ty}`
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
                data-status={n.status}
                data-change={n.change}
                data-coverage={n.coverage?.level}
                style={{ left: p.x + PAD, top: p.y + PAD, width: NW }}
              >
                <div className="sbx-flow-card-head" title={n.sub ? `${n.label} · ${n.sub}` : n.label}>
                  {n.badge && <span className="sbx-flow-num">{n.badge}</span>}
                  <span className="sbx-flow-card-name">{n.label}</span>
                  {n.sub && <span className="sbx-flow-card-sub">{n.sub}</span>}
                  {!n.sub && n.rows.length > 0 && <span className="sbx-flow-count">{n.rows.length}</span>}
                </div>
                {/* Why this card is thin, on the card. The reason was only ever
                    in the run report, so a bare table and a fully traced one
                    looked the same and the canvas overstated the result. */}
                {n.coverage && (
                  <div className="sbx-flow-note" data-level={n.coverage.level} title={n.coverage.reason}>
                    {n.coverage.badge}
                  </div>
                )}
                {n.change === 'lost-lineage' && (
                  <div className="sbx-flow-note" data-level="lost" title="This table had column lineage in the previous run and has none now.">
                    lineage lost
                  </div>
                )}
                {n.rows.map((r) =>
                  r.key.startsWith('__more') ? (
                    <button
                      key={r.key}
                      className="sbx-flow-row sbx-flow-more"
                      style={{ height: ROW_H, paddingLeft: 8 + (r.depth ?? 0) * 10 }}
                      onClick={() => toggle(groupKey(n.id, r.group))}
                    >
                      {r.label}
                    </button>
                  ) : (
                    <div
                      key={r.key}
                      className="sbx-flow-row"
                      data-tone={r.tone}
                      data-change={r.change}
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
                          {r.tone === 'read' ? 'R' : r.tone === 'write' ? 'W' : 'R→W'}
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

/**
 * Build the flow graph from the steps and (optionally) their run results.
 *
 * `fold` draws a step that both reads and writes as ONE hop row rather than two
 * — what the semantic views and the layouts they port to do. The positional
 * views keep the two rows: `flow` puts a step's inputs and outputs in different
 * columns, so a single row would have to face both ways at once.
 */
export function buildFlow(
  steps: Step[],
  results: Map<string, StepResult>,
  fold = false,
  /** The previous run, when Diff is on. Marks what is new and what stopped resolving. */
  diff?: RunDiff,
): { nodes: FlowNode[]; edges: FlowEdge[] } {
  const nodes: FlowNode[] = []
  const edges: FlowEdge[] = []
  const schemas = collectSchemas(results)
  const coverage = coverageOf(results)
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
        // A column that was not there last time, when Diff is on.
        change: diff?.addedColumns.has(columnKey(ref, c.name)) ? ('added' as const) : undefined,
      }))
      const cov = coverage.get(ref)
      nodes.push({
        id,
        kind: 'table',
        label: refLabel(ref, refs),
        ws: refWorkspace(ref, refs),
        lakehouse: refLakehouse(ref, refs),
        isFile: refKind(ref, refs) === 'file',
        // A raw file has no schema to count, so it says what it is instead of
        // showing "0 cols" — which would read as a table we failed to resolve.
        sub: refKind(ref, refs) === 'file' ? 'raw files' : allRows.length ? `${allRows.length} cols` : undefined,
        coverage: cov && cov.level !== 'traced'
          ? { level: cov.level, badge: coverageBadge(cov.level), reason: cov.reason }
          : undefined,
        change: diff?.lostLineage.has(ref)
          ? 'lost-lineage'
          : diff?.addedTables.has(ref)
            ? 'added'
            : undefined,
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

    /**
     * The column rows that sit under one table row inside this step card.
     *
     * The same schema the table's own card carries, repeated under the access
     * that touched it. That repetition is the point: it gives the edge a column
     * to leave from and a column to land on, so a table's relationship to the
     * step reads ACROSS to the tables layer instead of being implied by the
     * indent underneath it.
     */
    const nestedCols = (ref: string, rowKey: string, depth: number): FlowRow[] =>
      (schemas.get(ref) ?? []).map((c) => ({
        key: `${rowKey}>c:${c.name}`,
        label: c.name,
        tone: 'col' as const,
        meta: c.type ?? undefined,
        depth,
        group: rowKey,
      }))

    /**
     * One scope's tables as rows: a single HOP row where it both reads and
     * writes, one row per access where it does only one of them.
     *
     * A notebook reading `customers_raw` and writing `customers` is one move,
     * and a card drawing it as two rows made the lineage stop on the first and
     * start again on the second. Folded, the incoming edge lands on the same row
     * the outgoing one leaves, so the trace runs through the card — the shape
     * `sequenceToModel` exports, and the reason Create model gives back the
     * picture on screen.
     *
     * The columns beneath it are the UNION of both sides, keyed by name: a
     * column carried through is one row both edges touch, and a column the step
     * ADDS on write has no read side to arrive from, so it sits here with only
     * its outgoing edge.
     */
    const ioRows = (reads: string[], writes: string[], depth: number, scope?: string) => {
      const one = (ref: string, tone: 'read' | 'write') => {
        const row = io(ref, tone, { depth, scope })
        rows.push(row, ...nestedCols(ref, row.key, depth + 1))
        ;(tone === 'read' ? readAnchors : writeAnchors).push([ref, row.key])
      }
      if (!fold || !reads.length || !writes.length) {
        for (const r of reads) one(r, 'read')
        for (const w of writes) one(w, 'write')
        return
      }
      const label = (refs_: string[]) => uniq(refs_.map((r) => refLabel(r, refs))).join(', ')
      const key = `h:${scope ? `${scope}:` : ''}${reads.join('|')}>${writes.join('|')}`
      const ws = uniq([...reads, ...writes].map((r) => refWorkspace(r, refs))).filter(
        (w) => own && w && w !== own,
      )
      rows.push({
        key,
        label: `${label(reads)} → ${label(writes)}`,
        tone: 'hop',
        meta: ws.join(' + ') || undefined,
        depth,
      })
      const seen = new Set<string>()
      for (const ref of [...reads, ...writes])
        for (const c of schemas.get(ref) ?? []) {
          if (seen.has(c.name)) continue
          seen.add(c.name)
          rows.push({
            key: `${key}>c:${c.name}`,
            label: c.name,
            tone: 'col',
            meta: c.type ?? undefined,
            depth: depth + 1,
            group: key,
          })
        }
      for (const r of reads) readAnchors.push([r, key])
      for (const w of writes) writeAnchors.push([w, key])
    }

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
        ioRows(runReads, runWrites, 1, scope)
      })
    } else {
      // A notebook step IS the notebook, so there is nothing to nest under —
      // its tables sit at the top level, and their columns one level in.
      ioRows(stepReads(res), stepWrites(res), 0)
    }

    nodes.push({
      id: stepId,
      kind: step.kind,
      label: step.name,
      sub,
      badge: String(i + 1),
      // The step's OWN workspace, which is the axis the workspace view lays
      // cards out on. Empty when no run resolved one — the same "unresolved"
      // the tables column already distinguishes from a real name.
      ws: own,
      status: res?.status,
      rows,
      // Every card carries its full row list; the canvas decides how much of
      // each column run to show.
      allRows: rows,
    })

    /**
     * One access, as a table-level edge plus a column edge per resolved column.
     *
     * Both are emitted, tied by `group`, and the canvas picks: the column edges
     * whenever their rows are on screen, the table edge otherwise. Deciding it
     * here is not possible — which rows are visible depends on what the reader
     * has expanded, which is canvas state.
     */
    const access = (ref: string, key: string, tone: EdgeTone) => {
      const tableId = ensureTable(ref)
      const group = `${tone}|${stepId}|${key}`
      const read = tone === 'read'
      edges.push(
        read
          ? { from: tableId, to: stepId, toRow: key, tone, kind: 'table', group }
          : { from: stepId, fromRow: key, to: tableId, tone, kind: 'table', group },
      )
      for (const c of schemas.get(ref) ?? []) {
        const onTable = `c:${c.name}`
        const onStep = `${key}>c:${c.name}`
        edges.push(
          read
            ? { from: tableId, fromRow: onTable, to: stepId, toRow: onStep, tone, kind: 'column', group }
            : { from: stepId, fromRow: onStep, to: tableId, toRow: onTable, tone, kind: 'column', group },
        )
      }
    }

    for (const [ref, key] of readAnchors) access(ref, key, 'read')
    for (const [ref, key] of writeAnchors) access(ref, key, 'write')
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
  diffOn,
  onDiff,
  canDiff,
}: {
  steps: Step[]
  results: Map<string, StepResult>
  ran: boolean
  view: CanvasView
  onView: (v: CanvasView) => void
  diffOn: boolean
  onDiff: (on: boolean) => void
  /** False until a second run — one run has nothing to compare against. */
  canDiff: boolean
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
      // The exported model matches the picture on screen, which is the whole
      // contract of this button — so a semantic view exports semantic layers,
      // and the two arrangements map onto the two the builder already knows.
      const semantic = SEMANTIC_VIEWS.includes(view)
      const { model } = sequenceToModel(
        steps,
        results,
        defaultModelName(steps),
        view === 'sequence' ? 'sequence' : 'flow',
        { ...options, layout: semantic ? 'stages' : 'view' },
      )
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
            ['stages', 'Zig-Zag', 'Steps on the left, their tables on the right — the run zig-zags between the two'],
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
      {/* Diff sits with the view tabs because it is a way of reading the same
          canvas, not a separate mode with its own arrangement. */}
      <button
        className="sbx-view sbx-diff"
        data-active={diffOn || undefined}
        disabled={!canDiff}
        title={
          canDiff
            ? 'Mark what changed since the previous run'
            : 'Run the sequence twice — there is nothing to compare against yet'
        }
        onClick={() => onDiff(!diffOn)}
      >
        Diff
      </button>
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
  {
    key: 'columnEdges',
    label: 'Column-level edges',
    hint: 'Join each column to the same column on the table it came from',
  },
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

export function SequenceCanvas({
  steps,
  results,
  /**
   * Which half to render. The canvas and the run report used to stack in one
   * scroller, and a pipeline of any size left the canvas a letterbox with the
   * report below it — the lineage is the thing being looked at, so it gets the
   * column to itself and the report gets a tab of its own.
   */
  pane = 'canvas',
  previous = null,
  running = false,
}: {
  steps: Step[]
  results: Map<string, StepResult>
  pane?: 'canvas' | 'report'
  /** The run this one replaced, for Diff. */
  previous?: Map<string, StepResult> | null
  running?: boolean
}) {
  const [view, setView] = useState<CanvasView>('flow')
  // Rebuilt when the view changes, because the semantic views fold a step's
  // read and write into one hop row and the positional ones do not — the same
  // split `sequenceToModel` makes, so the card and the port always agree.
  const semanticView = SEMANTIC_VIEWS.includes(view)
  const [diffOn, setDiffOn] = useState(false)
  const diff = useMemo(() => diffRuns(previous, results), [previous, results])
  const flow = useMemo(
    () => buildFlow(steps, results, semanticView, diffOn && !diff.empty ? diff : undefined),
    [steps, results, semanticView, diffOn, diff],
  )
  const coverage = useMemo(() => coverageSummary(results), [results])
  //: how far a running sequence has got — the canvas was a spinner until the
  //  whole thing finished, on a pipeline that can be minutes.
  const done = [...results.values()].filter((r) => r.status === 'ok' || r.status === 'error').length
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

  // Coverage, across the run. The counterpart to the schema report above, and
  // the one that answers "why is this table bare?" when OneLake was perfectly
  // readable: production runs the stub engine, which derives column lineage from
  // SQL only, so a DataFrame-API notebook yields no column edges at all. Without
  // this that gap is indistinguishable from a notebook that moves no columns.
  const coverages = notebookRuns.map(({ r }) => r.coverage).filter((c) => !!c)
  const sum = (pick: (c: SandboxCoverage) => number) => coverages.reduce((n, c) => n + pick(c), 0)
  const totalWrittenTables = sum((c) => c.writes)
  const coveredWrites = sum((c) => c.writes_with_column_lineage)
  const bareWrites = [...new Set(coverages.flatMap((c) => c.writes_without_column_lineage))].sort()
  const dataframeCells = sum((c) => c.dataframe_write_cells)
  const dynamicSqlCells = sum((c) => c.dynamic_sql_cells)
  const unparsableCells = sum((c) => c.unparsable_cells)
  // The reasons, in the order they explain the most. Each is a real cause of a
  // bare write, and naming it is the whole point of the block.
  const coverageReasons = [
    dataframeCells > 0 &&
      `${dataframeCells} cell${dataframeCells === 1 ? '' : 's'} write through the DataFrame API — the ${
        notebookRuns[0]?.r.engine ?? 'stub'
      } engine derives column lineage from SQL only, so those writes have no column edges.`,
    dynamicSqlCells > 0 &&
      `${dynamicSqlCells} cell${dynamicSqlCells === 1 ? '' : 's'} build their SQL from an f-string or a variable; the query text is not knowable without running the cell, so it was skipped rather than guessed at.`,
    unparsableCells > 0 &&
      `${unparsableCells} cell${unparsableCells === 1 ? '' : 's'} could not be parsed.`,
  ].filter((r): r is string => typeof r === 'string')

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

  if (pane === 'canvas')
    return (
      <div className="sbx-canvas-body">
        <ToModelBar
          steps={steps}
          results={results}
          ran={ran}
          view={view}
          onView={setView}
          diffOn={diffOn}
          onDiff={setDiffOn}
          canDiff={!diff.empty}
        />
        {/* One strip under the bar, carrying whichever of the three things is
            true right now: a run in progress, a diff being read, or how much of
            the finished run actually resolved. */}
        {running ? (
          <div className="sbx-strip" data-tone="running">
            <span className="sbx-strip-bar" style={{ width: `${(done / Math.max(1, steps.length)) * 100}%` }} />
            <span className="sbx-strip-text">
              Running — step {Math.min(done + 1, steps.length)} of {steps.length}
              {steps[done] ? `: ${steps[done].name}` : ''}
            </span>
          </div>
        ) : diffOn && !diff.empty ? (
          <div className="sbx-strip" data-tone={diffIsClean(diff) ? 'ok' : 'diff'}>
            <span className="sbx-strip-text">
              {diffIsClean(diff)
                ? 'No change since the previous run — same tables, same columns, same lineage.'
                : [
                    diff.addedTables.size && `${diff.addedTables.size} table(s) new`,
                    diff.removedTables.size &&
                      `${diff.removedTables.size} no longer touched: ${[...diff.removedTables].join(', ')}`,
                    diff.addedColumns.size && `${diff.addedColumns.size} column(s) new`,
                    diff.removedColumns.size && `${diff.removedColumns.size} column(s) gone`,
                    diff.lostLineage.size && `${diff.lostLineage.size} lost column lineage`,
                  ]
                    .filter(Boolean)
                    .join(' · ')}
            </span>
          </div>
        ) : ran && coverage.tables > 0 ? (
          <div className="sbx-strip" data-tone={coverage.traced === coverage.tables ? 'ok' : 'warn'}>
            <span className="sbx-strip-text">
              {coverage.traced} of {coverage.tables} tables have column lineage
              {coverage.columnsOnly > 0 && ` · ${coverage.columnsOnly} columns only`}
              {coverage.bare > 0 && ` · ${coverage.bare} with no schema resolved`}
              {coverage.traced < coverage.tables && ' — hover a card’s note for why'}
            </span>
          </div>
        ) : null}
        <FlowCanvas nodes={flow.nodes} edges={flow.edges} view={view} />
      </div>
    )

  if (!ran)
    return (
      <div className="fx-detail-empty">
        <StepIcon kind="notebook" />
        <p>Nothing has run yet. Press Run on the sequence; the report lands here.</p>
      </div>
    )

  return (
    <div className="sbx-canvas-body">
      {(
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
                  {/* How much of what the run wrote actually got column lineage.
                      The rest of this header says what the run found; this says
                      how much of it is complete. */}
                  {totalWrittenTables > 0 && (
                    <div>
                      <dt>Columns</dt>
                      <dd data-warn={bareWrites.length > 0 || undefined}>
                        {coveredWrites}/{totalWrittenTables}
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

          {/* Same shape as the schema gap above, and the same argument: the run
              is valid, its column lineage is just incomplete for a reason that
              nothing else on screen would show. The reasons are listed because
              the actionable distinction lives in them — an engine limit is fixed
              by running the Spark engine, a dynamic query never can be. */}
          {bareWrites.length > 0 && (
            <details className="sbx-schema-gap">
              <summary>
                {bareWrites.length} written table{bareWrites.length === 1 ? '' : 's'} got no column
                lineage
                {coverageReasons.length > 0
                  ? ' — for the reasons below, not because there was nothing to find.'
                  : '.'}
              </summary>
              <ul>
                {bareWrites.map((ref) => (
                  // Labels come from every run's side table merged, not the
                  // first run's: a bare write may belong to any step.
                  <li key={ref}>
                    {refLabel(ref, Object.assign({}, ...notebookRuns.map(({ r }) => r.tables ?? {})))}
                  </li>
                ))}
              </ul>
              {coverageReasons.length > 0 && (
                <ul className="sbx-schema-why">
                  {coverageReasons.map((reason) => (
                    <li key={reason}>{reason}</li>
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

