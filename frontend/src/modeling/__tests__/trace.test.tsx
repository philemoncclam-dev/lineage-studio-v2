// Trace mode, driven through the real component.
//
// The pruning rule is unit-tested against `traceFrom`/`pruneModel`; what only
// the component can answer is whether the keystroke reaches the canvas, whether
// the unrelated model actually leaves the DOM, and whether the entity the trace
// was taken FROM is still identifiable once everything on screen is on the
// trace.
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it } from 'vitest'
import { useState } from 'react'
import {
  createMemoryHistory,
  createRootRoute,
  createRoute,
  createRouter,
  Outlet,
  RouterProvider,
} from '@tanstack/react-router'
import ModelViewer from '../ModelViewer'
import type { LineageModel } from '../../model/types'

/** `alpha` flows Raw -> Curated; `bravo` and the `unrelated` card do not. */
function model(): LineageModel {
  return {
    id: 'm',
    name: 'm',
    createdAt: 0,
    updatedAt: 0,
    layers: [
      {
        id: 'L1',
        name: 'Raw',
        objects: [
          {
            id: 'O1',
            name: 'orders',
            children: [
              { id: 'A1', name: 'alpha', children: [] },
              { id: 'A2', name: 'bravo', children: [] },
            ],
          },
          { id: 'O3', name: 'unrelated', children: [{ id: 'A9', name: 'zulu', children: [] }] },
        ],
      },
      {
        id: 'L2',
        name: 'Curated',
        objects: [
          {
            id: 'O2',
            name: 'orders_gold',
            children: [
              { id: 'B1', name: 'alpha_out', children: [] },
              { id: 'B2', name: 'bravo_out', children: [] },
            ],
          },
        ],
      },
    ],
    transitions: [
      { id: 'T1', source: 'A1', target: 'B1' },
      { id: 'T2', source: 'A2', target: 'B2' },
    ],
    properties: {},
  }
}

class BigResizeObserver {
  cb: ResizeObserverCallback
  constructor(cb: ResizeObserverCallback) {
    this.cb = cb
  }
  observe() {
    this.cb(
      [{ contentRect: { width: 2000, height: 2000 } } as ResizeObserverEntry],
      this as unknown as ResizeObserver,
    )
  }
  unobserve() {}
  disconnect() {}
}
globalThis.ResizeObserver = BigResizeObserver as unknown as typeof ResizeObserver

function renderViewer() {
  function Harness() {
    const [m, setM] = useState(model())
    return (
      <ModelViewer
        model={m}
        onChange={setM}
        onUndo={() => {}}
        onRedo={() => {}}
        canUndo={false}
        canRedo={false}
      />
    )
  }
  const rootRoute = createRootRoute({ component: Outlet })
  const viewerRoute = createRoute({
    getParentRoute: () => rootRoute,
    path: '/',
    component: Harness,
  })
  const router = createRouter({
    routeTree: rootRoute.addChildren([viewerRoute]),
    history: createMemoryHistory({ initialEntries: ['/'] }),
  })
  render(<RouterProvider router={router as never} />)
}

const row = (name: string) => screen.getByText(name).closest('.mv-row') as HTMLElement
const status = () => document.querySelector('.mv-status')?.textContent ?? ''

describe('trace mode', () => {
  it('drops everything off the trace from the DOM, not just from view', async () => {
    const user = userEvent.setup()
    renderViewer()
    await screen.findByText('alpha')

    await user.click(row('alpha'))
    await user.keyboard('t')

    // The chain survives...
    expect(screen.getByText('alpha')).toBeTruthy()
    expect(screen.getByText('alpha_out')).toBeTruthy()
    // ...and the sibling column, and the unrelated card, are GONE rather than
    // hidden — a hidden row keeps its space and the canvas stays full of holes.
    expect(screen.queryByText('bravo')).toBeNull()
    expect(screen.queryByText('bravo_out')).toBeNull()
    expect(screen.queryByText('unrelated')).toBeNull()
    expect(screen.queryByText('zulu')).toBeNull()
  })

  it('marks the row the trace was taken from, and only that one', async () => {
    const user = userEvent.setup()
    renderViewer()
    await screen.findByText('alpha')

    await user.click(row('alpha'))
    await user.keyboard('t')

    expect(row('alpha').getAttribute('data-trace-origin')).toBe('true')
    // Reached, but not the origin — being on the trace is what everything left
    // on screen has in common, so it cannot be what marks the seed.
    expect(row('alpha_out').getAttribute('data-trace-origin')).toBeNull()
  })

  it('says it is tracing, and how much is left', async () => {
    const user = userEvent.setup()
    renderViewer()
    await screen.findByText('alpha')

    expect(status()).not.toContain('Tracing')
    await user.click(row('alpha'))
    await user.keyboard('t')
    expect(status()).toContain('Tracing')
  })

  it('toggles off on the same selection, restoring the whole model', async () => {
    const user = userEvent.setup()
    renderViewer()
    await screen.findByText('alpha')

    await user.click(row('alpha'))
    await user.keyboard('t')
    expect(screen.queryByText('bravo')).toBeNull()

    await user.keyboard('t')
    expect(screen.getByText('bravo')).toBeTruthy()
    expect(screen.getByText('unrelated')).toBeTruthy()
    expect(status()).not.toContain('Tracing')
  })

  it('retraces rather than clearing when the selection has moved on', async () => {
    const user = userEvent.setup()
    renderViewer()
    await screen.findByText('alpha')

    await user.click(row('alpha'))
    await user.keyboard('t')
    // `bravo` is off the first trace, so re-select it from what is still shown:
    // clear the trace, pick the other column, trace again.
    await user.keyboard('{Escape}')
    await user.click(row('bravo'))
    await user.keyboard('t')

    expect(screen.getByText('bravo_out')).toBeTruthy()
    expect(screen.queryByText('alpha')).toBeNull()
    expect(row('bravo').getAttribute('data-trace-origin')).toBe('true')
  })

  it('clears on Escape', async () => {
    const user = userEvent.setup()
    renderViewer()
    await screen.findByText('alpha')

    await user.click(row('alpha'))
    await user.keyboard('t')
    await user.keyboard('{Escape}')

    expect(screen.getByText('bravo')).toBeTruthy()
    expect(status()).not.toContain('Tracing')
  })

  it('traces a whole card from its header, via the columns underneath it', async () => {
    const user = userEvent.setup()
    renderViewer()
    await screen.findByText('alpha')

    // The object has no transition of its own — only its columns do.
    await user.click(screen.getByText('orders'))
    await user.keyboard('t')

    expect(screen.getByText('alpha_out')).toBeTruthy()
    expect(screen.getByText('bravo_out')).toBeTruthy()
    expect(screen.queryByText('unrelated')).toBeNull()
  })
})
