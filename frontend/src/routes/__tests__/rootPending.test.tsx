// Regression test for CR-01 (SHELL-07 / ROADMAP SC#6 / Gap #1): RootPending
// (in ../__root) must never mount anything that reads router match context
// (useMatch/useSearch/useLoaderData) — TanStack Router's Suspense fallback
// slot is a sibling of matchContext.Provider, not a descendant of it, so any
// such call throws "Could not find a nearest match!" synchronously and
// blank-screens the app.
//
// This used to be reachable through the app's OWN root route, whose loader
// blocked first paint on fetchGraph(). That loader is gone — nothing read its
// result, and it made every cold visit wait on the backend before painting —
// so the app's root can no longer BE pending, and the test can no longer drive
// the fallback through it.
//
// What it drives instead: a synthetic root route carrying the REAL RootPending
// as its pendingComponent, with a loader that never settles. The component
// under test and the slot it renders into are both the real thing; only the
// route holding them is local. A second assertion pins the app's actual root
// to that same component, so the wiring this protects can't silently drift.
import { render, screen } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  createMemoryHistory,
  createRootRoute,
  createRoute,
  createRouter,
  Outlet,
  RouterProvider,
} from '@tanstack/react-router'

// jsdom has no ResizeObserver; cmdk's Command.List uses one internally.
// Polyfilled defensively — the pending path must not mount CommandPalette at
// all after the fix, but this guards against a partial/incorrect fix that
// still reaches cmdk during the pending render.
class MockResizeObserver {
  observe() {}
  unobserve() {}
  disconnect() {}
}
vi.stubGlobal('ResizeObserver', MockResizeObserver)

vi.mock('../../api', async () => {
  const actual = await vi.importActual<typeof import('../../api')>('../../api')
  return {
    ...actual,
    fetchPurviewStatus: () => Promise.resolve({ configured: false, write_enabled: false }),
  }
})

describe('root pending fallback (CR-01 / SHELL-07)', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('renders the pending fallback without throwing the router match-context invariant', async () => {
    const { RootPending } = await import('../__root')

    const rootRoute = createRootRoute({
      // Never resolves — holds the root in its pending state for the lifetime
      // of the test, so RootPending is what's on screen and the root's own
      // component never mounts (exactly the shipped arrangement).
      loader: () => new Promise(() => {}),
      component: () => <Outlet />,
      pendingComponent: RootPending,
    })

    const indexRoute = createRoute({
      getParentRoute: () => rootRoute,
      path: '/',
      component: () => null,
    })

    const router = createRouter({
      routeTree: rootRoute.addChildren([indexRoute]),
      history: createMemoryHistory({ initialEntries: ['/'] }),
      // Render the pending fallback synchronously instead of after the
      // default 1s/500ms delay, so the test doesn't need fake timers.
      defaultPendingMs: 0,
      defaultPendingMinMs: 0,
    })

    // A synchronous throw during render must surface as a test failure, not
    // be swallowed — render() itself throws if React aborts the commit.
    expect(() => render(<RouterProvider router={router} />)).not.toThrow()

    expect(await screen.findByText(/Loading/i)).toBeInTheDocument()
  })

  it('keeps the app root wired to that same safe fallback', async () => {
    const { Route, RootPending } = await import('../__root')
    expect(Route.options.pendingComponent).toBe(RootPending)
  })
})
