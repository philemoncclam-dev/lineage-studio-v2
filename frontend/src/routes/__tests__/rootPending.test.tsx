// Regression test for CR-01 (SHELL-07 / ROADMAP SC#6 / Gap #1): the router's
// pendingComponent (RootPending in ../__root) must never mount anything that
// reads router match context (useMatch/useSearch/useLoaderData) — TanStack
// Router's Suspense fallback slot is a sibling of matchContext.Provider, not a
// descendant of it, so any such call throws "Could not find a nearest match!"
// synchronously and blank-screens the app. This test drives the REAL root
// Route into its pending state (fetchGraph() never resolves) and asserts the
// render survives and shows the loading skeleton — the test that would have
// caught the crash before it shipped.
import { render, screen } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  createMemoryHistory,
  createRoute,
  createRouter,
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
    // Never resolves — forces the router to stay in the pending state for
    // the lifetime of the test, so RootPending is what's on screen.
    fetchGraph: () => new Promise(() => {}),
    fetchPurviewStatus: () => Promise.resolve({ configured: false, write_enabled: false }),
  }
})

describe('root route pending state (CR-01 / SHELL-07)', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('renders the pending fallback without throwing the router match-context invariant', async () => {
    // Import the real root Route fresh per-test (its module-level api mock
    // above must already be in place) and build a minimal router from it: the
    // actual Route this app ships, plus one trivial index child so an Outlet
    // target exists.
    const { Route: RootRoute } = await import('../__root')

    const indexRoute = createRoute({
      getParentRoute: () => RootRoute,
      path: '/',
      component: () => null,
    })

    const routeTree = RootRoute.addChildren([indexRoute])

    const router = createRouter({
      routeTree,
      context: { graph: null, fetchedAt: null, snapshotLabel: null },
      history: createMemoryHistory({ initialEntries: ['/'] }),
      // Render the pending fallback synchronously instead of after the
      // default 1s/500ms delay, so the test doesn't need fake timers.
      defaultPendingMs: 0,
      defaultPendingMinMs: 0,
    })

    // A synchronous throw during render must surface as a test failure, not
    // be swallowed — render() itself throws if React aborts the commit.
    expect(() => render(<RouterProvider router={router} />)).not.toThrow()

    expect(await screen.findByText(/Loading graph/i)).toBeInTheDocument()
  })
})
