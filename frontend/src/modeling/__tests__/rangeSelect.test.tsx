// Shift-click range selection across layers, objects and attributes.
//
// Driven through the real component because the rule under test is about the
// ORDER things appear in on screen — which comes from the layout, not from the
// model — and about which modifier the click carried.
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
              { id: 'A3', name: 'charlie', children: [] },
              { id: 'A4', name: 'delta', children: [] },
            ],
          },
        ],
      },
    ],
    transitions: [],
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

/** The status bar is the only place the selection size is stated. */
function selectedCount(): number {
  const status = document.querySelector('.mv-status')?.textContent ?? ''
  return Number(/(\d+) selected/.exec(status)?.[1] ?? 0)
}

const row = (name: string) => screen.getByText(name).closest('.mv-row') as HTMLElement

/**
 * Click with a modifier held.
 *
 * `user.click(el, { shiftKey: true })` does NOT do this — userEvent v14 takes no
 * modifier flags there, so passing them yields a plain click and the test
 * silently exercises the wrong branch. Modifiers have to be held around the
 * click with the keyboard API.
 */
async function clickWith(
  user: ReturnType<typeof userEvent.setup>,
  el: HTMLElement,
  key: 'Shift' | 'Control',
) {
  await user.keyboard(`{${key}>}`)
  await user.click(el)
  await user.keyboard(`{/${key}}`)
}

describe('range selection', () => {
  it('shift-click takes everything between the anchor and the click', async () => {
    const user = userEvent.setup()
    renderViewer()
    await screen.findByText('alpha')

    await user.click(row('alpha'))
    expect(selectedCount()).toBe(1)

    await clickWith(user, row('delta'), 'Shift')
    // alpha, bravo, charlie, delta.
    expect(selectedCount()).toBe(4)
  })

  it('runs the same range backwards', async () => {
    const user = userEvent.setup()
    renderViewer()
    await screen.findByText('alpha')

    await user.click(row('delta'))
    await clickWith(user, row('bravo'), 'Shift')
    // bravo, charlie, delta.
    expect(selectedCount()).toBe(3)
  })

  it('spans the card header, so a range can cross object and attribute levels', async () => {
    const user = userEvent.setup()
    renderViewer()
    await screen.findByText('alpha')

    const header = screen.getByText('orders').closest('.mv-card-header') as HTMLElement
    await user.click(header)
    await clickWith(user, row('bravo'), 'Shift')
    // The object plus alpha and bravo.
    expect(selectedCount()).toBe(3)
  })

  it('ctrl-click still toggles a single entity without taking a range', async () => {
    const user = userEvent.setup()
    renderViewer()
    await screen.findByText('alpha')

    await user.click(row('alpha'))
    await clickWith(user, row('charlie'), 'Control')
    expect(selectedCount()).toBe(2)

    // Toggling the same row off again.
    await clickWith(user, row('charlie'), 'Control')
    expect(selectedCount()).toBe(1)
  })

  it('shift extends from the last plain click, not from the whole selection', async () => {
    const user = userEvent.setup()
    renderViewer()
    await screen.findByText('alpha')

    await user.click(row('alpha'))
    // A ctrl-click moves the anchor too, so the range runs from charlie.
    await clickWith(user, row('charlie'), 'Control')
    await clickWith(user, row('delta'), 'Shift')
    // alpha (kept), charlie, delta — bravo is NOT in the range.
    expect(selectedCount()).toBe(3)
  })
})
