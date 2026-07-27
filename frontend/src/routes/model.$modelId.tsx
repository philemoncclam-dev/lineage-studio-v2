// Modeling mode, one model. Loads the model named in the path, and owns both
// undo history and write-back so ModelViewer stays a render-and-emit component.
//
// This route used to be `/model` and opened whichever model happened to be
// first in the index. The Model Browser is now the landing screen and picks the
// model, so the id is in the path — which also makes a model URL shareable and
// bookmarkable.
import { createFileRoute, Link } from '@tanstack/react-router'
import { useCallback, useEffect, useRef, useState } from 'react'
import ModelViewer from '../modeling/ModelViewer'
import { useUndoable } from '../modeling/useUndoable'
import { localStore } from '../model/store'
import { BarsSpinner } from '../shell/BarsSpinner'
import type { LineageModel } from '../model/types'

/** Writes are coalesced — a burst of edits shouldn't mean a burst of JSON.stringify. */
const SAVE_DEBOUNCE_MS = 400

export const Route = createFileRoute('/model/$modelId')({
  component: ModelRoute,
})

function ModelRoute() {
  const { modelId } = Route.useParams()
  const [loaded, setLoaded] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [missing, setMissing] = useState(false)
  const history = useUndoable<LineageModel | null>(null)
  const { present: model, set, reset, undo, redo, canUndo, canRedo } = history

  const saveTimer = useRef<number | undefined>(undefined)
  const pending = useRef<LineageModel | null>(null)

  useEffect(() => {
    let cancelled = false
    setLoaded(false)
    setMissing(false)
    void (async () => {
      try {
        const existing = await localStore.get(modelId)
        if (cancelled) return
        if (!existing) {
          // A stale bookmark or a model deleted from another tab. Say so rather
          // than silently substituting some other model.
          setMissing(true)
          return
        }
        // reset, not set — loading is not an undoable step.
        reset(existing)
        setLoaded(true)
      } catch (err) {
        if (!cancelled) setError(err instanceof Error ? err.message : String(err))
      }
    })()
    return () => {
      cancelled = true
    }
  }, [modelId, reset])

  const persist = useCallback((next: LineageModel) => {
    pending.current = next
    window.clearTimeout(saveTimer.current)
    saveTimer.current = window.setTimeout(() => {
      void localStore
        .save(next)
        .then(() => {
          pending.current = null
        })
        .catch((err: unknown) => {
          setError(err instanceof Error ? err.message : String(err))
        })
    }, SAVE_DEBOUNCE_MS)
  }, [])

  // Undo/redo change the present without going through onChange, so persistence
  // hangs off the model itself rather than off the edit call.
  useEffect(() => {
    if (loaded && model) persist(model)
  }, [model, loaded, persist])

  // Flush any pending save on unmount, so navigating away mid-debounce doesn't
  // silently drop the last edit.
  useEffect(
    () => () => {
      window.clearTimeout(saveTimer.current)
      if (pending.current) void localStore.save(pending.current).catch(() => {})
    },
    [],
  )

  const onChange = useCallback((next: LineageModel) => set(next), [set])

  if (error) {
    return <div className="mv-fallback">Couldn’t open the model: {error}</div>
  }
  if (missing) {
    return (
      <div className="mv-fallback">
        That model no longer exists. <Link to="/models">Back to the model browser</Link>
      </div>
    )
  }
  if (!model) {
    return (
      <div className="mv-fallback">
        <BarsSpinner size={16} /> Loading model…
      </div>
    )
  }
  return (
    <ModelViewer
      model={model}
      onChange={onChange}
      onUndo={undo}
      onRedo={redo}
      canUndo={canUndo}
      canRedo={canRedo}
    />
  )
}
