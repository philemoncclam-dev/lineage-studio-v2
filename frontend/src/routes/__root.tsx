// Root route: fetches the LineageGraph once (silent-catch-fallback-to-sample,
// ported from App.tsx's old effect), stashes it in RouterContext for
// descendant routes, and renders the shell + <Outlet/> in place of App.tsx's
// old top-bar/mode-ternary composition.

import { createRootRouteWithContext, Outlet } from '@tanstack/react-router'
import { fetchGraph, type LineageGraph } from '../api'
import { adapt, ModelProvider, sampleModel } from '../model'
import AppShell from '../shell/AppShell'

export interface RouterContext {
  graph: LineageGraph | null
  fetchedAt: number | null
}

export const Route = createRootRouteWithContext<RouterContext>()({
  loader: async () => {
    const graph = await fetchGraph().catch(() => null)
    // TRUST-03/D-14: an in-memory, session-only capture of when the graph
    // actually resolved — only set on a real fetch, never on the silent
    // sample-data fallback (FreshnessIndicator treats a null fetchedAt the
    // same as source==='sample'). No persistence.
    return { graph, fetchedAt: graph ? Date.now() : null }
  },
  component: RootComponent,
  pendingComponent: RootPending,
})

function RootComponent() {
  const { graph } = Route.useLoaderData()
  const model = graph ? adapt(graph) : sampleModel()
  return (
    <ModelProvider value={model}>
      <AppShell>
        <Outlet />
      </AppShell>
    </ModelProvider>
  )
}

// Canvas-region pending state (UI-SPEC "loading" consideration): the shell
// around it stays interactive/mounted, only the content area shows a subtle
// skeleton while fetchGraph() resolves.
//
// overlays={false} (CR-01 fix): the Suspense pendingComponent fallback slot
// never receives router match context, so Inspector/CommandPalette (both of
// which read match context via useSelection()/useLoaderData()) would throw
// "Could not find a nearest match!" if mounted here. AppShell's chrome
// (ModeMenu/Rail/RailBottomCluster) reads only router *state* (useRouterState),
// never match context, so it stays mounted and interactive.
function RootPending() {
  return (
    <AppShell overlays={false}>
      <div className="canvas-skeleton" role="status" aria-live="polite">
        Loading graph…
      </div>
    </AppShell>
  )
}
