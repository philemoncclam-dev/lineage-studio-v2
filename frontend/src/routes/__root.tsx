// Root route: renders the shell + <Outlet/>.
//
// The authored-model layer that used to wrap this tree (ModelProvider/adapt/
// sampleModel) was removed with the old Modeling mode — the model shape is
// being rebuilt from scratch. Only the backend LineageGraph contract survives.
//
// THERE IS NO LOADER HERE ANY MORE, and that is the point. The root used to
// `await fetchGraph()` and stash the result in RouterContext for descendants.
// No descendant ever read it — every surface that draws lineage (Explore, the
// sandbox canvas, the Model Viewer) fetches or builds its own — so the request
// bought nothing but the wait, and a root loader is the one wait that blocks
// first paint. The hosted backend sleeps when idle, so a cold visit sat on the
// "Loading…" skeleton for as long as `/graph` took — bounded at the 4s
// AbortSignal.timeout in api.ts, and paid in full on every cold start, every
// unreachable backend, and every dev session with no backend running — before
// showing an app that then threw the response away. Boot now touches the
// network only for auth.
//
// `fetchGraph` and the LineageGraph types stay in api.ts: the types are the
// frontend/backend contract and `lineage/sandboxToGraph.ts` builds that shape.

import type { ReactNode } from 'react'
import { createRootRoute, Outlet, useRouterState } from '@tanstack/react-router'
import { useAuth } from '../auth/auth'
import { LoginPage } from '../auth/LoginPage'
import AppShell from '../shell/AppShell'
import { BarsSpinner } from '../shell/BarsSpinner'

export const Route = createRootRoute({
  component: RootComponent,
  // Inert while the root has no loader — kept deliberately, not by accident.
  // It is the one line that decides what fills the screen if a root loader is
  // ever added back, and getting it wrong is the CR-01 blank-screen bug. Wired
  // now means the safe fallback is already in place then.
  pendingComponent: RootPending,
})

function RootComponent() {
  // A shared link is the one route that must render for somebody with no
  // account — that is the whole point of it — so it goes OUTSIDE the gate and
  // outside the shell. Inside, a recipient would hit the sign-in wall; and the
  // rail, mode menu and account chip all lead somewhere they cannot go.
  //
  // Matched on the pathname rather than by nesting under a pathless layout
  // route, because the gate wraps the entire tree by design (see `AuthGate`)
  // and one carve-out is smaller than restructuring every route to sit under a
  // second layout.
  const shared = useRouterState({
    select: (s) => s.location.pathname.startsWith('/s/'),
  })
  if (shared) return <Outlet />

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
// skeleton while a route's loader resolves.
//
// Exported for its regression test, and unreachable in the app while the root
// has no loader — see the `pendingComponent` note above. It renders its own
// <AppShell>, which is why it is NOT the router-wide default: below the root,
// RootComponent's shell has already mounted and a second one would nest.
//
// overlays={false} (CR-01 fix): the Suspense pendingComponent fallback slot
// never receives router match context, so overlays that read match context
// would throw "Could not find a nearest match!" if mounted here.
export function RootPending() {
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
