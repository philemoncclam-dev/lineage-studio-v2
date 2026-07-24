// Root route: fetches the LineageGraph once (silent-catch-fallback-to-sample,
// ported from App.tsx's old effect), stashes it in RouterContext for
// descendant routes, and renders the shell + <Outlet/> in place of App.tsx's
// old top-bar/mode-ternary composition.

import { createRootRouteWithContext, Outlet, useRouterState } from '@tanstack/react-router'
import { fetchGraph, type LineageGraph } from '../api'
import { adapt, ModelProvider, sampleModel } from '../model'
import { readGraphStash } from '../graphStash'
import AppShell from '../shell/AppShell'
import GraphSnapshotBanner from '../shell/GraphSnapshotBanner'

export interface RouterContext {
  graph: LineageGraph | null
  fetchedAt: number | null
  /** Model name when the graph came from an "Open in graph view" export. */
  snapshotLabel: string | null
}

export const Route = createRootRouteWithContext<RouterContext>()({
  loader: async () => {
    // An authored model exported from the modelling tab ("Open in graph view")
    // wins over the backend graph until the snapshot banner clears it.
    const stash = readGraphStash()
    if (stash) return { graph: stash.graph, fetchedAt: null, snapshotLabel: stash.label }
    const graph = await fetchGraph().catch(() => null)
    // TRUST-03/D-14: an in-memory, session-only capture of when the graph
    // actually resolved — only set on a real fetch, never on the silent
    // sample-data fallback (FreshnessIndicator treats a null fetchedAt the
    // same as source==='sample'). No persistence.
    return { graph, fetchedAt: graph ? Date.now() : null, snapshotLabel: null }
  },
  component: RootComponent,
  pendingComponent: RootPending,
})

function RootComponent() {
  const { graph, snapshotLabel } = Route.useLoaderData()
  const pathname = useRouterState({ select: (s) => s.location.pathname })
  const model = graph ? adapt(graph) : sampleModel()
  // The snapshot banner is only meaningful in the views that render the graph;
  // hide it inside the modelling tab (where the snapshot came from) and purview.
  const showBanner =
    !!snapshotLabel && (pathname.startsWith('/graph') || pathname.startsWith('/lineage'))
  return (
    <ModelProvider value={model}>
      <AppShell>
        {showBanner && <GraphSnapshotBanner label={snapshotLabel} />}
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
