// Modeling mode. Loads the active model from local storage, seeding the sample
// on first run so the viewer is never empty on a fresh browser.
import { createFileRoute } from '@tanstack/react-router'
import { useEffect, useState } from 'react'
import ModelViewer from '../modeling/ModelViewer'
import { sampleModel } from '../model/sample'
import { localStore } from '../model/store'
import { BarsSpinner } from '../shell/BarsSpinner'
import type { LineageModel } from '../model/types'

export const Route = createFileRoute('/model')({
  component: ModelRoute,
})

function ModelRoute() {
  const [model, setModel] = useState<LineageModel | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    void (async () => {
      try {
        const summaries = await localStore.list()
        const existing = summaries[0] ? await localStore.get(summaries[0].id) : null
        if (existing) {
          if (!cancelled) setModel(existing)
          return
        }
        const seed = sampleModel()
        await localStore.save(seed)
        if (!cancelled) setModel(seed)
      } catch (err) {
        if (!cancelled) setError(err instanceof Error ? err.message : String(err))
      }
    })()
    return () => {
      cancelled = true
    }
  }, [])

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
  return <ModelViewer model={model} />
}
