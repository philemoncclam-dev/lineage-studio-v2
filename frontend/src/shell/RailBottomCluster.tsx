// Rail-bottom cluster (D-05): Cmd+K search trigger, theme toggle, and a
// tri-state connection-status dot — identical in every mode. The search
// trigger opens the same palette the global Cmd+K listener (owned by
// AppShell) opens; the status dot preserves the existing one-shot
// fetchPurviewStatus() check (02-RESEARCH.md Open Question 1 — no polling).
import { type ReactNode, useEffect, useState } from 'react'
import * as Tooltip from '@radix-ui/react-tooltip'
import { VisuallyHidden } from '@radix-ui/react-visually-hidden'
import { fetchPurviewStatus } from '../api'
import { useOptionalAuth } from '../auth/auth'
import { accountName, initials } from '../auth/msal'

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

/**
 * Who the app is reading Fabric as, and a way to stop being them.
 *
 * Always shown, including when nobody signed in — that state is the one worth
 * surfacing loudest. On the service-principal fallback the workspaces in
 * Explore belong to a shared robot account, and a user who assumes they are
 * looking at their own access is drawing conclusions from somebody else's
 * permissions.
 */
function IdentityChip() {
  const auth = useOptionalAuth()
  // Outside a provider (router pending fallback, isolated tests) there is no
  // identity to report, and inventing one would be worse than silence.
  if (!auth) return null
  const { account, phase, signIn, signOut } = auth
  const signedIn = phase === 'signed-in'
  const label = signedIn
    ? `${accountName(account)} — sign out`
    : 'Not signed in — showing the service principal’s workspaces. Sign in.'

  return (
    <Tooltip.Root>
      <Tooltip.Trigger asChild>
        <button
          type="button"
          className="rail-identity"
          data-signed-in={signedIn}
          onClick={() => (signedIn ? signOut() : void signIn())}
        >
          {signedIn ? initials(account) : '?'}
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
      <IdentityChip />
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
