// /fabric/integrations — every external service this app calls, and who it
// calls them as.
//
// Not "connectors": in Fabric that word already means a data-source connector,
// and this app's audience lives in Fabric. These are dependencies of THIS
// application, not features of theirs.
//
// A LIST, not a wall of cards. The first version gave every service a bordered
// card with four labelled facts, so seven services filled a screen and a half
// of equal-weight boxes — nothing led, and finding the one that was not set up
// meant reading all of them. The row IS the answer now (state, name, host); the
// detail is one click away, and only for the row you asked about.
//
// Identity is the header because it answers the question the list cannot: "the
// app cannot see my workspace" is almost always "nobody granted THIS principal
// access", and that is unactionable until the principal has a name on screen.
//
// The inventory reports CONFIGURATION, not liveness (see
// backend/app/integrations.py) — so it is safe to load on view. The identity
// may make a Graph call, so it is fetched separately and allowed to arrive
// late rather than holding the page.

import { createFileRoute } from '@tanstack/react-router'
import { useEffect, useState } from 'react'
import {
  fetchIdentity,
  fetchIntegrations,
  type Identity,
  type Integration,
} from '../../api'
import { BarsSpinner } from '../../shell/BarsSpinner'
import '../../views/integrations.css'

export const Route = createFileRoute('/fabric/integrations')({
  component: IntegrationsRoute,
})

function IntegrationsRoute() {
  const [items, setItems] = useState<Integration[] | null>(null)
  const [identity, setIdentity] = useState<Identity | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [open, setOpen] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    void (async () => {
      try {
        const list = await fetchIntegrations()
        if (!cancelled) setItems(list)
      } catch (err) {
        if (!cancelled) setError(err instanceof Error ? err.message : String(err))
      }
    })()
    // Deliberately not awaited with the list: a slow or refused directory
    // lookup must not delay the inventory, which needs no network of its own.
    void (async () => {
      try {
        const who = await fetchIdentity()
        if (!cancelled) setIdentity(who)
      } catch {
        /* The header simply stays quiet; the list is the point of the page. */
      }
    })()
    return () => {
      cancelled = true
    }
  }, [])

  const missing = items?.filter((i) => !i.configured).length ?? 0

  return (
    <div className="ig-page">
      <header className="ig-head">
        <h1>Integrations</h1>
        <p className="ig-sub">
          What this app calls, and what stops working without each. Configuration,
          not a live health check.
        </p>
      </header>

      {identity && <IdentityBar identity={identity} />}

      {error && <p className="ig-error">{error}</p>}
      {!items && !error && (
        <div className="ig-loading" role="status" aria-live="polite">
          <BarsSpinner />
        </div>
      )}

      {items && (
        <>
          {/* The one number worth stating. "5 of 7 configured" makes someone
              count the difference; this is already the difference. */}
          <p className="ig-summary">
            {missing === 0
              ? `All ${items.length} configured.`
              : `${missing} of ${items.length} not configured.`}
          </p>

          <ul className="ig-list">
            {items.map((i) => {
              const isOpen = open === i.key
              return (
                <li key={i.key} className="ig-row" data-configured={i.configured || undefined}>
                  <button
                    className="ig-row-main"
                    aria-expanded={isOpen}
                    onClick={() => setOpen(isOpen ? null : i.key)}
                  >
                    {/* Words, not just a colour — same answer for a reader who
                        cannot see the difference between the two dots. */}
                    <span className="ig-state" data-on={i.configured || undefined}>
                      {i.configured ? 'Configured' : 'Not set up'}
                    </span>
                    <span className="ig-name">{i.name}</span>
                    <code className="ig-host">{i.host}</code>
                    {i.detail && <span className="ig-detail">{i.detail}</span>}
                    <span className="ig-chevron" data-open={isOpen || undefined} aria-hidden>
                      ›
                    </span>
                  </button>

                  {isOpen && (
                    <div className="ig-detail-panel">
                      <p>{i.purpose}</p>
                      <dl>
                        <dt>Needs</dt>
                        <dd>{i.needs}</dd>
                        {/* Only when it is missing: on a working service, what
                            you would lose is noise. */}
                        {!i.configured && (
                          <>
                            <dt>Without it</dt>
                            <dd>{i.degrades}</dd>
                          </>
                        )}
                      </dl>
                      {i.caveats.length > 0 && (
                        <ul className="ig-caveats">
                          {i.caveats.map((c) => (
                            <li key={c}>{c}</li>
                          ))}
                        </ul>
                      )}
                    </div>
                  )}
                </li>
              )
            })}
          </ul>
        </>
      )}
    </div>
  )
}

/** Who the backend authenticates as — the header's whole job. */
function IdentityBar({ identity }: { identity: Identity }) {
  if (identity.mode === 'user') {
    return (
      <p className="ig-identity" data-mode="user">
        Calling Fabric as <strong>the signed-in user</strong> — everything below runs
        with your own permissions.
      </p>
    )
  }
  return (
    <div className="ig-identity">
      <span className="ig-identity-label">Calling as</span>
      <strong className="ig-identity-name">
        {identity.display_name || 'service principal'}
      </strong>
      {/* The client id is an identifier, not a credential, and it is the exact
          string you paste into a workspace access grant — so it is selectable
          and never truncated. */}
      <code className="ig-identity-id">{identity.client_id}</code>
      {identity.note && <span className="ig-identity-note">{identity.note}</span>}
    </div>
  )
}
