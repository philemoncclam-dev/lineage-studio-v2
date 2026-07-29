// Root route: fetches the LineageGraph once and stashes it in RouterContext
// for descendant routes, then renders the shell + <Outlet/>.
//
// The authored-model layer that used to wrap this tree (ModelProvider/adapt/
// sampleModel) was removed with the old Modeling mode — the model shape is
// being rebuilt from scratch. Only the backend LineageGraph contract survives.

import type { ReactNode } from 'react'
import { createRootRouteWithContext, Outlet } from '@tanstack/react-router'
import { fetchGraph, type LineageGraph } from '../api'
import { useAuth } from '../auth/auth'
import { LoginPage } from '../auth/LoginPage'
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
    <AuthGate>
      <AppShell>
        <Outlet />
      </AppShell>
    </AuthGate>
  )
}

/**
 * Sign-in before anything else.
 *
 * The gate wraps the shell rather than sitting on a `/login` route because
 * there is nothing useful to render underneath it: which workspaces Explore
 * can list is a function of who is asking, so painting the app first and
 * resolving identity afterwards would show a tree that is wrong until it
 * isn't.
 *
 * `starting` is its own state, not folded into signed-out. On a return trip
 * from Microsoft the account is not known until `handleRedirectPromise`
 * settles, and treating that instant as signed-out would flash the sign-in
 * screen at somebody who just signed in.
 */
function AuthGate({ children }: { children: ReactNode }) {
  const { phase } = useAuth()
  if (phase === 'starting') {
    return (
      <div className="lg-booting" role="status" aria-live="polite">
        <BarsSpinner size={16} />
      </div>
    )
  }
  if (phase === 'signed-out') return <LoginPage />
  return <>{children}</>
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
