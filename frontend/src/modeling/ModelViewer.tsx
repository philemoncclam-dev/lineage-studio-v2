// The Model Viewer canvas: layer columns, object cards, attribute rows.
//
// Rendering strategy — a hybrid, chosen for density:
//  - Cards and rows are DOM. Text stays crisp at any zoom, hit-testing and
//    inline editing come for free, and the browser does the text layout.
//  - Only cards intersecting the viewport are mounted, and within a tall card
//    only the visible slice of rows is mounted. That keeps the live node count
//    proportional to the screen, not to the model, which is what makes a
//    six-figure-entity model viable at all.
//  - Transitions are one canvas layer underneath (see TransitionLayer).

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { buildIndex } from '../model/index'
import {
  CANVAS_PADDING,
  CARD_HEADER_HEIGHT,
  INDENT,
  LAYER_HEADER_HEIGHT,
  ROW_HEIGHT,
  layoutModel,
  type LayoutCard,
} from '../model/layout'
import type { EntityId, LineageModel } from '../model/types'
import TransitionLayer, { type Viewport } from './TransitionLayer'
import './modeling.css'

const MIN_SCALE = 0.15
const MAX_SCALE = 2.5
/** Rows rendered above and below the visible slice, to hide scroll tearing. */
const ROW_OVERSCAN = 6

interface Props {
  model: LineageModel
}

export default function ModelViewer({ model }: Props) {
  const hostRef = useRef<HTMLDivElement | null>(null)
  const [size, setSize] = useState({ width: 0, height: 0 })
  const [viewport, setViewport] = useState<Viewport>({ x: 0, y: 0, scale: 1 })
  const [collapsed, setCollapsed] = useState<ReadonlySet<EntityId>>(new Set())
  const [selected, setSelected] = useState<EntityId | null>(null)

  const index = useMemo(() => buildIndex(model), [model])
  const layout = useMemo(() => layoutModel(model, collapsed), [model, collapsed])
  const parentOf = useCallback(
    (id: EntityId) => index.entries.get(id)?.parentId ?? null,
    [index],
  )

  // The trace: the selected entity plus everything one hop away. Highlighting
  // both endpoints is what makes a selected row's lineage legible in a bundle.
  const highlighted = useMemo(() => {
    if (!selected) return new Set<EntityId>()
    const out = new Set<EntityId>([selected])
    for (const to of index.outgoing.get(selected) ?? []) out.add(to)
    for (const from of index.incoming.get(selected) ?? []) out.add(from)
    return out
  }, [selected, index])

  useEffect(() => {
    const host = hostRef.current
    if (!host) return
    const observer = new ResizeObserver(([entry]) => {
      const { width, height } = entry.contentRect
      setSize({ width, height })
    })
    observer.observe(host)
    return () => observer.disconnect()
  }, [])

  // Wheel: ctrl/cmd zooms about the pointer, otherwise it pans. Registered
  // natively rather than via onWheel because React's synthetic wheel listener
  // is passive, and preventDefault() there is a no-op that lets the page scroll.
  useEffect(() => {
    const host = hostRef.current
    if (!host) return
    const onWheel = (e: WheelEvent) => {
      e.preventDefault()
      setViewport((v) => {
        if (!e.ctrlKey && !e.metaKey) {
          return { ...v, x: v.x - e.deltaX, y: v.y - e.deltaY }
        }
        const rect = host.getBoundingClientRect()
        const px = e.clientX - rect.left
        const py = e.clientY - rect.top
        const next = clamp(v.scale * Math.exp(-e.deltaY * 0.0015), MIN_SCALE, MAX_SCALE)
        // Keep the world point under the cursor pinned while scaling.
        const k = next / v.scale
        return { scale: next, x: px - (px - v.x) * k, y: py - (py - v.y) * k }
      })
    }
    host.addEventListener('wheel', onWheel, { passive: false })
    return () => host.removeEventListener('wheel', onWheel)
  }, [])

  const onPointerDown = (e: React.PointerEvent) => {
    if (e.button !== 0 || (e.target as HTMLElement).closest('.mv-row, .mv-card-header')) return
    const startX = e.clientX
    const startY = e.clientY
    const origin = viewport
    const target = e.currentTarget as HTMLElement
    target.setPointerCapture(e.pointerId)
    const move = (ev: PointerEvent) => {
      setViewport({ ...origin, x: origin.x + (ev.clientX - startX), y: origin.y + (ev.clientY - startY) })
    }
    const up = () => {
      window.removeEventListener('pointermove', move)
      window.removeEventListener('pointerup', up)
    }
    window.addEventListener('pointermove', move)
    window.addEventListener('pointerup', up)
  }

  const toggle = (id: EntityId) => {
    setCollapsed((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  // World-space rect currently on screen, used to cull cards and rows.
  const view = useMemo(() => {
    const { x, y, scale } = viewport
    return {
      top: -y / scale,
      bottom: (-y + size.height) / scale,
      left: -x / scale,
      right: (-x + size.width) / scale,
    }
  }, [viewport, size])

  const visibleCards = useMemo(
    () =>
      layout.cards.filter(
        (c) =>
          c.x + c.width > view.left &&
          c.x < view.right &&
          c.y + c.height > view.top &&
          c.y < view.bottom,
      ),
    [layout, view],
  )

  return (
    <div className="mv-host" ref={hostRef} onPointerDown={onPointerDown}>
      <TransitionLayer
        layout={layout}
        transitions={model.transitions}
        parentOf={parentOf}
        viewport={viewport}
        width={size.width}
        height={size.height}
        highlighted={highlighted}
      />

      <div
        className="mv-world"
        style={{
          transform: `translate(${viewport.x}px, ${viewport.y}px) scale(${viewport.scale})`,
        }}
      >
        {layout.layers.map((layer) => (
          <div
            key={layer.id}
            className="mv-layer-header"
            style={{
              left: layer.x,
              top: CANVAS_PADDING,
              width: layer.width,
              height: LAYER_HEADER_HEIGHT,
            }}
            data-collapsed={layer.collapsed || undefined}
            onDoubleClick={() => toggle(layer.id)}
            title={`${layer.name} — ${layer.objectCount} object(s)`}
          >
            <span className="mv-layer-name">{layer.name}</span>
          </div>
        ))}

        {visibleCards.map((card) => (
          <Card
            key={card.id}
            card={card}
            view={view}
            selected={selected}
            highlighted={highlighted}
            properties={model.properties}
            onToggle={toggle}
            onSelect={setSelected}
          />
        ))}
      </div>

      <div className="mv-status">
        {model.layers.length} layers · {layout.cards.length} objects ·{' '}
        {model.transitions.length} transitions · {Math.round(viewport.scale * 100)}%
      </div>
    </div>
  )
}

interface CardProps {
  card: LayoutCard
  view: { top: number; bottom: number; left: number; right: number }
  selected: EntityId | null
  highlighted: ReadonlySet<EntityId>
  properties: LineageModel['properties']
  onToggle: (id: EntityId) => void
  onSelect: (id: EntityId) => void
}

function Card({ card, view, selected, highlighted, properties, onToggle, onSelect }: CardProps) {
  // Row-level virtualization. A card can be thousands of rows tall, so mount
  // only the slice the viewport actually covers and spacer-pad the rest.
  const rowsTop = card.y + CARD_HEADER_HEIGHT
  const firstVisible = Math.max(0, Math.floor((view.top - rowsTop) / ROW_HEIGHT) - ROW_OVERSCAN)
  const lastVisible = Math.min(
    card.rows.length,
    Math.ceil((view.bottom - rowsTop) / ROW_HEIGHT) + ROW_OVERSCAN,
  )
  const slice = card.rows.slice(firstVisible, Math.max(firstVisible, lastVisible))

  return (
    <div
      className="mv-card"
      style={{ left: card.x, top: card.y, width: card.width, height: card.height }}
      data-selected={selected === card.id || undefined}
      data-traced={highlighted.has(card.id) || undefined}
    >
      <div
        className="mv-card-header"
        style={{ height: CARD_HEADER_HEIGHT }}
        onClick={() => onSelect(card.id)}
        onDoubleClick={() => onToggle(card.id)}
      >
        <button
          className="mv-twisty"
          data-collapsed={card.collapsed || undefined}
          onClick={(e) => {
            e.stopPropagation()
            onToggle(card.id)
          }}
          aria-label={card.collapsed ? `Expand ${card.name}` : `Collapse ${card.name}`}
        />
        <span className="mv-card-name" title={card.name}>
          {card.name}
        </span>
        <span className="mv-count">
          {card.direct}
          <span className="mv-count-total">({card.total})</span>
        </span>
      </div>

      {slice.length > 0 && (
        <div style={{ paddingTop: firstVisible * ROW_HEIGHT }}>
          {slice.map((row) => (
            <div
              key={row.id}
              className="mv-row"
              style={{ height: ROW_HEIGHT, paddingLeft: 6 + row.depth * INDENT }}
              data-selected={selected === row.id || undefined}
              data-traced={highlighted.has(row.id) || undefined}
              onClick={() => onSelect(row.id)}
              onDoubleClick={() => row.hasChildren && onToggle(row.id)}
            >
              {row.hasChildren ? (
                <button
                  className="mv-twisty"
                  data-collapsed={row.collapsed || undefined}
                  onClick={(e) => {
                    e.stopPropagation()
                    onToggle(row.id)
                  }}
                  aria-label={row.collapsed ? `Expand ${row.name}` : `Collapse ${row.name}`}
                />
              ) : (
                <span className="mv-twisty-spacer" />
              )}
              <span className="mv-row-name" title={row.name}>
                {row.name}
              </span>
              <Badges bag={properties[row.id]} />
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

/**
 * Property-driven badges. These are display rules, not intrinsic fields — the
 * classification lives in the property table, and the viewer decorates rows
 * from it. Hard-coding a `classification` field on Attribute would have made
 * every future rule a schema change.
 */
function Badges({ bag }: { bag: Record<string, string> | undefined }) {
  if (!bag) return null
  const out: React.ReactNode[] = []
  if (bag.CDE === 'true') out.push(<span key="cde" className="mv-badge" data-kind="cde">CDE</span>)
  const cls = bag.Classification
  if (cls) out.push(<span key="cls" className="mv-badge" data-kind={cls.toLowerCase()}>{cls}</span>)
  return out.length ? <span className="mv-badges">{out}</span> : null
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value))
}
