// The Fabric-style lineage canvas: one card per item, arrows between them.
//
// Built rather than borrowed. The Modeling viewer draws an AUTHORED model —
// layers you arranged, cards you placed, rows you can edit — and this is the
// opposite kind of picture: a machine-laid graph of things you cannot move,
// where the only questions are "what is this" and "what does it touch". Reusing
// the model canvas meant dressing every Fabric item as a layer/object/attribute
// it is not, and it showed.
//
// Layout is `dagre`, which was already a dependency and unused. It is a layered
// (Sugiyama) layout: nodes are ranked left to right by dependency, then ordered
// within a rank to cut edge crossings. That second half is what a hand-rolled
// longest-path pass does not do, and it is most of why Fabric's lineage view
// reads cleanly on a real workspace instead of turning into a hairball.
//
// Cards are DOM, edges are one SVG layer beneath them — the same split the
// sandbox flow canvas uses, so text stays selectable and accessible while the
// curves stay cheap.

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import dagre from '@dagrejs/dagre'
import type { ItemGraph, ItemKind, LineageItem } from './lineageItems'

const CARD_W = 216
const CARD_H = 56
/** Space between ranks. Wide enough that an arrow is a readable run, not a nick. */
const RANK_GAP = 96
const NODE_GAP = 20
const PAD = 32

const ZOOM_MIN = 0.3
const ZOOM_MAX = 1.6

/** One glyph per Fabric item type — the canvas's whole vocabulary of shape. */
const ICONS: Record<ItemKind, React.ReactNode> = {
  lakehouse: <path d="M4 7c0-1.5 3.6-2.5 8-2.5S20 5.5 20 7v10c0 1.5-3.6 2.5-8 2.5S4 18.5 4 17zM4 7c0 1.5 3.6 2.5 8 2.5s8-1 8-2.5" />,
  notebook: <path d="M6 3h9l4 4v14H6z M15 3v4h4M9 12h6M9 16h6" />,
  // Three stages wired left to right — a pipeline, as its own canvas draws it.
  pipeline: <path d="M3 12h4M10 12h4M17 12h4M7 9.5h3v5H7zM14 9.5h3v5h-3z" />,
  warehouse: <path d="M4 8.5 12 4l8 4.5V20H4zM9 20v-6h6v6" />,
  // A star schema: the fact in the middle, dimensions hanging off it.
  semanticmodel: <path d="M10 10h4v4h-4zM12 4v6M12 14v6M4 12h6M14 12h6" />,
  report: <path d="M4 5h16v14H4zM8 16v-4M12 16V9M16 16v-6" />,
  dataflow: <path d="M4 6h7a4 4 0 0 1 0 8H8a4 4 0 0 0 0 8h8M16 4l4 2-4 2" />,
  eventhouse: <path d="M4 18V9M9 18V5M14 18v-7M19 18v-4M3 21h18" />,
  table: <path d="M4 5h16v14H4z M4 10h16M4 15h16M10 5v14" />,
  item: <path d="M4 5h6v5H4zM14 14h6v5h-6zM10 7.5h2.5a1.5 1.5 0 0 1 1.5 1.5v6" />,
}

interface Placed extends LineageItem {
  x: number
  y: number
}

interface Positioned {
  cards: Placed[]
  edges: { from: string; to: string; count: number; d: string; mx: number; my: number }[]
  width: number
  height: number
}

/**
 * Rank, order and place every card, then shape each arrow.
 *
 * Edges leave the right edge of a card and arrive on the left, with control
 * points pulled horizontally — so a connector reads as a flow even when the two
 * cards are far apart vertically. A BACKWARD edge (a genuine cycle, which
 * Fabric permits) loops out of the left side instead of cutting back through
 * everything between.
 */
function layout(graph: ItemGraph): Positioned {
  const g = new dagre.graphlib.Graph()
  g.setGraph({ rankdir: 'LR', ranksep: RANK_GAP, nodesep: NODE_GAP, marginx: PAD, marginy: PAD })
  g.setDefaultEdgeLabel(() => ({}))
  for (const item of graph.items) g.setNode(item.id, { width: CARD_W, height: CARD_H })
  for (const link of graph.links) {
    // dagre keeps ONE edge per pair; the count already lives on our link.
    if (g.hasNode(link.from) && g.hasNode(link.to)) g.setEdge(link.from, link.to)
  }
  dagre.layout(g)

  const at = new Map<string, { x: number; y: number }>()
  for (const item of graph.items) {
    const n = g.node(item.id)
    // dagre positions by CENTRE; the cards are placed by their top-left.
    at.set(item.id, { x: (n?.x ?? 0) - CARD_W / 2, y: (n?.y ?? 0) - CARD_H / 2 })
  }

  const cards = graph.items.map((item) => ({ ...item, ...at.get(item.id)! }))
  const edges = graph.links.flatMap((link) => {
    const s = at.get(link.from)
    const t = at.get(link.to)
    if (!s || !t) return []
    const sy = s.y + CARD_H / 2
    const ty = t.y + CARD_H / 2
    const backward = t.x < s.x
    const sx = backward ? s.x : s.x + CARD_W
    const tx = backward ? t.x + CARD_W : t.x
    const bow = backward ? 70 : 0
    const c1 = backward ? sx - bow : sx + (tx - sx) * 0.5
    const c2 = backward ? tx + bow : sx + (tx - sx) * 0.5
    return [{
      ...link,
      d: `M${sx} ${sy}C${c1} ${sy} ${c2} ${ty} ${tx} ${ty}`,
      // Where the count badge sits: the curve's midpoint, near enough.
      mx: (sx + tx) / 2,
      my: (sy + ty) / 2,
    }]
  })

  const graphSize = g.graph()
  return {
    cards,
    edges,
    width: (graphSize?.width ?? 0) + PAD,
    height: (graphSize?.height ?? 0) + PAD,
  }
}

/** Everything reachable from `seed`, both directions — Fabric's impact view. */
function connected(graph: ItemGraph, seed: string): Set<string> {
  const neighbours = new Map<string, string[]>()
  const add = (from: string, to: string) => {
    const list = neighbours.get(from)
    if (list) list.push(to)
    else neighbours.set(from, [to])
  }
  for (const l of graph.links) {
    add(l.from, l.to)
    add(l.to, l.from)
  }
  const seen = new Set([seed])
  const stack = [seed]
  while (stack.length) {
    const id = stack.pop()!
    for (const next of neighbours.get(id) ?? []) {
      if (seen.has(next)) continue
      seen.add(next)
      stack.push(next)
    }
  }
  return seen
}

export function LineageCanvas({ graph }: { graph: ItemGraph }) {
  const [zoom, setZoom] = useState(1)
  const [selected, setSelected] = useState<string | null>(null)
  const scrollRef = useRef<HTMLDivElement | null>(null)

  const { cards, edges, width, height } = useMemo(() => layout(graph), [graph])

  // Selecting an item narrows the canvas to what it touches. Cleared by Esc or
  // by clicking the background, so there is always a way back out.
  const lit = useMemo(
    () => (selected ? connected(graph, selected) : null),
    [graph, selected],
  )

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setSelected(null)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  // A new graph is a new picture; keeping the old selection would dim a canvas
  // around an item that may no longer be on it.
  useEffect(() => setSelected(null), [graph])

  const fit = useCallback(() => {
    const host = scrollRef.current
    if (!host || !width || !height) return
    const scale = Math.min(host.clientWidth / width, host.clientHeight / height, 1)
    setZoom(Math.max(ZOOM_MIN, Number(scale.toFixed(2))))
    host.scrollTo({ top: 0, left: 0 })
  }, [width, height])

  return (
    <div className="fl-wrap">
      <div className="fl-zoom">
        <button onClick={() => setZoom((z) => Math.max(ZOOM_MIN, +(z - 0.1).toFixed(2)))} aria-label="Zoom out">
          −
        </button>
        <span>{Math.round(zoom * 100)}%</span>
        <button onClick={() => setZoom((z) => Math.min(ZOOM_MAX, +(z + 0.1).toFixed(2)))} aria-label="Zoom in">
          +
        </button>
        <button onClick={fit}>Fit</button>
        {selected && <button onClick={() => setSelected(null)}>Clear selection</button>}
      </div>

      <div className="fl-scroll" ref={scrollRef} onClick={() => setSelected(null)}>
        <div
          className="fl-world"
          style={{
            width: width * zoom,
            height: height * zoom,
          }}
        >
          <div
            className="fl-scale"
            style={{ width, height, transform: `scale(${zoom})`, transformOrigin: '0 0' }}
          >
            <svg className="fl-edges" width={width} height={height} aria-hidden>
              <defs>
                <marker id="fl-arrow" markerWidth="9" markerHeight="9" refX="7" refY="3.5" orient="auto">
                  <path d="M0 0l7 3.5-7 3.5z" fill="currentColor" />
                </marker>
              </defs>
              {edges.map((e) => {
                const on = !lit || (lit.has(e.from) && lit.has(e.to))
                return (
                  <g key={`${e.from} ${e.to}`} className="fl-edge" data-dim={!on || undefined}>
                    <path d={e.d} fill="none" markerEnd="url(#fl-arrow)" />
                    {/* The tables this one arrow stands for — the thing the
                        item-level roll-up would otherwise throw away. */}
                    {e.count > 1 && (
                      <text className="fl-edge-count" x={e.mx} y={e.my - 4} textAnchor="middle">
                        {e.count}
                      </text>
                    )}
                  </g>
                )
              })}
            </svg>

            {cards.map((card) => (
              <button
                key={card.id}
                type="button"
                className="fl-card"
                style={{ left: card.x, top: card.y, width: CARD_W, height: CARD_H }}
                data-kind={card.kind}
                data-selected={selected === card.id || undefined}
                data-dim={(lit && !lit.has(card.id)) || undefined}
                onClick={(e) => {
                  e.stopPropagation()
                  setSelected((prev) => (prev === card.id ? null : card.id))
                }}
                title={card.opaque ? `${card.name} — dependencies not crawled` : card.name}
              >
                <svg className="fl-card-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinejoin="round">
                  {ICONS[card.kind]}
                </svg>
                <span className="fl-card-text">
                  <span className="fl-card-name">{card.name}</span>
                  <span className="fl-card-type">
                    {card.typeLabel}
                    {card.opaque && <span className="fl-card-flag"> · not crawled</span>}
                  </span>
                </span>
              </button>
            ))}
          </div>
        </div>
      </div>
    </div>
  )
}
