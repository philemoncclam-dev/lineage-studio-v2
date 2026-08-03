// /fabric/lineage — the workspace lineage view, Fabric's own lineage tab as
// this app draws it.
//
// Pick a workspace, run the crawl, get every item in it and the dependencies
// between them on the Modeling canvas. It opens item-level (lakehouse cards
// folded) because that is the question this view answers — "what depends on
// what" — and unfolding a lakehouse turns the same picture into table lineage.
//
// The crawl is a BUTTON, not a load. It costs one Fabric call per item in the
// workspace, so a page that fetched on mount would hammer a large tenant every
// time someone navigated here.
//
// Read-only, deliberately. What is on screen is derived from Fabric, and an
// edit here would be silently thrown away by the next crawl — "Open in
// Modeling" is the way to get an editable copy, and it hands over a snapshot
// that no longer follows the tenant.

import { createFileRoute, useNavigate } from '@tanstack/react-router'
import { useEffect, useMemo, useState } from 'react'
import { fetchFabricWorkspaces, fetchWorkspaceLineage, type FabricWorkspace } from '../../api'
import { graphToModel } from '../../fabric/graphToModel'
import { localStore } from '../../model/store'
import ModelViewer from '../../modeling/ModelViewer'
import { BarsSpinner } from '../../shell/BarsSpinner'
import type { LineageModel } from '../../model/types'
import '../../views/fabric.css'

export const Route = createFileRoute('/fabric/lineage')({
  component: WorkspaceLineageRoute,
})

function WorkspaceLineageRoute() {
  const navigate = useNavigate()
  const [workspaces, setWorkspaces] = useState<FabricWorkspace[]>([])
  const [workspaceId, setWorkspaceId] = useState('')
  const [model, setModel] = useState<LineageModel | null>(null)
  const [opaque, setOpaque] = useState<string[]>([])
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    void (async () => {
      try {
        const list = await fetchFabricWorkspaces()
        if (cancelled) return
        setWorkspaces(list)
        setWorkspaceId((prev) => prev || list[0]?.id || '')
      } catch (err) {
        if (!cancelled) setError(err instanceof Error ? err.message : String(err))
      }
    })()
    return () => {
      cancelled = true
    }
  }, [])

  const crawl = async () => {
    if (!workspaceId) return
    setBusy(true)
    setError(null)
    try {
      const graph = await fetchWorkspaceLineage(workspaceId)
      const { model: built, opaque: skipped } = graphToModel(
        graph,
        workspaces.find((w) => w.id === workspaceId)?.name,
      )
      setModel(built)
      setOpaque(skipped)
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
      setModel(null)
    } finally {
      setBusy(false)
    }
  }

  // Every card starts folded: this view is about items, and a lakehouse
  // unfolded to its tables is the other question.
  const folded = useMemo(
    () => new Set(model?.layers.flatMap((l) => l.objects.map((o) => o.id)) ?? []),
    [model],
  )

  /** Hand the crawl over as an editable model — a snapshot, not a live link. */
  const openInModeling = async () => {
    if (!model) return
    await localStore.save(model)
    await navigate({ to: '/model/$modelId', params: { modelId: model.id } })
  }

  return (
    <div className="fx-lineage-page">
      <header className="fx-lineage-bar">
        <label>
          Workspace{' '}
          <select value={workspaceId} onChange={(e) => setWorkspaceId(e.target.value)}>
            {workspaces.map((w) => (
              <option key={w.id} value={w.id}>
                {w.name}
              </option>
            ))}
          </select>
        </label>
        <button onClick={crawl} disabled={!workspaceId || busy}>
          {busy ? 'Reading items…' : model ? 'Re-read' : 'Build lineage'}
        </button>
        {model && (
          <>
            <span className="fx-lineage-hint">
              T traces · ⇧T upstream · ⌥T downstream · open a card for its tables
            </span>
            <button onClick={() => void openInModeling()}>Open in Modeling</button>
          </>
        )}
      </header>

      {/* Said out loud rather than left to an isolated box. A report with no
          arrows looks exactly like a report nothing depends on, and that is the
          one wrong answer this view could give. */}
      {opaque.length > 0 && (
        <p className="fx-lineage-note">
          {opaque.length} item{opaque.length === 1 ? '' : 's'} could not be read for
          dependencies ({opaque.slice(0, 3).join(', ')}
          {opaque.length > 3 ? '…' : ''}) — they are drawn without edges, which does
          not mean nothing depends on them.
        </p>
      )}
      {error && <p className="fx-lineage-error">{error}</p>}

      <div className="fx-lineage-canvas">
        {busy && !model && (
          <div className="fx-lineage-empty" role="status" aria-live="polite">
            <BarsSpinner />
            <p>Reading every notebook and pipeline in the workspace…</p>
          </div>
        )}
        {!busy && !model && !error && (
          <div className="fx-lineage-empty">
            <p>Pick a workspace and build its lineage.</p>
          </div>
        )}
        {model && (
          <ModelViewer
            key={model.id}
            model={model}
            initialCollapsed={folded}
            onChange={() => {}}
            onUndo={() => {}}
            onRedo={() => {}}
            canUndo={false}
            canRedo={false}
            readOnly
          />
        )}
      </div>
    </div>
  )
}
