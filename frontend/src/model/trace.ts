// Lineage trace: everything that flows into, out of, or through a selection.
//
// The Views filter answers "which entities look like this"; a trace answers
// "which entities are CONNECTED to this", which no combination of name, tag or
// property can express. They narrow the viewer through the same path — a trace
// produces a match set, and the viewer hides what is not in it — so tracing
// costs the render nothing new.
//
// Reachability is undirected on purpose. "Leads to that or goes through that"
// is both halves of a lineage question: where a column came from AND what it
// went on to feed. Walking only downstream would answer half of it and quietly
// drop the upstream that explains the value.

import { ancestorsOf, type ModelIndex } from './index'
import type { EntityId } from './types'

/**
 * Every entity connected to `seeds`, plus the containers needed to draw them.
 *
 * Three passes, each earning its place:
 *
 *  1. **Down into the seeds.** Selecting a table means tracing the table, and a
 *     table's transitions hang off its COLUMNS — the object itself often has no
 *     edge at all. Seeding only what was clicked would trace a table to nothing.
 *  2. **Out along transitions**, both directions, transitively.
 *  3. **Up to the ancestors** of everything reached. A traced row whose object
 *     was dropped has no card to sit in, which is the floating-row bug the hide
 *     filter already guards against.
 *
 * Note the asymmetry between 1 and 3: descending applies only to the seeds, not
 * to everything the walk reaches. A trace that pulled in the whole schema of
 * every table it touched would come back with most of the model, which is the
 * one answer a trace must never give.
 */
export function traceFrom(index: ModelIndex, seeds: Iterable<EntityId>): ReadonlySet<EntityId> {
  const children = new Map<EntityId, EntityId[]>()
  for (const entry of index.entries.values()) {
    if (!entry.parentId) continue
    const list = children.get(entry.parentId)
    if (list) list.push(entry.id)
    else children.set(entry.parentId, [entry.id])
  }

  const reached = new Set<EntityId>()
  const frontier: EntityId[] = []

  // 1 — the seeds and everything inside them.
  const stack = [...seeds]
  while (stack.length) {
    const id = stack.pop()!
    if (reached.has(id) || !index.entries.has(id)) continue
    reached.add(id)
    frontier.push(id)
    for (const child of children.get(id) ?? []) stack.push(child)
  }

  // 2 — follow every transition touching the frontier, either way.
  while (frontier.length) {
    const id = frontier.pop()!
    for (const next of index.outgoing.get(id) ?? [])
      if (!reached.has(next)) {
        reached.add(next)
        frontier.push(next)
      }
    for (const next of index.incoming.get(id) ?? [])
      if (!reached.has(next)) {
        reached.add(next)
        frontier.push(next)
      }
  }

  // 3 — the cards and layers that hold what we found.
  const out = new Set<EntityId>(reached)
  for (const id of reached) for (const up of ancestorsOf(index, id)) out.add(up.id)
  return out
}
