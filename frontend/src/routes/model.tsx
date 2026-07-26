// Modeling mode. Loads the active model from local storage, seeding the sample
// on first run so the viewer is never empty on a fresh browser, and owns both
// undo history and write-back so ModelViewer stays a render-and-emit component.
import { createFileRoute } from '@tanstack/react-router'
import { useCallback, useEffect, useRef, useState } from 'react'
import ModelViewer from '../modeling/ModelViewer'
import { useUndoable } from '../modeling/useUndoable'
import { sampleModel } from '../model/sample'
import { localStore } from '../model/store'
import { BarsSpinner } from '../shell/BarsSpinner'
import type { LineageModel } from '../model/types'

/** Writes are coalesced — a burst of edits shouldn't mean a burst of JSON.stringify. */
const SAVE_DEBOUNCE_MS = 400

export const Route = createFileRoute('/model')({
  component: ModelRoute,
})

function ModelRoute() {
  const [loaded, setLoaded] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const history = useUndoable<LineageModel | null>(null)
  const { present: model, set, reset, undo, redo, canUndo, canRedo } = history

  const saveTimer = useRef<number | undefined>(undefined)
  const pending = useRef<LineageModel | null>(null)

  useEffect(() => {
    let cancelled = false
    void (async () => {
      try {
        const summaries = await localStore.list()
        const existing = summaries[0] ? await localStore.get(summaries[0].id) : null
        const next = existing ?? sampleModel()
        if (!existing) await localStore.save(next)
        if (!cancelled) {
          // reset, not set — loading is not an undoable step.
          reset(next)
          setLoaded(true)
        }
      } catch (err) {
        if (!cancelled) setError(err instanceof Error ? err.message : String(err))
      }
    })()
    return () => {
      cancelled = true
    }
  }, [reset])

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
