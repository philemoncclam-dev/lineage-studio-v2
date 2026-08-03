// /fabric/integrations — every external service this app calls.
//
// The question this answers is "what does this thing actually talk to, and what
// do I lose if I don't set one up?". Before it, that meant reading five clients
// and three docstrings.
//
// Not "connectors": in Fabric that word already means a data-source connector,
// and this app's audience lives in Fabric. These are dependencies of THIS
// application, not features of theirs.
//
// It reports CONFIGURATION, not liveness — see the note in
// backend/app/integrations.py. So it is safe to load on view: no upstream call,
// nothing to hang behind a firewalled host, no token acquired per visit.

import { createFileRoute } from '@tanstack/react-router'
import { useEffect, useState } from 'react'
import { fetchIntegrations, type Integration } from '../../api'
import { BarsSpinner } from '../../shell/BarsSpinner'
import '../../views/fabric.css'
import '../../views/integrations.css'

export const Route = createFileRoute('/fabric/integrations')({
  component: IntegrationsRoute,
})

function IntegrationsRoute() {
  const [items, setItems] = useState<Integration[] | null>(null)
  const [error, setError] = useState<string | null>(null)

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
    return () => {
      cancelled = true
    }
  }, [])

  const ready = items?.filter((i) => i.configured).length ?? 0

  return (
    <div className="ig-page">
      <header className="ig-head">
        <h1>Integrations</h1>
        {items && (
          <span className="ig-count">
            {ready} of {items.length} configured
          </span>
        )}
        {/* Said once, at the top: a reader who assumes these are health checks
            will misread every row on the page. */}
        <p className="ig-sub">
          What this app calls, and what stops working without each. This is
          configuration — not a live health check.
        </p>
      </header>

      {error && <p className="ig-error">{error}</p>}
      {!items && !error && (
        <div className="ig-loading" role="status" aria-live="polite">
          <BarsSpinner />
        </div>
      )}

      <ul className="ig-list">
        {(items ?? []).map((i) => (
          <li key={i.key} className="ig-card" data-configured={i.configured || undefined}>
            <div className="ig-card-head">
              <span className="ig-status" data-on={i.configured || undefined}>
                {/* The words carry it, not the dot — a colourblind reader gets
                    the same answer as everyone else. */}
                {i.configured ? 'Configured' : 'Not configured'}
              </span>
              <span className="ig-name">{i.name}</span>
              <code className="ig-host">{i.host}</code>
            </div>

            <dl className="ig-facts">
              <div>
                <dt>Used for</dt>
                <dd>{i.purpose}</dd>
              </div>
              <div>
                <dt>Needs</dt>
                <dd>{i.needs}</dd>
              </div>
              {/* Only worth the row when it is actually missing — on a
                  configured service "what you'd lose" is noise. */}
              {!i.configured && (
                <div>
                  <dt>Without it</dt>
                  <dd>{i.degrades}</dd>
                </div>
              )}
              {i.detail && (
                <div>
                  <dt>Now</dt>
                  <dd>{i.detail}</dd>
                </div>
              )}
            </dl>

            {i.caveats.length > 0 && (
              <ul className="ig-caveats">
                {i.caveats.map((c) => (
                  <li key={c}>{c}</li>
                ))}
              </ul>
            )}
          </li>
        ))}
      </ul>
    </div>
  )
}
