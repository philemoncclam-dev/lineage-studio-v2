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
//   attribute = a table's column
//   transition = table->step (read), step->table (write), and column->column
//                where the run resolved it
import type { LineageModel, Layer, ModelObject, Attribute, Transition, EntityId } from '../model/types'
import { emptyModel } from '../model/store'
import { TAGS_KEY } from '../model/tags'
import {
  refLabel,
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
 * Prefer what the engine SAID. The sqlglot path qualifies every column against
 * the schemas and reports `from_table` outright, so there is nothing to infer —
 * and it is right in exactly the case the fallback below cannot be: a join
 * where both sides carry the same column name.
 *
 * Spark's plan analysis names the column but not its table, so for that engine
 * we still resolve against the schemas of the tables this run read. An ambiguous
 * name (two inputs both have `id`) stays unresolved rather than guessed — a
 * wrong column edge is worse than a missing one, and the table-level edge still
 * carries the lineage.
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
  /** Column-to-column transitions, where the run resolved them unambiguously. */
  columnEdges: boolean
}

export const DEFAULT_PORT_OPTIONS: PortOptions = {
  kindTags: true,
  accessTags: true,
  provenance: true,
  columns: true,
  columnEdges: true,
}

export interface ToModelResult {
  model: LineageModel
  /** Counts for the confirmation the caller shows. */
  stats: { layers: number; objects: number; attributes: number; transitions: number; columnEdges: number }
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

  const ensureTable = (ref: string): string => {
    const id = tableId(ref)
    if (!byId.has(id)) {
      const n: Node = {
        id,
        kind: 'table',
        name: refLabel(ref, refs),
        ref,
        ws: refWorkspace(ref, refs),
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
  const objIdOf = new Map<string, EntityId>()

  // Two fixed columns in the sequence view; dependency depth in the flow view.
  // Node order already has steps in run order and tables in first-touch order,
  // so the split alone gives "step 1 on top".
  const col = new Map<string, number>()
  if (view === 'sequence') nodes.forEach((n) => col.set(n.id, n.kind === 'table' ? 1 : 0))
  else for (const [id, c] of columnsOf(nodes, links)) col.set(id, c)
  const lastCol = Math.max(0, ...col.values())

  const layers: Layer[] = []
  for (let c = 0; c <= lastCol; c++) {
    const inColumn = nodes.filter((n) => col.get(n.id) === c)
    if (!inColumn.length) continue
    const name =
      view === 'sequence' ? (c === 0 ? 'Notebooks & pipelines' : 'Tables') : layerName(inColumn, c, lastCol)
    const layer: Layer = { id: crypto.randomUUID(), name, objects: [] }
    for (const n of inColumn) {
      const object: ModelObject = { id: crypto.randomUUID(), name: n.name, children: [] }
      objIdOf.set(n.id, object.id)
      // A step's I/O rows become ITS attributes, mirroring its canvas card.
      // Without them a step exported as a bare object and the model did not
      // look like the canvas it came from.
      const ioAttr = (row: IoRow, group: number): Attribute => {
        const attr: Attribute = { id: crypto.randomUUID(), name: refLabel(row.table, refs), children: [] }
        ioAttrOf.set(ioKey(n.id, group, row.access, row.table), attr.id)
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

      if (n.groups) {
        // One Group per activity, its tables inside. The notebooks are now IN
        // the model rather than merged away, and because an Attribute with
        // children is a Group, the viewer collapses them with no new machinery.
        n.groups.forEach((g, gi) => {
          const group: Attribute = {
            id: crypto.randomUUID(),
            name: g.name,
            children: g.io.map((row) => ioAttr(row, gi)),
          }
          // Tagged, not just propertied: a tag is what the viewer badges on the
          // row, so a notebook reads as one at a glance — the same reasoning as
          // the object kind tags below.
          if (options.kindTags) props[group.id] = { [TAGS_KEY]: g.tag }
          object.children.push(group)
        })
      } else {
        for (const row of n.io) object.children.push(ioAttr(row, -1))
      }
      if (options.columns)
        for (const column of n.columns) {
          const attr: Attribute = { id: crypto.randomUUID(), name: column.name, children: [] }
          attrIdOf.set(`${n.name}\0${column.name}`, attr.id)
          if (column.type) props[attr.id] = { 'Data type': column.type }
          object.children.push(attr)
        }
      // The kind goes in as a TAG, not just a property: a tag is what the
      // viewer badges on the card, so an object reads as a notebook at a
      // glance instead of only under inspection.
      const bag: Record<string, string> = {
        ...(options.kindTags
          ? {
              [TAGS_KEY]:
                n.kind === 'table' ? 'Table' : n.kind === 'pipeline' ? 'Pipeline' : 'Notebook',
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
      layer.objects.push(object)
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
      continue
    }

    // Flow view: true direction, anchored on the step's own I/O row.
    const stepNode = l.kind === 'read' ? l.to : l.from
    const io = ioAttrOf.get(ioKey(stepNode, l.group, access, l.table))
    const source = l.kind === 'read' ? objIdOf.get(l.from) : (io ?? objIdOf.get(l.from))
    const target = l.kind === 'read' ? (io ?? objIdOf.get(l.to)) : objIdOf.get(l.to)
    if (source && target) addTransition(source, target, bag)
  }

  // Column-level edges, where the run resolved them unambiguously.
  let columnEdges = 0
  for (const [key, res] of wantColumnEdges ? results : []) {
    const step = steps.find((s) => s.key === key)
    if (!step) continue
    for (const run of res.runs) {
      const flows = run.result?.column_lineage ?? []
      const reads = run.result?.reads ?? []
      for (const f of flows) {
        const targetAttr = attrIdOf.get(`${f.to_table}\0${f.to_column}`)
        if (!targetAttr) continue
        const fromTable = resolveSourceTable(f, reads, schemas)
        if (!fromTable) continue
        const sourceAttr = attrIdOf.get(`${fromTable}\0${f.from_column}`)
        if (!sourceAttr || sourceAttr === targetAttr) continue
        addTransition(sourceAttr, targetAttr, {
          ...(options.provenance ? { Source: 'Fabric sandbox', Via: step.name } : {}),
          ...(f.transform ? { Transform: f.transform } : {}),
        })
        columnEdges++
      }
    }
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
    stats: { layers: layers.length, objects, attributes, transitions: transitions.length, columnEdges },
  }
}

/** A default model name: the sequence's first step, plus how many followed. */
export function defaultModelName(steps: Step[]): string {
  if (!steps.length) return 'Sandbox lineage'
  const [first, ...rest] = steps
  return rest.length ? `${first.name} +${rest.length}` : first.name
}
