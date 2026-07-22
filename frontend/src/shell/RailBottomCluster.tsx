// Rail-bottom cluster (D-05): Cmd+K search trigger, theme toggle, and a
// tri-state connection-status dot — identical in every mode. The search
// trigger opens the same palette the global Cmd+K listener (owned by
// AppShell) opens; the status dot preserves the existing one-shot
// fetchPurviewStatus() check (02-RESEARCH.md Open Question 1 — no polling).
import { type ReactNode, useEffect, useState } from 'react'
import * as Tooltip from '@radix-ui/react-tooltip'
import { VisuallyHidden } from '@radix-ui/react-visually-hidden'
import { fetchPurviewStatus } from '../api'
import { getTheme, isDarkResolved, setTheme } from './theme'

type StatusDot = 'ok' | 'off' | 'err'

function SearchIcon() {
  return (
    <svg viewBox="0 0 24 24"><circle cx="11" cy="11" r="7" /><path d="M20 20l-3.5-3.5" /></svg>
  )
}

function ThemeIcon({ dark }: { dark: boolean }) {
  return dark ? (
    <svg viewBox="0 0 24 24"><path d="M20 14.5A8.5 8.5 0 1 1 9.5 4a7 7 0 0 0 10.5 10.5Z" /></svg>
  ) : (
    <svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="4.5" /><path d="M12 2.5v3M12 18.5v3M4.2 4.2l2.1 2.1M17.7 17.7l2.1 2.1M2.5 12h3M18.5 12h3M4.2 19.8l2.1-2.1M17.7 6.3l2.1-2.1" /></svg>
  )
}

function RailBottomButton({ label, onClick, children }: { label: string; onClick: () => void; children: ReactNode }) {
  return (
    <Tooltip.Root>
      <Tooltip.Trigger asChild>
        <button type="button" className="rail-bottom-btn" onClick={onClick}>
          {children}
          <VisuallyHidden>{label}</VisuallyHidden>
        </button>
      </Tooltip.Trigger>
      <Tooltip.Portal>
        <Tooltip.Content className="rail-tooltip" side="right" sideOffset={8}>
          {label}
          <Tooltip.Arrow className="rail-tooltip-arrow" />
        </Tooltip.Content>
      </Tooltip.Portal>
    </Tooltip.Root>
  )
}

export default function RailBottomCluster({ onOpenSearch }: { onOpenSearch: () => void }) {
  const [dark, setDark] = useState(() => isDarkResolved())
  const [status, setStatus] = useState<StatusDot>('off')

  useEffect(() => {
    let alive = true
    fetchPurviewStatus()
      .then((s) => { if (alive) setStatus(s.configured ? 'ok' : 'off') })
      .catch(() => { if (alive) setStatus('err') })
    return () => { alive = false }
  }, [])

  const toggleTheme = () => {
    const next = getTheme() === 'dark' || (!getTheme() && isDarkResolved()) ? 'light' : 'dark'
    setTheme(next)
    setDark(next === 'dark')
  }

  return (
    <div className="rail-bottom">
      <RailBottomButton label="Search (⌘K)" onClick={onOpenSearch}>
        <SearchIcon />
      </RailBottomButton>
      <RailBottomButton label="Toggle theme" onClick={toggleTheme}>
        <ThemeIcon dark={dark} />
      </RailBottomButton>
      <Tooltip.Root>
        <Tooltip.Trigger asChild>
          <span className="status-dot-wrap" role="status">
            <span className={`status-dot status-dot-${status}`} />
            <VisuallyHidden>Backend connection status</VisuallyHidden>
          </span>
        </Tooltip.Trigger>
        <Tooltip.Portal>
          <Tooltip.Content className="rail-tooltip" side="right" sideOffset={8}>
            Backend connection status
            <Tooltip.Arrow className="rail-tooltip-arrow" />
          </Tooltip.Content>
        </Tooltip.Portal>
      </Tooltip.Root>
    </div>
  )
}
