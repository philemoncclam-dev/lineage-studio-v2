// Generic per-mode icon rail (SHELL-01, SHELL-02, D-01/D-03/D-04). Renders
// one button per `railConfig` entry — data-driven, not hardcoded per-mode
// JSX, so a fifth destination is a one-line railConfig.ts edit. Each item is
// icon-only + a Radix Tooltip label + a persistent VisuallyHidden accessible
// name (Don't Hand-Roll: 02-RESEARCH.md).
import { useSyncExternalStore, type ReactNode } from 'react'
import * as Tooltip from '@radix-ui/react-tooltip'
import { VisuallyHidden } from '@radix-ui/react-visually-hidden'
import { Link, useRouterState } from '@tanstack/react-router'
import type { RailIconName, RailItem } from './railConfig'
import {
  hasRailAction,
  railActionsVersion,
  runRailAction,
  subscribeRailActions,
} from './railActions'

// Inline stroke-based SVGs, currentColor, stroke-width 1.8 — the exact
// pattern `.search svg` already establishes in components.css (01-UI-SPEC.md
// Icon library convention). No icon font, no per-node glyphs.
const ICONS: Record<RailIconName, ReactNode> = {
  scope: (
    <svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="7" /><circle cx="12" cy="12" r="2.5" /><path d="M12 2v3M12 19v3M2 12h3M19 12h3" /></svg>
  ),
  filter: (
    <svg viewBox="0 0 24 24"><path d="M4 5h16M7 12h10M10 19h4" /></svg>
  ),
  layout: (
    <svg viewBox="0 0 24 24"><rect x="3.5" y="3.5" width="17" height="17" rx="1.5" /><path d="M3.5 10h17M10 10v10.5" /></svg>
  ),
  explore: (
    <svg viewBox="0 0 24 24"><path d="M4 6h4l2-2h10v14a2 2 0 0 1-2 2H4z" /><path d="M4 6v12" /></svg>
  ),
  dashboard: (
    <svg viewBox="0 0 24 24"><rect x="3.5" y="3.5" width="7" height="7" rx="1.5" /><rect x="13.5" y="3.5" width="7" height="11" rx="1.5" /><rect x="3.5" y="13.5" width="7" height="7" rx="1.5" /><rect x="13.5" y="17.5" width="7" height="3" rx="1.5" /></svg>
  ),
  sandbox: (
    <svg viewBox="0 0 24 24"><rect x="3.5" y="4.5" width="17" height="15" rx="2.5" /><path d="M10 9.5l5 3-5 3z" /></svg>
  ),
  definitions: (
    <svg viewBox="0 0 24 24"><path d="M6 3h9l4 4v14H6z" /><path d="M15 3v4h4M9 12h6M9 16h6" /></svg>
  ),
  products: (
    <svg viewBox="0 0 24 24"><path d="M3.5 7.5 12 3l8.5 4.5L12 12z" /><path d="M3.5 7.5V16l8.5 4.5V12M20.5 7.5V16L12 20.5" /></svg>
  ),
  layers: (
    <svg viewBox="0 0 24 24"><path d="M12 3.5 3.5 8l8.5 4.5L20.5 8z" /><path d="M3.5 12 12 16.5 20.5 12M3.5 16 12 20.5 20.5 16" /></svg>
  ),
  plus: (
    <svg viewBox="0 0 24 24"><path d="M12 5v14M5 12h14" /></svg>
  ),
  inbox: (
    <svg viewBox="0 0 24 24"><path d="M3.5 13.5 6 5h12l2.5 8.5V19H3.5z" /><path d="M3.5 13.5H9a3 3 0 0 0 6 0h5.5" /></svg>
  ),
  import: (
    <svg viewBox="0 0 24 24"><path d="M12 3v11" /><path d="m8 10.5 4 4 4-4" /><path d="M4 17v3h16v-3" /></svg>
  ),
  export: (
    <svg viewBox="0 0 24 24"><path d="M12 15V4" /><path d="m8 7.5 4-4 4 4" /><path d="M4 17v3h16v-3" /></svg>
  ),
}

export default function Rail({ items }: { items: RailItem[] }) {
  const pathname = useRouterState({ select: (s) => s.location.pathname })
  // Action items are only usable while a page has registered a handler, so the
  // rail has to re-render when registrations change.
  useSyncExternalStore(subscribeRailActions, railActionsVersion, railActionsVersion)
  // First-match-wins: graph items intentionally share a `to` this phase (no
  // distinct sub-page exists yet, see railConfig.ts) — this keeps "current
  // destination" a singular concept even when several config entries resolve
  // to the same route, so accent never marks more than one item at once.
  const activeKey = items.find((it) => it.to === pathname)?.key

  return (
    <nav className="rail" aria-label="Mode destinations">
      {items.map((item) => {
        const isActive = item.key === activeKey
        return (
          <Tooltip.Root key={item.key}>
            <Tooltip.Trigger asChild>
              {item.action ? (
                <button
                  type="button"
                  className="rail-item"
                  disabled={!hasRailAction(item.action)}
                  onClick={() => item.action && runRailAction(item.action)}
                >
                  {ICONS[item.icon]}
                  <VisuallyHidden>{item.label}</VisuallyHidden>
                </button>
              ) : (
                <Link to={item.to as never} className={`rail-item${isActive ? ' active' : ''}`} data-active={isActive}>
                  {ICONS[item.icon]}
                  <VisuallyHidden>{item.label}</VisuallyHidden>
                </Link>
              )}
            </Tooltip.Trigger>
            <Tooltip.Portal>
              <Tooltip.Content className="rail-tooltip" side="right" sideOffset={8}>
                {item.label}
                <Tooltip.Arrow className="rail-tooltip-arrow" />
              </Tooltip.Content>
            </Tooltip.Portal>
          </Tooltip.Root>
        )
      })}
    </nav>
  )
}
