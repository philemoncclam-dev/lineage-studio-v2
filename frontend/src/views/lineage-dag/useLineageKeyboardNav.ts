// Roving-tabindex + path-walk keyboard/AT model for the DAG canvas (DAG-08,
// SC#6, pitfall #19 — 03-UI-SPEC.md "Keyboard & Assistive Technology
// Traversal Model"). No codebase analog exists (03-PATTERNS.md "No Analog
// Found") — this is the direct implementation of the UI-SPEC's key table.
//
// This hook does NOT layer on top of @xyflow/react's own keyboard model —
// LineageDagView (plan 03-07) disables it entirely (nodesFocusable={false},
// edgesFocusable={false}, disableKeyboardA11y) and wires this hook's
// onKeyDown to the xyflow wrapper div instead (RESEARCH.md Pitfall 1).
//
// `resolveNextFocus` is a pure function over a flat, reading-order list of
// focus targets (headers + column rows) and is independently unit-tested
// without any DOM. `useLineageKeyboardNav` is the thin DOM-facing wrapper:
// it reads the currently-focused element's `data-lineage-focus` id, calls
// the resolver, and moves focus + rovingtabindex onto the resolved target.
//
// Never removes tabIndex/aria-* from any element outside the resolved
// target pair (current -1, next 0) — a mouse-dimmed (pointer-events:none)
// element stays keyboard-reachable, since pointer-events is a mouse-only
// CSS property and this hook only ever manipulates `tabIndex` via DOM APIs,
// never `aria-*` or CSS classes (03-UI-SPEC.md "Mouse-non-interactive vs.
// keyboard-reachable").

import { useCallback, type KeyboardEvent, type RefObject } from 'react'

export interface FocusTarget {
  id: string
  kind: 'header' | 'row'
  rank: number
  cardId: string
  colKey?: string
}

/**
 * Pure resolver: given the flat, reading-order `targets` list (rank
 * ascending, cards top-to-bottom within a rank, header before its rows
 * within a card), the currently-focused target's id, the pressed key, and
 * the column-edge topology (for path-walk), returns the id of the target
 * that should receive focus next — or `null` if the key isn't handled /
 * there is nowhere to move (caller leaves focus unchanged in that case).
 *
 * `Tab`/`Shift+Tab` always return null — the canvas is a single Tab stop
 * and never traps focus (both keys share the same `key` value, `'Tab'`;
 * `shiftKey` doesn't change this function's behavior).
 */
export function resolveNextFocus(
  targets: FocusTarget[],
  currentId: string,
  key: string,
  colEdges: [string, string][],
): string | null {
  if (key === 'Tab') return null
  if (targets.length === 0) return null

  const idx = targets.findIndex((t) => t.id === currentId)
  if (idx === -1) return null
  const current = targets[idx]

  if (key === 'Home') return targets[0].id
  if (key === 'End') return targets[targets.length - 1].id

  if (key === 'ArrowDown' || key === 'ArrowUp') {
    const dir = key === 'ArrowDown' ? 1 : -1
    const neighborIdx = idx + dir
    if (neighborIdx >= 0 && neighborIdx < targets.length && targets[neighborIdx].cardId === current.cardId) {
      return targets[neighborIdx].id
    }
    // Crossed the current card's boundary — move to the first/last target
    // of the next/previous card in the SAME rank (never jumps ranks).
    const sameRank = targets.filter((t) => t.rank === current.rank)
    const cardIds: string[] = []
    for (const t of sameRank) {
      if (cardIds[cardIds.length - 1] !== t.cardId) cardIds.push(t.cardId)
    }
    const cardIdx = cardIds.indexOf(current.cardId)
    const nextCardIdx = cardIdx + dir
    if (nextCardIdx < 0 || nextCardIdx >= cardIds.length) return null
    const nextCardTargets = sameRank.filter((t) => t.cardId === cardIds[nextCardIdx])
    return dir === 1 ? nextCardTargets[0].id : nextCardTargets[nextCardTargets.length - 1].id
  }

  if (key === 'ArrowRight' || key === 'ArrowLeft') {
    const downstream = key === 'ArrowRight'
    if (current.kind === 'row' && current.colKey) {
      // Path-walk: jump directly to the first downstream (→) / upstream (←)
      // connected column via the colEdges neighbourhood — the power-user
      // "walk the edge" affordance that dual-purposes as edge operability.
      const edge = colEdges.find(([s, t]) => (downstream ? s === current.colKey : t === current.colKey))
      if (!edge) return null
      const connectedColKey = downstream ? edge[1] : edge[0]
      const found = targets.find((t) => t.colKey === connectedColKey)
      return found ? found.id : null
    }
    if (current.kind === 'header') {
      // Rank-by-rank traversal, matching the DAG's own left-to-right
      // structure — lands on the first (topmost) target of the adjacent
      // rank, regardless of the header's own vertical position.
      const targetRank = current.rank + (downstream ? 1 : -1)
      const rankTargets = targets.filter((t) => t.rank === targetRank)
      return rankTargets.length > 0 ? rankTargets[0].id : null
    }
    return null
  }

  return null
}

export interface UseLineageKeyboardNavOptions {
  containerRef: RefObject<HTMLElement | null>
  targets: FocusTarget[]
  colEdges: [string, string][]
  onSelect: (nodeId: string, colKey?: string) => void
}

export interface UseLineageKeyboardNavResult {
  onKeyDown: (e: KeyboardEvent<HTMLElement>) => void
}

// Moves DOM focus to the target with the given `data-lineage-focus` id and
// re-derives roving tabIndex (0 on the new target, -1 on every other
// tracked element) — the standard roving-tabindex pattern. Only ever
// touches `tabIndex`; never removes `aria-*` attributes or CSS classes on
// any element, so a mouse-dimmed row stays keyboard-focusable.
function moveFocus(container: HTMLElement, nextId: string): void {
  const all = container.querySelectorAll<HTMLElement>('[data-lineage-focus]')
  all.forEach((el) => {
    el.tabIndex = el.getAttribute('data-lineage-focus') === nextId ? 0 : -1
  })
  const next = container.querySelector<HTMLElement>(`[data-lineage-focus="${nextId}"]`)
  next?.focus()
}

/**
 * Attaches the roving-tabindex + path-walk keydown model to the xyflow
 * wrapper. Returns an `onKeyDown` handler the caller wires directly onto
 * that wrapper's `role="group"` element (LineageDagView, plan 03-07).
 */
export function useLineageKeyboardNav({
  containerRef,
  targets,
  colEdges,
  onSelect,
}: UseLineageKeyboardNavOptions): UseLineageKeyboardNavResult {
  const onKeyDown = useCallback(
    (e: KeyboardEvent<HTMLElement>) => {
      // Tab/Shift+Tab are never intercepted — no preventDefault, focus
      // leaves the canvas to the surrounding chrome.
      if (e.key === 'Tab') return

      const container = containerRef.current
      if (!container) return

      const activeEl = document.activeElement as HTMLElement | null
      const currentId = activeEl?.getAttribute('data-lineage-focus') ?? targets[0]?.id
      if (!currentId) return

      if (e.key === 'Enter' || e.key === ' ' || e.key === 'Spacebar') {
        const target = targets.find((t) => t.id === currentId)
        if (!target) return
        e.preventDefault()
        // Row -> select(nodeId, colKey); header -> select(nodeId) only,
        // matching D-07's select()/clear() contract (Phase 2).
        onSelect(target.cardId, target.kind === 'row' ? target.colKey : undefined)
        return
      }

      const nextId = resolveNextFocus(targets, currentId, e.key, colEdges)
      if (!nextId || nextId === currentId) return
      e.preventDefault()
      moveFocus(container, nextId)
    },
    [containerRef, targets, colEdges, onSelect],
  )

  return { onKeyDown }
}
