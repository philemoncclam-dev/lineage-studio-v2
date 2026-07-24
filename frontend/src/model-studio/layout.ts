// Deterministic swimlane layout (idea ported from lineage-studio's
// canvas/layout.ts): each Layer is a fixed column; its top-level children
// (Objects with their tables, or Groups placed directly under the Layer) stack
// vertically as container cards. Heights are computed from row constants that
// MUST match model-studio.css, or cards overlap.
import type { Edge as RFEdge, Node as RFNode } from '@xyflow/react'
import type { Model, ModelNode } from './types'

export interface AttrData {
  id: string
  name: string
  dataType: string
}

export interface TableData {
  groupId: string
  name: string
  attributes: AttrData[]
}

// One canvas card: an Object band with its tables, or a single bare table.
export interface ContainerData {
  band: { objectId: string; name: string } | null
  tables: TableData[]
  layerId: string
  [key: string]: unknown
}

export interface LayerData {
  layerId: string
  name: string
  width: number
  height: number
  [key: string]: unknown
}

// Layout constants (px, flow coordinates) — keep in sync with model-studio.css.
export const CARD_W = 248
const COL_PAD = 20
export const COL_W = CARD_W + COL_PAD * 2
const LAYER_HEAD_H = 44
const CONTENT_TOP = LAYER_HEAD_H + 16
const BAND_H = 34 // object band header row
const TABLE_HEAD_H = 30 // table title row
const ATTR_ROW_H = 26
const EMPTY_TABLE_H = 24 // "no columns" hint row
const TABLE_FOOT_H = 24 // "+ column" row
const BORDERS = 2
const CARD_GAP = 14
const CARD_FOOT_H = 26 // container "+ table" row (objects only)
const MIN_LAYER_H = 320
const LAYER_BOTTOM_PAD = 72 // room for the add-object/table affordance

function tableHeight(t: TableData): number {
  return TABLE_HEAD_H + (t.attributes.length ? t.attributes.length * ATTR_ROW_H : EMPTY_TABLE_H) + TABLE_FOOT_H
}

function containerHeight(c: ContainerData): number {
  const tables = c.tables.reduce((sum, t) => sum + tableHeight(t), 0)
  return (c.band ? BAND_H + CARD_FOOT_H : 0) + tables + BORDERS
}

/** Vertical offset of an attribute row's centre within its container card. */
function attrOffsets(c: ContainerData): Map<string, number> {
  const out = new Map<string, number>()
  let y = 1 + (c.band ? BAND_H : 0)
  for (const t of c.tables) {
    y += TABLE_HEAD_H
    for (const a of t.attributes) {
      out.set(a.id, y + ATTR_ROW_H / 2)
      y += ATTR_ROW_H
    }
    if (!t.attributes.length) y += EMPTY_TABLE_H
    y += TABLE_FOOT_H
  }
  return out
}

export interface FlowResult {
  nodes: RFNode[]
  edges: RFEdge[]
  /** attribute node id -> id of the container RF node that renders it. */
  attrContainer: Map<string, string>
}

export function modelToFlow(model: Model): FlowResult {
  const childrenOf = new Map<string | null, ModelNode[]>()
  for (const n of model.nodes) {
    const arr = childrenOf.get(n.parentId) ?? []
    arr.push(n)
    childrenOf.set(n.parentId, arr)
  }

  const toTable = (g: ModelNode): TableData => ({
    groupId: g.id,
    name: g.name,
    attributes: (childrenOf.get(g.id) ?? [])
      .filter((n) => n.type === 'Attribute')
      .map((a) => ({ id: a.id, name: a.name, dataType: String(a.properties.dataType ?? '') })),
  })

  const layers = (childrenOf.get(null) ?? []).filter((n) => n.type === 'Layer')
  const nodes: RFNode[] = []
  const attrContainer = new Map<string, string>()

  // First pass: build containers per layer and measure column heights.
  const perLayer = layers.map((layer) => {
    const containers: ContainerData[] = []
    for (const child of childrenOf.get(layer.id) ?? []) {
      if (child.type === 'Object') {
        containers.push({
          band: { objectId: child.id, name: child.name },
          tables: (childrenOf.get(child.id) ?? []).filter((n) => n.type === 'Group').map(toTable),
          layerId: layer.id,
        })
      } else if (child.type === 'Group') {
        containers.push({ band: null, tables: [toTable(child)], layerId: layer.id })
      }
    }
    const height =
      CONTENT_TOP +
      containers.reduce((sum, c) => sum + containerHeight(c) + CARD_GAP, 0) +
      LAYER_BOTTOM_PAD
    return { layer, containers, height }
  })

  const maxH = Math.max(MIN_LAYER_H, ...perLayer.map((p) => p.height))

  perLayer.forEach(({ layer, containers }, col) => {
    const x = col * COL_W
    nodes.push({
      id: `layer:${layer.id}`,
      type: 'msLayer',
      position: { x, y: 0 },
      data: { layerId: layer.id, name: layer.name, width: COL_W, height: maxH } satisfies LayerData,
      draggable: false,
      // Must stay selectable: xyflow disables pointer events entirely on
      // non-draggable non-selectable nodes, which would dead-click the
      // layer-header input and add buttons.
      selectable: true,
      deletable: false,
      zIndex: 0,
    })
    let y = CONTENT_TOP
    containers.forEach((c) => {
      const anchorId = c.band ? c.band.objectId : c.tables[0].groupId
      const id = `card:${anchorId}`
      for (const t of c.tables) for (const a of t.attributes) attrContainer.set(a.id, id)
      nodes.push({
        id,
        type: 'msCard',
        position: { x: x + COL_PAD, y },
        data: c,
        draggable: false,
        deletable: false,
        zIndex: 1,
      })
      y += containerHeight(c) + CARD_GAP
    })
  })

  // Edges: attribute → attribute, anchored to per-attribute handles.
  const edges: RFEdge[] = []
  for (const e of model.edges) {
    const sourceCard = attrContainer.get(e.sourceNodeId)
    const targetCard = attrContainer.get(e.targetNodeId)
    if (!sourceCard || !targetCard) continue
    edges.push({
      id: e.id,
      source: sourceCard,
      sourceHandle: `out:${e.sourceNodeId}`,
      target: targetCard,
      targetHandle: `in:${e.targetNodeId}`,
      type: 'default',
      className: `ms-edge ms-edge-${e.kind ?? 'copy'}`,
      zIndex: 2,
    })
  }

  return { nodes, edges, attrContainer }
}

// Exported for handle positioning sanity checks in tests.
export const _internal = { tableHeight, containerHeight, attrOffsets }
