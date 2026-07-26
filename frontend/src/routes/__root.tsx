// Root route: fetches the LineageGraph once and stashes it in RouterContext
// for descendant routes, then renders the shell + <Outlet/>.
//
// The authored-model layer that used to wrap this tree (ModelProvider/adapt/
// sampleModel) was removed with the old Modeling mode — the model shape is
// being rebuilt from scratch. Only the backend LineageGraph contract survives.

import { createRootRouteWithContext, Outlet } from '@tanstack/react-router'
import { fetchGraph, type LineageGraph } from '../api'
import AppShell from '../shell/AppShell'
import { BarsSpinner } from '../shell/BarsSpinner'

export interface RouterContext {
  graph: LineageGraph | null
  fetchedAt: number | null
}

export const Route = createRootRouteWithContext<RouterContext>()({
  loader: async () => {
    const graph = await fetchGraph().catch(() => null)
    // TRUST-03/D-14: an in-memory, session-only capture of when the graph
    // actually resolved — only set on a real fetch. No persistence.
    return { graph, fetchedAt: graph ? Date.now() : null }
  },
  component: RootComponent,
  pendingComponent: RootPending,
})

function RootComponent() {
  return (
    <AppShell>
      <Outlet />
    </AppShell>
  )
}

// Canvas-region pending state (UI-SPEC "loading" consideration): the shell
// around it stays interactive/mounted, only the content area shows a subtle
// skeleton while fetchGraph() resolves.
//
// overlays={false} (CR-01 fix): the Suspense pendingComponent fallback slot
// never receives router match context, so overlays that read match context
// would throw "Could not find a nearest match!" if mounted here.
function RootPending() {
  return (
    <AppShell overlays={false}>
      <div className="canvas-skeleton" role="status" aria-live="polite">
        <span className="loading-row">
          <BarsSpinner size={18} />
          Loading…
        </span>
      </div>
    </AppShell>
  )
}
