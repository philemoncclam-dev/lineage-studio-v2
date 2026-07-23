import { render } from '@testing-library/react'
import { createElement, useRef } from 'react'
import { describe, expect, it, vi } from 'vitest'
import {
  resolveNextFocus,
  useLineageKeyboardNav,
  type FocusTarget,
} from './useLineageKeyboardNav'

// Fixture graph (03-UI-SPEC.md's Keyboard & AT table): rank 0 has two table
// cards (raw, cust), rank 1 has one notebook card (nb, header-only), rank 2
// has one table card (clean) fed by column edges from raw. Reading order:
// rank ascending, cards top-to-bottom within a rank, header before its own
// rows within a card.
const targets: FocusTarget[] = [
  { id: 'raw', kind: 'header', rank: 0, cardId: 'raw' },
  { id: 'raw.order_id', kind: 'row', rank: 0, cardId: 'raw', colKey: 'raw.order_id' },
  { id: 'raw.customer', kind: 'row', rank: 0, cardId: 'raw', colKey: 'raw.customer' },
  { id: 'cust', kind: 'header', rank: 0, cardId: 'cust' },
  { id: 'cust.region', kind: 'row', rank: 0, cardId: 'cust', colKey: 'cust.region' },
  { id: 'nb', kind: 'header', rank: 1, cardId: 'nb' },
  { id: 'clean', kind: 'header', rank: 2, cardId: 'clean' },
  { id: 'clean.order_id', kind: 'row', rank: 2, cardId: 'clean', colKey: 'clean.order_id' },
  { id: 'clean.customer_name', kind: 'row', rank: 2, cardId: 'clean', colKey: 'clean.customer_name' },
]

const colEdges: [string, string][] = [
  ['raw.order_id', 'clean.order_id'],
  ['raw.customer', 'clean.customer_name'],
]

describe('resolveNextFocus', () => {
  it('ArrowDown moves within the same card, header -> first row -> next row', () => {
    expect(resolveNextFocus(targets, 'raw', 'ArrowDown', colEdges)).toBe('raw.order_id')
    expect(resolveNextFocus(targets, 'raw.order_id', 'ArrowDown', colEdges)).toBe('raw.customer')
  })

  it('ArrowDown at the last row of a card moves to the next card in the same rank', () => {
    expect(resolveNextFocus(targets, 'raw.customer', 'ArrowDown', colEdges)).toBe('cust')
  })

  it('ArrowDown at the last card of a rank has nowhere to go (null)', () => {
    expect(resolveNextFocus(targets, 'cust.region', 'ArrowDown', colEdges)).toBeNull()
  })

  it('ArrowUp is the exact inverse of ArrowDown', () => {
    expect(resolveNextFocus(targets, 'raw.customer', 'ArrowUp', colEdges)).toBe('raw.order_id')
    expect(resolveNextFocus(targets, 'raw.order_id', 'ArrowUp', colEdges)).toBe('raw')
    // Crossing back over a card boundary lands on the previous card's LAST
    // target (mirrors ArrowDown landing on the next card's FIRST target).
    expect(resolveNextFocus(targets, 'cust', 'ArrowUp', colEdges)).toBe('raw.customer')
  })

  it('ArrowRight on a header moves to the first target of the next rank', () => {
    expect(resolveNextFocus(targets, 'raw', 'ArrowRight', colEdges)).toBe('nb')
    expect(resolveNextFocus(targets, 'cust', 'ArrowRight', colEdges)).toBe('nb')
    expect(resolveNextFocus(targets, 'nb', 'ArrowRight', colEdges)).toBe('clean')
  })

  it('ArrowLeft on a header moves to the first target of the previous rank', () => {
    expect(resolveNextFocus(targets, 'clean', 'ArrowLeft', colEdges)).toBe('nb')
    expect(resolveNextFocus(targets, 'nb', 'ArrowLeft', colEdges)).toBe('raw')
  })

  it('ArrowRight/Left on a rank-boundary header returns null (no rank beyond the edge)', () => {
    expect(resolveNextFocus(targets, 'raw', 'ArrowLeft', colEdges)).toBeNull()
    expect(resolveNextFocus(targets, 'clean', 'ArrowRight', colEdges)).toBeNull()
  })

  it('ArrowRight path-walks a connected row directly to its first downstream column', () => {
    expect(resolveNextFocus(targets, 'raw.order_id', 'ArrowRight', colEdges)).toBe('clean.order_id')
  })

  it('ArrowLeft path-walks a connected row directly to its first upstream column', () => {
    expect(resolveNextFocus(targets, 'clean.customer_name', 'ArrowLeft', colEdges)).toBe('raw.customer')
  })

  it('ArrowRight/Left on an unconnected row returns null (no path to walk)', () => {
    expect(resolveNextFocus(targets, 'cust.region', 'ArrowRight', colEdges)).toBeNull()
    expect(resolveNextFocus(targets, 'cust.region', 'ArrowLeft', colEdges)).toBeNull()
  })

  it('Home/End jump to the first/last target in the whole canvas', () => {
    expect(resolveNextFocus(targets, 'clean.customer_name', 'Home', colEdges)).toBe('raw')
    expect(resolveNextFocus(targets, 'raw', 'End', colEdges)).toBe('clean.customer_name')
  })

  it('Tab and Shift+Tab are never intercepted — always returns null (canvas is one Tab stop)', () => {
    expect(resolveNextFocus(targets, 'raw.order_id', 'Tab', colEdges)).toBeNull()
    expect(resolveNextFocus(targets, 'raw.order_id', 'Tab', colEdges)).toBeNull() // Shift+Tab shares key 'Tab'
  })

  it('an unknown current id or key resolves to null', () => {
    expect(resolveNextFocus(targets, 'does-not-exist', 'ArrowDown', colEdges)).toBeNull()
    expect(resolveNextFocus(targets, 'raw', 'PageDown', colEdges)).toBeNull()
    expect(resolveNextFocus([], 'raw', 'ArrowDown', colEdges)).toBeNull()
  })
})

// One jsdom focus-movement case for the hook itself (the resolver above is
// pure and needs no DOM) — verifies onKeyDown actually moves document focus
// + roving tabIndex, invokes onSelect on Enter/Space, and leaves a dimmed
// (pointer-events:none) element keyboard-focusable.
function Harness({
  onSelect,
}: {
  onSelect: (nodeId: string, colKey?: string) => void
}) {
  const containerRef = useRef<HTMLDivElement>(null)
  const { onKeyDown } = useLineageKeyboardNav({ containerRef, targets, colEdges, onSelect })
  return createElement(
    'div',
    { ref: containerRef, role: 'group', onKeyDown },
    targets.map((t, i) =>
      createElement('div', {
        key: t.id,
        'data-lineage-focus': t.id,
        tabIndex: i === 0 ? 0 : -1,
        // 'cust.region' simulates a mouse-dimmed row (unrelated trace,
        // pointer-events:none) — must stay keyboard-focusable regardless.
        style: t.id === 'cust.region' ? { pointerEvents: 'none' } : undefined,
      }),
    ),
  )
}

describe('useLineageKeyboardNav (jsdom focus movement)', () => {
  it('ArrowDown moves DOM focus and rolls tabIndex from the current to the next target', () => {
    const onSelect = vi.fn()
    const { container } = render(createElement(Harness, { onSelect }))
    const rawEl = container.querySelector('[data-lineage-focus="raw"]') as HTMLElement
    const rowEl = container.querySelector('[data-lineage-focus="raw.order_id"]') as HTMLElement
    rawEl.focus()
    expect(document.activeElement).toBe(rawEl)

    const group = container.querySelector('[role="group"]') as HTMLElement
    group.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true }))

    expect(document.activeElement).toBe(rowEl)
    expect(rawEl.tabIndex).toBe(-1)
    expect(rowEl.tabIndex).toBe(0)
  })

  it('Enter invokes onSelect with the focused row target’s (nodeId, colKey)', () => {
    const onSelect = vi.fn()
    const { container } = render(createElement(Harness, { onSelect }))
    const rowEl = container.querySelector('[data-lineage-focus="raw.order_id"]') as HTMLElement
    rowEl.focus()
    const group = container.querySelector('[role="group"]') as HTMLElement
    group.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }))
    expect(onSelect).toHaveBeenCalledWith('raw', 'raw.order_id')
  })

  it('Enter on a header target invokes onSelect with no colKey', () => {
    const onSelect = vi.fn()
    const { container } = render(createElement(Harness, { onSelect }))
    const headerEl = container.querySelector('[data-lineage-focus="raw"]') as HTMLElement
    headerEl.focus()
    const group = container.querySelector('[role="group"]') as HTMLElement
    group.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }))
    expect(onSelect).toHaveBeenCalledWith('raw', undefined)
  })

  it('a dimmed (pointer-events:none) row stays keyboard-focusable via path-walk', () => {
    const onSelect = vi.fn()
    const { container } = render(createElement(Harness, { onSelect }))
    const orderIdEl = container.querySelector('[data-lineage-focus="raw.order_id"]') as HTMLElement
    const cleanOrderIdEl = container.querySelector('[data-lineage-focus="clean.order_id"]') as HTMLElement
    orderIdEl.focus()
    const group = container.querySelector('[role="group"]') as HTMLElement
    group.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true }))
    expect(document.activeElement).toBe(cleanOrderIdEl)

    // The dimmed row keeps its tabIndex attribute (never stripped) even
    // though it is not the current roving target.
    const dimmedEl = container.querySelector('[data-lineage-focus="cust.region"]') as HTMLElement
    expect(dimmedEl.getAttribute('data-lineage-focus')).toBe('cust.region')
    expect(dimmedEl.tabIndex).toBe(-1)
  })
})
