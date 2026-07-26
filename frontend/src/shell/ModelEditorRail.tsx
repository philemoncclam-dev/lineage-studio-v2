// Modeling mode's rail contents. When the vendored model editor is mounted it
// publishes its toolbar state through model-app/railBridge; this component
// renders those actions as native host rail items (same .rail-item idiom as
// Rail.tsx — icon-only, Radix tooltip, VisuallyHidden name) and sends clicks
// back through the bridge. When no editor is mounted (the /model library
// page), it falls back to the static railConfig items.
import { Fragment, useSyncExternalStore, type ReactNode } from 'react'
import * as Tooltip from '@radix-ui/react-tooltip'
import * as DropdownMenu from '@radix-ui/react-dropdown-menu'
import { VisuallyHidden } from '@radix-ui/react-visually-hidden'
import {
  getModelRailState,
  sendModelRailAction,
  subscribeModelRailState,
  type ModelRailAction,
} from '../model-app/railBridge'
import Rail from './Rail'
import { railConfig } from './railConfig'

// Inline stroke SVGs, currentColor, stroke-width 1.8 — Rail.tsx's icon
// convention, one glyph per editor action.
const ICONS: Record<ModelRailAction, ReactNode> = {
  home: (
    <svg viewBox="0 0 24 24"><path d="M4 10.5 12 4l8 6.5V20h-5.5v-5h-5v5H4z" /></svg>
  ),
  overview: (
    <svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="8.5" /><path d="M12 11v5M12 8v.5" /></svg>
  ),
  history: (
    <svg viewBox="0 0 24 24"><path d="M4 12a8 8 0 1 0 2.3-5.6L4 8.5" /><path d="M4 4v4.5H8.5M12 8v4.5l3 2" /></svg>
  ),
  search: (
    <svg viewBox="0 0 24 24"><circle cx="11" cy="11" r="6.5" /><path d="m16 16 4.5 4.5" /></svg>
  ),
  details: (
    <svg viewBox="0 0 24 24"><rect x="3.5" y="4.5" width="17" height="15" rx="1.5" /><path d="M15 4.5v15" /></svg>
  ),
  filter: (
    <svg viewBox="0 0 24 24"><path d="M4 5h16M7 12h10M10 19h4" /></svg>
  ),
  tags: (
    <svg viewBox="0 0 24 24"><path d="M4 4h7l9 9-7 7-9-9z" /><circle cx="8.5" cy="8.5" r="1.2" /></svg>
  ),
  validate: (
    <svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="8.5" /><path d="m8 12.5 2.5 2.5L16 9.5" /></svg>
  ),
  add: (
    <svg viewBox="0 0 24 24"><path d="M12 5v14M5 12h14" /></svg>
  ),
  map: (
    <svg viewBox="0 0 24 24"><circle cx="6" cy="7" r="2.5" /><circle cx="18" cy="17" r="2.5" /><path d="M8.5 7H14a3 3 0 0 1 3 3v4.5" /></svg>
  ),
  tidy: (
    <svg viewBox="0 0 24 24"><path d="M7 4v16M12 4v16M17 4v16" transform="rotate(90 12 12)" /><path d="M8 4h8M6 12h12M9 20h6" /></svg>
  ),
  import: (
    <svg viewBox="0 0 24 24"><path d="M12 4v11M7 10l5 5 5-5" /><path d="M4.5 19.5h15" /></svg>
  ),
  export: (
    <svg viewBox="0 0 24 24"><path d="M12 15V4M7 9l5-5 5 5" /><path d="M4.5 19.5h15" /></svg>
  ),
  graph: (
    <svg viewBox="0 0 24 24"><circle cx="6" cy="7" r="2.5" /><circle cx="18" cy="6" r="2.5" /><circle cx="13" cy="18" r="2.5" /><path d="M8 8l3.5 8M16 8l-2 7.5" /></svg>
  ),
  undo: (
    <svg viewBox="0 0 24 24"><path d="M8.5 5 4 9.5 8.5 14" /><path d="M4 9.5h10a6 6 0 0 1 0 12h-3" /></svg>
  ),
  redo: (
    <svg viewBox="0 0 24 24"><path d="M15.5 5 20 9.5 15.5 14" /><path d="M20 9.5H10a6 6 0 0 0 0 12h3" /></svg>
  ),
  settings: (
    <svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="3" /><path d="M12 3v3M12 18v3M3 12h3M18 12h3M5.6 5.6l2.1 2.1M16.3 16.3l2.1 2.1M18.4 5.6l-2.1 2.1M7.7 16.3l-2.1 2.1" /></svg>
  ),
}

const MORE_ICON = (
  <svg viewBox="0 0 24 24"><circle cx="12" cy="5" r="1.4" /><circle cx="12" cy="12" r="1.4" /><circle cx="12" cy="19" r="1.4" /></svg>
)

interface Item {
  action: ModelRailAction
  label: string
  active?: boolean
  disabled?: boolean
  badge?: number
  sepBefore?: boolean
}

function RailActionButton({ item }: { item: Item }) {
  return (
    <Tooltip.Root>
      <Tooltip.Trigger asChild>
        <button
          type="button"
          className={`rail-item rail-action${item.active ? ' active' : ''}`}
          disabled={item.disabled}
          onClick={() => sendModelRailAction(item.action)}
        >
          {ICONS[item.action]}
          {item.badge != null && item.badge > 0 && <span className="rail-action-badge">{item.badge}</span>}
          <VisuallyHidden>{item.label}</VisuallyHidden>
        </button>
      </Tooltip.Trigger>
      <Tooltip.Portal>
        <Tooltip.Content className="rail-tooltip" side="right" sideOffset={8}>
          {item.label}
          <Tooltip.Arrow className="rail-tooltip-arrow" />
        </Tooltip.Content>
      </Tooltip.Portal>
    </Tooltip.Root>
  )
}

/** The overflow menu — same action bridge, rendered as labelled rows. */
function RailMoreMenu({ items }: { items: Item[] }) {
  return (
    <DropdownMenu.Root>
      <Tooltip.Root>
        <Tooltip.Trigger asChild>
          <DropdownMenu.Trigger asChild>
            <button type="button" className="rail-item rail-action">
              {MORE_ICON}
              <VisuallyHidden>More tools</VisuallyHidden>
            </button>
          </DropdownMenu.Trigger>
        </Tooltip.Trigger>
        <Tooltip.Portal>
          <Tooltip.Content className="rail-tooltip" side="right" sideOffset={8}>
            More tools
            <Tooltip.Arrow className="rail-tooltip-arrow" />
          </Tooltip.Content>
        </Tooltip.Portal>
      </Tooltip.Root>
      <DropdownMenu.Portal>
        <DropdownMenu.Content className="mode-menu" side="right" align="start" sideOffset={8}>
          {items.map((item) => (
            <Fragment key={item.action}>
              {item.sepBefore && <DropdownMenu.Separator className="rail-more-sep" />}
              <DropdownMenu.Item
                className="mode-menu-item rail-more-item"
                disabled={item.disabled}
                onSelect={() => sendModelRailAction(item.action)}
              >
                <span className="rail-more-icon">{ICONS[item.action]}</span>
                <span>{item.label}</span>
              </DropdownMenu.Item>
            </Fragment>
          ))}
        </DropdownMenu.Content>
      </DropdownMenu.Portal>
    </DropdownMenu.Root>
  )
}

export default function ModelEditorRail() {
  const state = useSyncExternalStore(subscribeModelRailState, getModelRailState)

  if (!state) return <Rail items={railConfig.model} />

  // Seventeen icon-only buttons made the rail unreadable — nothing stood out,
  // so everything had to be hovered to be identified. The split below is by
  // reach, not by category: what you touch while actually modelling stays on
  // the rail; what you touch once a session moves behind "More", where it
  // gets a text label and is easier to find than an anonymous glyph was.
  const primary: Item[] = [
    { action: 'home', label: 'Model library' },
    { action: 'search', label: 'Search', active: state.panel === 'search', sepBefore: true },
    { action: 'details', label: 'Details', active: state.panel === 'details' },
    { action: 'filter', label: 'Filter', active: state.panel === 'filter' || state.filterActive },
    { action: 'validate', label: 'Validate', active: state.panel === 'validation', badge: state.validationCount },
    { action: 'add', label: 'Add node', active: state.addMenuOpen, sepBefore: true },
    { action: 'undo', label: 'Undo', disabled: !state.canUndo, sepBefore: true },
    { action: 'redo', label: 'Redo', disabled: !state.canRedo },
  ]

  const overflow: Item[] = [
    { action: 'overview', label: 'Model overview' },
    ...(state.showHistory ? [{ action: 'history', label: 'Version history' } as Item] : []),
    { action: 'graph', label: 'Open in graph view' },
    { action: 'tags', label: 'Tags', sepBefore: true },
    { action: 'map', label: 'Map attributes' },
    { action: 'tidy', label: 'Tidy layout' },
    { action: 'import', label: 'Import', sepBefore: true },
    { action: 'export', label: 'Export' },
    { action: 'settings', label: 'Editor settings', sepBefore: true },
  ]

  return (
    <nav className="rail rail-model" aria-label="Model editor tools">
      {primary.map((item) => (
        <Fragment key={item.action}>
          {item.sepBefore && <span className="rail-sep" aria-hidden />}
          <RailActionButton item={item} />
        </Fragment>
      ))}
      <span className="rail-sep" aria-hidden />
      <RailMoreMenu items={overflow} />
    </nav>
  )
}
