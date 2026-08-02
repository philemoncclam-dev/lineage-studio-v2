// What "collapse all X" collapses.
//
// Separate from ModelViewer because it is the one part of the bulk fold with a
// rule in it — a group is an attribute that HAS children, at any depth — and a
// rule buried in a menu handler is a rule with no test.
import type { EntityId, LineageModel, Attribute } from './types'

/**
 * Every entity of one kind that can be folded.
 *
 * `groups` and `objects` are separate answers because they leave different
 * things on screen: folding the groups keeps every object and its top-level
 * rows, which reads structure; folding the objects keeps the layers and the
 * object names, which reads flow between them.
 */
export function foldTargets(model: LineageModel, kind: 'groups' | 'objects' | 'layers'): EntityId[] {
  if (kind === 'layers') return model.layers.map((l) => l.id)
  const objects = model.layers.flatMap((l) => l.objects)
  if (kind === 'objects') return objects.map((o) => o.id)
  // A childless attribute is a leaf — collapsing it would fold nothing and
  // leave a twisty on a row that has nothing under it.
  const groups = (list: readonly Attribute[]): EntityId[] =>
    list.flatMap((a) => (a.children.length ? [a.id, ...groups(a.children)] : []))
  return objects.flatMap((o) => groups(o.children))
}
