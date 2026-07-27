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

/** Object card width. Cards are a fixed size and do NOT fill their layer. */
export const CARD_WIDTH = 300
/**
 * Layer column width. Deliberately wider than CARD_WIDTH: the difference
 * becomes a gutter inside the column, centred on the card, so a layer boundary
 * has white space either side of its objects rather than butting straight
 * against them. Every layer is this same width, collapsed ones excepted.
 */
export const LAYER_WIDTH = 344
/** Horizontal room between layer columns — this is where transitions are drawn. */
export const LAYER_GAP = 96
export const LAYER_COLLAPSED_WIDTH = 28
export const LAYER_HEADER_HEIGHT = 30
export const CARD_GAP = 14
export const CARD_HEADER_HEIGHT = 24
export const ROW_HEIGHT = 21
/** Left inset added per nesting level. */
export const INDENT = 12
export const CANVAS_PADDING = 40
/**
 * Extra left inset. In Modeling the canvas runs the full window width and the
 * icon rail floats on top of it, so the first column has to start clear of the
 * rail or it would sit underneath it.
 */
export const CANVAS_PADDING_LEFT = 76
/**
 * Width of the "add a layer" slot the band ends with. The band no longer runs
 * to the canvas edge (an open-ended band read as a layer that owned all the
 * empty space to its right), so the world has to be wide enough to hold this
 * slot plus the usual right padding beyond the last segment.
 */
export const LAYER_ADD_WIDTH = 34

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
  /** Column left edge — where this layer's cards live. */
  x: number
  /** Column width. */
  width: number
  /**
   * Band segment bounds. Segments are CONTIGUOUS — they meet in the middle of
   * the inter-column gap, and the first/last run to the canvas edges. If a
   * segment were only as wide as its column, the gap between segments would
   * belong to no layer, and the eye would read a "column" as running from one
   * divider to the next: half a gap wider than the real column, and offset from
   * it. That is what makes a name centred in its segment look off-centre.
   */
  bandLeft: number
  bandWidth: number
  /** True centre of the column, in world x. Names anchor here, not to the band. */
  centerX: number
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
  /**
   * World x where the layer band stops. The band is CLOSED on the right — past
   * this point is canvas, owned by no layer — and this is where the "add a
   * layer" slot is drawn.
   */
  bandEnd: number
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

/**
 * @param collapsed Entities whose children are folded away. A collapsed layer
 *   shrinks to a narrow strip in place rather than disappearing — that strip is
 *   its own affordance for expanding it again, so a layer can never be hidden
 *   somewhere the user can't find it.
 */
export function layoutModel(model: LineageModel, collapsed: ReadonlySet<EntityId>): Layout {
  const layers: LayoutLayer[] = []
  const cards: LayoutCard[] = []
  const anchors = new Map<EntityId, Anchor>()

  let x = CANVAS_PADDING_LEFT
  let maxBottom = CANVAS_PADDING + LAYER_HEADER_HEIGHT

  for (const layer of model.layers) {
    const layerCollapsed = collapsed.has(layer.id)
    const width = layerCollapsed ? LAYER_COLLAPSED_WIDTH : LAYER_WIDTH

    // Band bounds are patched in after the loop, once the neighbours (and the
    // total canvas width) are known.
    layers.push({
      id: layer.id,
      name: layer.name,
      x,
      width,
      bandLeft: 0,
      bandWidth: 0,
      centerX: x + width / 2,
      collapsed: layerCollapsed,
      objectCount: layer.objects.length,
    })

    let y = CANVAS_PADDING + LAYER_HEADER_HEIGHT + CARD_GAP

    // Cards are centred in the column; the leftover is the gutter.
    const cardX = x + Math.round((width - CARD_WIDTH) / 2)

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
          x: cardX,
          y,
          width: CARD_WIDTH,
          height,
          rows,
          collapsed: objCollapsed,
          direct: obj.children.length,
          total: totalDescendants(obj.children),
        })

        // Anchors sit on the CARD edges, not the column edges, so transitions
        // meet the box the user actually sees rather than floating in the gutter.
        anchors.set(obj.id, {
          left: cardX,
          right: cardX + CARD_WIDTH,
          cy: y + CARD_HEADER_HEIGHT / 2,
        })
        for (const row of rows) {
          anchors.set(row.id, {
            left: cardX,
            right: cardX + CARD_WIDTH,
            cy: row.y + ROW_HEIGHT / 2,
          })
        }

        y += height + CARD_GAP
      }
    }

    // A layer is a legal endpoint too — anchor it on its header band.
    //
    // A COLLAPSED layer gets no anchor at all. That is what makes collapsing it
    // also hide every transition into or out of it: with no anchor on the layer
    // and none on its (unrendered) cards and rows, resolveAnchor walks the whole
    // chain and finds nothing, so the curve is skipped. Without this, every
    // hidden layer's traffic would pile up on its narrow strip.
    if (!layerCollapsed) {
      anchors.set(layer.id, {
        left: x,
        right: x + width,
        cy: CANVAS_PADDING + LAYER_HEADER_HEIGHT / 2,
      })
    }

    maxBottom = Math.max(maxBottom, y)
    x += width + LAYER_GAP
  }

  // Contiguous band segments: each boundary sits halfway between two columns.
  // The LEFT edge runs to the canvas edge, but the RIGHT one does not — the
  // last segment stops half a gutter past its column, the same distance every
  // other boundary sits at. Letting it run on made the rightmost layer look
  // like it owned every empty pixel to its right, with no line to end it.
  for (let i = 0; i < layers.length; i += 1) {
    const layer = layers[i]
    const previous = layers[i - 1]
    const next = layers[i + 1]
    const left = previous ? (previous.x + previous.width + layer.x) / 2 : 0
    const right = next
      ? (layer.x + layer.width + next.x) / 2
      : layer.x + layer.width + LAYER_GAP / 2
    layer.bandLeft = left
    layer.bandWidth = right - left
  }

  const last = layers.at(-1)
  const bandEnd = last ? last.bandLeft + last.bandWidth : CANVAS_PADDING_LEFT
  // Wide enough for the closed band plus the add-layer slot beyond it, and never
  // narrower than the columns themselves need.
  const totalWidth = Math.max(x - LAYER_GAP + CANVAS_PADDING, bandEnd + LAYER_ADD_WIDTH + CANVAS_PADDING)

  return {
    layers,
    cards,
    anchors,
    width: totalWidth,
    height: maxBottom + CANVAS_PADDING,
    bandEnd,
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
