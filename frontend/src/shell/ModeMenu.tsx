// App-logo mode switcher (D-02): a Radix DropdownMenu triggered by clicking
// the logo mark, listing the three modes with the current one checkmarked.
// Selecting a mode is a real navigation (drilling, not selection — pushes
// history like any other mode change). No segmented control or rail icon
// ever switches modes (D-02 is the only mode-switch affordance).
import * as DropdownMenu from '@radix-ui/react-dropdown-menu'
import * as Tooltip from '@radix-ui/react-tooltip'
import { VisuallyHidden } from '@radix-ui/react-visually-hidden'
import { Link, useRouterState } from '@tanstack/react-router'
import { MODE_LABEL, MODE_LANDING, modeFromPathname, type ModeKey } from './railConfig'

const MODE_ORDER: ModeKey[] = ['graph', 'lineage', 'model', 'purview']

function LogoMark() {
  // Abstract mark, not a wordmark — the trigger is icon-only per the rail's
  // own icon-only convention (D-04's slim-chrome intent extends to the logo
  // cell above it).
  return (
    <svg viewBox="0 0 24 24">
      <path d="M4 17V9l8-5 8 5v8l-8 5-8-5Z" />
      <path d="M4 9l8 5 8-5M12 14v8" />
    </svg>
  )
}

function CheckIcon() {
  return (
    <svg viewBox="0 0 24 24" className="mode-menu-check"><path d="M5 12.5l4.5 4.5L19 7" /></svg>
  )
}

export default function ModeMenu() {
  const pathname = useRouterState({ select: (s) => s.location.pathname })
  const current = modeFromPathname(pathname)

  return (
    <DropdownMenu.Root>
      <Tooltip.Root>
        <Tooltip.Trigger asChild>
          <DropdownMenu.Trigger asChild>
            <button type="button" className="mode-menu-trigger">
              <LogoMark />
              <VisuallyHidden>Switch mode</VisuallyHidden>
            </button>
          </DropdownMenu.Trigger>
        </Tooltip.Trigger>
        <Tooltip.Portal>
          <Tooltip.Content className="rail-tooltip" side="right" sideOffset={8}>
            Switch mode
            <Tooltip.Arrow className="rail-tooltip-arrow" />
          </Tooltip.Content>
        </Tooltip.Portal>
      </Tooltip.Root>

      <DropdownMenu.Portal>
        <DropdownMenu.Content className="mode-menu" side="right" align="start" sideOffset={8}>
          {MODE_ORDER.map((mode) => (
            <DropdownMenu.Item asChild key={mode}>
              <Link to={MODE_LANDING[mode] as never} className="mode-menu-item" data-current={mode === current}>
                <span className="mode-menu-item-check">{mode === current && <CheckIcon />}</span>
                <span>{MODE_LABEL[mode]}</span>
              </Link>
            </DropdownMenu.Item>
          ))}
        </DropdownMenu.Content>
      </DropdownMenu.Portal>
    </DropdownMenu.Root>
  )
}
