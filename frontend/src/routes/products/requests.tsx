// /products/requests — the owner approval inbox. Pending requests can be
// approved or denied; approving performs the gated Fabric reader grant and
// shows what it did (applied, previewed, or blocked pending an object id).
import { useEffect, useState } from 'react'
import { createFileRoute } from '@tanstack/react-router'
import {
  decideRequest,
  fetchAllRequests,
  fetchPurviewStatus,
  type AccessRequest,
} from '../../api'
import '../../views/products.css'

export const Route = createFileRoute('/products/requests')({
  component: RequestsInbox,
})

function RequestCard({
  req,
  writeEnabled,
  onDecided,
}: {
  req: AccessRequest
  writeEnabled: boolean
  onDecided: (r: AccessRequest) => void
}) {
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const decide = async (approve: boolean) => {
    setBusy(true); setError(null)
    try {
      // Approving applies the grant for real when writes are enabled; otherwise
      // it records the intent (dry-run), which the backend does honestly.
      onDecided(await decideRequest(req.id, { approve, decided_by: 'owner', apply: approve && writeEnabled }))
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="dp-req">
      <div className="dp-req-head">
        <div>
          <div className="dp-req-who"><strong>{req.requester_name}</strong> · {req.product_name}</div>
          <div className="dp-req-meta">{req.requester_email} · {new Date(req.created_at).toLocaleString()}</div>
        </div>
        <span className="dp-pill" data-status={req.status}>{req.status}</span>
      </div>

      {req.justification && <p className="dp-req-just">“{req.justification}”</p>}
      {error && <div className="dp-error">{error}</div>}

      {req.status === 'pending' ? (
        <div className="dp-req-actions">
          <button className="dp-btn primary" disabled={busy} onClick={() => void decide(true)}>
            {busy ? 'Working…' : writeEnabled ? 'Approve & grant' : 'Approve'}
          </button>
          <button className="dp-btn" disabled={busy} onClick={() => void decide(false)}>Deny</button>
        </div>
      ) : (
        <div className="dp-req-meta">
          {req.status === 'approved' ? 'Approved' : 'Denied'}
          {req.decided_by ? ` by ${req.decided_by}` : ''}
          {req.decided_at ? ` · ${new Date(req.decided_at).toLocaleString()}` : ''}
        </div>
      )}

      {req.grant && (
        <div className="dp-req-grant">
          {req.grant.applied
            ? `✓ ${req.grant.describes}`
            : `⧗ ${req.grant.describes}${req.grant.error ? ` — ${req.grant.error}` : ' (previewed)'}`}
        </div>
      )}
    </div>
  )
}

function RequestsInbox() {
  const [requests, setRequests] = useState<AccessRequest[]>([])
  const [writeEnabled, setWriteEnabled] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let alive = true
    Promise.all([fetchAllRequests(), fetchPurviewStatus().catch(() => ({ write_enabled: false }))])
      .then(([r, status]) => { if (alive) { setRequests(r); setWriteEnabled(!!(status as { write_enabled?: boolean }).write_enabled) } })
      .catch((e) => { if (alive) setError(e instanceof Error ? e.message : String(e)) })
    return () => { alive = false }
  }, [])

  const onDecided = (updated: AccessRequest) =>
    setRequests((rs) => rs.map((r) => (r.id === updated.id ? updated : r)))

  return (
    <div className="dp-page">
      <div className="dp-page-head">
        <h1 className="dp-title">Access requests</h1>
        {!writeEnabled && <span className="dp-pill">preview mode</span>}
      </div>

      {error && <div className="dp-error">{error}</div>}

      {requests.length === 0 ? (
        <div className="dp-empty">No access requests yet.</div>
      ) : (
        requests.map((r) => (
          <RequestCard key={r.id} req={r} writeEnabled={writeEnabled} onDecided={onDecided} />
        ))
      )}
    </div>
  )
}
