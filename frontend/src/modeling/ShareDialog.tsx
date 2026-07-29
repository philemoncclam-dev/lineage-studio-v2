// Publish a model to a link anyone can open.
//
// Three things this screen says BEFORE the link exists, because each one is a
// surprise afterwards and afterwards is too late:
//
//   1. **Anyone with the link can read it.** No sign-in, no allow-list. That is
//      what "shareable" was asked to mean here, and it is not "private".
//   2. **It is a snapshot.** Later edits stay local until you publish again.
//   3. **It may not survive a redeploy**, when the backend is on SQLite with an
//      ephemeral disk — which `/shares/status` reports and nobody else would
//      know until a recipient said the link was dead.
//
// Styling reuses the viewer's own `.imp-*`/`.ms-backdrop` classes from
// modeling.css. Not the Model Browser's `.mb-*` shell, which lives in a
// stylesheet this view does not import — see the note at the top of
// ModelDialogs.tsx, where reaching across for a skin rendered a dialog as
// unstyled markup in a corner.

import { useEffect, useState } from 'react'
import { fetchShareStatus, shareModel } from '../api'
import type { LineageModel } from '../model/types'

const TTL_CHOICES: { label: string; days: number | null }[] = [
  { label: '7 days', days: 7 },
  { label: '30 days', days: 30 },
  { label: '90 days', days: 90 },
  { label: 'No expiry', days: null },
]

export default function ShareDialog({
  model,
  onClose,
}: {
  model: LineageModel
  onClose: () => void
}) {
  const [ttl, setTtl] = useState<number | null>(90)
  const [busy, setBusy] = useState(false)
  const [link, setLink] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [copied, setCopied] = useState(false)
  const [durable, setDurable] = useState<boolean | null>(null)

  useEffect(() => {
    let cancelled = false
    void fetchShareStatus()
      .then((s) => !cancelled && setDurable(s.durable))
      // An unreachable status endpoint is not worth a warning of its own —
      // publishing will fail loudly a moment later if the backend is down.
      .catch(() => !cancelled && setDurable(null))
    return () => {
      cancelled = true
    }
  }, [])

  async function publish() {
    setBusy(true)
    setError(null)
    try {
      const created = await shareModel(model, model.name || 'Shared model', ttl)
      // Built from the CURRENT origin rather than a configured base: the link
      // has to work where the reader opens it, and this bundle is served from
      // exactly that host.
      setLink(`${window.location.origin}/s/${created.token}`)
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="ms-backdrop" onMouseDown={onClose}>
      <div
        className="imp-panel"
        onMouseDown={(e) => e.stopPropagation()}
        onKeyDown={(e) => e.stopPropagation()}
        role="dialog"
        aria-label="Share this model"
      >
        <header className="imp-head">
          <h2 className="imp-title">Share</h2>
          <button className="imp-x" onClick={onClose} aria-label="Close">
            ×
          </button>
        </header>

        <div className="imp-body">
          {error && <div className="imp-error">{error}</div>}

          {link ? (
            <>
              <p className="imp-lede">
                Anyone with this link can view “{model.name || 'Untitled'}”. They
                don't need an account.
              </p>
              <input
                className="sh-link"
                readOnly
                value={link}
                onFocus={(e) => e.currentTarget.select()}
              />
              <p className="imp-hint">
                This is a snapshot as the model stands now. Your later edits stay
                on this machine until you share again.
              </p>
            </>
          ) : (
            <>
              <p className="imp-lede">
                Publishes a read-only copy to a link.{' '}
                <strong>Anyone who has the link can open it</strong> — there is
                no sign-in and no list of people, so the link itself is the
                permission.
              </p>

              <label className="imp-hint" htmlFor="share-ttl">
                Link expires after
              </label>
              <select
                id="share-ttl"
                className="sh-link"
                value={String(ttl)}
                onChange={(e) =>
                  setTtl(e.target.value === 'null' ? null : Number(e.target.value))
                }
              >
                {TTL_CHOICES.map((c) => (
                  <option key={c.label} value={String(c.days)}>
                    {c.label}
                  </option>
                ))}
              </select>

              {durable === false && (
                /* Not a detail: a link lost to a redeploy is indistinguishable
                   from a revoked one, and the person who followed it cannot
                   tell you which happened. */
                <div className="imp-error">
                  This backend keeps shares in a local file, so links may be lost
                  when it restarts or redeploys. Set <code>DATABASE_URL</code> for
                  links that last.
                </div>
              )}
            </>
          )}
        </div>

        <footer className="imp-foot">
          {link ? (
            <>
              <button className="imp-btn" onClick={onClose}>
                Done
              </button>
              <button
                className="imp-btn imp-btn--primary"
                onClick={() => {
                  void navigator.clipboard.writeText(link).then(() => setCopied(true))
                }}
              >
                {copied ? 'Copied' : 'Copy link'}
              </button>
            </>
          ) : (
            <>
              <button className="imp-btn" onClick={onClose}>
                Cancel
              </button>
              <button
                className="imp-btn imp-btn--primary"
                onClick={() => void publish()}
                disabled={busy}
              >
                {busy ? 'Publishing…' : 'Create link'}
              </button>
            </>
          )}
        </footer>
      </div>
    </div>
  )
}
