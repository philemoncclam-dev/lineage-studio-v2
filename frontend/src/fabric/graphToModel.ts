// Workspace lineage -> the Modeling canvas.
//
// The backend's `/fabric/workspaces/{id}/lineage` returns an item-level graph
// (see backend/app/fabric/workspace_lineage.py). This turns it into the same
// `LineageModel` the Modeling canvas already draws, so the Fabric-style view
// needs no second renderer, no second layout and no second hit-tester — and it
// inherits trace, search, collapse and export for free.
//
// The mapping, and why it is this one:
//   layer     = a dependency column, by longest path — so every arrow points
//               right, which is what makes Fabric's lineage tab readable
//   object    = a Fabric ITEM: a lakehouse, notebook, pipeline, or an item we
//               have no reader for
//   attribute = a table inside its lakehouse
//
// Tables as ROWS rather than cards is the load-bearing choice. Collapse the
// lakehouse cards and you have Fabric's view exactly — one box per item, arrows
// between them — because `resolveAnchor` already re-points an edge from a hidden
// row onto its card. Expand one and the same picture becomes table lineage. Two
// readings, one model, no mode flag.

import type { LineageGraph, LineageNode } from '../api'
import type { Attribute, Layer, LineageModel, ModelObject, Transition } from '../model/types'
import { emptyModel } from '../model/store'
import { TAGS_KEY } from '../model/tags'
import { longestPathColumns } from './depth'

/** Which card an entity is drawn on: a table's lakehouse, or the item itself. */
function ownerOf(node: LineageNode, byId: Map<string, LineageNode>): string {
  if (node.kind !== 'table') return node.id
  const parent = node.parent_id ? byId.get(node.parent_id) : undefined
  return parent?.kind === 'lakehouse' ? parent.id : node.id
}

/** The badge an item card wears — what Fabric would show as its type icon. */
function tagOf(node: LineageNode): string {
  if (node.kind === 'item') return String(node.meta?.item_type ?? 'Item')
  if (node.kind === 'table' && node.meta?.inferred) return 'External'
  return node.kind.charAt(0).toUpperCase() + node.kind.slice(1)
}

export interface GraphToModelResult {
  model: LineageModel
  /** Items drawn with no dependencies known, so the UI can say why. */
  opaque: string[]
}

/**
 * One workspace's item graph as an editable model.
 *
 * The workspace node itself is dropped: it contains everything, so it would be
 * a card every other card points at, adding a column and saying nothing. Its
 * name becomes the model's instead.
 */
export function graphToModel(graph: LineageGraph, fallbackName = 'Workspace'): GraphToModelResult {
  const byId = new Map(graph.nodes.map((n) => [n.id, n]))
  const workspace = graph.nodes.find((n) => n.kind === 'workspace')
  const drawable = graph.nodes.filter((n) => n.kind !== 'workspace')

  // Cards are items; a table with no lakehouse (one referenced but never
  // catalogued) becomes its own card, since there is nothing to nest it in.
  const cardIds: string[] = []
  const rowsOf = new Map<string, LineageNode[]>()
  for (const node of drawable) {
    const owner = ownerOf(node, byId)
    if (owner === node.id) {
      if (!cardIds.includes(node.id)) cardIds.push(node.id)
    } else {
      const list = rowsOf.get(owner)
      if (list) list.push(node)
      else rowsOf.set(owner, [node])
    }
  }

  // Depth runs on the CARD graph, not the raw one: an edge into a table is a
  // dependency on its lakehouse as far as the columns are concerned, and
  // ranking tables independently would put two tables of one lakehouse in
  // different columns — which is not a thing a card can do.
  const links = graph.edges
    .map((e) => ({
      from: ownerOf(byId.get(e.source) ?? ({ id: e.source, kind: 'table' } as LineageNode), byId),
      to: ownerOf(byId.get(e.target) ?? ({ id: e.target, kind: 'table' } as LineageNode), byId),
    }))
    // A lakehouse whose table one of its own notebooks rewrites would otherwise
    // depend on itself, which is a cycle with no meaning.
    .filter((l) => l.from !== l.to)
  const depth = longestPathColumns(cardIds, links)

  const columns = [...new Set(cardIds.map((id) => depth.get(id) ?? 0))].sort((a, b) => a - b)
  const layers: Layer[] = columns.map((d) => ({
    id: `layer:${d}`,
    name: d === 0 ? 'Sources' : `Stage ${d}`,
    objects: cardIds
      .filter((id) => (depth.get(id) ?? 0) === d)
      .map((id): ModelObject => {
        const node = byId.get(id)!
        const children: Attribute[] = (rowsOf.get(id) ?? []).map((t) => ({
          id: t.id,
          name: t.name,
          children: [],
        }))
        return { id, name: node.name, children }
      }),
  }))

  // Endpoints are kept as the graph gave them — a table row id stays a table
  // row id. The canvas rolls the edge up to the card when the card is
  // collapsed, which is exactly the item-level reading; hard-coding the card
  // here would throw the table-level one away.
  const seen = new Set<string>()
  const transitions: Transition[] = []
  for (const e of graph.edges) {
    if (!byId.has(e.source) || !byId.has(e.target)) continue
    const key = `${e.source}->${e.target}`
    if (seen.has(key)) continue
    seen.add(key)
    transitions.push({ id: `tr:${key}`, source: e.source, target: e.target })
  }

  const properties: Record<string, Record<string, string>> = {}
  for (const node of drawable) {
    const bag: Record<string, string> = { [TAGS_KEY]: tagOf(node) }
    if (node.meta?.ref) bag.Ref = String(node.meta.ref)
    if (node.meta?.opaque) bag.Dependencies = 'not crawled'
    properties[node.id] = bag
  }

  return {
    model: {
      ...emptyModel(workspace?.name || fallbackName),
      layers,
      transitions,
      properties,
    },
    opaque: drawable.filter((n) => n.meta?.opaque).map((n) => n.name),
  }
}
