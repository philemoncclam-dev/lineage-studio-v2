// Sandbox sequence -> an authored Modeling model.
//
// The sandbox produces observed lineage (what the notebooks actually read and
// wrote, per Spark's own plans); Modeling holds authored lineage the user can
// edit, lay out, map and version. This is the one-way bridge between them: it
// snapshots a run into a model and hands it over. Nothing links the two
// afterwards — re-running the sequence does not update a model built from it,
// by design, or the user's edits would be clobbered by the next run.
//
// The shape mirrors what the canvas already draws, so the model opens looking
// like the lineage the user just looked at:
//   layer   = a dependency column (sources on the left, as in the flow bands)
//   object  = a table, notebook or pipeline card
//   attribute = a table's column, or a step's access — and, under an access,
//               that table's columns again, exactly as the card nests them
//   transition = table->step (read), step->table (write); an access's columns
//                across to the same columns on the table; and column->column
//                where the run resolved real lineage between two tables
import type { LineageModel, Layer, ModelObject, Attribute, Transition, EntityId } from '../model/types'
import { emptyModel } from '../model/store'
import { TAGS_KEY } from '../model/tags'
import {
  refKind,
  refLabel,
  refLakehouse,
  refWorkspace,
  type FabricPipelineActivity,
  type SandboxColumn,
  type SandboxColumnFlow,
  type SandboxTableRef,
} from '../api'
import { stepReads, stepTables, stepWrites, type Step, type StepResult } from './sequence'

/** A node on the way to becoming an object. */
interface Node {
  id: string
  kind: 'table' | 'notebook' | 'pipeline'
  name: string
  /**
   * A raw file source rather than a Delta table. Kept beside `kind` rather than
   * inside it because `kind === 'table'` is what assigns the layer and the
   * column — a file belongs there, it is a data source — while the tag, and so
   * how it reads on the card, must say File.
   */
  isFile?: boolean
  /**
   * A table's lakehouse. Independent of whether the WORKSPACE resolved — a ref
   * naming `lh_bronze` and no workspace has a perfectly good lakehouse, and
   * treating the two as one answer is what put every table in a layer called
   * `Tables` under a holder called `Tables`.
   */
  lakehouse?: string
  /** A table's columns, which become its attributes. */
  columns: SandboxColumn[]
  /**
   * A step's I/O rows, which become ITS attributes — the tables it reads and
   * writes, exactly as the canvas card lists them. Without these a step
   * exported as a bare object and the model didn't look like the canvas it
   * came from; with them, an edge also lands on the row it belongs to rather
   * than on the object header.
   */
  io: IoRow[]
  /**
   * A pipeline's activities, each with the tables IT touched.
   *
   * Present only for a pipeline that actually ran something. When it is, `io`
   * is empty and these become the object's attributes instead: one Group per
   * activity, its I/O rows nested inside. A pipeline used to export as a flat
   * merge of every table it touched, which answered "what did this pipeline
   * touch" and lost "which notebook touched it" — and left the notebooks out
   * of the model entirely, even though they are the things doing the work.
   *
   * An Attribute with children IS a Group (see model/types.ts), so this needs
   * no new entity kind — and the viewer gives every group a twisty, so the
   * notebooks collapse for free.
   */
  groups?: IoGroup[]
  /** Step ordinal, for the property bag. Steps only. */
  ordinal?: number
  /** Workspace the node belongs to — a step's own, or a table's. */
  ws?: string
  /**
   * A table's canonical ref. The identity, kept apart from `name` (the leaf)
   * because two workspaces can hold a same-named table, and because the run's
   * column lineage is keyed by ref.
   */
  ref?: string
}

interface IoRow {
  table: string
  access: 'Read' | 'Write'
}

/** One activity inside a pipeline, and the tables it touched. */
interface IoGroup {
  name: string
  /** What to badge it as — `Notebook` for a notebook activity, else its type. */
  tag: string
  io: IoRow[]
}

interface Link {
  from: string
  to: string
  kind: 'read' | 'write'
  /** The table end of the link — used to find the step's I/O attribute. */
  table: string
  /**
   * Which activity group the step-side endpoint lives in; -1 when the step has
   * no groups. Part of the anchor key because the same table under two
   * activities is two rows, and an edge has to land on the right one.
   */
  group: number
}

const tableId = (name: string) => `t:${name.toLowerCase()}`
const stepId = (key: string) => `s:${key}`

/** Where a step's I/O attribute for one access lives. */
const ioKey = (nodeId: string, group: number, access: 'Read' | 'Write', table: string) =>
  `${nodeId}|${group}|${access}|${table}`
/** One column nested under that access — the step-side end of a column edge. */
const ioColKey = (io: string, column: string) => `${io}\0${column}`

/**
 * What to badge one activity of a pipeline as.
 *
 * A run entry knows only its name, so the activity list is what says whether it
 * was a notebook or something declarative like a Copy. Falls back to `Notebook`
 * when the activity can't be found: every run WAS a notebook before Copy
 * activities started contributing, so that is the honest default rather than a
 * blank badge.
 */
function activityTag(runName: string, activities?: FabricPipelineActivity[]): string {
  const activity = activities?.find((a) => a.name === runName)
  if (!activity) return 'Notebook'
  return activity.notebook_id ? 'Notebook' : activity.type || 'Notebook'
}

/**
 * Longest-path layering — a node sits one column right of its deepest input,
 * the same rule the flow canvas uses, so the model's layer order matches the
 * picture the sequence was exported from.
 */
function columnsOf(nodes: Node[], links: Link[]): Map<string, number> {
  const parents = new Map<string, string[]>()
  nodes.forEach((n) => parents.set(n.id, []))
  links.forEach((l) => parents.get(l.to)?.push(l.from))

  const col = new Map<string, number>()
  const visiting = new Set<string>()
  const walk = (id: string): number => {
    const seen = col.get(id)
    if (seen !== undefined) return seen
    if (visiting.has(id)) return 0 // defensive: a cycle must not hang the export
    visiting.add(id)
    const up = parents.get(id) ?? []
    const v = up.length ? 1 + Math.max(...up.map(walk)) : 0
    visiting.delete(id)
    col.set(id, v)
    return v
  }
  nodes.forEach((n) => walk(n.id))
  return col
}

/**
 * One column per owner — the `workspace` canvas layout, as layers.
 *
 * Ownership is the axis, so a medallion run that hops between two workspaces
 * gives two layers with edges crossing back and forth between them, which is
 * the honest picture of it. Columns are ordered by how early the owner appears,
 * so the first layer is still where the run starts.
 */
function ownerColumnsOf(nodes: Node[], links: Link[], refs: Record<string, SandboxTableRef>): Map<string, number> {
  const depth = columnsOf(nodes, links)
  const byId = new Map(nodes.map((n) => [n.id, n]))
  const lakeOf = (n: Node): string =>
    n.kind === 'table'
      ? refLakehouse(n.ref ?? n.name, refs)
      : refLakehouse(
          byId.get(links.find((l) => l.kind === 'write' && l.from === n.id)?.to ?? '')?.ref ?? '',
          refs,
        )
  const key = (n: Node) => n.ws || (lakeOf(n) ? `lh:${lakeOf(n)}` : '')

  const first = new Map<string, { depth: number; at: number }>()
  nodes.forEach((n, i) => {
    const k = key(n)
    const d = depth.get(n.id) ?? 0
    const prev = first.get(k)
    if (!prev) first.set(k, { depth: d, at: i })
    else prev.depth = Math.min(prev.depth, d)
  })
  const index = new Map(
    [...first.entries()]
      // An unknown owner sorts last: it is the least trustworthy column and
      // should not head the model.
      .sort(([ka, a], [kb, b]) => (ka === '' ? 1 : kb === '' ? -1 : a.depth - b.depth || a.at - b.at))
      .map(([k], i) => [k, i]),
  )
  return new Map(nodes.map((n) => [n.id, index.get(key(n)) ?? 0]))
}

/**
 * The pipeline a step was reached through, from the name the backend built.
 *
 * `expand_pipeline_activities` names an expanded step
 * `invoke pl_20_bronze / invoke pl_21_dims / run nb_x`. Everything before the
 * last segment is the orchestration that reached it; the last segment is the
 * step itself. '' when the step was run directly and has no parent.
 */
function parentPipeline(name: string): string {
  const cut = name.lastIndexOf(' / ')
  return cut === -1 ? '' : name.slice(0, cut)
}

/** The step's own name, with the orchestration prefix removed. */
function leafName(name: string): string {
  const cut = name.lastIndexOf(' / ')
  return cut === -1 ? name : name.slice(cut + 3)
}

const uniq = (xs: (string | undefined)[]): string[] => [
  ...new Set(xs.filter((x): x is string => !!x)),
]

/**
 * Medallion stage names, in the order data moves through them. Kept in step
 * with the canvas's `STAGE_ORDER` — the model is meant to be the picture the
 * user pressed the button on, so the two must rank a lakehouse the same way.
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
function stageRank(name: string): number {
  const low = name.toLowerCase()
  let best = -1
  STAGE_ORDER.forEach((s, i) => {
    if (best < 0 && new RegExp(`(^|[^a-z])${s}([^a-z]|$)`).test(low)) best = i
  })
  return best
}

/**
 * A layer label built from what is in the layer, not from its position.
 *
 * `Source tables`/`Tables`/`Output tables` describe where a column sits in a
 * layout. A workspace name describes what the thing IS, and still means
 * something a week later.
 *
 * A mixed layer names every workspace in it rather than picking one, since
 * silently choosing would misattribute the rest.
 */
function semanticLayerName(inColumn: Node[]): string {
  // The WORKSPACE and nothing else. The lakehouse is not a layer and does not
  // belong in a layer's name — it is an object inside one, holding its tables.
  // Naming the layer `Platform · lh_bronze` said the same thing twice and made
  // a layer look like it existed per lakehouse, which is the shape this is
  // deliberately not.
  const ws = uniq(inColumn.map((n) => n.ws))
  if (ws.length) return ws.join(' + ')
  // Nothing in the layer resolved a workspace — which is the normal case for a
  // notebook addressing its own lakehouse by name. Name the layer for the
  // lakehouses in it rather than 'Tables': it is the most specific true thing
  // left, and 'Tables' told the reader nothing at all.
  const lakes = uniq(inColumn.map((n) => n.lakehouse))
  if (lakes.length) return lakes.join(' + ')
  return inColumn.some((n) => n.kind === 'table') ? 'Tables' : 'Notebooks & pipelines'
}

/** Band label for a column, matching the canvas: all-tables columns say so. */
function layerName(inColumn: Node[], col: number, lastCol: number): string {
  if (!inColumn.length) return `Layer ${col + 1}`
  const tables = inColumn.filter((n) => n.kind === 'table').length
  if (tables !== inColumn.length) return 'Notebooks & pipelines'
  if (col === 0) return 'Source tables'
  return col === lastCol ? 'Output tables' : 'Tables'
}

/**
 * Which read table a source column came from.
 *
 * Prefer what the engine SAID. Both engines now report `from_table` outright —
 * sqlglot qualifies every column against the schemas, and Spark matches each
 * referenced attribute's Catalyst exprId to the relation that produced it — so
 * there is usually nothing to infer, and what they say is right in exactly the
 * case the fallback below cannot be: a join where both sides carry the same
 * column name.
 *
 * The fallback survives for the columns that are genuinely unowned (one
 * resolving to a CTE or subquery rather than a base table) and for models saved
 * before the engines filled the field. An ambiguous name (two inputs both have
 * `id`) stays unresolved rather than guessed — a wrong column edge is worse
 * than a missing one, and the table-level edge still carries the lineage.
 */
function resolveSourceTable(
  flow: SandboxColumnFlow,
  readTables: string[],
  schemas: Map<string, SandboxColumn[]>,
): string | undefined {
  if (flow.from_table) return flow.from_table
  const hits = readTables.filter((t) =>
    (schemas.get(t) ?? []).some((c) => c.name === flow.from_column),
  )
  return hits.length === 1 ? hits[0] : undefined
}

/**
 * What the port carries across.
 *
 * Everything defaults ON — the port's job is to reproduce the run, and someone
 * who never opens the settings should get the whole picture. The toggles exist
 * because a model is an authoring surface rather than a report: a user building
 * on top of a ported run may not want the sandbox's tags and provenance
 * competing with their own.
 *
 * All of them are SUBTRACTIVE, and none changes the SHAPE of the graph — the
 * same objects and the same table-level edges come across either way. A model
 * ported with everything off is the same lineage, just barer.
 */
export interface PortOptions {
  /** The Notebook/Pipeline/Table tag badged on each object's card. */
  kindTags: boolean
  /** `Access` on a step's I/O rows — what draws the R/W badge in the viewer. */
  accessTags: boolean
  /** Provenance: `Source`, `Step` and `Workspace` on objects, `Source` on edges. */
  provenance: boolean
  /** Table columns as attributes. Off also means no column-level edges. */
  columns: boolean
  /**
   * Join each column under an access to the same column on the table.
   *
   * Where the run resolved a derivation for a written column, it rides on this
   * edge as `Derives`/`Transform` rather than as an edge of its own between the
   * two tables — see `flowOf`.
   */
  columnEdges: boolean
  /**
   * How the model is divided into layers.
   *
   * `view` keeps the historical behaviour — follow whichever canvas view the
   * user was looking at, so the exported model matches the picture they pressed
   * the button on.
   *
   * The other two name layers after what is in them rather than after a
   * position in a computed layout, and group tables under the lakehouse that
   * holds them. Each mirrors the canvas view of the same name — pressing
   * Create model from a view exports the arrangement on screen:
   *
   *   `workspace` — one layer per OWNER: the workspace, or the lakehouse
   *     standing in for it where no workspace resolved. The most truthful about
   *     ownership, and the reason it is not the default: a medallion run
   *     crosses between owners on every hop, so some writes point back into the
   *     layer on their left.
   *
   *   `stages`  — the same layers, with the lakehouses inside each one ordered
   *     by medallion stage: landing, bronze, silver, gold. The whole medallion
   *     is ONE layer because it is one workspace; the stage is an ordering
   *     within it, not an owner of its own.
   */
  layout?: ModelLayout
}

export type ModelLayout = 'view' | 'workspace' | 'stages'

export const DEFAULT_PORT_OPTIONS: PortOptions = {
  kindTags: true,
  accessTags: true,
  provenance: true,
  columns: true,
  columnEdges: true,
  layout: 'view',
}

export interface ToModelResult {
  model: LineageModel
  /** Counts for the confirmation the caller shows. */
  stats: {
    layers: number
    objects: number
    attributes: number
    transitions: number
    /** Column-to-column LINEAGE the run resolved — a measure of the engine. */
    columnEdges: number
    /** An access's columns joined to the table's own. Mechanical, not resolved. */
    accessColumnEdges: number
  }
}

export function sequenceToModel(
  steps: Step[],
  results: Map<string, StepResult>,
  name: string,
  /**
   * Which arrangement to export — the canvas view the user was looking at.
   * `flow` gives one layer per dependency depth; `sequence` gives exactly two,
   * Tables then Notebooks & pipelines, with the steps in run order. The graph
   * is identical either way; only the layering differs, and a write in the
   * sequence layout therefore points back into the layer on its left.
   */
  view: 'flow' | 'sequence' = 'flow',
  options: PortOptions = DEFAULT_PORT_OPTIONS,
): ToModelResult {
  // Columns off leaves nothing for a column edge to land on, so it implies
  // column edges off. Enforced here rather than in the settings UI: the option
  // must mean the same thing however the caller assembled it.
  const wantColumnEdges = options.columns && options.columnEdges
  const nodes: Node[] = []
  const links: Link[] = []
  const byId = new Map<string, Node>()
  const schemas = new Map<string, SandboxColumn[]>()

  // Schemas first: a table's columns may be resolved by any run that touched it.
  for (const res of results.values())
    for (const run of res.runs)
      for (const [table, cols] of Object.entries(run.result?.table_schemas ?? {}))
        if (cols.length && !schemas.get(table)?.length) schemas.set(table, cols)

  // Ref -> parts, merged across every step, so one table is one card with one
  // workspace however many notebooks touched it.
  const refs: Record<string, SandboxTableRef> = Object.assign(
    {},
    ...steps.map((s) => stepTables(results.get(s.key))),
  )

  /**
   * `to_table\0to_column` -> where that column came from, and via which step.
   *
   * Column lineage is carried as PROPERTIES on the write-side column edge, not
   * as an edge of its own between the two tables. As an edge it was the one
   * transition in the model that did not run table -> step -> table: in the
   * flow view it leapt from a source table straight to an output table, past
   * the notebooks layer that actually performs the derivation, and in the
   * sequence view — where every table shares one layer — it doubled back from
   * gold to silver underneath the column it belonged to.
   *
   * Nothing is lost by demoting it. The derivation is still recorded, on the
   * edge into the column it produced, and the route it took is now traversable
   * through the step rather than around it.
   */
  const flowOf = new Map<string, { from: string; column: string; transform?: string; via: string }>()

  for (const [key, res] of results) {
    const step = steps.find((s) => s.key === key)
    if (!step) continue
    for (const run of res.runs) {
      const reads = run.result?.reads ?? []
      for (const f of run.result?.column_lineage ?? []) {
        const k = `${f.to_table}\0${f.to_column}`
        if (flowOf.has(k)) continue
        // An unattributable source stays out entirely rather than being
        // guessed at — the same rule the edge followed.
        const from = resolveSourceTable(f, reads, schemas)
        if (!from) continue
        flowOf.set(k, { from, column: f.from_column, transform: f.transform ?? undefined, via: step.name })
      }
    }
  }

  const ensureTable = (ref: string): string => {
    const id = tableId(ref)
    if (!byId.has(id)) {
      const n: Node = {
        id,
        kind: 'table',
        name: refLabel(ref, refs),
        ref,
        ws: refWorkspace(ref, refs),
        lakehouse: refLakehouse(ref, refs),
        isFile: refKind(ref, refs) === 'file',
        columns: schemas.get(ref) ?? [],
        io: [],
      }
      nodes.push(n)
      byId.set(id, n)
    }
    return id
  }

  steps.forEach((step, i) => {
    const id = stepId(step.key)
    const res = results.get(step.key)
    // A pipeline groups by activity; a notebook step IS the notebook, so it has
    // nothing to nest under and keeps the flat merged list.
    const groups: IoGroup[] | undefined =
      step.kind === 'pipeline' && res?.runs.length
        ? res.runs.map((run) => ({
            name: run.name,
            tag: activityTag(run.name, res.activities),
            io: [
              ...(run.result?.reads ?? []).map((t) => ({ table: t, access: 'Read' as const })),
              ...(run.result?.writes ?? []).map((t) => ({ table: t, access: 'Write' as const })),
            ],
          }))
        : undefined

    const io: IoRow[] = groups
      ? []
      : [
          ...stepReads(res).map((t) => ({ table: t, access: 'Read' as const })),
          ...stepWrites(res).map((t) => ({ table: t, access: 'Write' as const })),
        ]

    const n: Node = {
      id,
      kind: step.kind,
      name: step.name,
      columns: [],
      io,
      groups,
      ordinal: i + 1,
      // The run echoes the notebook's own workspace NAME; `step.ws` is the GUID
      // the tree navigates by. The name is what tables carry, so comparing the
      // two is what makes a cross-workspace row detectable.
      ws: res?.runs.find((r) => r.result?.workspace)?.result?.workspace || step.ws,
    }
    nodes.push(n)
    byId.set(id, n)

    // One link per ACCESS, not per distinct table: a table written by one
    // activity and read by the next is two accesses, and merging them would put
    // both edges on whichever row happened to come first.
    const emit = (row: IoRow, group: number) => {
      if (row.access === 'Read')
        links.push({ from: ensureTable(row.table), to: id, kind: 'read', table: row.table, group })
      else links.push({ from: id, to: ensureTable(row.table), kind: 'write', table: row.table, group })
    }
    if (groups) groups.forEach((g, gi) => g.io.forEach((row) => emit(row, gi)))
    else io.forEach((row) => emit(row, -1))
  })

  // --- build the model --------------------------------------------------
  const model = emptyModel(name)
  const props: LineageModel['properties'] = {}
  const attrIdOf = new Map<string, EntityId>() // `${table}\0${column}` -> attribute id
  const ioAttrOf = new Map<string, EntityId>() // `${stepId}|${access}|${table}` -> attribute id
  const ioColAttrOf = new Map<string, EntityId>() // `${ioKey}\0${column}` -> attribute id
  const objIdOf = new Map<string, EntityId>()

  // Two fixed columns in the sequence view; dependency depth in the flow view.
  // Node order already has steps in run order and tables in first-touch order,
  // so the split alone gives "step 1 on top".
  const layout: ModelLayout = options.layout ?? 'view'
  //: Layers named for the workspace, tables gathered under their lakehouse.
  const semantic = layout !== 'view'

  const col = new Map<string, number>()
  if (semantic)
    // One layer per OWNER — the workspace, or the lakehouse standing in for it
    // where no workspace resolved. Both semantic layouts share it: a medallion
    // platform holds ALL its lakehouses, however many stages they span, and the
    // engineering workspace holds the pipelines that move data between them.
    // `stages` used to give a layer per medallion stage, which split one
    // workspace across four layers and drew the same workspace band repeatedly;
    // it now orders the lakehouses INSIDE its layer by stage instead.
    for (const [id, c] of ownerColumnsOf(nodes, links, refs)) col.set(id, c)
  else if (view === 'sequence')
    // Steps left, tables right — the sequence canvas, exported as it looks.
    nodes.forEach((n) => col.set(n.id, n.kind === 'table' ? 1 : 0))
  else for (const [id, c] of columnsOf(nodes, links)) col.set(id, c)
  const lastCol = Math.max(0, ...col.values())

  const layers: Layer[] = []
  for (let c = 0; c <= lastCol; c++) {
    const inColumn = nodes.filter((n) => col.get(n.id) === c)
    if (!inColumn.length) continue
    // A steps layer in the `stages` layout whose workspace never resolved is
    // named for what it FEEDS, matching the canvas band. Where the workspace IS
    // known it still wins: a layer is named for what it is, and a notebook's
    // workspace is what it is. This is only the fallback that keeps every steps
    // layer from being called 'Notebooks & pipelines'.
    const feeds =
      layout === 'stages' && inColumn.every((n) => n.kind !== 'table' && !n.ws)
        ? uniq(
            links
              .filter((l) => l.kind === 'write' && inColumn.some((n) => n.id === l.from))
              .map((l) => refLakehouse(l.table, refs)),
          )
        : []
    const name = feeds.length
      ? `Into ${feeds.join(' + ')}`
      : semantic
        ? semanticLayerName(inColumn)
        : view === 'sequence'
          ? c === 0
            ? 'Notebooks & pipelines'
            : 'Tables'
          : layerName(inColumn, c, lastCol)
    const layer: Layer = { id: crypto.randomUUID(), name, objects: [] }
    //: lakehouse name -> its tables, collected while walking this layer's nodes
    //  and wrapped into one object per lakehouse once the layer is done.
    const grouped = new Map<string, ModelObject[]>()
    //: pipeline path -> its holder object, so `a / b / c` nests c inside b
    //  inside a. Keyed by the FULL path: one pipeline invoked twice from
    //  different parents is two holders, which is what the run did.
    const pipelines = new Map<string, ModelObject>()
    /**
     * The holder for one orchestration path, creating its ancestors as needed.
     *
     * A master pipeline that invokes four others used to export as four
     * top-level objects named `invoke pl_00_master / invoke pl_20_bronze` — the
     * hierarchy was in the label rather than in the model. Now it is one object
     * with the children it actually invoked nested inside it.
     */
    const pipelineHolder = (path: string): ModelObject => {
      const existing = pipelines.get(path)
      if (existing) return existing
      const cut = path.lastIndexOf(' / ')
      const holder: ModelObject = {
        id: crypto.randomUUID(),
        name: cut === -1 ? path : path.slice(cut + 3),
        children: [],
      }
      pipelines.set(path, holder)
      if (options.kindTags) props[holder.id] = { [TAGS_KEY]: 'Pipeline' }
      // A ModelObject and an Attribute are the same shape, so a nested holder
      // is its parent's child verbatim — no second entity kind.
      if (cut === -1) layer.objects.push(holder)
      else pipelineHolder(path.slice(0, cut)).children.push(holder)
      return holder
    }
    for (const n of inColumn) {
      const object: ModelObject = { id: crypto.randomUUID(), name: n.name, children: [] }
      objIdOf.set(n.id, object.id)
      // A step's I/O rows become ITS attributes, mirroring its canvas card.
      // Without them a step exported as a bare object and the model did not
      // look like the canvas it came from.
      const ioAttr = (row: IoRow, group: number): Attribute => {
        const key = ioKey(n.id, group, row.access, row.table)
        // The access carries the table's columns beneath it, the same way the
        // canvas card does. That nesting is what gives a column edge somewhere
        // to leave FROM on the step side — without it the port drew a model
        // whose steps were a flat list of table names, which is not the picture
        // the user pressed the button on.
        const children: Attribute[] = options.columns
          ? (schemas.get(row.table) ?? []).map((c) => {
              const col: Attribute = { id: crypto.randomUUID(), name: c.name, children: [] }
              ioColAttrOf.set(ioColKey(key, c.name), col.id)
              if (c.type) props[col.id] = { 'Data type': c.type }
              return col
            })
          : []
        // `(staged)` distinguishes the copy of a table that sits INSIDE a step
        // from the real table in its lakehouse layer. Both are called `orders`
        // and they mean different things: one is the notebook's view of it at
        // that moment, the other is the table itself. Without the suffix a
        // reader sees the same name twice and reasonably assumes a duplicate.
        const attr: Attribute = {
          id: crypto.randomUUID(),
          name: semantic ? `${refLabel(row.table, refs)} (staged)` : refLabel(row.table, refs),
          children,
        }
        ioAttrOf.set(key, attr.id)
        // Only the Access LABEL is optional. The row itself is structure —
        // dropping it would put the edge back on the object header and the
        // model would stop looking like the canvas.
        // A row whose table lives in ANOTHER workspace is named as such: it is
        // the fact a reader most needs and cannot otherwise see on the row.
        const rowWs = refWorkspace(row.table, refs)
        const foreign = rowWs && n.ws && rowWs !== n.ws ? rowWs : ''
        if (options.accessTags || foreign)
          props[attr.id] = {
            ...(options.accessTags ? { Access: row.access } : {}),
            ...(foreign ? { Workspace: foreign } : {}),
          }
        return attr
      }

      /**
       * One step's rows, as ONE staged hop where it both reads and writes.
       *
       * A notebook reading `customers_raw` from lh_landing and writing
       * `customers` to lh_bronze is a single move, and exporting it as two
       * unrelated rows broke the trace exactly where it should be tightest: the
       * reader saw a row that ends and another that begins, with nothing saying
       * they are the same hop. Wrapped, the pair reads `customers_raw →
       * customers` and the lineage zig-zags smoothly between the two layers.
       *
       * The rows themselves are untouched inside it, so every edge still lands
       * on the access it belongs to — this adds a level, it does not merge.
       */
      const stagedRows = (rows: IoRow[], group: number): Attribute[] => {
        const attrs = rows.map((row) => ioAttr(row, group))
        const label = (access: IoRow['access']) =>
          uniq(rows.filter((r) => r.access === access).map((r) => refLabel(r.table, refs)))
        const [reads, writes] = [label('Read'), label('Write')]
        if (!semantic || !reads.length || !writes.length) return attrs
        const hop: Attribute = {
          id: crypto.randomUUID(),
          name: `${reads.join(', ')} → ${writes.join(', ')}`,
          children: attrs,
        }
        // Tagged, so the hop is obvious on the card rather than inferred from
        // the arrow in its name.
        if (options.kindTags) props[hop.id] = { [TAGS_KEY]: 'Staged' }
        return [hop]
      }

      if (n.groups) {
        // One Group per activity, its tables inside. The notebooks are now IN
        // the model rather than merged away, and because an Attribute with
        // children is a Group, the viewer collapses them with no new machinery.
        n.groups.forEach((g, gi) => {
          const group: Attribute = {
            id: crypto.randomUUID(),
            name: g.name,
            children: stagedRows(g.io, gi),
          }
          // Tagged, not just propertied: a tag is what the viewer badges on the
          // row, so a notebook reads as one at a glance — the same reasoning as
          // the object kind tags below.
          if (options.kindTags) props[group.id] = { [TAGS_KEY]: g.tag }
          object.children.push(group)
        })
      } else {
        object.children.push(...stagedRows(n.io, -1))
      }
      if (options.columns)
        for (const column of n.columns) {
          const attr: Attribute = { id: crypto.randomUUID(), name: column.name, children: [] }
          // Keyed by the REF, not the display name. The column-lineage lookup
          // below uses `f.to_table`, which is always a canonical ref
          // (`Analytics/Silver/silver_orders`), while `n.name` is the leaf
          // label (`silver_orders`). Those coincide only for bare unqualified
          // refs — which is what a hand-written fixture uses and what a real
          // Fabric run never produces. Keyed by name, every lookup missed and
          // EVERY column edge was silently dropped from a real model: the
          // columns still drew on the cards, so the loss was invisible.
          attrIdOf.set(`${n.ref ?? n.name}\0${column.name}`, attr.id)
          if (column.type) props[attr.id] = { 'Data type': column.type }
          object.children.push(attr)
        }
      // The kind goes in as a TAG, not just a property: a tag is what the
      // viewer badges on the card, so an object reads as a notebook at a
      // glance instead of only under inspection.
      const bag: Record<string, string> = {
        ...(options.kindTags
          ? {
              [TAGS_KEY]: n.isFile
                ? 'File'
                : n.kind === 'table'
                  ? 'Table'
                  : n.kind === 'pipeline'
                    ? 'Pipeline'
                    : 'Notebook',
            }
          : {}),
        ...(options.provenance
          ? {
              Source: 'Fabric sandbox',
              ...(n.ordinal ? { Step: String(n.ordinal) } : {}),
              ...(n.ws ? { Workspace: n.ws } : {}),
            }
          : {}),
      }
      // No empty bags: an entity with no properties should have no entry at
      // all, or the Inspector and the exporters have a row of blanks to skip.
      if (Object.keys(bag).length) props[object.id] = bag
      // In the semantic layouts a table is not a top-level object: the LAKEHOUSE
      // is, and its tables hang beneath it. Held back here and wrapped below.
      //
      // This costs nothing to wire, because a ModelObject and an Attribute are
      // the same shape (`{id, name, children}`) and a Transition may point at
      // either — so the object built above becomes the attribute verbatim, and
      // `objIdOf` keeps addressing it by the same id. No edge has to be rebuilt.
      if (semantic && n.kind === 'table') {
        const lake = refLakehouse(n.ref ?? n.name, refs) || 'Tables'
        ;(grouped.get(lake) ?? grouped.set(lake, []).get(lake)!).push(object)
      } else if (semantic && parentPipeline(n.name)) {
        // A notebook reached through a pipeline belongs UNDER that pipeline.
        // `expand_pipeline_activities` names it `invoke pl_20_bronze / … / run
        // nb`, so the prefix is the orchestration the backend already resolved
        // — no second traversal, and one pipeline invoked twice stays two
        // groups because the whole prefix is the key.
        object.name = leafName(n.name)
        pipelineHolder(parentPipeline(n.name)).children.push(object)
      } else layer.objects.push(object)
    }
    // Lakehouses in medallion order in the `stages` layout — the stage is what
    // that view is FOR, and with one layer per workspace it is the order of the
    // objects inside it that carries it. Unranked lakehouses keep their
    // first-touch order, after the ones that name a stage.
    const lakes = [...grouped.keys()]
    if (layout === 'stages')
      lakes.sort((a, b) => (stageRank(a) + 1 || Infinity) - (stageRank(b) + 1 || Infinity))
    for (const lake of lakes) {
      const holder: ModelObject = { id: crypto.randomUUID(), name: lake, children: grouped.get(lake)! }
      if (options.kindTags) props[holder.id] = { [TAGS_KEY]: 'Lakehouse' }
      layer.objects.push(holder)
    }
    layers.push(layer)
  }

  const transitions: Transition[] = []
  const addTransition = (source: EntityId, target: EntityId, bag: Record<string, string>) => {
    const t: Transition = { id: crypto.randomUUID(), source, target }
    transitions.push(t)
    if (Object.keys(bag).length) props[t.id] = bag
    return t
  }

  // Declared before the helper that increments them. Counted apart on purpose:
  // `columnEdges` answers "how much column lineage did the run actually
  // resolve", which is a measure of the ENGINE and drops to zero on an
  // ambiguous join. Access edges are mechanical — one per column per access,
  // always — so folding them in would mask exactly the signal that number
  // exists to carry.
  let columnEdges = 0
  let accessColumnEdges = 0

  /**
   * The column edges belonging to one access: each column under the step's row,
   * across to the same column on the table.
   *
   * The identity pairing the canvas draws, and a different claim from the
   * `column_lineage` edges below — this one says "this access moved this
   * column", those say "this column derives from that one". Both are column to
   * column, so both answer to the same toggle.
   *
   * The table-level transition is emitted regardless and never replaced: it is
   * the structural link the layering and every consumer read, and PortOptions
   * promises the shape of the graph does not depend on these toggles. The
   * canvas can hide it behind the column edges because it is redrawing the same
   * graph; a model has to carry it.
   */
  const columnEdgesFor = (l: Link, access: 'Read' | 'Write', bag: Record<string, string>) => {
    if (!wantColumnEdges) return
    const stepNode = l.kind === 'read' ? l.to : l.from
    const io = ioKey(stepNode, l.group, access, l.table)
    for (const c of schemas.get(l.table) ?? []) {
      const onStep = ioColAttrOf.get(ioColKey(io, c.name))
      const onTable = attrIdOf.get(`${l.table}\0${c.name}`)
      if (!onStep || !onTable) continue
      // Where a written column came from, on the edge that produces it. The
      // read side gets nothing: a column arriving from a table has no
      // derivation of its own to report.
      const flow = l.kind === 'write' ? flowOf.get(`${l.table}\0${c.name}`) : undefined
      const derived = flow
        ? {
            Derives: `${refLabel(flow.from, refs)}.${flow.column}`,
            ...(flow.transform ? { Transform: flow.transform } : {}),
            ...(options.provenance ? { Via: flow.via } : {}),
          }
        : {}
      if (flow) columnEdges++
      // Sequence view runs every edge step -> table, for the same reason the
      // table-level ones do; flow view keeps true direction.
      if (view === 'sequence' || l.kind === 'write')
        addTransition(onStep, onTable, { ...bag, ...derived })
      else addTransition(onTable, onStep, bag)
      accessColumnEdges++
    }
  }

  for (const l of links) {
    const access = l.kind === 'read' ? 'Read' : 'Write'
    const bag = {
      ...(options.provenance ? { Source: 'Fabric sandbox' } : {}),
      ...(options.accessTags ? { Access: access } : {}),
    }

    if (view === 'sequence') {
      // Two layers, steps on the left: EVERY transition runs step -> table, so
      // each one leaves a notebook on the left and lands on a table on the
      // right. A read is data moving right-to-left in reality, and orienting it
      // that way would draw it looping back under the whole tables column —
      // which is the thing this view exists to avoid. The direction of travel
      // is carried by `Access` and by which row it leaves from, not by the
      // arrow. The Flow view keeps true edge direction.
      const stepNode = l.kind === 'read' ? l.to : l.from
      const tableNode = l.kind === 'read' ? l.from : l.to
      const source = ioAttrOf.get(ioKey(stepNode, l.group, access, l.table)) ?? objIdOf.get(stepNode)
      const target = objIdOf.get(tableNode)
      if (source && target) addTransition(source, target, bag)
      columnEdgesFor(l, access, bag)
      continue
    }

    // Flow view: true direction, anchored on the step's own I/O row.
    const stepNode = l.kind === 'read' ? l.to : l.from
    const io = ioAttrOf.get(ioKey(stepNode, l.group, access, l.table))
    const source = l.kind === 'read' ? objIdOf.get(l.from) : (io ?? objIdOf.get(l.from))
    const target = l.kind === 'read' ? (io ?? objIdOf.get(l.to)) : objIdOf.get(l.to)
    if (source && target) addTransition(source, target, bag)
    columnEdgesFor(l, access, bag)
  }

  // Counted through the nesting, not just the top level: a pipeline's tables
  // now sit inside its activity groups, and counting only direct children would
  // report a model with fewer attributes than it has.
  const countAttrs = (list: Attribute[]): number =>
    list.reduce((n, a) => n + 1 + countAttrs(a.children), 0)
  const attributes = layers.reduce(
    (n, l) => n + l.objects.reduce((m, o) => m + countAttrs(o.children), 0),
    0,
  )
  const objects = layers.reduce((n, l) => n + l.objects.length, 0)

  return {
    model: { ...model, layers, transitions, properties: props },
    stats: {
      layers: layers.length,
      objects,
      attributes,
      transitions: transitions.length,
      columnEdges,
      accessColumnEdges,
    },
  }
}

/** A default model name: the sequence's first step, plus how many followed. */
export function defaultModelName(steps: Step[]): string {
  if (!steps.length) return 'Sandbox lineage'
  const [first, ...rest] = steps
  return rest.length ? `${first.name} +${rest.length}` : first.name
}
