// /fabric/lineage — the workspace lineage view, modelled on Fabric's own.
//
// Pick a workspace, run the crawl, and get every item in it drawn the way
// Fabric draws them: one card per item with its type icon, arrows for the
// dependencies, laid out left to right. Item-level throughout — a lakehouse is
// one box and its tables are not on the canvas, exactly as in the real product.
//
// The crawl is a BUTTON, not a load. It costs one Fabric call per item in the
// workspace, so a page that fetched on mount would hammer a large tenant every
// time someone navigated here.

import { createFileRoute } from '@tanstack/react-router'
import { useEffect, useState } from 'react'
import { fetchFabricWorkspaces, fetchWorkspaceLineage, type FabricWorkspace } from '../../api'
import { LineageCanvas } from '../../fabric/LineageCanvas'
import { toItemGraph, type ItemGraph } from '../../fabric/lineageItems'
import { BarsSpinner } from '../../shell/BarsSpinner'
import '../../views/fabric.css'
import '../../views/fabricLineage.css'

export const Route = createFileRoute('/fabric/lineage')({
  component: WorkspaceLineageRoute,
})

function WorkspaceLineageRoute() {
  const [workspaces, setWorkspaces] = useState<FabricWorkspace[]>([])
  const [workspaceId, setWorkspaceId] = useState('')
  const [graph, setGraph] = useState<ItemGraph | null>(null)
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
      const items = toItemGraph(await fetchWorkspaceLineage(workspaceId))
      setGraph(items)
      setOpaque(items.items.filter((i) => i.opaque).map((i) => i.name))
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
      setGraph(null)
    } finally {
      setBusy(false)
    }
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
        <button onClick={() => void crawl()} disabled={!workspaceId || busy}>
          {busy ? 'Reading items…' : graph ? 'Re-read' : 'Build lineage'}
        </button>
        {graph && (
          <span className="fx-lineage-hint">
            {graph.items.length} items · {graph.links.length} dependencies · click an
            item to see what it touches
          </span>
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
        {busy && !graph && (
          <div className="fx-lineage-empty" role="status" aria-live="polite">
            <BarsSpinner />
            <p>Reading every notebook and pipeline in the workspace…</p>
          </div>
        )}
        {!busy && !graph && !error && (
          <div className="fx-lineage-empty">
            <p>Pick a workspace and build its lineage.</p>
          </div>
        )}
        {graph && graph.items.length === 0 && (
          <div className="fx-lineage-empty">
            <p>Nothing readable in this workspace.</p>
          </div>
        )}
        {graph && graph.items.length > 0 && <LineageCanvas graph={graph} />}
      </div>
    </div>
  )
}
