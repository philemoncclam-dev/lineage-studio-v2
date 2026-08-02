// Lineage, in sentences.
//
// The canvas answers "what is connected to what" to someone willing to follow a
// line. Most people reading a lineage model are not: they arrived with one of
// three questions — where did this come from, what happens if it changes, is it
// trustworthy — and a graph makes them derive the answer instead of reading it.
//
// Nothing here is new lineage. Every fact is already in the model: the
// transitions, and the property bag the sandbox port fills in (`Access`,
// `Derives`, `Transform`, `Via`, `Step`, `Workspace`, `Source`). This module
// only assembles them into statements, which is the part that was missing.
import { ancestorsOf, type ModelIndex } from './index'
import { tagsOf } from './tags'
import type { EntityId, LineageModel } from './types'

/** One upstream or downstream fact, as a sentence plus the entity it names. */
export interface Link {
  /** The other end — what to select when the reader clicks the line. */
  id: EntityId
  /** `customers_raw.email` — the other end, qualified by its object. */
  what: string
  /** Where it lives: `lh_landing · Platform`, or as much of that as is known. */
  where: string
  /** `unchanged`, `amount * 1.2`, `read by nb_22` — how it got across. */
  how?: string
}

export interface Explanation {
  /** `email`, `customers`, `nb_22_bronze_products`. */
  name: string
  /** What kind of thing it is, in words a reader outside the platform knows. */
  kind: string
  /** Where it sits: object, then layer. */
  where: string
  /** A one-line answer, used as the panel's lede. */
  headline: string
  upstream: Link[]
  downstream: Link[]
  /** Run provenance, when the sandbox port put it there. */
  facts: { label: string; value: string }[]
}

/**
 * The plain-language name for an entity's kind.
 *
 * Prefers the TAG, because the port writes what the thing actually was
 * (`Notebook`, `Lakehouse`, `Staged`) while the structural kind only knows
 * layer/object/attribute. `Staged` is the hop row: a step's own view of the
 * tables it moved, which is neither a table nor a column and reads as neither.
 */
const KIND_WORDS: Record<string, string> = {
  Table: 'table',
  File: 'raw file',
  Notebook: 'notebook',
  Pipeline: 'pipeline',
  Lakehouse: 'lakehouse',
  Staged: 'step',
}

function kindOf(model: LineageModel, index: ModelIndex, id: EntityId): string {
  const tag = tagsOf(model, id).find((t) => KIND_WORDS[t])
  if (tag) return KIND_WORDS[tag]
  const entry = index.entries.get(id)
  if (!entry) return 'entity'
  if (entry.kind === 'layer') return 'layer'
  if (entry.kind === 'object') return 'object'
  return entry.hasChildren ? 'group' : 'column'
}

/** `customers.email` — the entity, qualified by the object holding it. */
function qualify(index: ModelIndex, id: EntityId): string {
  const entry = index.entries.get(id)
  if (!entry) return '(deleted)'
  const parent = entry.objectId ? index.entries.get(entry.objectId) : null
  return parent && parent.id !== entry.id ? `${parent.name}.${entry.name}` : entry.name
}

/** `lh_bronze · Platform` — as much of the containing path as exists. */
function locate(index: ModelIndex, id: EntityId): string {
  const chain = ancestorsOf(index, id).map((a) => a.name)
  return chain.join(' · ')
}

/**
 * How one transition moved the value, from the properties the port wrote.
 *
 * `Derives` names the column it came from and `Transform` the expression that
 * produced it; with neither, an edge between two columns of the same name is a
 * straight copy, and saying "unchanged" is more useful than saying nothing.
 */
function how(model: LineageModel, index: ModelIndex, tid: EntityId, from: EntityId, to: EntityId): string | undefined {
  const bag = model.properties[tid] ?? {}
  if (bag.Transform) return bag.Transform
  if (bag.Derives) return `from ${bag.Derives}`
  const a = index.entries.get(from)
  const b = index.entries.get(to)
  if (a && b && a.name === b.name) return 'unchanged'
  return bag.Access ? bag.Access.toLowerCase() : undefined
}

/** Which transitions touch `id`, in each direction. */
function edgesOf(model: LineageModel, id: EntityId) {
  const out = model.transitions.filter((t) => t.source === id)
  const inc = model.transitions.filter((t) => t.target === id)
  return { out, inc }
}

export function explain(model: LineageModel, index: ModelIndex, id: EntityId): Explanation | null {
  const entry = index.entries.get(id)
  if (!entry) return null
  const kind = kindOf(model, index, id)
  const where = locate(index, id)
  const { out, inc } = edgesOf(model, id)

  const link = (tid: EntityId, other: EntityId): Link => ({
    id: other,
    what: qualify(index, other),
    where: locate(index, other),
    how: how(model, index, tid, id, other),
  })
  const upstream = inc.map((t) => link(t.id, t.source))
  const downstream = out.map((t) => link(t.id, t.target))

  const bag = model.properties[id] ?? {}
  const facts: { label: string; value: string }[] = []
  const step = bag.Step
  if (step) facts.push({ label: 'Runs', value: `step ${step} of the sequence` })
  if (bag.Workspace) facts.push({ label: 'Workspace', value: bag.Workspace })
  if (bag['Data type']) facts.push({ label: 'Type', value: bag['Data type'] })
  if (bag.Source) facts.push({ label: 'Recorded by', value: bag.Source })

  // The lede answers the question the reader came with, in one line. A thing
  // with no upstream is a source and says so — "nothing feeds this" is an
  // answer, and leaving it blank reads as an app that failed to load.
  const headline = upstream.length
    ? `${entry.name} is built from ${upstream.length} upstream ${upstream.length === 1 ? 'source' : 'sources'}${
        downstream.length ? `, and ${downstream.length} ${downstream.length === 1 ? 'thing depends' : 'things depend'} on it` : ''
      }.`
    : downstream.length
      ? `${entry.name} is a starting point — nothing feeds it, and ${downstream.length} ${
          downstream.length === 1 ? 'thing depends' : 'things depend'
        } on it.`
      : `${entry.name} has no lineage recorded — nothing feeds it and nothing reads it.`

  return { name: entry.name, kind, where, headline, upstream, downstream, facts }
}

/** What a change to one entity would reach, grouped by the thing that holds it. */
export interface Impact {
  /** Entities reachable downstream, not counting the subject or its own rows. */
  total: number
  /** One row per affected object: its name, where it lives, and what breaks in it. */
  objects: { id: EntityId; name: string; where: string; items: string[] }[]
  /** True when the walk stopped early — a cycle guard, not a real end. */
  truncated: boolean
}

/**
 * Everything downstream of `id`, following transitions FORWARDS only.
 *
 * The trace on the canvas is deliberately undirected — "where did this come
 * from and what does it feed" is one question when you are reading a graph.
 * "What breaks if I change this" is not: an upstream table is not at risk from
 * a change here, and including it turns a precise answer into a vague one.
 *
 * Starts from the entity AND its descendants, because changing a table means
 * changing its columns, and a table's transitions usually hang off its columns
 * rather than off the table itself.
 */
export function impactOf(index: ModelIndex, id: EntityId, limit = 2000): Impact {
  const children = new Map<EntityId, EntityId[]>()
  for (const entry of index.entries.values()) {
    if (!entry.parentId) continue
    const list = children.get(entry.parentId)
    if (list) list.push(entry.id)
    else children.set(entry.parentId, [entry.id])
  }

  const seeds = new Set<EntityId>()
  const stack = [id]
  while (stack.length) {
    const cur = stack.pop()!
    if (seeds.has(cur)) continue
    seeds.add(cur)
    for (const child of children.get(cur) ?? []) stack.push(child)
  }

  const reached = new Set<EntityId>()
  const frontier = [...seeds]
  let truncated = false
  while (frontier.length) {
    const cur = frontier.pop()!
    for (const next of index.outgoing.get(cur) ?? []) {
      if (seeds.has(next) || reached.has(next)) continue
      if (reached.size >= limit) {
        truncated = true
        break
      }
      reached.add(next)
      frontier.push(next)
    }
  }

  const byObject = new Map<EntityId, { name: string; where: string; items: string[] }>()
  for (const hit of reached) {
    const entry = index.entries.get(hit)
    if (!entry) continue
    // Group under the object, or under itself when the hit IS an object — a
    // list of forty column names with no card names above them is not an
    // answer anyone can act on.
    const holderId = entry.objectId ?? entry.id
    const holder = index.entries.get(holderId)
    if (!holder) continue
    const row = byObject.get(holderId) ?? { name: holder.name, where: locate(index, holderId), items: [] }
    if (hit !== holderId) row.items.push(entry.name)
    byObject.set(holderId, row)
  }

  return {
    total: reached.size,
    objects: [...byObject].map(([oid, row]) => ({ id: oid, ...row })),
    truncated,
  }
}
