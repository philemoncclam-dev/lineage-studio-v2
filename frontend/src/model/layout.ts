// Geometry for the Model Viewer canvas.
//
// One pass produces every rectangle the viewer needs, and BOTH renderers read
// from it: the DOM layer draws cards/rows, the canvas layer draws transitions.
// Keeping a single source of geometry is what stops edges from drifting away
// from the rows they point at — the failure mode when each layer measures
// independently.
//
// Layout is pure and cheap enough to run on every model/collapse change.
// Coordinates are "world" units; pan and zoom are applied by the viewer.

import type { Attribute, EntityId, LineageModel } from './types'

export const LAYER_WIDTH = 300
/** Horizontal room between layer columns — this is where transitions are drawn. */
export const LAYER_GAP = 140
export const LAYER_COLLAPSED_WIDTH = 28
export const LAYER_HEADER_HEIGHT = 30
export const CARD_GAP = 14
export const CARD_HEADER_HEIGHT = 24
export const ROW_HEIGHT = 21
/** Left inset added per nesting level. */
export const INDENT = 12
export const CANVAS_PADDING = 40

export interface LayoutRow {
  id: EntityId
  name: string
  depth: number
  /** World-space top edge. */
  y: number
  hasChildren: boolean
  collapsed: boolean
}

export interface LayoutCard {
  id: EntityId
  layerId: EntityId
  name: string
  x: number
  y: number
  width: number
  height: number
  rows: LayoutRow[]
  collapsed: boolean
  /** Direct and total descendant counts, rendered as `3(26)`. */
  direct: number
  total: number
}

export interface LayoutLayer {
  id: EntityId
  name: string
  x: number
  width: number
  collapsed: boolean
  objectCount: number
}

/** Where a transition may attach. `cy` is the vertical centre of the row/header. */
export interface Anchor {
  left: number
  right: number
  cy: number
}

export interface Layout {
  layers: LayoutLayer[]
  cards: LayoutCard[]
  anchors: Map<EntityId, Anchor>
  width: number
  height: number
}

/** Flattens an attribute subtree into the rows that are actually visible. */
function flattenVisible(
  attrs: Attribute[],
  collapsed: ReadonlySet<EntityId>,
  depth: number,
  out: Omit<LayoutRow, 'y'>[],
): void {
  for (const attr of attrs) {
    const isCollapsed = collapsed.has(attr.id)
    out.push({
      id: attr.id,
      name: attr.name,
      depth,
      hasChildren: attr.children.length > 0,
      collapsed: isCollapsed,
    })
    if (!isCollapsed) flattenVisible(attr.children, collapsed, depth + 1, out)
  }
}

function totalDescendants(attrs: Attribute[]): number {
  let n = 0
  for (const a of attrs) n += 1 + totalDescendants(a.children)
  return n
}

export function layoutModel(model: LineageModel, collapsed: ReadonlySet<EntityId>): Layout {
  const layers: LayoutLayer[] = []
  const cards: LayoutCard[] = []
  const anchors = new Map<EntityId, Anchor>()

  let x = CANVAS_PADDING
  let maxBottom = CANVAS_PADDING + LAYER_HEADER_HEIGHT

  for (const layer of model.layers) {
    const layerCollapsed = collapsed.has(layer.id)
    const width = layerCollapsed ? LAYER_COLLAPSED_WIDTH : LAYER_WIDTH

    layers.push({
      id: layer.id,
      name: layer.name,
      x,
      width,
      collapsed: layerCollapsed,
      objectCount: layer.objects.length,
    })

    let y = CANVAS_PADDING + LAYER_HEADER_HEIGHT + CARD_GAP

    if (!layerCollapsed) {
      for (const obj of layer.objects) {
        const objCollapsed = collapsed.has(obj.id)
        const flat: Omit<LayoutRow, 'y'>[] = []
        if (!objCollapsed) flattenVisible(obj.children, collapsed, 0, flat)

        const rows: LayoutRow[] = flat.map((row, i) => ({
          ...row,
          y: y + CARD_HEADER_HEIGHT + i * ROW_HEIGHT,
        }))
        const height = CARD_HEADER_HEIGHT + rows.length * ROW_HEIGHT

        cards.push({
          id: obj.id,
          layerId: layer.id,
          name: obj.name,
          x,
          y,
          width,
          height,
          rows,
          collapsed: objCollapsed,
          direct: obj.children.length,
          total: totalDescendants(obj.children),
        })

        // The object header is itself a valid transition endpoint, and it is
        // also where edges land when the object is collapsed.
        anchors.set(obj.id, {
          left: x,
          right: x + width,
          cy: y + CARD_HEADER_HEIGHT / 2,
        })
        for (const row of rows) {
          anchors.set(row.id, { left: x, right: x + width, cy: row.y + ROW_HEIGHT / 2 })
        }

        y += height + CARD_GAP
      }
    }

    // A layer is a legal endpoint too — anchor it on its header band.
    anchors.set(layer.id, {
      left: x,
      right: x + width,
      cy: CANVAS_PADDING + LAYER_HEADER_HEIGHT / 2,
    })

    maxBottom = Math.max(maxBottom, y)
    x += width + LAYER_GAP
  }

  return {
    layers,
    cards,
    anchors,
    width: x - LAYER_GAP + CANVAS_PADDING,
    height: maxBottom + CANVAS_PADDING,
  }
}

/**
 * The anchor a transition endpoint should actually use.
 *
 * An endpoint can be hidden — its object or a parent group is collapsed. Rather
 * than dropping the edge (which would silently misrepresent the lineage), it is
 * re-pointed at the nearest visible ancestor, so a collapsed group visibly
 * carries the traffic of everything inside it.
 */
export function resolveAnchor(
  layout: Layout,
  parentOf: (id: EntityId) => EntityId | null,
  id: EntityId,
): Anchor | null {
  let cursor: EntityId | null = id
  const seen = new Set<EntityId>()
  while (cursor && !seen.has(cursor)) {
    const anchor = layout.anchors.get(cursor)
    if (anchor) return anchor
    seen.add(cursor)
    cursor = parentOf(cursor)
  }
  return null
}
