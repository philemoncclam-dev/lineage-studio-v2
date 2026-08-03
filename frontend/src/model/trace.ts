// Lineage trace: everything that flows into, out of, or through a selection.
//
// The Views filter answers "which entities look like this"; a trace answers
// "which entities are CONNECTED to this", which no combination of name, tag or
// property can express. They narrow the viewer through the same path — a trace
// produces a match set, and the viewer hides what is not in it — so tracing
// costs the render nothing new.
//
// Reachability defaults to undirected. "Leads to that or goes through that" is
// both halves of a lineage question: where a column came from AND what it went
// on to feed, and walking one way only would answer half of it.
//
// But the halves are also separate questions people actually ask — "where does
// this number come from" is an audit, "what breaks if I drop this" is only ever
// downstream — and answering both at once buries the one you asked in the one
// you did not. So the direction is a parameter, with both as the default.

import { ancestorsOf, type ModelIndex } from './index'
import type { Attribute, EntityId, LineageModel } from './types'

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
export type TraceDirection = 'both' | 'up' | 'down'

export function traceFrom(
  index: ModelIndex,
  seeds: Iterable<EntityId>,
  direction: TraceDirection = 'both',
): ReadonlySet<EntityId> {
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

  // 2 — follow every transition touching the frontier, the requested way(s).
  while (frontier.length) {
    const id = frontier.pop()!
    const next: EntityId[] = []
    if (direction !== 'up') next.push(...(index.outgoing.get(id) ?? []))
    if (direction !== 'down') next.push(...(index.incoming.get(id) ?? []))
    for (const to of next)
      if (!reached.has(to)) {
        reached.add(to)
        frontier.push(to)
      }
  }

  // 3 — the cards and layers that hold what we found.
  const out = new Set<EntityId>(reached)
  for (const id of reached) for (const up of ancestorsOf(index, id)) out.add(up.id)
  return out
}

/**
 * The model with everything outside `keep` removed.
 *
 * Hiding and pruning are not the same thing, and a trace needs the second.
 * Dropping cards and rows at render time leaves their SPACE behind — the layout
 * is computed from the whole model, so a traced canvas came out as the original
 * canvas with holes punched in it: full-height cards showing two rows, columns
 * of empty space where unrelated tables used to be, and the traced entities as
 * far apart as they ever were. That is the opposite of what a trace is for.
 *
 * Laying out a pruned model instead makes every card shrink to the rows that
 * survived and every column close up behind what left, so the chain reads as
 * one compact run.
 *
 * The pruned model is for LAYOUT AND DISPLAY ONLY. Edits still apply to the
 * real one — ids are unchanged, so anything selected while tracing still refers
 * to the same entity.
 */
export function pruneModel(model: LineageModel, keep: ReadonlySet<EntityId>): LineageModel {
  const keepAttrs = (attrs: Attribute[]): Attribute[] =>
    attrs
      .filter((a) => keep.has(a.id))
      .map((a) => ({ ...a, children: keepAttrs(a.children) }))

  const layers = model.layers
    .filter((l) => keep.has(l.id))
    .map((l) => ({
      ...l,
      objects: l.objects
        .filter((o) => keep.has(o.id))
        .map((o) => ({ ...o, children: keepAttrs(o.children) })),
    }))
    // A layer that kept nothing is an empty column, and an empty column still
    // takes a band and a slot on the canvas. Nothing is being said by it.
    .filter((l) => l.objects.length > 0)

  return {
    ...model,
    layers,
    // Both endpoints, for the reason `visibleTransitions` gives: an edge into a
    // row that is no longer drawn hangs in space pointing at nothing.
    transitions: model.transitions.filter((t) => keep.has(t.source) && keep.has(t.target)),
  }
}
