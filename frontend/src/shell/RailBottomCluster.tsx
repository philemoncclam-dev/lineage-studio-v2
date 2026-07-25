// Rail-bottom cluster (D-05): Cmd+K search trigger, theme toggle, and a
// tri-state connection-status dot — identical in every mode. The search
// trigger opens the same palette the global Cmd+K listener (owned by
// AppShell) opens; the status dot preserves the existing one-shot
// fetchPurviewStatus() check (02-RESEARCH.md Open Question 1 — no polling).
import { type ReactNode, useEffect, useState } from 'react'
import * as Tooltip from '@radix-ui/react-tooltip'
import { VisuallyHidden } from '@radix-ui/react-visually-hidden'
import { fetchPurviewStatus } from '../api'

type StatusDot = 'ok' | 'off' | 'err'

function SearchIcon() {
  return (
    <svg viewBox="0 0 24 24"><circle cx="11" cy="11" r="7" /><path d="M20 20l-3.5-3.5" /></svg>
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
  const [status, setStatus] = useState<StatusDot>('off')

  useEffect(() => {
    let alive = true
    fetchPurviewStatus()
      .then((s) => { if (alive) setStatus(s.configured ? 'ok' : 'off') })
      .catch(() => { if (alive) setStatus('err') })
    return () => { alive = false }
  }, [])

  return (
    <div className="rail-bottom">
      <RailBottomButton label="Search (⌘K)" onClick={onOpenSearch}>
        <SearchIcon />
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
