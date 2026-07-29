// A shared model, opened by its link.
//
// This route is reachable WITHOUT SIGNING IN — it is the only one that is, and
// that is the point of the feature: the recipient does not use this app. So it
// mounts outside the sign-in gate (see `__root.tsx`), fetches by token, and
// renders the canvas read-only.
//
// What is on screen is a SNAPSHOT taken when the owner published. It does not
// follow their later edits, and the header says so — a reader who thinks they
// are looking at today's model will cite something that has since changed.

import { createFileRoute } from '@tanstack/react-router'
import { useEffect, useState } from 'react'
import { fetchSharedModel } from '../api'
import ModelViewer from '../modeling/ModelViewer'
import { BarsSpinner } from '../shell/BarsSpinner'
import type { LineageModel } from '../model/types'
import './shared.css'

export const Route = createFileRoute('/s/$shareToken')({
  component: SharedRoute,
})

function SharedRoute() {
  const { shareToken } = Route.useParams()
  const [model, setModel] = useState<LineageModel | null>(null)
  const [name, setName] = useState('')
  const [sharedAt, setSharedAt] = useState<number | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    void (async () => {
      try {
        const shared = await fetchSharedModel(shareToken)
        if (cancelled) return
        setModel(shared.model as LineageModel)
        setName(shared.name)
        setSharedAt(shared.created_at)
      } catch (err) {
        if (!cancelled) setError(err instanceof Error ? err.message : String(err))
      }
    })()
    return () => {
      cancelled = true
    }
  }, [shareToken])

  if (error) {
    return (
      <main className="sh-empty">
        <h1>This link isn't valid</h1>
        {/* Expired, revoked and never-existed are one message on purpose — see
            the backend note. So the page cannot say which, and guessing would
            be worse than saying nothing. */}
        <p>It may have expired, or been revoked by whoever shared it.</p>
      </main>
    )
  }

  if (!model) {
    return (
      <main className="sh-empty" role="status" aria-live="polite">
        <BarsSpinner />
        <p>Opening shared model…</p>
      </main>
    )
  }

  return (
    <div className="sh-page">
      <header className="sh-bar">
        <span className="sh-name">{name || model.name}</span>
        <span className="sh-badge">Read-only</span>
        {sharedAt && (
          <span className="sh-when">
            Shared {new Date(sharedAt * 1000).toLocaleDateString()} — a snapshot,
            not the live model
          </span>
        )}
      </header>
      <div className="sh-canvas">
        <ModelViewer
          model={model}
          // Nothing to write back to: the document lives on the sender's
          // machine, and this viewer holds a copy the reader cannot change.
          onChange={() => {}}
          onUndo={() => {}}
          onRedo={() => {}}
          canUndo={false}
          canRedo={false}
          readOnly
        />
      </div>
    </div>
  )
}
