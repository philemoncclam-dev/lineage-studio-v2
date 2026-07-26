// Canvas context menu.
//
// A plain positioned list rather than a Radix menu: it opens at a point from a
// contextmenu event on many different targets, and the item set is computed from
// what was right-clicked. Radix's trigger-per-target model would mean wrapping
// every row and card header in a menu root, which is exactly the per-row cost
// the virtualized canvas exists to avoid.

import { useEffect, useLayoutEffect, useRef, useState } from 'react'

export interface MenuItem {
  key: string
  label: string
  onSelect?: () => void
  disabled?: boolean
  /** Draws a rule above this item. */
  separated?: boolean
  danger?: boolean
}

interface Props {
  x: number
  y: number
  items: MenuItem[]
  onClose: () => void
}

export default function ContextMenu({ x, y, items, onClose }: Props) {
  const ref = useRef<HTMLDivElement | null>(null)
  const [position, setPosition] = useState({ x, y })

  // Flip back inside the viewport when opened near an edge, before paint so the
  // menu never visibly jumps.
  useLayoutEffect(() => {
    const el = ref.current
    if (!el) return
    const { width, height } = el.getBoundingClientRect()
    setPosition({
      x: x + width > window.innerWidth ? Math.max(4, window.innerWidth - width - 4) : x,
      y: y + height > window.innerHeight ? Math.max(4, window.innerHeight - height - 4) : y,
    })
  }, [x, y])

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopPropagation()
        onClose()
      }
    }
    // Capture phase: close before the canvas handles the click underneath.
    window.addEventListener('keydown', onKey, true)
    return () => window.removeEventListener('keydown', onKey, true)
  }, [onClose])

  return (
    <>
      <div className="cm-catch" onMouseDown={onClose} onContextMenu={(e) => e.preventDefault()} />
      <div
        ref={ref}
        className="cm-menu"
        style={{ left: position.x, top: position.y }}
        role="menu"
        onContextMenu={(e) => e.preventDefault()}
      >
        {items.map((item) => (
          <button
            key={item.key}
            className="cm-item"
            role="menuitem"
            data-separated={item.separated || undefined}
            data-danger={item.danger || undefined}
            disabled={item.disabled}
            onClick={() => {
              item.onSelect?.()
              onClose()
            }}
          >
            {item.label}
          </button>
        ))}
      </div>
    </>
  )
}
