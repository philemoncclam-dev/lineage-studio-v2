// The Model Browser — the app's landing screen.
//
// The route's only job beyond mounting the browser is first-run seeding, which
// moved here from /model when the browser took over as the landing screen.
import { createFileRoute } from '@tanstack/react-router'
import ModelBrowser from '../modeling/ModelBrowser'
import { sampleModel } from '../model/sample'
import { localStore } from '../model/store'

/**
 * Marks that the sample has been offered once. Without it, deleting every model
 * would resurrect the sample on the next visit — which reads as the delete
 * having failed, and makes an empty library impossible to reach.
 */
const SEEDED_KEY = 'lineage-studio:seeded'

async function seedOnFirstRun(): Promise<void> {
  if (localStorage.getItem(SEEDED_KEY)) return
  localStorage.setItem(SEEDED_KEY, '1')
  // Only seed a genuinely empty library — a browser that already has models
  // predates this key and must not gain a stray sample.
  if ((await localStore.list()).length > 0) return
  await localStore.save(sampleModel())
}

export const Route = createFileRoute('/models')({
  // Failure to seed must not block the browser: an empty list is a working
  // screen with its own "create your first model" state.
  loader: () => seedOnFirstRun().catch(() => undefined),
  component: ModelBrowser,
})
