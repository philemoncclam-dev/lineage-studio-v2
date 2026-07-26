// Undo/redo over whole-model snapshots.
//
// Snapshots rather than an inverse-operation log: every mutation in model/edit.ts
// already returns a fresh model and shares untouched subtrees structurally, so
// keeping a reference per step is cheap and — unlike hand-written inverses —
// cannot drift out of sync with the forward operation.
//
// The history is session-only, matching the Model Viewer's own History panel.
// It is not persisted: reopening a model starts a fresh history.

import { useCallback, useMemo, useRef, useState } from 'react'

/** Steps retained before the oldest is dropped, bounding memory on long sessions. */
const HISTORY_LIMIT = 100

export interface Undoable<T> {
  present: T
  set: (next: T) => void
  /** Replaces the present without adding a history entry (e.g. loading). */
  reset: (next: T) => void
  undo: () => void
  redo: () => void
  canUndo: boolean
  canRedo: boolean
}

export function useUndoable<T>(initial: T): Undoable<T> {
  const [past, setPast] = useState<T[]>([])
  const [present, setPresent] = useState<T>(initial)
  const [future, setFuture] = useState<T[]>([])

  // Read the live present inside callbacks without making them depend on it —
  // otherwise every keystroke would rebuild the window keydown listener.
  const presentRef = useRef(present)
  presentRef.current = present

  const set = useCallback((next: T) => {
    if (next === presentRef.current) return
    setPast((p) => {
      const grown = [...p, presentRef.current]
      return grown.length > HISTORY_LIMIT ? grown.slice(grown.length - HISTORY_LIMIT) : grown
    })
    setPresent(next)
    // Any new edit invalidates the redo branch — standard linear-history model.
    setFuture([])
  }, [])

  const reset = useCallback((next: T) => {
    setPast([])
    setFuture([])
    setPresent(next)
  }, [])

  const undo = useCallback(() => {
    setPast((p) => {
      if (p.length === 0) return p
      const previous = p[p.length - 1]
      setFuture((f) => [presentRef.current, ...f])
      setPresent(previous)
      return p.slice(0, -1)
    })
  }, [])

  const redo = useCallback(() => {
    setFuture((f) => {
      if (f.length === 0) return f
      const [next, ...rest] = f
      setPast((p) => [...p, presentRef.current])
      setPresent(next)
      return rest
    })
  }, [])

  return useMemo(
    () => ({
      present,
      set,
      reset,
      undo,
      redo,
      canUndo: past.length > 0,
      canRedo: future.length > 0,
    }),
    [present, set, reset, undo, redo, past.length, future.length],
  )
}
